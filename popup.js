// Popup script
console.log('[Popup] ====== POPUP.JS LOADED ======');
let port = null;
let currentShortcode = null;
let extractedData = {
  media: null,
  comments: null
};

// Password protection (using CONFIG)
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
const openSidePanelBtn = document.getElementById('openSidePanel');

// Name prompt elements
const namePromptOverlay = document.getElementById('namePromptOverlay');
const promptUsernameEl = document.getElementById('promptUsername');
const realNameInput = document.getElementById('realNameInput');
const saveNameBtn = document.getElementById('saveNameBtn');
const skipNameBtn = document.getElementById('skipNameBtn');

// Name prompt state
let pendingDownloadAction = null;
let pendingUsername = null;

// Side panel button handler
if (openSidePanelBtn) {
  openSidePanelBtn.addEventListener('click', async () => {
    try {
      // Send message to background to open side panel
      const response = await chrome.runtime.sendMessage({ action: 'openSidePanel' });
      if (response && response.success) {
        // Close the popup after opening side panel
        window.close();
      } else {
        console.log('[Popup] Could not open side panel:', response?.error);
        // Show tooltip or feedback
        openSidePanelBtn.textContent = '⚠️ Unavailable';
        setTimeout(() => {
          openSidePanelBtn.textContent = '📌 Pin to Side';
        }, 2000);
      }
    } catch (error) {
      console.error('[Popup] Error opening side panel:', error);
    }
  });
}

// Initialize password hash on first run
async function initializePassword() {
  const result = await chrome.storage.local.get([CONFIG.SECURITY.PASSWORD_STORAGE_KEY]);

  // If no password hash exists, create one from default password 'MM66^^'
  if (!result[CONFIG.SECURITY.PASSWORD_STORAGE_KEY]) {
    const defaultHash = await CONFIG.hashPassword('MM777*+');
    await chrome.storage.local.set({ [CONFIG.SECURITY.PASSWORD_STORAGE_KEY]: defaultHash });
  }
}

// Check authentication on load
async function checkAuthentication() {
  await initializePassword();
  const result = await chrome.storage.local.get([CONFIG.SECURITY.AUTH_STORAGE_KEY]);

  if (result[CONFIG.SECURITY.AUTH_STORAGE_KEY]) {
    unlockExtension();
  }
}

// Verify password
async function verifyPassword() {
  const enteredPassword = passwordInput.value;

  // Get stored password hash
  const result = await chrome.storage.local.get([CONFIG.SECURITY.PASSWORD_STORAGE_KEY]);
  const storedHash = result[CONFIG.SECURITY.PASSWORD_STORAGE_KEY];

  // Verify password
  const isValid = await CONFIG.verifyPassword(enteredPassword, storedHash);

  if (isValid) {
    // Correct password - save authentication state
    await chrome.storage.local.set({ [CONFIG.SECURITY.AUTH_STORAGE_KEY]: true });
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
    } else if (msg.type === 'progress') {
      // Real-time progress updates
      showStatus('info', msg.message);
    } else if (msg.type === 'batchProgress') {
      updateBatchProgress(msg.data);
    } else if (msg.type === 'batchComplete') {
      handleBatchComplete(msg.data);
    } else if (msg.type === 'batchStopped') {
      handleBatchStopped(msg.data);
    } else if (msg.type === 'profileScrapeProgress') {
      console.log('[Popup] Received profileScrapeProgress:', msg.data);
      handleProfileScrapeProgress(msg.data);
    } else if (msg.type === 'profileScrapeComplete') {
      console.log('[Popup] Received profileScrapeComplete:', msg.data);
      handleProfileScrapeComplete(msg.data);
    } else if (msg.type === 'profileChunkPause') {
      console.log('[Popup] Received profileChunkPause:', msg.data);
      handleProfileChunkPause(msg.data);
    } else if (msg.type === 'profileResumed') {
      console.log('[Popup] Received profileResumed:', msg.data);
      handleProfileResumed(msg.data);
    } else if (msg.type === 'profileRateLimited') {
      console.log('[Popup] Received profileRateLimited:', msg.data);
      handleProfileRateLimited(msg.data);
    } else if (msg.type === 'savedProfileScrapeState') {
      console.log('[Popup] Received savedProfileScrapeState:', msg.data);
      handleSavedProfileScrapeState(msg.data);
    } else if (msg.type === 'profileScrapingStateSaved') {
      console.log('[Popup] Profile scraping state saved');
    } else if (msg.type === 'profileScrapingStateCleared') {
      console.log('[Popup] Profile scraping state cleared');
    } else if (msg.type === 'downloadStats') {
      // Update download history count when it changes
      if (typeof msg.data.count === 'number') {
        downloadHistoryCount.textContent = msg.data.count;
      }
    } else if (msg.type === 'savedBatchState') {
      // Handle saved batch state for resume functionality
      handleSavedBatchState(msg.data);
    } else if (msg.type === 'batchResumed') {
      // Handle batch resumed confirmation
      handleBatchResumed(msg.data);
    } else if (msg.type === 'urlsFilteredByTeam') {
      // Handle filtered URLs for profile download
      handleUrlsFilteredByTeam(msg.data);
    } else if (msg.type === 'downloadSourceStats') {
      // Handle download source stats update
      handleDownloadSourceStats(msg.data);
    } else if (msg.type === 'folderScanUpdated') {
      // Folder scan completed
      console.log('[Popup] Folder scan updated:', msg.data);
    } else if (msg.type === 'folderScanStats') {
      // Folder scan stats loaded
      handleFolderScanStats(msg.data);
    } else if (msg.type === 'profileScreenshotCaptured') {
      // Profile screenshot captured
      if (msg.data.success) {
        console.log('[Popup] Profile screenshot saved:', msg.data.filename);
        showStatus('success', '📸 Profile screenshot saved!');
      } else {
        console.error('[Popup] Profile screenshot failed:', msg.data.error);
        showStatus('warning', '📸 Screenshot failed: ' + msg.data.error);
      }
    }

    // Handle sync-related messages (defined at bottom of file)
    if (typeof handleSyncMessages === 'function') {
      handleSyncMessages(msg);
    }
  });

  port.onDisconnect.addListener(() => {
    console.log('[Popup] Port disconnected!');
  });

  // Check if we're on a post or reel page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const isPost = tab.url.includes('instagram.com/p/');
  const isReel = tab.url.includes('instagram.com/reel/');
  const isReels = tab.url.includes('instagram.com/reels/');

  if (!isPost && !isReel && !isReels) {
    showStatus('warning', '⚠️ Please open an Instagram post or reel to use this extension');
    extractBtn.disabled = true;
    return;
  }

  // Extract shortcode from URL (works for /p/, /reel/, and /reels/)
  const match = tab.url.match(/\/(p|reel|reels)\/([^\/]+)/);
  if (match) {
    currentShortcode = match[2];
    if (match[1] === 'reel' || match[1] === 'reels') {
      showStatus('info', '🔄 Reel detected - Click Extract to convert to post format');
    } else {
      showStatus('info', `✅ Ready to extract data from this post`);
    }
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

// ===== NAME PROMPT FUNCTIONS =====

// Check if username has a name mapping, show prompt if not
async function checkNameBeforeDownload(username, downloadAction) {
  try {
    // Use sendMessage for simpler request-response pattern
    const response = await chrome.runtime.sendMessage({
      action: 'checkNameMapping',
      data: { username }
    });

    console.log('[Popup] checkNameMapping response:', response);

    if (!response || !response.enabled) {
      // Team Sync not enabled, proceed without name check
      return true;
    }

    if (response.hasMapping) {
      // Name found, proceed
      showStatus('success', `✓ ${response.realName}`);
      return true;
    } else {
      // No name found, show prompt
      showStatus('info', `No name found for @${username}`);
      return new Promise((resolve) => {
        showNamePrompt(username, downloadAction, resolve);
      });
    }
  } catch (error) {
    console.error('[Popup] checkNameBeforeDownload error:', error);
    // On error, proceed with download anyway
    return true;
  }
}

// Show the name prompt modal
function showNamePrompt(username, downloadAction, resolveCallback) {
  pendingDownloadAction = { action: downloadAction, resolve: resolveCallback };
  pendingUsername = username;

  promptUsernameEl.textContent = '@' + username;
  realNameInput.value = '';
  namePromptOverlay.classList.remove('hidden');
  realNameInput.focus();
}

// Hide the name prompt modal
function hideNamePrompt() {
  namePromptOverlay.classList.add('hidden');
  pendingDownloadAction = null;
  pendingUsername = null;
}

// Handle Save Name button
if (saveNameBtn) {
  saveNameBtn.addEventListener('click', async () => {
    const realName = realNameInput.value.trim();

    if (!realName) {
      realNameInput.style.borderColor = '#ed4956';
      setTimeout(() => realNameInput.style.borderColor = '#dbdbdb', 2000);
      return;
    }

    if (!pendingUsername) return;

    // Save the name mapping
    saveNameBtn.disabled = true;
    saveNameBtn.textContent = 'Saving...';

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'addNameMapping',
        data: { username: pendingUsername, realName }
      });

      saveNameBtn.disabled = false;
      saveNameBtn.textContent = 'Save & Continue';

      if (result && result.success) {
        showStatus('success', `✓ Name saved: ${realName}`);
        hideNamePrompt();
        if (pendingDownloadAction?.resolve) {
          pendingDownloadAction.resolve(true);
        }
      } else {
        showStatus('error', result?.error || 'Failed to save name');
      }
    } catch (error) {
      console.error('[Popup] Save name error:', error);
      saveNameBtn.disabled = false;
      saveNameBtn.textContent = 'Save & Continue';
      showStatus('error', 'Failed to save name');
    }
  });
}

// Handle Skip button
if (skipNameBtn) {
  skipNameBtn.addEventListener('click', () => {
    hideNamePrompt();
    if (pendingDownloadAction?.resolve) {
      pendingDownloadAction.resolve(true); // Continue without name
    }
  });
}

// Handle Enter key in name input
if (realNameInput) {
  realNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveNameBtn?.click();
    }
  });
}

// ===== END NAME PROMPT FUNCTIONS =====

// Extract data from page
extractBtn.addEventListener('click', async () => {
  setButtonLoading(extractBtn, true);
  showStatus('info', '⏳ Extracting data from post...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Check if we're on a /reel/ or /reels/ URL and redirect to /p/ for better compatibility
    const reelMatch = tab.url.match(/instagram\.com\/(reel|reels)\/([^\/\?]+)/);
    if (reelMatch) {
      const shortcode = reelMatch[2];
      const postUrl = `https://www.instagram.com/p/${shortcode}/`;
      showStatus('info', '🔄 Converting reel URL to post format...');

      // Redirect to /p/ URL
      await chrome.tabs.update(tab.id, { url: postUrl });

      // Wait for page to load and auto-extract
      showStatus('info', '⏳ Waiting for page to load and auto-extracting...');

      // Listen for tab update to complete
      const listener = (tabId, changeInfo, updatedTab) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);

          // Wait a bit more for Instagram to render, then extract
          setTimeout(async () => {
            showStatus('info', '⏳ Extracting data...');
            chrome.tabs.sendMessage(tab.id, { action: 'extractMedia' });
            chrome.tabs.sendMessage(tab.id, { action: 'extractComments' });

            // Wait for data to be collected
            setTimeout(() => {
              port.postMessage({ action: 'getCurrentData' });
              setButtonLoading(extractBtn, false);
            }, 3000);
          }, 2000);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
      return;
    }

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

// Helper function to build custom folder name: username_POSTTYPE_YYYYMMDD_shortcode[_collab_user1_user2]
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

  // Build base name
  let folderName = `${username}_${postType}_${dateStr}_${shortcode}`;

  // Add collaborators if present
  if (postInfo.collaborators && Array.isArray(postInfo.collaborators) && postInfo.collaborators.length > 0) {
    const collabsToAdd = postInfo.collaborators
      .filter(c => c !== username)
      .slice(0, 3); // Limit to 3 collaborators

    if (collabsToAdd.length > 0) {
      folderName += '_collab_' + collabsToAdd.join('_');
    }
  }

  return folderName;
}

// Helper function to build base filename prefix
function buildFilePrefix(postInfo) {
  return buildFolderName(postInfo);
}

// Build custom filename: USERNAME_POSTTYPE_YYYY-MM-DD_shortcode_comments.ext
async function buildCommentsFilename(postInfo, extension) {
  const username = postInfo.username || 'unknown';
  const folderName = buildFolderName(postInfo);
  const filePrefix = buildFilePrefix(postInfo);

  // Get real name from background for parent folder
  let parentFolder = username;
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'checkNameMapping',
      data: { username }
    });
    if (response?.enabled && response?.hasMapping && response?.realName) {
      const sanitizedRealName = response.realName.replace(/[\/\\:*?"<>|]/g, '_').trim();
      parentFolder = `${sanitizedRealName} - ${username}`;
    }
  } catch (error) {
    console.error('[Popup] Error getting name mapping:', error);
  }

  return `Instagram/${parentFolder}/${folderName}/comments/${filePrefix}_comments.${extension}`;
}

// Download comments only (JSON)
downloadJsonBtn.addEventListener('click', async () => {
  if (!extractedData.comments || !extractedData.comments.comments) {
    showStatus('error', 'No comments to download');
    return;
  }

  setButtonLoading(downloadJsonBtn, true);
  showStatus('info', '⏳ Downloading comments as JSON...');

  const filename = await buildCommentsFilename(extractedData.comments.post_info || {}, 'json');
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

  const filename = await buildCommentsFilename(extractedData.comments.post_info || {}, 'csv');
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
  // Get username from extracted data
  const username = extractedData.media?.post_info?.username ||
                   extractedData.comments?.post_info?.username;

  if (username) {
    // Check for name mapping before download
    setButtonLoading(downloadAllBtn, true);
    showStatus('info', `⏳ Checking name for @${username}...`);

    const canProceed = await checkNameBeforeDownload(username, 'downloadAll');
    if (!canProceed) {
      setButtonLoading(downloadAllBtn, false);
      return; // Name prompt is shown, wait for user action
    }
  }

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
console.log('[Popup] startBatchBtn element:', startBatchBtn);
console.log('[Popup] batchUrls element:', batchUrls);
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
const retryAllFailedBtn = document.getElementById('retryAllFailedBtn');

// Skip downloaded toggle elements
const skipDownloadedToggle = document.getElementById('skipDownloadedToggle');
const downloadHistoryCount = document.getElementById('downloadHistoryCount');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

// Download source elements
const historySourceCount = document.getElementById('historySourceCount');
const folderSourceCount = document.getElementById('folderSourceCount');
const teamSourceCount = document.getElementById('teamSourceCount');
const skipSourceHistory = document.getElementById('skipSourceHistory');
const skipSourceFolder = document.getElementById('skipSourceFolder');
const skipSourceTeam = document.getElementById('skipSourceTeam');
const skipSourceTeamLabel = document.getElementById('skipSourceTeamLabel');
const scanFolderBtn = document.getElementById('scanFolderBtn');
const folderScanInfo = document.getElementById('folderScanInfo');
const folderScanPath = document.getElementById('folderScanPath');

// Resume batch elements
const resumeBatchSection = document.getElementById('resumeBatchSection');
const resumeBatchInfo = document.getElementById('resumeBatchInfo');
const resumeBatchBtn = document.getElementById('resumeBatchBtn');
const discardBatchBtn = document.getElementById('discardBatchBtn');

// Team filter elements
const filterByTeamToggle = document.getElementById('filterByTeamToggle');
const profileTeamFilterInfo = document.getElementById('profileTeamFilterInfo');
const profileNewPostsCount = document.getElementById('profileNewPostsCount');
const profileTeamDownloadedCount = document.getElementById('profileTeamDownloadedCount');

// Profile screenshot toggle
const downloadProfileScreenshotToggle = document.getElementById('downloadProfileScreenshotToggle');

// Toggle batch section
toggleBatchBtn.addEventListener('click', () => {
  if (batchContent.classList.contains('hidden')) {
    batchContent.classList.remove('hidden');
    toggleBatchBtn.textContent = 'Hide';
    // Check for saved batch when opening batch section
    checkForSavedBatch();
    // Load download source stats (from background)
    loadDownloadSourceStats();
    // Also load folder scan stats directly from storage (more reliable)
    loadFolderScanStatsFromStorage();
  } else {
    batchContent.classList.add('hidden');
    toggleBatchBtn.textContent = 'Show';
  }
});

// Load folder scan stats on popup open (so user sees current counts)
// Use setTimeout to ensure function is defined and DOM elements are ready
setTimeout(() => loadFolderScanStatsFromStorage(), 100);

// Load download history count on startup
async function loadDownloadStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getDownloadStats' });
    if (response && typeof response.count === 'number') {
      downloadHistoryCount.textContent = response.count;
    }
  } catch (error) {
    console.log('[Popup] Error loading download stats:', error);
  }
}

// Load all download source stats
function loadDownloadSourceStats() {
  if (port) {
    port.postMessage({ action: 'getDownloadSourceStats' });
  }
}

// Extract shortcode from folder name pattern
function extractShortcodeFromFolderName(folderName) {
  const match = folderName.match(/_IG_(?:POST|REEL)_\d{8}_([a-zA-Z0-9_-]+?)(?:_collab_|$)/);
  return match ? match[1] : null;
}

// Open folder scan page in a new tab (File System Access API doesn't work in popups)
function openFolderScanPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL('folder-scan.html') });
}

// Attach folder scan button listener
if (scanFolderBtn) {
  scanFolderBtn.addEventListener('click', openFolderScanPage);
}

// Handle download source stats update
function handleDownloadSourceStats(data) {
  // Update history count
  if (historySourceCount) {
    historySourceCount.textContent = data.history.count;
    downloadHistoryCount.textContent = data.history.count;
  }

  // Update folder count
  if (folderSourceCount) {
    folderSourceCount.textContent = data.folder.count;

    // Update folder scan info
    if (data.folder.lastScan) {
      const scanDate = new Date(data.folder.lastScan);
      const timeAgo = getTimeAgo(scanDate);
      folderScanInfo.textContent = `${data.folder.count} posts (${timeAgo})`;

      if (data.folder.folderPath) {
        folderScanPath.textContent = `📂 ${data.folder.folderPath}`;
        folderScanPath.classList.remove('hidden');
      }
    } else {
      folderScanInfo.textContent = 'Not scanned';
    }
  }

  // Update team count (show/hide based on whether team sync is enabled)
  if (teamSourceCount && skipSourceTeamLabel) {
    if (data.team.enabled) {
      teamSourceCount.textContent = data.team.count;
      skipSourceTeamLabel.classList.remove('hidden');
    } else {
      skipSourceTeamLabel.classList.add('hidden');
    }
  }
}

// Handle folder scan stats
function handleFolderScanStats(data) {
  if (folderSourceCount) {
    folderSourceCount.textContent = data.count;
  }
  if (data.lastScan) {
    const scanDate = new Date(data.lastScan);
    const timeAgo = getTimeAgo(scanDate);
    if (folderScanInfo) {
      folderScanInfo.textContent = `${data.count} posts (${timeAgo})`;
    }

    if (data.folderPath && folderScanPath) {
      folderScanPath.textContent = `📂 ${data.folderPath}`;
      folderScanPath.classList.remove('hidden');
    }
  }
}

// Load folder scan stats directly from storage (called on popup open)
async function loadFolderScanStatsFromStorage() {
  try {
    const result = await chrome.storage.local.get('folderScanCache');
    if (result.folderScanCache) {
      const cache = result.folderScanCache;
      const count = cache.shortcodes?.length || 0;
      handleFolderScanStats({
        count: count,
        lastScan: cache.lastScan,
        folderPath: cache.folderPath
      });
      console.log('[Popup] Loaded folder scan stats from storage:', count, 'shortcodes');
    }
  } catch (e) {
    console.error('[Popup] Error loading folder scan stats:', e);
  }
}

// Helper function to format time ago
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Get current skip sources configuration
function getSkipSources() {
  return {
    history: skipSourceHistory?.checked ?? true,
    folder: skipSourceFolder?.checked ?? true,
    team: skipSourceTeam?.checked ?? true
  };
}

// Load stats when popup opens
loadDownloadStats();

// Clear history button
clearHistoryBtn.addEventListener('click', async () => {
  const confirmed = confirm('Clear all download history? This will allow previously downloaded posts to be downloaded again.');
  if (!confirmed) return;

  try {
    await chrome.runtime.sendMessage({ action: 'clearDownloadHistory' });
    downloadHistoryCount.textContent = '0';
    showStatus('success', '✅ Download history cleared');
  } catch (error) {
    console.log('[Popup] Error clearing history:', error);
    showStatus('error', '❌ Failed to clear history');
  }
});

// ===== RESUME BATCH FUNCTIONALITY =====

// Check for saved batch state
function checkForSavedBatch() {
  if (port) {
    port.postMessage({ action: 'getSavedBatchState' });
  }
}

// Resume batch button
if (resumeBatchBtn) {
  resumeBatchBtn.addEventListener('click', () => {
    if (!port) return;

    // Reset UI
    batchProgress.classList.remove('hidden');
    batchResults.classList.add('hidden');
    failedSection.classList.add('hidden');
    resumeBatchSection.classList.add('hidden');

    // Disable controls
    startBatchBtn.disabled = true;
    stopBatchBtn.disabled = false;
    batchUrls.disabled = true;

    port.postMessage({ action: 'resumeBatch' });
    showStatus('info', '▶️ Resuming batch download...');
  });
}

// Discard saved batch button
if (discardBatchBtn) {
  discardBatchBtn.addEventListener('click', () => {
    if (!port) return;
    port.postMessage({ action: 'clearSavedBatch' });
    resumeBatchSection.classList.add('hidden');
    showStatus('info', 'Saved batch discarded');
  });
}

// Handle saved batch state response
function handleSavedBatchState(data) {
  if (data && resumeBatchSection) {
    const remaining = data.totalInBatch - data.currentIndex;
    resumeBatchSection.classList.remove('hidden');
    resumeBatchInfo.textContent = `${remaining} posts remaining (${data.successCount} already completed)`;
  } else if (resumeBatchSection) {
    resumeBatchSection.classList.add('hidden');
  }
}

// Handle batch resumed
function handleBatchResumed(data) {
  showStatus('success', `Resumed! ${data.remaining} posts remaining`);
}

// Handle filtered URLs by team (for profile download with team filter)
function handleUrlsFilteredByTeam(data) {
  const { originalCount, filteredUrls, removedCount } = data;

  // Update info display
  if (profileTeamFilterInfo) {
    profileTeamFilterInfo.classList.remove('hidden');
    profileNewPostsCount.textContent = filteredUrls.length;
    profileTeamDownloadedCount.textContent = removedCount;
  }

  if (filteredUrls.length === 0) {
    showStatus('info', `All ${originalCount} posts have been downloaded by team members`);
    return;
  }

  // Fill in batch URLs textarea with filtered URLs
  batchUrls.value = filteredUrls.join('\n');
  urlCount.textContent = `${filteredUrls.length} URLs`;
  urlCount.style.color = '#2e7d32';

  // Show batch section if hidden
  if (batchContent.classList.contains('hidden')) {
    batchContent.classList.remove('hidden');
    toggleBatchBtn.textContent = 'Hide';
  }

  const skippedMsg = removedCount > 0 ? ` (${removedCount} already downloaded by team)` : '';
  showStatus('success', `✅ Added ${filteredUrls.length} new posts to batch download${skippedMsg}. Click "Start Batch" to begin.`);
}

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
    // Match Instagram post URLs (including /reel/ and /reels/)
    // Supports both formats:
    //   - https://www.instagram.com/p/CODE/
    //   - https://www.instagram.com/username/p/CODE/
    const match = line.match(/instagram\.com\/(?:[^\/]+\/)?(p|reel|reels)\/([^\/\s\?]+)/);
    if (match) {
      const shortcode = match[2];
      // Always convert to /p/ format for reliability
      const normalizedUrl = `https://www.instagram.com/p/${shortcode}/`;

      // Remove duplicates
      if (!seen.has(normalizedUrl)) {
        seen.add(normalizedUrl);
        validUrls.push(normalizedUrl);
      }
    }
  }

  return validUrls;
}

// Start batch processing
console.log('[Popup] About to attach startBatchBtn click listener...');
if (startBatchBtn) {
  startBatchBtn.addEventListener('click', async () => {
    console.log('[Popup] Start batch clicked');

    const urls = parseUrls(batchUrls.value);

    if (urls.length === 0) {
      showStatus('error', '❌ No valid Instagram URLs found');
      return;
    }

    // Check for name mapping if we have a profile username
    if (collectedProfileUsername) {
      showStatus('info', `⏳ Checking name for @${collectedProfileUsername}...`);
      const canProceed = await checkNameBeforeDownload(collectedProfileUsername, 'batch');
      if (!canProceed) {
        return; // Name prompt is shown, wait for user action
      }
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

    // Start batch with skip option and profile username (for collab posts)
    const skipDownloaded = skipDownloadedToggle?.checked ?? true;
    const skipSources = getSkipSources();
    port.postMessage({
      action: 'startBatch',
      data: {
        urls,
        skipDownloaded,
        skipSources,
        profileUsername: collectedProfileUsername // Pass profile username for collab handling
      }
    });

    showStatus('info', `🚀 Starting batch download of ${urls.length} posts...`);
  });
  console.log('[Popup] startBatchBtn click listener attached!');
} else {
  console.error('[Popup] startBatchBtn not found!');
}

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
  const { current, total, url, successCount: success, failedUrls: failed, skippedCount: skipped, isPaused, pauseReason, pauseDuration } = data;

  batchProgressText.textContent = `${current}/${total}`;
  batchProgressBar.style.width = `${(current / total) * 100}%`;
  batchCurrentUrl.textContent = url;

  // Handle pause state (rate limit or cooldown)
  if (isPaused && pauseReason) {
    batchStatus.textContent = `⏸️ ${pauseReason}`;
    batchStatus.style.color = '#f57c00';
    batchProgressBar.style.background = '#f57c00';

    // Show countdown if we have a pause duration
    if (pauseDuration) {
      let remaining = Math.ceil(pauseDuration / 1000);
      const countdownInterval = setInterval(() => {
        remaining--;
        if (remaining > 0) {
          batchStatus.textContent = `⏸️ Resuming in ${remaining}s...`;
        } else {
          clearInterval(countdownInterval);
          batchStatus.style.color = '';
          batchProgressBar.style.background = '';
        }
      }, 1000);
    }
  } else if (skipped > 0) {
    batchStatus.textContent = `Processing post ${current} of ${total}... (${skipped} skipped)`;
    batchStatus.style.color = '';
    batchProgressBar.style.background = '';
  } else {
    batchStatus.textContent = `Processing post ${current} of ${total}...`;
    batchStatus.style.color = '';
    batchProgressBar.style.background = '';
  }

  successCount.textContent = success;
  renderFailedUrls(failed);
  batchResults.classList.remove('hidden');
}

// Handle batch complete
function handleBatchComplete(data) {
  const { successCount: success, failedUrls: failed, total, skippedCount: skipped, stoppedDueToRateLimit } = data;

  batchProgress.classList.add('hidden');
  startBatchBtn.disabled = false;
  stopBatchBtn.disabled = true;
  batchUrls.disabled = false;

  // Show rate limit warning if batch was stopped due to 429 errors
  if (stoppedDueToRateLimit) {
    showStatus('error', `🚫 Batch stopped due to rate limiting. Downloaded ${success} posts. Wait a few minutes before trying again.`);
    return;
  }

  successCount.textContent = success;
  renderFailedUrls(failed);

  if (failed.length > 0) {
    const skippedMsg = skipped > 0 ? `, ${skipped} skipped` : '';
    showStatus('warning', `✅ Batch complete! ${success}/${total} succeeded, ${failed.length} failed${skippedMsg}`);
  } else {
    const skippedMsg = skipped > 0 ? ` (${skipped} already downloaded)` : '';
    showStatus('success', `🎉 Batch complete! All ${success} posts downloaded successfully!${skippedMsg}`);
  }

  batchResults.classList.remove('hidden');

  // Refresh download history count
  loadDownloadStats();
}

// Handle batch stopped
function handleBatchStopped(data) {
  const { successCount: success, failedUrls: failed } = data;

  batchProgress.classList.add('hidden');
  startBatchBtn.disabled = false;
  stopBatchBtn.disabled = true;
  batchUrls.disabled = false;

  successCount.textContent = success;
  renderFailedUrls(failed);
  batchResults.classList.remove('hidden');
  showStatus('warning', `⏹️ Batch stopped. ${success} posts completed.`);
}

// Helper function to render failed URLs with individual retry buttons
function renderFailedUrls(failed) {
  if (!failed || failed.length === 0) {
    failedSection.classList.add('hidden');
    return;
  }

  failedSection.classList.remove('hidden');
  failedCount.textContent = failed.length;

  failedUrls.innerHTML = failed.map((f, index) => `
    <div class="failed-item" data-index="${index}" data-url="${escapeHtml(f.url)}" style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #ffcdd2;">
      <div style="word-break: break-all; margin-bottom: 4px;">${escapeHtml(f.url)}</div>
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
        <span style="color: #999; font-size: 10px; flex: 1;">${escapeHtml(f.error || 'Unknown error')}</span>
        <button class="retry-single-btn secondary" data-url="${escapeHtml(f.url)}"
                style="font-size: 9px; padding: 2px 6px; cursor: pointer; white-space: nowrap;">
          🔄 Retry
        </button>
      </div>
    </div>
  `).join('');
}

// HTML escape helper
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Retry all failed URLs
function retryAllFailed() {
  const failedItems = Array.from(failedUrls.querySelectorAll('.failed-item'));
  const urlsToRetry = failedItems.map(item => item.dataset.url);

  if (urlsToRetry.length === 0) {
    showStatus('info', 'No failed URLs to retry');
    return;
  }

  console.log('[Popup] Retrying all failed URLs:', urlsToRetry.length);

  // Clear failed section
  failedSection.classList.add('hidden');
  failedUrls.innerHTML = '';

  // Start new batch with failed URLs
  port.postMessage({
    action: 'startBatch',
    data: {
      urls: urlsToRetry,
      skipDownloaded: false,  // Don't skip - we're retrying failures
      isRetry: true
    }
  });

  showStatus('info', `🔄 Retrying ${urlsToRetry.length} failed URL(s)...`);
}

// Retry single failed URL
function retrySingleFailed(url) {
  if (!url) return;

  console.log('[Popup] Retrying single URL:', url);

  // Remove from failed list UI immediately
  const item = failedUrls.querySelector(`[data-url="${CSS.escape(url)}"]`);
  if (item) item.remove();

  // Update count
  const remaining = failedUrls.querySelectorAll('.failed-item').length;
  failedCount.textContent = remaining;
  if (remaining === 0) {
    failedSection.classList.add('hidden');
  }

  // Start single-URL batch
  port.postMessage({
    action: 'startBatch',
    data: {
      urls: [url],
      skipDownloaded: false,
      isRetry: true
    }
  });

  showStatus('info', `🔄 Retrying 1 URL...`);
}

// Retry button event listeners
retryAllFailedBtn?.addEventListener('click', retryAllFailed);

// Event delegation for individual retry buttons
failedUrls?.addEventListener('click', (e) => {
  if (e.target.classList.contains('retry-single-btn')) {
    const url = e.target.dataset.url;
    retrySingleFailed(url);
  }
});

// Profile Scraper Controls
const toggleProfileBtn = document.getElementById('toggleProfileBtn');
const profileContent = document.getElementById('profileContent');
const profileNotOnProfile = document.getElementById('profileNotOnProfile');
const profileOnProfile = document.getElementById('profileOnProfile');
const profileUsername = document.getElementById('profileUsername');
const profilePostCount = document.getElementById('profilePostCount');
const startProfileScrapeBtn = document.getElementById('startProfileScrapeBtn');
const stopProfileScrapeBtn = document.getElementById('stopProfileScrapeBtn');
const profileScrapeProgress = document.getElementById('profileScrapeProgress');
const profileScrapeStatus = document.getElementById('profileScrapeStatus');
const profileScrapeCount = document.getElementById('profileScrapeCount');
const profileScrapeBar = document.getElementById('profileScrapeBar');
const profileScrapeComplete = document.getElementById('profileScrapeComplete');
const profileCollectedCount = document.getElementById('profileCollectedCount');
const profileCollectedUser = document.getElementById('profileCollectedUser');
const downloadProfilePostsBtn = document.getElementById('downloadProfilePostsBtn');

// Chunk pause controls
const profileChunkInfo = document.getElementById('profileChunkInfo');
const profileCurrentChunk = document.getElementById('profileCurrentChunk');
const profileTotalChunks = document.getElementById('profileTotalChunks');
const profileChunkPauseControls = document.getElementById('profileChunkPauseControls');
const profilePauseCountdown = document.getElementById('profilePauseCountdown');
const profileContinueNowBtn = document.getElementById('profileContinueNowBtn');
const profilePauseBtn = document.getElementById('profilePauseBtn');

// Resume profile section
const resumeProfileSection = document.getElementById('resumeProfileSection');
const resumeProfileCount = document.getElementById('resumeProfileCount');
const resumeProfileTarget = document.getElementById('resumeProfileTarget');
const resumeProfileUsername = document.getElementById('resumeProfileUsername');
const resumeProfileBtn = document.getElementById('resumeProfileBtn');
const downloadCollectedBtn = document.getElementById('downloadCollectedBtn');
const discardProfileBtn = document.getElementById('discardProfileBtn');

// Rate limited section
const profileRateLimitedSection = document.getElementById('profileRateLimitedSection');
const rateLimitedCount = document.getElementById('rateLimitedCount');
const downloadRateLimitedBtn = document.getElementById('downloadRateLimitedBtn');
const discardRateLimitedBtn = document.getElementById('discardRateLimitedBtn');

let collectedProfilePosts = [];
let collectedProfileUsername = null; // Store the profile username for batch downloads
let chunkPauseCountdownInterval = null; // For countdown timer
let savedProfileScrapingState = null; // For resume functionality

// Handle profile scrape progress (called from init via port.onMessage)
function handleProfileScrapeProgress(data) {
  const { count, targetCount, currentChunk, totalChunks, isPaused } = data;
  profileScrapeCount.textContent = count;

  // Update chunk info (check for undefined/null, not falsy since 0 is valid)
  if (profileCurrentChunk && currentChunk !== undefined && currentChunk !== null) {
    profileCurrentChunk.textContent = currentChunk;
  }
  if (profileTotalChunks && totalChunks !== undefined && totalChunks !== null) {
    profileTotalChunks.textContent = totalChunks;
  }

  if (targetCount > 0) {
    const percentage = Math.min((count / targetCount) * 100, 100);
    profileScrapeBar.style.width = percentage + '%';
    profileScrapeStatus.textContent = `Collecting: ${count}/${targetCount} posts (Chunk ${currentChunk || 1}/${totalChunks || '?'})...`;
  } else {
    profileScrapeStatus.textContent = `Collecting: ${count} posts found (Chunk ${currentChunk || 1}/${totalChunks || '?'})...`;
    // Indeterminate progress for "all posts"
    profileScrapeBar.style.width = '50%';
  }

  // Hide chunk pause controls when not paused
  if (!isPaused && profileChunkPauseControls) {
    profileChunkPauseControls.classList.add('hidden');
    clearChunkPauseCountdown();
  }
}

// Handle chunk pause (auto-pause between chunks)
function handleProfileChunkPause(data) {
  const { count, targetCount, pauseDuration, posts, username, isManualPause } = data;

  // Store the posts for potential download
  collectedProfilePosts = posts || [];
  collectedProfileUsername = username;

  // Update progress display
  profileScrapeCount.textContent = count;
  if (targetCount > 0) {
    const percentage = Math.min((count / targetCount) * 100, 100);
    profileScrapeBar.style.width = percentage + '%';
  }

  // Show chunk pause controls
  if (profileChunkPauseControls) {
    profileChunkPauseControls.classList.remove('hidden');
  }

  // Start countdown if auto-pause (not manual)
  if (!isManualPause && pauseDuration > 0) {
    startChunkPauseCountdown(pauseDuration / 1000);
    profileScrapeStatus.textContent = `Pausing to avoid rate limit...`;
  } else {
    profileScrapeStatus.textContent = `Paused - ${count} posts collected`;
    if (profilePauseCountdown) {
      profilePauseCountdown.textContent = '∞';
    }
  }

  showStatus('info', `⏸️ Paused at ${count} posts. Cooling down...`);
}

// Handle rate limited (403/429)
function handleProfileRateLimited(data) {
  const { count, targetCount, posts, username, errorStatus } = data;

  // Store the posts
  collectedProfilePosts = posts || [];
  collectedProfileUsername = username;

  // Hide progress, show rate limited section
  profileScrapeProgress.classList.add('hidden');
  if (profileRateLimitedSection) {
    profileRateLimitedSection.classList.remove('hidden');
    rateLimitedCount.textContent = count;
  }

  // Re-enable buttons
  startProfileScrapeBtn.disabled = false;
  stopProfileScrapeBtn.disabled = true;
  profilePostCount.disabled = false;

  showStatus('error', `🚫 Rate limited (${errorStatus})! Collected ${count} posts.`);
}

// Handle profile scrape resumed
function handleProfileResumed(data) {
  const { count, targetCount } = data;

  // Hide chunk pause controls
  if (profileChunkPauseControls) {
    profileChunkPauseControls.classList.add('hidden');
  }
  clearChunkPauseCountdown();

  profileScrapeStatus.textContent = `Collecting: ${count}/${targetCount || '?'} posts...`;
  showStatus('info', `▶️ Resumed collecting posts...`);
}

// Start countdown timer for chunk pause
function startChunkPauseCountdown(seconds) {
  clearChunkPauseCountdown();

  let remaining = seconds;
  if (profilePauseCountdown) {
    profilePauseCountdown.textContent = remaining;
  }

  chunkPauseCountdownInterval = setInterval(() => {
    remaining--;
    if (profilePauseCountdown) {
      profilePauseCountdown.textContent = remaining;
    }

    if (remaining <= 0) {
      clearChunkPauseCountdown();
    }
  }, 1000);
}

// Clear countdown timer
function clearChunkPauseCountdown() {
  if (chunkPauseCountdownInterval) {
    clearInterval(chunkPauseCountdownInterval);
    chunkPauseCountdownInterval = null;
  }
}

// Handle profile scrape complete (called from init via port.onMessage)
function handleProfileScrapeComplete(data) {
  const { posts, count, username } = data;

  // Update the global variables
  collectedProfilePosts = posts || [];
  collectedProfileUsername = username || null; // Store for batch download

  console.log('[Popup] Profile scrape complete, stored', collectedProfilePosts.length, 'posts for @' + collectedProfileUsername);

  // Update UI
  profileScrapeProgress.classList.add('hidden');
  profileScrapeComplete.classList.remove('hidden');
  profileCollectedCount.textContent = count;
  profileCollectedUser.textContent = username || 'user';

  // Re-enable buttons
  startProfileScrapeBtn.disabled = false;
  stopProfileScrapeBtn.disabled = true;
  profilePostCount.disabled = false;

  showStatus('success', `✅ Collected ${count} posts from @${username}`);
}

// Toggle profile section
toggleProfileBtn.addEventListener('click', () => {
  if (profileContent.classList.contains('hidden')) {
    profileContent.classList.remove('hidden');
    toggleProfileBtn.textContent = 'Hide';
    // Check profile status when section is opened
    checkProfileStatus();
    // Also check for saved profile scrape state
    checkSavedProfileScrape();
  } else {
    profileContent.classList.add('hidden');
    toggleProfileBtn.textContent = 'Show';
  }
});

// Check if we're on a profile page
async function checkProfileStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Check URL pattern for profile page
    const url = tab.url || '';
    const isProfilePage = url.includes('instagram.com/') &&
                         !url.includes('/p/') &&
                         !url.includes('/reel/') &&
                         !url.includes('/reels/') &&
                         !url.includes('/explore/') &&
                         !url.includes('/direct/') &&
                         !url.includes('/accounts/') &&
                         !url.includes('/stories/');

    // Try to get username from URL
    const match = url.match(/instagram\.com\/([^\/\?\#]+)/);
    const username = match ? match[1] : null;

    if (isProfilePage && username && !['explore', 'direct', 'accounts', 'stories', 'reels'].includes(username)) {
      profileNotOnProfile.classList.add('hidden');
      profileOnProfile.classList.remove('hidden');
      profileUsername.textContent = '@' + username;

      // Also ask the content script for confirmation
      chrome.tabs.sendMessage(tab.id, { action: 'getProfileStatus' }, (response) => {
        if (response && response.username) {
          profileUsername.textContent = '@' + response.username;
        }
      });
    } else {
      profileNotOnProfile.classList.remove('hidden');
      profileOnProfile.classList.add('hidden');
    }
  } catch (error) {
    console.error('Error checking profile status:', error);
    profileNotOnProfile.classList.remove('hidden');
    profileOnProfile.classList.add('hidden');
  }
}

// Start profile scraping
startProfileScrapeBtn.addEventListener('click', async () => {
  const count = parseInt(profilePostCount.value) || 0;

  // Reset UI
  collectedProfilePosts = [];
  profileScrapeProgress.classList.remove('hidden');
  profileScrapeComplete.classList.add('hidden');
  profileScrapeCount.textContent = '0';
  profileScrapeBar.style.width = '0%';
  profileScrapeStatus.textContent = 'Collecting posts...';

  // Reset chunk info
  if (profileCurrentChunk) profileCurrentChunk.textContent = '1';
  if (profileTotalChunks) {
    const totalChunks = count > 0 ? Math.ceil(count / 50) : '?';
    profileTotalChunks.textContent = totalChunks;
  }

  // Disable/enable buttons
  startProfileScrapeBtn.disabled = true;
  stopProfileScrapeBtn.disabled = false;
  profilePostCount.disabled = true;

  // Send command to content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, {
      action: 'startProfileScrape',
      count: count
    });
    showStatus('info', `🔍 Collecting posts from profile...`);
  } catch (error) {
    console.error('[Popup] Error starting profile scrape:', error);
    showStatus('error', 'Content script not ready. Please refresh the Instagram page and try again.');
    startProfileScrapeBtn.disabled = false;
    stopProfileScrapeBtn.disabled = true;
    profilePostCount.disabled = false;
    profileScrapeProgress.classList.add('hidden');
  }
});

// Stop profile scraping
stopProfileScrapeBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'stopProfileScrape' });
    stopProfileScrapeBtn.disabled = true;
    profileScrapeStatus.textContent = 'Stopping...';
  } catch (error) {
    console.error('[Popup] Error stopping profile scrape:', error);
    showStatus('error', 'Failed to stop. Please refresh the page.');
  }
});

// Download all collected profile posts
downloadProfilePostsBtn.addEventListener('click', async () => {
  console.log('[Popup] Download button clicked, collectedProfilePosts:', collectedProfilePosts.length);

  if (collectedProfilePosts.length === 0) {
    showStatus('error', 'No posts collected yet');
    return;
  }

  // Capture profile screenshot if enabled
  const shouldCaptureScreenshot = downloadProfileScreenshotToggle && downloadProfileScreenshotToggle.checked;
  const username = collectedProfileUsername || 'unknown';

  if (shouldCaptureScreenshot && port) {
    showStatus('info', '📸 Capturing profile screenshot...');
    const saveAs = askWhereToSaveCheckbox && askWhereToSaveCheckbox.checked;
    port.postMessage({
      action: 'captureProfileScreenshot',
      data: { username, saveAs }
    });
    // Note: Screenshot happens asynchronously, we continue with the batch setup
  }

  // Convert to URLs
  const urls = collectedProfilePosts.map(p => {
    const url = p.postUrl || `https://www.instagram.com/p/${p.code}/`;
    console.log('[Popup] Post URL:', url);
    return url;
  });

  console.log('[Popup] Total URLs to add:', urls.length);

  // Check if team filter is enabled
  const useTeamFilter = filterByTeamToggle && filterByTeamToggle.checked;

  if (useTeamFilter && port) {
    // Filter URLs through team sync first
    showStatus('info', '🔍 Checking team downloads...');
    port.postMessage({
      action: 'filterUrlsByTeamSync',
      data: { urls }
    });
    // Response will be handled by handleUrlsFilteredByTeam
    return;
  }

  // No team filter - proceed directly
  batchUrls.value = urls.join('\n');
  urlCount.textContent = `${urls.length} URLs`;
  urlCount.style.color = '#2e7d32';

  // Show batch section if hidden
  if (batchContent.classList.contains('hidden')) {
    batchContent.classList.remove('hidden');
    toggleBatchBtn.textContent = 'Hide';
  }

  showStatus('success', `✅ Added ${urls.length} posts to batch download. Click "Start Batch" to begin.`);
});

// ===== PROFILE SCRAPING CHUNK CONTROLS =====

// Continue Now button (skip countdown)
if (profileContinueNowBtn) {
  profileContinueNowBtn.addEventListener('click', async () => {
    clearChunkPauseCountdown();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'continueNowProfileScrape' });
      showStatus('info', '▶️ Continuing...');
    } catch (error) {
      console.error('[Popup] Error sending continueNow:', error);
      showStatus('error', 'Failed to continue. Please refresh the page.');
    }
  });
}

// Pause button (stop auto-continue)
if (profilePauseBtn) {
  profilePauseBtn.addEventListener('click', async () => {
    clearChunkPauseCountdown();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'pauseProfileScrape' });
      if (profilePauseCountdown) {
        profilePauseCountdown.textContent = '∞';
      }
      showStatus('info', '⏸️ Paused. Progress saved.');
    } catch (error) {
      console.error('[Popup] Error sending pause:', error);
      showStatus('error', 'Failed to pause. Please refresh the page.');
    }
  });
}

// ===== RESUME PROFILE SCRAPING =====

// Handle saved profile scrape state (for resume functionality)
function handleSavedProfileScrapeState(data) {
  if (data && data.exists) {
    savedProfileScrapingState = data;

    // Show resume section
    if (resumeProfileSection) {
      resumeProfileSection.classList.remove('hidden');
      resumeProfileCount.textContent = data.count;
      resumeProfileTarget.textContent = data.targetCount || '?';
      resumeProfileUsername.textContent = data.username || 'user';
    }
  } else {
    savedProfileScrapingState = null;
    if (resumeProfileSection) {
      resumeProfileSection.classList.add('hidden');
    }
  }
}

// Check for saved profile scrape state when profile section is opened
function checkSavedProfileScrape() {
  if (port) {
    port.postMessage({ action: 'checkSavedProfileScrape' });
  }
}

// Resume profile scraping
if (resumeProfileBtn) {
  resumeProfileBtn.addEventListener('click', async () => {
    if (!savedProfileScrapingState || !savedProfileScrapingState.posts) {
      showStatus('error', 'No saved state to resume');
      return;
    }

    // Hide resume section, show progress
    resumeProfileSection.classList.add('hidden');
    profileScrapeProgress.classList.remove('hidden');
    profileScrapeComplete.classList.add('hidden');

    // Set up UI
    startProfileScrapeBtn.disabled = true;
    stopProfileScrapeBtn.disabled = false;
    profilePostCount.disabled = true;

    // Send resume command to content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, {
      action: 'startProfileScrape',
      count: savedProfileScrapingState.targetCount,
      existingPosts: savedProfileScrapingState.posts
    });

    showStatus('info', `▶️ Resuming from ${savedProfileScrapingState.count} posts...`);
  });
}

// Download collected posts (from resume section)
if (downloadCollectedBtn) {
  downloadCollectedBtn.addEventListener('click', () => {
    if (!savedProfileScrapingState || !savedProfileScrapingState.posts) {
      showStatus('error', 'No collected posts to download');
      return;
    }

    // Use the saved posts
    collectedProfilePosts = savedProfileScrapingState.posts;
    collectedProfileUsername = savedProfileScrapingState.username;

    // Trigger the download
    downloadProfilePostsBtn.click();

    // Clear saved state
    port.postMessage({ action: 'clearProfileScrapingState' });
    resumeProfileSection.classList.add('hidden');
  });
}

// Discard saved profile scrape
if (discardProfileBtn) {
  discardProfileBtn.addEventListener('click', () => {
    if (confirm('Discard saved profile scraping progress?')) {
      port.postMessage({ action: 'clearProfileScrapingState' });
      resumeProfileSection.classList.add('hidden');
      savedProfileScrapingState = null;
      showStatus('info', '🗑️ Saved progress discarded');
    }
  });
}

// ===== RATE LIMITED SECTION =====

// Download collected posts (from rate limited section)
if (downloadRateLimitedBtn) {
  downloadRateLimitedBtn.addEventListener('click', () => {
    if (collectedProfilePosts.length === 0) {
      showStatus('error', 'No collected posts to download');
      return;
    }

    // Hide rate limited section
    profileRateLimitedSection.classList.add('hidden');

    // Trigger the download
    downloadProfilePostsBtn.click();

    // Clear saved state
    port.postMessage({ action: 'clearProfileScrapingState' });
  });
}

// Discard rate limited posts
if (discardRateLimitedBtn) {
  discardRateLimitedBtn.addEventListener('click', () => {
    profileRateLimitedSection.classList.add('hidden');
    collectedProfilePosts = [];
    port.postMessage({ action: 'clearProfileScrapingState' });
    showStatus('info', '🗑️ Collected posts discarded');
  });
}

// Open Archive Viewer button
const openViewerBtn = document.getElementById('openViewerBtn');
if (openViewerBtn) {
  openViewerBtn.addEventListener('click', () => {
    // Get the viewer URL from the extension
    const viewerUrl = chrome.runtime.getURL('viewer/instagram-viewer.html');
    chrome.tabs.create({ url: viewerUrl });
  });
}

// ===== GOOGLE SHEETS SYNC UI =====

// Sync UI Elements
const toggleSyncBtn = document.getElementById('toggleSyncBtn');
const syncContent = document.getElementById('syncContent');
const syncStatusText = document.getElementById('syncStatusText');
const lastSyncTime = document.getElementById('lastSyncTime');
const syncedCount = document.getElementById('syncedCount');
const sheetsWebAppUrl = document.getElementById('sheetsWebAppUrl');
const sheetsUserId = document.getElementById('sheetsUserId');
const saveSyncConfigBtn = document.getElementById('saveSyncConfigBtn');
const refreshSyncBtn = document.getElementById('refreshSyncBtn');
const skipTeamDownloadedToggle = document.getElementById('skipTeamDownloadedToggle');
const profileCompletionSection = document.getElementById('profileCompletionSection');
const completionUsername = document.getElementById('completionUsername');
const completionBar = document.getElementById('completionBar');
const completionPct = document.getElementById('completionPct');
const completionDownloaded = document.getElementById('completionDownloaded');
const completionTotal = document.getElementById('completionTotal');
const profileTotalInput = document.getElementById('profileTotalInput');
const updateProfileTotalBtn = document.getElementById('updateProfileTotalBtn');
const detectPostCountBtn = document.getElementById('detectPostCountBtn');

// Toggle sync section
if (toggleSyncBtn) {
  toggleSyncBtn.addEventListener('click', () => {
    if (syncContent.classList.contains('hidden')) {
      syncContent.classList.remove('hidden');
      toggleSyncBtn.textContent = 'Hide';
      loadSyncStatus();
    } else {
      syncContent.classList.add('hidden');
      toggleSyncBtn.textContent = 'Show';
    }
  });
}

// Load sync status from background
function loadSyncStatus() {
  if (port) {
    port.postMessage({ action: 'getSheetsStatus' });
  }
}

// Save sync configuration
if (saveSyncConfigBtn) {
  saveSyncConfigBtn.addEventListener('click', () => {
    const webAppUrl = sheetsWebAppUrl.value.trim();
    const userId = sheetsUserId.value.trim();

    if (!webAppUrl || !userId) {
      showStatus('error', 'Please fill in both URL and User ID');
      return;
    }

    if (!webAppUrl.includes('script.google.com')) {
      showStatus('error', 'Please enter a valid Google Apps Script URL');
      return;
    }

    showStatus('info', 'Saving configuration...');
    port.postMessage({
      action: 'configureSheets',
      data: { webAppUrl, userId }
    });
  });
}

// Manual sync refresh
if (refreshSyncBtn) {
  refreshSyncBtn.addEventListener('click', () => {
    showStatus('info', 'Syncing with Google Sheets...');
    port.postMessage({ action: 'refreshSheetsCache' });
  });
}

// Skip team downloaded toggle
if (skipTeamDownloadedToggle) {
  skipTeamDownloadedToggle.addEventListener('change', () => {
    port.postMessage({
      action: 'setSkipTeamDownloaded',
      data: { skip: skipTeamDownloadedToggle.checked }
    });
  });
}

// Update profile total posts
if (updateProfileTotalBtn) {
  updateProfileTotalBtn.addEventListener('click', async () => {
    const totalPosts = parseInt(profileTotalInput.value);
    const username = completionUsername.textContent.replace('@', '');

    if (!totalPosts || totalPosts < 1) {
      showStatus('error', 'Enter a valid number of posts');
      return;
    }

    showStatus('info', 'Updating profile total...');
    port.postMessage({
      action: 'updateProfileTotal',
      data: { username, totalPosts }
    });
  });
}

// Detect post count from page
if (detectPostCountBtn) {
  detectPostCountBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      detectPostCountBtn.disabled = true;
      detectPostCountBtn.textContent = '...';

      chrome.tabs.sendMessage(tab.id, { action: 'getProfilePostCount' }, (response) => {
        detectPostCountBtn.disabled = false;
        detectPostCountBtn.textContent = 'Detect';

        if (chrome.runtime.lastError) {
          showStatus('error', 'Could not detect post count. Make sure you are on a profile page.');
          return;
        }

        if (response && response.success && response.postCount) {
          profileTotalInput.value = response.postCount;
          profileTotalInput.style.backgroundColor = '#e8f5e9';
          setTimeout(() => {
            profileTotalInput.style.backgroundColor = '';
          }, 2000);

          // Auto-update Google Sheet with detected count
          const username = completionUsername.textContent.replace('@', '');
          if (port && username && username !== 'username') {
            console.log('[Popup] Auto-updating profile total in Sheets:', username, response.postCount);
            port.postMessage({
              action: 'updateProfileTotal',
              data: { username, totalPosts: response.postCount }
            });
            showStatus('success', `Detected ${response.postCount} posts and updated in Sheets`);
          } else {
            showStatus('success', `Detected ${response.postCount} posts`);
          }
        } else {
          showStatus('warning', 'Could not detect post count. Please enter manually.');
        }
      });
    } catch (error) {
      detectPostCountBtn.disabled = false;
      detectPostCountBtn.textContent = 'Detect';
      showStatus('error', 'Error detecting post count');
    }
  });
}

// Check profile completion when on profile page
async function checkProfileCompletionForSync() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab.url || '';

    // Check if on profile page
    const isProfilePage = url.includes('instagram.com/') &&
      !url.includes('/p/') &&
      !url.includes('/reel/') &&
      !url.includes('/reels/') &&
      !url.includes('/explore/') &&
      !url.includes('/direct/') &&
      !url.includes('/accounts/') &&
      !url.includes('/stories/');

    if (isProfilePage) {
      const match = url.match(/instagram\.com\/([^\/\?\#]+)/);
      const username = match ? match[1] : null;

      if (username && !['explore', 'direct', 'accounts', 'stories', 'reels'].includes(username)) {
        // Get profile completion stats
        port.postMessage({
          action: 'getProfileCompletion',
          data: { username }
        });

        // Also try to auto-detect post count from the page
        chrome.tabs.sendMessage(tab.id, { action: 'getProfilePostCount' }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('[Popup] Could not get post count:', chrome.runtime.lastError.message);
            return;
          }
          if (response && response.success && response.postCount) {
            console.log('[Popup] Auto-detected post count:', response.postCount);
            // Auto-fill the input if it's empty or different
            if (profileTotalInput && (!profileTotalInput.value || parseInt(profileTotalInput.value) !== response.postCount)) {
              profileTotalInput.value = response.postCount;
              profileTotalInput.style.backgroundColor = '#e8f5e9'; // Light green to indicate auto-filled
              setTimeout(() => {
                profileTotalInput.style.backgroundColor = '';
              }, 2000);

              // Auto-update the Google Sheet with detected count
              if (port && username) {
                console.log('[Popup] Auto-updating profile total in Sheets:', username, response.postCount);
                port.postMessage({
                  action: 'updateProfileTotal',
                  data: { username, totalPosts: response.postCount }
                });
              }
            }
          }
        });
      }
    }
  } catch (error) {
    console.log('[Popup] Error checking profile completion:', error);
  }
}

// Handle sync-related messages from background
function handleSyncMessages(msg) {
  if (msg.type === 'sheetsStatus') {
    const status = msg.data;
    syncStatusText.textContent = status.enabled ? 'Connected' : 'Not configured';
    syncStatusText.style.color = status.enabled ? '#2e7d32' : '#8e8e8e';
    lastSyncTime.textContent = status.lastSync ? new Date(status.lastSync).toLocaleString() : 'Never';
    syncedCount.textContent = status.cacheSize?.downloads || 0;

    // Update toggle state
    if (skipTeamDownloadedToggle) {
      skipTeamDownloadedToggle.checked = status.skipTeamDownloaded || false;
    }

    // Load saved config values
    chrome.storage.local.get(['sheetsWebAppUrl', 'sheetsUserId']).then(stored => {
      if (sheetsWebAppUrl) sheetsWebAppUrl.value = stored.sheetsWebAppUrl || '';
      if (sheetsUserId) sheetsUserId.value = stored.sheetsUserId || '';
    });

    // Check profile completion if enabled
    if (status.enabled) {
      checkProfileCompletionForSync();
    }
  }

  if (msg.type === 'sheetsConfigured') {
    if (msg.data.success) {
      showStatus('success', 'Sync configured successfully!');
      loadSyncStatus();
    } else {
      showStatus('error', 'Configuration failed: ' + (msg.data.error || 'Unknown error'));
    }
  }

  if (msg.type === 'sheetsCacheRefreshed') {
    if (msg.data.success) {
      showStatus('success', `Synced! ${msg.data.downloadCount} downloads tracked`);
      loadSyncStatus();
    } else {
      showStatus('error', 'Sync failed: ' + msg.data.error);
    }
  }

  if (msg.type === 'profileCompletion') {
    if (msg.data && profileCompletionSection) {
      profileCompletionSection.classList.remove('hidden');
      completionUsername.textContent = '@' + msg.data.username;
      completionPct.textContent = msg.data.completion_pct || 0;
      completionDownloaded.textContent = msg.data.downloaded_count || 0;
      completionTotal.textContent = msg.data.total_posts || 0;
      completionBar.style.width = (msg.data.completion_pct || 0) + '%';
      profileTotalInput.value = msg.data.total_posts || '';
    }
  }

  if (msg.type === 'profileTotalUpdated') {
    if (msg.data.success) {
      showStatus('success', 'Profile total updated!');
      checkProfileCompletionForSync();
    } else {
      showStatus('error', 'Failed to update: ' + msg.data.error);
    }
  }

  if (msg.type === 'skipTeamDownloadedSet') {
    if (msg.data.success) {
      console.log('[Popup] Skip team downloaded preference saved');
    }
  }
}

// Note: init() is called from unlockExtension() after password verification
