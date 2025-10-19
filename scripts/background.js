// Background service worker
let currentData = {
  postData: null,
  comments: null,
  media: null
};

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message.type);

  if (message.type === 'POST_DATA_RESPONSE') {
    currentData.postData = message.data;
  } else if (message.type === 'COMMENTS_RESPONSE') {
    currentData.comments = message.data;
  } else if (message.type === 'MEDIA_RESPONSE') {
    currentData.media = message.data;
  }

  return true;
});

// Offscreen document management
let creatingOffscreen = null;

async function setupOffscreenDocument() {
  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen.html')]
  });

  if (existingContexts.length > 0) {
    return; // Already exists
  }

  // If already creating, wait for it
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  // Create the offscreen document
  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Process and crop screenshot images using Canvas API'
  });

  await creatingOffscreen;
  creatingOffscreen = null;
}

// Crop screenshot using offscreen document
async function cropScreenshot(dataUrl, cropLeftPercent = 15, cropBottomPercent = 10) {
  try {
    await setupOffscreenDocument();

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'CROP_SCREENSHOT',
        dataUrl: dataUrl,
        cropLeft: cropLeftPercent,
        cropBottom: cropBottomPercent
      }, (response) => {
        if (response && response.success) {
          resolve(response.dataUrl);
        } else {
          reject(new Error(response?.error || 'Failed to crop screenshot'));
        }
      });
    });
  } catch (error) {
    console.error('[Background] Error cropping screenshot:', error);
    // Return original if cropping fails
    return dataUrl;
  }
}

// Helper function to download a file
async function downloadFile(url, filename, saveAs = false) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: saveAs  // If true, prompts user for location
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(downloadId);
      }
    });
  });
}

// Helper function to build custom folder name: username_YYYY-MM-DD_shortcode
function buildFolderName(postInfo) {
  const username = postInfo.username || 'unknown';
  const shortcode = postInfo.shortcode || 'post';

  // Format date as YYYY-MM-DD
  let dateStr = 'unknown-date';
  if (postInfo.posted_at) {
    const date = new Date(postInfo.posted_at);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    dateStr = `${year}-${month}-${day}`;
  }

  return `${username}_${dateStr}_${shortcode}`;
}

// Helper function to download data as JSON
function downloadJSON(data, filename, saveAs = false) {
  const jsonString = JSON.stringify(data, null, 2);
  // Use data URL instead of blob URL (Manifest V3 service workers don't have URL.createObjectURL)
  const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonString);

  return downloadFile(dataUrl, filename, saveAs);
}

// Helper function to convert comments to CSV
function commentsToCSV(commentsData) {
  // Extract post info and comments
  const postInfo = commentsData.post_info || {};
  const comments = commentsData.comments || [];

  // CSV Header with post metadata columns
  const rows = [
    [
      'Post Username',
      'Post URL',
      'Post Caption',
      'Post Like Count',
      'Post Comment Count',
      'Post Date',
      'Comment ID',
      'Comment Username',
      'Comment Text',
      'Comment Created At',
      'Comment Likes',
      'Is Reply'
    ]
  ];

  // Post metadata values (will be duplicated in each row)
  const postMetadata = [
    postInfo.username || 'Unknown',
    postInfo.post_url || '',
    (postInfo.caption || '').replace(/"/g, '""'), // Escape quotes
    postInfo.like_count || 0,
    postInfo.comment_count || 0,
    postInfo.posted_at || ''
  ];

  function addComment(comment, isReply = false) {
    rows.push([
      ...postMetadata,
      comment.id,
      comment.owner?.username || 'Unknown',
      (comment.text || '').replace(/"/g, '""'), // Escape quotes
      new Date(comment.created_at * 1000).toISOString(),
      comment.like_count,
      isReply ? 'Yes' : 'No'
    ]);

    // Add replies
    if (comment.replies && comment.replies.length > 0) {
      comment.replies.forEach(reply => addComment(reply, true));
    }
  }

  comments.forEach(comment => addComment(comment));

  return rows.map(row =>
    row.map(cell => `"${cell}"`).join(',')
  ).join('\n');
}

// Helper function to download CSV
function downloadCSV(csvContent, filename, saveAs = false) {
  // Use data URL instead of blob URL (Manifest V3 service workers don't have URL.createObjectURL)
  const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);

  return downloadFile(dataUrl, filename, saveAs);
}

// Helper function to escape HTML
function escapeHTML(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Helper function to fetch avatars via content script
async function fetchAvatarsViaContentScript(urls) {
  if (!urls || urls.length === 0) {
    console.log('[Background] No avatar URLs to fetch');
    return {};
  }

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      console.error('[Background] No active tab found');
      return {};
    }

    console.log('[Background] Active tab:', tab.id, tab.url);
    console.log('[Background] Requesting', urls.length, 'avatars from content script...');
    console.log('[Background] URLs to fetch:', urls);

    // Send message to content script to fetch avatars
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'fetchAvatars',
        urls: urls
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Background] Error fetching avatars:', chrome.runtime.lastError.message);
          resolve({});
        } else if (response && response.success) {
          console.log('[Background] SUCCESS! Received', Object.keys(response.avatarCache).length, 'avatars');
          console.log('[Background] Avatar cache sample:', Object.keys(response.avatarCache).slice(0, 2));
          resolve(response.avatarCache);
        } else {
          console.error('[Background] Failed to fetch avatars. Response:', response);
          resolve({});
        }
      });
    });
  } catch (error) {
    console.error('[Background] Error in fetchAvatarsViaContentScript:', error);
    return {};
  }
}

// Helper function to generate HTML archive
async function generatePostHTML(postData) {
  const media = postData.media?.media || [];
  const comments = postData.comments?.comments || [];
  const post_info = postData.media?.post_info || postData.comments?.post_info || {};

  // Extract post info
  const username = post_info.username || 'unknown';
  const fullName = post_info.full_name || username;
  const profilePicUrl = post_info.profile_pic_url || '';
  const caption = post_info.caption || '';
  const likeCount = post_info.like_count || 0;
  const commentCount = post_info.comment_count || 0;
  const postedAt = post_info.posted_at || '';
  const postUrl = post_info.post_url || '';

  // Collect all unique profile picture URLs
  const profilePicUrls = new Set();
  if (profilePicUrl) profilePicUrls.add(profilePicUrl);

  // Add comment author avatars
  function collectAvatars(commentList) {
    for (const comment of commentList) {
      if (comment.owner?.profile_pic_url) {
        profilePicUrls.add(comment.owner.profile_pic_url);
      }
      if (comment.replies && comment.replies.length > 0) {
        collectAvatars(comment.replies);
      }
    }
  }
  collectAvatars(comments);

  // Fetch all profile pictures via content script
  console.log('[Background] About to fetch avatars, URLs:', Array.from(profilePicUrls));
  const avatarCache = await fetchAvatarsViaContentScript(Array.from(profilePicUrls));
  console.log('[Background] Avatar cache keys:', Object.keys(avatarCache));
  console.log('[Background] Avatar cache has', Object.keys(avatarCache).length, 'entries');

  // Helper to get base64 avatar
  const getAvatar = (url) => {
    const avatar = avatarCache[url] || '';
    if (!avatar) {
      console.warn('[Background] No avatar found for URL:', url);
    }
    return avatar;
  };

  // Format date
  let formattedDate = 'Unknown date';
  if (postedAt) {
    const date = new Date(postedAt);
    formattedDate = date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  // Generate media HTML
  let mediaHTML = '';
  if (media.length > 0) {
    if (media.length === 1) {
      const item = media[0];
      if (item.video_url) {
        mediaHTML = `<video controls class="post-media"><source src="${item.video_url}" type="video/mp4"></video>`;
      } else if (item.image_url) {
        mediaHTML = `<img src="${item.image_url}" alt="Post media" class="post-media">`;
      }
    } else {
      const carouselItems = media.map((item, index) => {
        const content = item.video_url
          ? `<video controls class="post-media"><source src="${item.video_url}" type="video/mp4"></video>`
          : `<img src="${item.image_url}" alt="Post media ${index + 1}" class="post-media">`;
        return `<div class="carousel-item ${index === 0 ? 'active' : ''}">${content}</div>`;
      }).join('');

      const dots = media.map((_, index) =>
        `<span class="dot ${index === 0 ? 'active' : ''}" onclick="currentSlide(${index + 1})"></span>`
      ).join('');

      mediaHTML = `
        <div class="carousel">
          <div class="carousel-container">${carouselItems}</div>
          <button class="carousel-btn prev" onclick="moveCarousel(-1)">❮</button>
          <button class="carousel-btn next" onclick="moveCarousel(1)">❯</button>
          <div class="carousel-dots">${dots}</div>
        </div>`;
    }
  }

  // Generate comments HTML
  function renderComment(comment, isReply = false) {
    const commentDate = new Date(comment.created_at * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    const commentUsername = escapeHTML(comment.owner?.username || 'Unknown');
    const commentAvatarUrl = comment.owner?.profile_pic_url || '';
    const commentAvatar = getAvatar(commentAvatarUrl);

    const replies = comment.replies && comment.replies.length > 0
      ? `<div class="replies">${comment.replies.map(r => renderComment(r, true)).join('')}</div>`
      : '';

    return `
      <div class="comment ${isReply ? 'reply' : ''}">
        <div class="comment-content">
          ${commentAvatar ? `<img src="${commentAvatar}" alt="${commentUsername}" class="comment-avatar">` : '<div class="comment-avatar-placeholder"></div>'}
          <div class="comment-body">
            <div class="comment-header">
              <span class="comment-username">${commentUsername}</span>
              <span class="comment-date">${commentDate}</span>
            </div>
            <div class="comment-text">${escapeHTML(comment.text || '')}</div>
            <div class="comment-footer">
              <span class="comment-likes">${comment.like_count || 0} likes</span>
            </div>
          </div>
        </div>
        ${replies}
      </div>`;
  }

  const commentsHTML = comments.length > 0
    ? comments.map(c => renderComment(c)).join('')
    : '<p class="no-comments">No comments</p>';

  const archiveDate = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHTML(username)} - Instagram Post Archive</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#fafafa;color:#262626;padding:20px}.container{max-width:935px;margin:0 auto;background:white;border:1px solid #dbdbdb;border-radius:8px;overflow:hidden}.post-header{padding:16px;border-bottom:1px solid #efefef;display:flex;align-items:center;justify-content:space-between}.user-info{display:flex;align-items:center;gap:12px}.profile-avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;border:1px solid #dbdbdb}.profile-avatar-placeholder{width:40px;height:40px;border-radius:50%;background:#dbdbdb}.username{font-weight:600;font-size:14px}.full-name{color:#8e8e8e;font-size:12px}.post-date{color:#8e8e8e;font-size:12px}.media-container{background:#000;position:relative;width:100%;min-height:400px;display:flex;align-items:center;justify-content:center}.post-media{width:100%;max-height:600px;object-fit:contain}.carousel{position:relative;width:100%}.carousel-container{position:relative;width:100%;min-height:400px;background:#000}.carousel-item{display:none;width:100%}.carousel-item.active{display:flex;align-items:center;justify-content:center}.carousel-btn{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);color:white;border:none;padding:10px 15px;cursor:pointer;font-size:18px;border-radius:4px;z-index:10}.carousel-btn:hover{background:rgba(0,0,0,0.8)}.carousel-btn.prev{left:10px}.carousel-btn.next{right:10px}.carousel-dots{text-align:center;padding:10px;background:#000}.dot{height:8px;width:8px;margin:0 4px;background-color:#bbb;border-radius:50%;display:inline-block;cursor:pointer}.dot.active{background-color:#0095f6}.post-stats{padding:16px;border-bottom:1px solid #efefef}.stats-row{display:flex;gap:16px;margin-bottom:8px}.stat{font-weight:600;font-size:14px}.caption{padding:16px;border-bottom:1px solid #efefef}.caption-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}.caption-avatar{width:32px;height:32px;border-radius:50%;object-fit:cover;border:1px solid #dbdbdb}.caption-avatar-placeholder{width:32px;height:32px;border-radius:50%;background:#dbdbdb}.caption-username{font-weight:600}.caption-text{white-space:pre-wrap;word-wrap:break-word;display:block}.comments-section{max-height:500px;overflow-y:auto;padding:16px}.comments-header{font-weight:600;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #efefef}.comment{margin-bottom:16px}.comment.reply{margin-left:32px;padding-left:16px;border-left:2px solid #efefef}.comment-content{display:flex;gap:12px;align-items:flex-start}.comment-avatar{width:32px;height:32px;border-radius:50%;object-fit:cover;border:1px solid #dbdbdb;flex-shrink:0}.comment-avatar-placeholder{width:32px;height:32px;border-radius:50%;background:#dbdbdb;flex-shrink:0}.comment-body{flex:1}.comment-header{display:flex;align-items:center;gap:8px;margin-bottom:4px}.comment-username{font-weight:600;font-size:14px}.comment-date{color:#8e8e8e;font-size:12px}.comment-text{font-size:14px;margin-bottom:4px;white-space:pre-wrap;word-wrap:break-word}.comment-footer{display:flex;gap:12px;color:#8e8e8e;font-size:12px}.comment-likes{font-weight:600}.replies{margin-top:12px}.no-comments{text-align:center;color:#8e8e8e;padding:40px}.footer{padding:16px;background:#fafafa;border-top:1px solid #efefef;text-align:center;font-size:12px;color:#8e8e8e}.footer a{color:#0095f6;text-decoration:none}.footer a:hover{text-decoration:underline}</style>
</head>
<body>
<div class="container">
<div class="post-header">
<div class="user-info">
${getAvatar(profilePicUrl) ? `<img src="${getAvatar(profilePicUrl)}" alt="${escapeHTML(username)}" class="profile-avatar">` : '<div class="profile-avatar-placeholder"></div>'}
<div>
<div class="username">${escapeHTML(username)}</div>
${fullName !== username ? `<div class="full-name">${escapeHTML(fullName)}</div>` : ''}
</div>
</div>
<div class="post-date">${formattedDate}</div>
</div>
<div class="media-container">${mediaHTML}</div>
<div class="post-stats">
<div class="stats-row">
<span class="stat">${likeCount.toLocaleString()} likes</span>
<span class="stat">${commentCount.toLocaleString()} comments</span>
</div>
</div>
${caption ? `<div class="caption"><div class="caption-header">${getAvatar(profilePicUrl) ? `<img src="${getAvatar(profilePicUrl)}" alt="${escapeHTML(username)}" class="caption-avatar">` : '<div class="caption-avatar-placeholder"></div>'}<span class="caption-username">${escapeHTML(username)}</span></div><span class="caption-text">${escapeHTML(caption)}</span></div>` : ''}
<div class="comments-section">
<div class="comments-header">Comments</div>
${commentsHTML}
</div>
<div class="footer">Archived from <a href="${postUrl}" target="_blank">Instagram</a> on ${archiveDate}</div>
</div>
<script>let currentSlideIndex=1;showSlide(currentSlideIndex);function moveCarousel(n){showSlide(currentSlideIndex+=n)}function currentSlide(n){showSlide(currentSlideIndex=n)}function showSlide(n){const slides=document.getElementsByClassName("carousel-item");const dots=document.getElementsByClassName("dot");if(slides.length===0)return;if(n>slides.length){currentSlideIndex=1}if(n<1){currentSlideIndex=slides.length}for(let i=0;i<slides.length;i++){slides[i].classList.remove('active')}for(let i=0;i<dots.length;i++){dots[i].classList.remove('active')}slides[currentSlideIndex-1].classList.add('active');if(dots.length>0){dots[currentSlideIndex-1].classList.add('active')}}</script>
</body>
</html>`;
}

// Helper function to download HTML
function downloadHTML(htmlContent, filename, saveAs = false) {
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
  return downloadFile(dataUrl, filename, saveAs);
}

// Expose API for popup
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    port.onMessage.addListener(async (msg) => {
      try {
        if (msg.action === 'getCurrentData') {
          port.postMessage({
            type: 'currentData',
            data: currentData
          });
        } else if (msg.action === 'downloadMedia') {
          const { media, postInfo, saveAs } = msg.data;

          // Build custom folder name
          const folderName = buildFolderName(postInfo);
          const folderPrefix = `Instagram/${folderName}/media`;

          // Build base filename
          const username = postInfo.username || 'unknown';
          const shortcode = postInfo.shortcode || 'post';
          let dateStr = 'unknown-date';
          if (postInfo.posted_at) {
            const date = new Date(postInfo.posted_at);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            dateStr = `${year}-${month}-${day}`;
          }

          for (let i = 0; i < media.length; i++) {
            const item = media[i];
            const url = item.video_url || item.image_url;
            const extension = item.video_url ? 'mp4' : 'jpg';

            // Custom filename: username_YYYY-MM-DD_shortcode_media_1.jpg
            const filename = `${folderPrefix}/${username}_${dateStr}_${shortcode}_media_${i + 1}.${extension}`;

            try {
              // Only prompt saveAs for the first file
              await downloadFile(url, filename, saveAs && i === 0);
            } catch (error) {
              console.error(`Failed to download media ${i + 1}:`, error);
              port.postMessage({
                type: 'error',
                message: `Failed to download media ${i + 1}: ${error.message}`
              });
            }
          }

          port.postMessage({
            type: 'success',
            message: `Downloaded ${media.length} media files`
          });
        } else if (msg.action === 'downloadComments') {
          const { comments, filename, saveAs } = msg.data;

          if (msg.data.format === 'json') {
            await downloadJSON(comments, filename, saveAs);
          } else if (msg.data.format === 'csv') {
            const csv = commentsToCSV(comments);
            await downloadCSV(csv, filename, saveAs);
          }

          port.postMessage({
            type: 'success',
            message: `Downloaded comments as ${msg.data.format.toUpperCase()}`
          });
        } else if (msg.action === 'downloadHTML') {
          // Download HTML archive
          const { filename, saveAs } = msg.data;

          const htmlContent = await generatePostHTML(currentData);
          await downloadHTML(htmlContent, filename, saveAs);

          port.postMessage({
            type: 'success',
            message: 'Downloaded HTML archive'
          });
        } else if (msg.action === 'captureScreenshot') {
          // Capture screenshot of the current tab
          const { filename, saveAs } = msg.data;

          chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (tabs[0]) {
              try {
                const dataUrl = await chrome.tabs.captureVisibleTab(null, {
                  format: 'png',
                  quality: 100
                });

                // Crop the screenshot (remove 15% from left, 10% from bottom)
                const croppedDataUrl = await cropScreenshot(dataUrl, 15, 10);

                await downloadFile(croppedDataUrl, filename, saveAs);

                port.postMessage({
                  type: 'success',
                  message: 'Screenshot captured successfully!'
                });
              } catch (error) {
                console.error('[Background] Screenshot error:', error);
                port.postMessage({
                  type: 'error',
                  message: 'Failed to capture screenshot: ' + error.message
                });
              }
            }
          });
        } else if (msg.action === 'downloadAll') {
          const { saveAs } = msg.data;

          // Get post info from either media or comments data
          const postInfo = currentData.media?.post_info || currentData.comments?.post_info || {};
          const folderName = buildFolderName(postInfo);

          const username = postInfo.username || 'unknown';
          const shortcode = postInfo.shortcode || 'post';
          let dateStr = 'unknown-date';
          if (postInfo.posted_at) {
            const date = new Date(postInfo.posted_at);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            dateStr = `${year}-${month}-${day}`;
          }

          // Download media
          if (currentData.media && currentData.media.media) {
            const folderPrefix = `Instagram/${folderName}/media`;
            for (let i = 0; i < currentData.media.media.length; i++) {
              const item = currentData.media.media[i];
              const url = item.video_url || item.image_url;
              const extension = item.video_url ? 'mp4' : 'jpg';
              const filename = `${folderPrefix}/${username}_${dateStr}_${shortcode}_media_${i + 1}.${extension}`;
              // Only prompt saveAs for the first file
              await downloadFile(url, filename, saveAs && i === 0);
            }
          }

          // Download comments as JSON
          if (currentData.comments && currentData.comments.comments) {
            const filename = `Instagram/${folderName}/comments/${username}_${dateStr}_${shortcode}_comments.json`;
            await downloadJSON(currentData.comments, filename, false);
          }

          // Download post metadata
          const metadata = {
            ...postInfo,
            downloaded_at: new Date().toISOString(),
            media_count: currentData.media?.media?.length || 0,
            comment_count: currentData.comments?.total || 0
          };
          const metadataFilename = `Instagram/${folderName}/${username}_${dateStr}_${shortcode}_metadata.json`;
          await downloadJSON(metadata, metadataFilename, false);

          // Download HTML archive
          const htmlContent = await generatePostHTML(currentData);
          const htmlFilename = `Instagram/${folderName}/${username}_${dateStr}_${shortcode}_archive.html`;
          await downloadHTML(htmlContent, htmlFilename, false);

          // Capture screenshot
          chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (tabs[0]) {
              try {
                const dataUrl = await chrome.tabs.captureVisibleTab(null, {
                  format: 'png',
                  quality: 100
                });

                // Crop the screenshot (remove 15% from left, 10% from bottom)
                const croppedDataUrl = await cropScreenshot(dataUrl, 15, 10);

                const screenshotFilename = `Instagram/${folderName}/${username}_${dateStr}_${shortcode}_screenshot.png`;
                await downloadFile(croppedDataUrl, screenshotFilename, false);

                port.postMessage({
                  type: 'success',
                  message: 'Downloaded all content successfully!'
                });
              } catch (error) {
                console.error('[Background] Screenshot error:', error);
                port.postMessage({
                  type: 'success',
                  message: 'Downloaded all content (screenshot failed)'
                });
              }
            } else {
              port.postMessage({
                type: 'success',
                message: 'Downloaded all content successfully!'
              });
            }
          });
        }
      } catch (error) {
        console.error('[Background] Error:', error);
        port.postMessage({
          type: 'error',
          message: error.message
        });
      }
    });
  }
});

console.log('[Instagram Downloader] Background script loaded');
