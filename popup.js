// Popup script
let port = null;
let currentShortcode = null;
let extractedData = {
  media: null,
  comments: null
};

// DOM elements
const statusEl = document.getElementById('status');
const statusTextEl = document.getElementById('statusText');
const statsEl = document.getElementById('stats');
const mediaCountEl = document.getElementById('mediaCount');
const commentCountEl = document.getElementById('commentCount');
const extractBtn = document.getElementById('extractBtn');
const downloadOptionsEl = document.getElementById('downloadOptions');
const downloadMediaBtn = document.getElementById('downloadMediaBtn');
const downloadCommentsBtn = document.getElementById('downloadCommentsBtn');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const downloadJsonBtn = document.getElementById('downloadJsonBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const downloadHtmlBtn = document.getElementById('downloadHtmlBtn');
const downloadScreenshotBtn = document.getElementById('downloadScreenshotBtn');
const askWhereToSaveCheckbox = document.getElementById('askWhereToSave');

// Initialize
async function init() {
  // Connect to background script
  port = chrome.runtime.connect({ name: 'popup' });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'success') {
      showStatus('success', msg.message);
    } else if (msg.type === 'error') {
      showStatus('error', msg.message);
    } else if (msg.type === 'currentData') {
      handleExtractedData(msg.data);
    }
  });

  // Check if we're on a post page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes('instagram.com/p/')) {
    showStatus('warning', '⚠️ Please open an Instagram post to use this extension');
    extractBtn.disabled = true;
    return;
  }

  // Extract shortcode from URL
  const match = tab.url.match(/\/p\/([^\/]+)/);
  if (match) {
    currentShortcode = match[1];
    showStatus('info', '✅ Ready to extract data from this post');
  }

  // Request any previously extracted data from background
  port.postMessage({ action: 'getCurrentData' });
}

// Show status message
function showStatus(type, message) {
  statusEl.className = `status ${type}`;
  statusTextEl.textContent = message;
}

// Handle extracted data
function handleExtractedData(data) {
  extractedData = data;

  // Check for errors
  if (data.media && data.media.error) {
    showStatus('error', `Media Error: ${data.media.error}`);
    return;
  }

  if (data.comments && data.comments.error) {
    showStatus('error', `Comments Error: ${data.comments.error}`);
    return;
  }

  // Update UI with stats
  const mediaCount = data.media?.media?.length || 0;
  const commentCount = data.comments?.total || data.comments?.comments?.length || 0;

  mediaCountEl.textContent = mediaCount;
  commentCountEl.textContent = commentCount;

  if (mediaCount > 0 || commentCount > 0) {
    statsEl.classList.remove('hidden');
    downloadOptionsEl.classList.remove('hidden');
    showStatus('success', '✅ Data extracted successfully!');
  } else {
    showStatus('warning', '⚠️ No data found. Try refreshing the page.');
  }
}

// Set button loading state
function setButtonLoading(button, loading) {
  if (loading) {
    button.disabled = true;
    const originalText = button.textContent;
    button.dataset.originalText = originalText;
    button.innerHTML = '<span class="loading"></span>' + originalText;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

// Extract data from page
extractBtn.addEventListener('click', async () => {
  setButtonLoading(extractBtn, true);
  showStatus('info', '⏳ Extracting data from post...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Request data extraction from content script
    chrome.tabs.sendMessage(tab.id, { action: 'extractMedia' });
    chrome.tabs.sendMessage(tab.id, { action: 'extractComments' });

    // Wait for data to be collected (script tag parsing is fast)
    setTimeout(() => {
      port.postMessage({ action: 'getCurrentData' });
      setButtonLoading(extractBtn, false);
    }, 3000);

  } catch (error) {
    showStatus('error', `Error: ${error.message}`);
    setButtonLoading(extractBtn, false);
  }
});

// Download media only
downloadMediaBtn.addEventListener('click', async () => {
  if (!extractedData.media || !extractedData.media.media) {
    showStatus('error', 'No media to download');
    return;
  }

  setButtonLoading(downloadMediaBtn, true);
  showStatus('info', '⏳ Downloading media files...');

  const saveAs = askWhereToSaveCheckbox?.checked || false;

  port.postMessage({
    action: 'downloadMedia',
    data: {
      media: extractedData.media.media,
      postInfo: extractedData.media.post_info || {},
      saveAs: saveAs
    }
  });

  setTimeout(() => setButtonLoading(downloadMediaBtn, false), 2000);
});

// Helper function to build custom folder name: username_YYYY-MM-DD_shortcode
function buildFolderName(postInfo) {
  const username = postInfo.username || 'unknown';
  const shortcode = postInfo.shortcode || currentShortcode || 'post';

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

// Build custom filename: username_YYYY-MM-DD_shortcode_comments.ext
function buildCommentsFilename(postInfo, extension) {
  const folderName = buildFolderName(postInfo);
  const username = postInfo.username || 'unknown';
  const shortcode = postInfo.shortcode || currentShortcode || 'post';

  // Format date as YYYY-MM-DD
  let dateStr = 'unknown-date';
  if (postInfo.posted_at) {
    const date = new Date(postInfo.posted_at);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    dateStr = `${year}-${month}-${day}`;
  }

  return `Instagram/${folderName}/comments/${username}_${dateStr}_${shortcode}_comments.${extension}`;
}

// Download comments only (JSON)
downloadJsonBtn.addEventListener('click', async () => {
  if (!extractedData.comments || !extractedData.comments.comments) {
    showStatus('error', 'No comments to download');
    return;
  }

  setButtonLoading(downloadJsonBtn, true);
  showStatus('info', '⏳ Downloading comments as JSON...');

  const filename = buildCommentsFilename(extractedData.comments.post_info || {}, 'json');
  const saveAs = askWhereToSaveCheckbox?.checked || false;

  port.postMessage({
    action: 'downloadComments',
    data: {
      comments: extractedData.comments,
      filename: filename,
      format: 'json',
      saveAs: saveAs
    }
  });

  setTimeout(() => setButtonLoading(downloadJsonBtn, false), 1500);
});

// Download comments only (CSV)
downloadCsvBtn.addEventListener('click', async () => {
  if (!extractedData.comments || !extractedData.comments.comments) {
    showStatus('error', 'No comments to download');
    return;
  }

  setButtonLoading(downloadCsvBtn, true);
  showStatus('info', '⏳ Downloading comments as CSV...');

  const filename = buildCommentsFilename(extractedData.comments.post_info || {}, 'csv');
  const saveAs = askWhereToSaveCheckbox?.checked || false;

  port.postMessage({
    action: 'downloadComments',
    data: {
      comments: extractedData.comments,
      filename: filename,
      format: 'csv',
      saveAs: saveAs
    }
  });

  setTimeout(() => setButtonLoading(downloadCsvBtn, false), 1500);
});

// Download HTML archive
downloadHtmlBtn.addEventListener('click', async () => {
  if ((!extractedData.media || !extractedData.media.media) && (!extractedData.comments || !extractedData.comments.comments)) {
    showStatus('error', 'No data to download');
    return;
  }

  setButtonLoading(downloadHtmlBtn, true);
  showStatus('info', '⏳ Downloading profile pictures and generating HTML...');

  const postInfo = extractedData.comments?.post_info || extractedData.media?.post_info || {};
  const folderName = buildFolderName(postInfo);
  const username = postInfo.username || 'unknown';
  const shortcode = postInfo.shortcode || currentShortcode || 'post';

  let dateStr = 'unknown-date';
  if (postInfo.posted_at) {
    const date = new Date(postInfo.posted_at);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    dateStr = `${year}-${month}-${day}`;
  }

  const filename = `Instagram/${folderName}/${username}_${dateStr}_${shortcode}_archive.html`;
  const saveAs = askWhereToSaveCheckbox?.checked || false;

  port.postMessage({
    action: 'downloadHTML',
    data: {
      filename: filename,
      saveAs: saveAs
    }
  });

  setTimeout(() => setButtonLoading(downloadHtmlBtn, false), 5000);
});

// Download comments button (shows format options)
downloadCommentsBtn.addEventListener('click', () => {
  const formatDiv = document.getElementById('commentFormat');
  formatDiv.style.display = formatDiv.style.display === 'none' ? 'flex' : 'none';
});

// Download screenshot
downloadScreenshotBtn.addEventListener('click', async () => {
  setButtonLoading(downloadScreenshotBtn, true);
  showStatus('info', '⏳ Capturing screenshot...');

  // Build screenshot filename
  const postInfo = extractedData.comments?.post_info || extractedData.media?.post_info || {};
  const folderName = buildFolderName(postInfo);
  const username = postInfo.username || 'unknown';
  const shortcode = postInfo.shortcode || currentShortcode || 'post';

  let dateStr = 'unknown-date';
  if (postInfo.posted_at) {
    const date = new Date(postInfo.posted_at);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    dateStr = `${year}-${month}-${day}`;
  }

  const filename = `Instagram/${folderName}/${username}_${dateStr}_${shortcode}_screenshot.png`;
  const saveAs = askWhereToSaveCheckbox?.checked || false;

  port.postMessage({
    action: 'captureScreenshot',
    data: {
      filename: filename,
      saveAs: saveAs
    }
  });

  setTimeout(() => setButtonLoading(downloadScreenshotBtn, false), 1500);
});

// Download everything
downloadAllBtn.addEventListener('click', async () => {
  setButtonLoading(downloadAllBtn, true);
  showStatus('info', '⏳ Downloading everything...');

  const saveAs = askWhereToSaveCheckbox?.checked || false;

  port.postMessage({
    action: 'downloadAll',
    data: {
      saveAs: saveAs
    }
  });

  setTimeout(() => setButtonLoading(downloadAllBtn, false), 3000);
});

// Initialize on load
init();
