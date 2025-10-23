// Popup script
let port = null;
let currentShortcode = null;
let extractedData = {
  media: null,
  comments: null
};

// Password protection
const CORRECT_PASSWORD = 'MM66^^';
const passwordScreen = document.getElementById('passwordScreen');
const mainContent = document.getElementById('mainContent');
const passwordInput = document.getElementById('passwordInput');
const unlockBtn = document.getElementById('unlockBtn');
const passwordError = document.getElementById('passwordError');

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

// Check authentication on load
async function checkAuthentication() {
  const result = await chrome.storage.local.get(['isAuthenticated']);

  if (result.isAuthenticated) {
    unlockExtension();
  }
}

// Verify password
function verifyPassword() {
  const enteredPassword = passwordInput.value;

  if (enteredPassword === CORRECT_PASSWORD) {
    // Correct password - save authentication state
    chrome.storage.local.set({ isAuthenticated: true });
    unlockExtension();
  } else {
    // Wrong password
    passwordError.textContent = '❌ Incorrect password';
    passwordError.classList.remove('hidden');
    passwordInput.value = '';
    passwordInput.focus();

    // Shake animation
    passwordInput.style.animation = 'shake 0.4s';
    setTimeout(() => {
      passwordInput.style.animation = '';
    }, 400);
  }
}

// Unlock extension
function unlockExtension() {
  passwordScreen.classList.add('hidden');
  mainContent.classList.add('unlocked');
  init();
}

// Add shake animation
const style = document.createElement('style');
style.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-10px); }
    75% { transform: translateX(10px); }
  }
`;
document.head.appendChild(style);

// Password screen event listeners
unlockBtn.addEventListener('click', verifyPassword);

passwordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    verifyPassword();
  }
});

passwordInput.addEventListener('input', () => {
  passwordError.classList.add('hidden');
});

// Check authentication on popup load
checkAuthentication();

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
    } else if (msg.type === 'batchProgress') {
      updateBatchProgress(msg.data);
    } else if (msg.type === 'batchComplete') {
      handleBatchComplete(msg.data);
    } else if (msg.type === 'batchStopped') {
      handleBatchStopped(msg.data);
    }
  });

  // Check if we're on a post or reel page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const isPost = tab.url.includes('instagram.com/p/');
  const isReel = tab.url.includes('instagram.com/reel/');

  if (!isPost && !isReel) {
    showStatus('warning', '⚠️ Please open an Instagram post or reel to use this extension');
    extractBtn.disabled = true;
    return;
  }

  // Extract shortcode from URL (works for both /p/ and /reel/)
  const match = tab.url.match(/\/(p|reel)\/([^\/]+)/);
  if (match) {
    currentShortcode = match[2];
    const contentType = match[1] === 'reel' ? 'reel' : 'post';
    showStatus('info', `✅ Ready to extract data from this ${contentType}`);
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

// Helper function to build custom folder name: username_POSTTYPE_YYYYMMDD_shortcode
function buildFolderName(postInfo) {
  const username = postInfo.username || 'unknown';
  const postType = (postInfo.post_type || 'post').toUpperCase();
  const shortcode = postInfo.shortcode || currentShortcode || 'post';

  // Format date as YYYYMMDD (no dashes)
  let dateStr = 'unknown-date';
  if (postInfo.posted_at) {
    const date = new Date(postInfo.posted_at);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    dateStr = `${year}${month}${day}`;
  }

  return `${username}_${postType}_${dateStr}_${shortcode}`;
}

// Helper function to build base filename prefix
function buildFilePrefix(postInfo) {
  return buildFolderName(postInfo);
}

// Build custom filename: USERNAME_POSTTYPE_YYYY-MM-DD_shortcode_comments.ext
function buildCommentsFilename(postInfo, extension) {
  const folderName = buildFolderName(postInfo);
  const filePrefix = buildFilePrefix(postInfo);

  return `Instagram/${folderName}/comments/${filePrefix}_comments.${extension}`;
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
  showStatus('info', '⏳ Downloading media and profile pictures for offline HTML...');

  const postInfo = extractedData.comments?.post_info || extractedData.media?.post_info || {};
  const folderName = buildFolderName(postInfo);
  const filePrefix = buildFilePrefix(postInfo);

  const filename = `Instagram/${folderName}/${filePrefix}_archive.html`;
  const saveAs = askWhereToSaveCheckbox?.checked || false;

  port.postMessage({
    action: 'downloadHTML',
    data: {
      filename: filename,
      saveAs: saveAs
    }
  });

  setTimeout(() => setButtonLoading(downloadHtmlBtn, false), 15000);
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
  const filePrefix = buildFilePrefix(postInfo);

  const filename = `Instagram/${folderName}/${filePrefix}_screenshot.png`;
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

// Batch Download Controls
const toggleBatchBtn = document.getElementById('toggleBatchBtn');
const batchContent = document.getElementById('batchContent');
const batchUrls = document.getElementById('batchUrls');
const urlCount = document.getElementById('urlCount');
const startBatchBtn = document.getElementById('startBatchBtn');
const stopBatchBtn = document.getElementById('stopBatchBtn');
const batchProgress = document.getElementById('batchProgress');
const batchStatus = document.getElementById('batchStatus');
const batchProgressText = document.getElementById('batchProgressText');
const batchProgressBar = document.getElementById('batchProgressBar');
const batchCurrentUrl = document.getElementById('batchCurrentUrl');
const batchResults = document.getElementById('batchResults');
const successCount = document.getElementById('successCount');
const failedSection = document.getElementById('failedSection');
const failedCount = document.getElementById('failedCount');
const failedUrls = document.getElementById('failedUrls');

// Toggle batch section
toggleBatchBtn.addEventListener('click', () => {
  if (batchContent.classList.contains('hidden')) {
    batchContent.classList.remove('hidden');
    toggleBatchBtn.textContent = 'Hide';
  } else {
    batchContent.classList.add('hidden');
    toggleBatchBtn.textContent = 'Show';
  }
});

// Update URL count
batchUrls.addEventListener('input', () => {
  const urls = parseUrls(batchUrls.value);
  urlCount.textContent = `${urls.length} URL${urls.length !== 1 ? 's' : ''}`;

  if (urls.length > 0) {
    urlCount.style.color = '#2e7d32';
  } else {
    urlCount.style.color = '#8e8e8e';
  }
});

// Parse and validate URLs
function parseUrls(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const validUrls = [];
  const seen = new Set();

  for (const line of lines) {
    // Match Instagram post URLs
    if (line.match(/instagram\.com\/(p|reel)\/[^\/\s]+/)) {
      // Normalize URL
      const match = line.match(/instagram\.com\/(p|reel)\/([^\/\s]+)/);
      if (match) {
        const shortcode = match[2];
        const normalizedUrl = `https://www.instagram.com/${match[1]}/${shortcode}/`;

        // Remove duplicates
        if (!seen.has(normalizedUrl)) {
          seen.add(normalizedUrl);
          validUrls.push(normalizedUrl);
        }
      }
    }
  }

  return validUrls;
}

// Start batch processing
startBatchBtn.addEventListener('click', () => {
  const urls = parseUrls(batchUrls.value);

  if (urls.length === 0) {
    showStatus('error', '❌ No valid Instagram URLs found');
    return;
  }

  // Confirm before starting
  const confirmed = confirm(`Start batch download for ${urls.length} post${urls.length !== 1 ? 's' : ''}?\n\nThis will take approximately ${Math.ceil(urls.length * 10 / 60)} minutes.`);

  if (!confirmed) {
    return;
  }

  // Reset UI
  batchProgress.classList.remove('hidden');
  batchResults.classList.add('hidden');
  failedSection.classList.add('hidden');
  successCount.textContent = '0';
  failedCount.textContent = '0';
  failedUrls.innerHTML = '';

  // Disable controls
  startBatchBtn.disabled = true;
  stopBatchBtn.disabled = false;
  batchUrls.disabled = true;

  // Start batch
  port.postMessage({
    action: 'startBatch',
    data: { urls }
  });

  showStatus('info', `🚀 Starting batch download of ${urls.length} posts...`);
});

// Stop batch processing
stopBatchBtn.addEventListener('click', () => {
  port.postMessage({
    action: 'stopBatch'
  });

  startBatchBtn.disabled = false;
  stopBatchBtn.disabled = true;
  batchUrls.disabled = false;

  showStatus('warning', '⏹️ Batch processing stopped');
});

// Update batch progress
function updateBatchProgress(data) {
  const { current, total, url, successCount: success, failedUrls: failed } = data;

  batchProgressText.textContent = `${current}/${total}`;
  batchProgressBar.style.width = `${(current / total) * 100}%`;
  batchCurrentUrl.textContent = url;
  batchStatus.textContent = `Processing post ${current} of ${total}...`;

  successCount.textContent = success;

  if (failed.length > 0) {
    failedSection.classList.remove('hidden');
    failedCount.textContent = failed.length;
    failedUrls.innerHTML = failed.map(f => `<div>${f.url}<br><span style="color: #999;">Error: ${f.error}</span></div>`).join('<br>');
  }

  batchResults.classList.remove('hidden');
}

// Handle batch complete
function handleBatchComplete(data) {
  const { successCount: success, failedUrls: failed, total } = data;

  batchProgress.classList.add('hidden');
  startBatchBtn.disabled = false;
  stopBatchBtn.disabled = true;
  batchUrls.disabled = false;

  successCount.textContent = success;

  if (failed.length > 0) {
    failedSection.classList.remove('hidden');
    failedCount.textContent = failed.length;
    failedUrls.innerHTML = failed.map(f => `<div>${f.url}<br><span style="color: #999;">Error: ${f.error}</span></div>`).join('<br>');

    showStatus('warning', `✅ Batch complete! ${success}/${total} succeeded, ${failed.length} failed`);
  } else {
    showStatus('success', `🎉 Batch complete! All ${success} posts downloaded successfully!`);
  }

  batchResults.classList.remove('hidden');
}

// Handle batch stopped
function handleBatchStopped(data) {
  const { successCount: success, failedUrls: failed } = data;

  batchProgress.classList.add('hidden');
  startBatchBtn.disabled = false;
  stopBatchBtn.disabled = true;
  batchUrls.disabled = false;

  successCount.textContent = success;

  if (failed.length > 0) {
    failedSection.classList.remove('hidden');
    failedCount.textContent = failed.length;
    failedUrls.innerHTML = failed.map(f => `<div>${f.url}<br><span style="color: #999;">Error: ${f.error}</span></div>`).join('<br>');
  }

  batchResults.classList.remove('hidden');
  showStatus('warning', `⏹️ Batch stopped. ${success} posts completed.`);
}

// Note: init() is called from unlockExtension() after password verification
