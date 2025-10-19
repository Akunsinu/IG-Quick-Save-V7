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
