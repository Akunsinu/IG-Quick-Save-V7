// Offscreen document for image processing
// Used to render Instagram-style screenshots since service workers don't have DOM access

// SVG icons for screenshot export (same as viewer)
const screenshotIcons = {
  heart: `<svg viewBox="0 0 24 24"><path fill="none" stroke="#262626" stroke-width="2" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`,
  comment: `<svg viewBox="0 0 24 24"><path fill="none" stroke="#262626" stroke-width="2" d="M20.656 17.008a9.993 9.993 0 1 0-3.59 3.615L22 22z"/></svg>`,
  share: `<svg viewBox="0 0 24 24"><path fill="none" stroke="#262626" stroke-width="2" stroke-linejoin="round" d="M22 3L9.218 10.083"/><path fill="none" stroke="#262626" stroke-width="2" stroke-linejoin="round" d="M11.698 20.334L22 3 2 3l7.218 7.084 2.48 10.25z"/></svg>`,
  save: `<svg viewBox="0 0 24 24"><path fill="none" stroke="#262626" stroke-width="2" stroke-linejoin="round" d="M20 21l-8-7.56L4 21V3h16v18z"/></svg>`
};

// Helper: Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Helper: Format number
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CROP_SCREENSHOT') {
    cropScreenshot(message.dataUrl, message.cropLeft, message.cropBottom)
      .then(croppedDataUrl => {
        sendResponse({ success: true, dataUrl: croppedDataUrl });
      })
      .catch(error => {
        console.error('[Offscreen] Error cropping screenshot:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }

  if (message.type === 'RENDER_SCREENSHOT') {
    renderInstagramScreenshot(message.postData, message.mediaDataUrl, message.avatarDataUrl)
      .then(screenshotDataUrl => {
        sendResponse({ success: true, dataUrl: screenshotDataUrl });
      })
      .catch(error => {
        console.error('[Offscreen] Error rendering screenshot:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
});

async function cropScreenshot(dataUrl, cropLeftPercent, cropBottomPercent) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');

        // Calculate crop amounts
        const cropLeft = Math.floor(img.width * (cropLeftPercent / 100));
        const cropBottom = Math.floor(img.height * (cropBottomPercent / 100));

        // New dimensions after cropping
        const newWidth = img.width - cropLeft;
        const newHeight = img.height - cropBottom;

        // Set canvas size to the cropped dimensions
        canvas.width = newWidth;
        canvas.height = newHeight;

        // Draw the cropped portion
        ctx.drawImage(
          img,
          cropLeft, 0,
          newWidth, newHeight,
          0, 0,
          newWidth, newHeight
        );

        // Convert back to data URL
        const croppedDataUrl = canvas.toDataURL('image/png', 1.0);
        resolve(croppedDataUrl);

      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    img.src = dataUrl;
  });
}

async function renderInstagramScreenshot(postData, mediaDataUrl, avatarDataUrl) {
  return new Promise(async (resolve, reject) => {
    try {
      const renderContainer = document.getElementById('screenshot-render');

      const username = postData.username || 'Unknown';
      const initial = username.charAt(0).toUpperCase();
      const caption = postData.caption || '';
      const likeCount = postData.like_count || 0;

      // Format date
      let formattedDate = '';
      if (postData.posted_at) {
        const date = new Date(postData.posted_at);
        formattedDate = date.toLocaleDateString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric'
        });
      }

      // Build the HTML structure (same as viewer)
      const container = document.createElement('div');
      container.className = 'screenshot-container';

      container.innerHTML = `
        <div class="screenshot-post">
          <div class="screenshot-header">
            ${avatarDataUrl
              ? `<img class="screenshot-avatar" src="${avatarDataUrl}" alt="${escapeHtml(username)}">`
              : `<div class="screenshot-avatar">${initial}</div>`
            }
            <span class="screenshot-username">${escapeHtml(username)}</span>
          </div>
          <img class="screenshot-media" src="${mediaDataUrl}" alt="">
          <div class="screenshot-actions">
            <div class="screenshot-actions-left">
              ${screenshotIcons.heart}
              ${screenshotIcons.comment}
              ${screenshotIcons.share}
            </div>
            <div class="screenshot-actions-right">
              ${screenshotIcons.save}
            </div>
          </div>
          <div class="screenshot-footer">
            <div class="screenshot-likes">${formatNumber(likeCount)} likes</div>
            ${caption ? `
              <div class="screenshot-caption">
                <strong>${escapeHtml(username)}</strong> ${escapeHtml(caption)}
              </div>
            ` : ''}
            ${formattedDate ? `<div class="screenshot-time">${formattedDate}</div>` : ''}
          </div>
        </div>
      `;

      renderContainer.appendChild(container);

      // Wait for media image to load
      const mediaImg = container.querySelector('.screenshot-media');
      if (mediaImg && !mediaImg.complete) {
        await new Promise((imgResolve) => {
          mediaImg.onload = imgResolve;
          mediaImg.onerror = imgResolve;
        });
      }

      // Wait for avatar if present
      const avatarImg = container.querySelector('img.screenshot-avatar');
      if (avatarImg && !avatarImg.complete) {
        await new Promise((imgResolve) => {
          avatarImg.onload = imgResolve;
          avatarImg.onerror = imgResolve;
        });
      }

      // Small delay for rendering
      await new Promise(resolve => setTimeout(resolve, 100));

      // Capture with html2canvas
      const screenshotPost = container.querySelector('.screenshot-post');
      const canvas = await html2canvas(screenshotPost, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        allowTaint: true
      });

      // Get data URL
      const screenshotDataUrl = canvas.toDataURL('image/png');

      // Cleanup
      renderContainer.removeChild(container);

      resolve(screenshotDataUrl);

    } catch (error) {
      reject(error);
    }
  });
}

console.log('[Offscreen] Document ready for screenshot rendering');
