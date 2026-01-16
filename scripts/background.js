// Background service worker
// Import config and modules (service workers use importScripts)
importScripts('../config.js');
importScripts('./sheets-sync.js');

let currentData = {
  postData: null,
  comments: null,
  media: null
};

// Track connected popup/sidepanel ports for progress messages
let activePopupPort = null;
let activeSidePanelPort = null;

// Helper function to broadcast messages to both popup and sidepanel
function broadcastToUI(message) {
  if (activePopupPort) {
    try {
      activePopupPort.postMessage(message);
    } catch (e) {
      console.log('[Background] Error sending to popup:', e);
      activePopupPort = null;
    }
  }
  if (activeSidePanelPort) {
    try {
      activeSidePanelPort.postMessage(message);
    } catch (e) {
      console.log('[Background] Error sending to sidepanel:', e);
      activeSidePanelPort = null;
    }
  }
}

// Batch processing state
let batchState = {
  isProcessing: false,
  queue: [],
  currentIndex: 0,
  successCount: 0,
  skippedCount: 0,
  failedUrls: [],
  tabId: null,
  port: null,
  skipDownloaded: true, // Default to skipping already downloaded posts
  profileUsername: null, // Username from profile scraping (takes priority in folder names for collabs)
  // Rate limiting tracking
  consecutiveErrors: 0,
  last429Time: null,
  currentPauseDuration: 0,
  isPaused: false,
  // Request budget tracking (for proactive rate limiting)
  requestTimestamps: []
};

// ===== Request Budget System (Proactive Rate Limiting) =====

const requestBudget = {
  // Track request timestamps within sliding window
  requests: [],

  // Record a new request
  recordRequest() {
    this.requests.push(Date.now());
    // Clean up old requests outside the window
    this.cleanup();
  },

  // Remove requests outside the sliding window
  cleanup() {
    const windowMs = CONFIG.REQUEST_BUDGET?.WINDOW_MS || 60000;
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < windowMs);
  },

  // Check if we can make another request
  canMakeRequest() {
    if (!CONFIG.REQUEST_BUDGET?.ENABLED) return true;
    this.cleanup();
    const maxRequests = CONFIG.REQUEST_BUDGET?.MAX_REQUESTS || 40;
    return this.requests.length < maxRequests;
  },

  // Get current request count in window
  getRequestCount() {
    this.cleanup();
    return this.requests.length;
  },

  // Check if we're approaching the limit (should pause proactively)
  shouldPauseProactively() {
    if (!CONFIG.REQUEST_BUDGET?.ENABLED) return false;
    this.cleanup();
    const threshold = CONFIG.REQUEST_BUDGET?.PAUSE_THRESHOLD || 35;
    return this.requests.length >= threshold;
  },

  // Calculate wait time until we can make another request
  getWaitTime() {
    if (this.canMakeRequest()) return 0;
    const windowMs = CONFIG.REQUEST_BUDGET?.WINDOW_MS || 60000;
    const oldest = this.requests[0];
    return Math.max(0, (oldest + windowMs) - Date.now() + 1000); // +1s buffer
  },

  // Get status for UI display
  getStatus() {
    this.cleanup();
    const maxRequests = CONFIG.REQUEST_BUDGET?.MAX_REQUESTS || 40;
    const threshold = CONFIG.REQUEST_BUDGET?.PAUSE_THRESHOLD || 35;
    return {
      current: this.requests.length,
      max: maxRequests,
      threshold: threshold,
      isNearLimit: this.requests.length >= threshold,
      waitTime: this.getWaitTime()
    };
  }
};

// ===== Enhanced 429 Recovery =====

function calculate429RecoveryTime(consecutiveErrors) {
  const basePause = CONFIG.TIMING.BATCH_429_HANDLING?.PAUSE_DURATION || 300000;
  const maxPause = CONFIG.TIMING.BATCH_429_HANDLING?.MAX_PAUSE_DURATION || 900000;
  const jitterRange = CONFIG.TIMING.BATCH_429_HANDLING?.JITTER_RANGE || 60000;
  const backoffMultiplier = CONFIG.TIMING.BATCH_429_HANDLING?.BACKOFF_MULTIPLIER || 1.5;

  // Calculate base pause with exponential backoff
  const calculatedPause = Math.min(
    basePause * Math.pow(backoffMultiplier, consecutiveErrors - 1),
    maxPause
  );

  // Add randomized jitter (+/- jitterRange)
  const jitter = (Math.random() - 0.5) * 2 * jitterRange;

  return Math.round(Math.max(basePause, calculatedPause + jitter));
}

// Format duration for display
function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

// ===== Batch State Persistence (for resume capability) =====

// Save batch state to storage for resume capability
async function saveBatchState() {
  if (!batchState.isProcessing && batchState.queue.length === 0) {
    // Clear saved state if batch is complete
    await chrome.storage.local.remove('savedBatchState');
    return;
  }

  const stateToSave = {
    queue: batchState.queue,
    currentIndex: batchState.currentIndex,
    successCount: batchState.successCount,
    skippedCount: batchState.skippedCount,
    failedUrls: batchState.failedUrls,
    skipDownloaded: batchState.skipDownloaded,
    profileUsername: batchState.profileUsername, // Preserve profile username for resume
    savedAt: Date.now(),
    totalInBatch: batchState.queue.length
  };

  await chrome.storage.local.set({ savedBatchState: stateToSave });
  console.log('[Background] Batch state saved for resume:', stateToSave.currentIndex, '/', stateToSave.totalInBatch);
}

// Load saved batch state
async function loadSavedBatchState() {
  try {
    const result = await chrome.storage.local.get('savedBatchState');
    if (result.savedBatchState) {
      const state = result.savedBatchState;
      // Check if state is less than 24 hours old
      const ageHours = (Date.now() - state.savedAt) / (1000 * 60 * 60);
      if (ageHours < 24) {
        return state;
      } else {
        // State is too old, clear it
        await chrome.storage.local.remove('savedBatchState');
      }
    }
    return null;
  } catch (error) {
    console.error('[Background] Error loading saved batch state:', error);
    return null;
  }
}

// Clear saved batch state
async function clearSavedBatchState() {
  await chrome.storage.local.remove('savedBatchState');
  console.log('[Background] Saved batch state cleared');
}

// ===== Downloaded Posts Tracking =====

// ===== Local Folder Scanning =====
// Cache for folder-scanned shortcodes
let folderScanCache = {
  shortcodes: new Set(),
  lastScan: null,
  folderPath: null
};

// Extract shortcode from folder name pattern: username_IG_POSTTYPE_YYYYMMDD_shortcode[_collab_...]
function extractShortcodeFromFolderName(folderName) {
  // Pattern matches: anything_IG_POST/REEL_8digits_shortcode (with optional _collab_ suffix)
  const match = folderName.match(/_IG_(?:POST|REEL)_\d{8}_([a-zA-Z0-9_-]+?)(?:_collab_|$)/);
  return match ? match[1] : null;
}

// Get folder scan stats
function getFolderScanStats() {
  return {
    count: folderScanCache.shortcodes.size,
    lastScan: folderScanCache.lastScan,
    folderPath: folderScanCache.folderPath
  };
}

// Check if shortcode exists in folder scan cache
function isInFolderScanCache(shortcode) {
  return folderScanCache.shortcodes.has(shortcode);
}

// Update folder scan cache with scanned shortcodes
function updateFolderScanCache(shortcodes, folderPath) {
  folderScanCache.shortcodes = new Set(shortcodes);
  folderScanCache.lastScan = Date.now();
  folderScanCache.folderPath = folderPath;

  // Also persist to storage for resuming
  chrome.storage.local.set({
    folderScanCache: {
      shortcodes: Array.from(shortcodes),
      lastScan: folderScanCache.lastScan,
      folderPath: folderPath
    }
  });

  console.log('[Background] Folder scan cache updated:', shortcodes.length, 'shortcodes from', folderPath);
}

// Load folder scan cache from storage on startup
async function loadFolderScanCache() {
  try {
    const result = await chrome.storage.local.get('folderScanCache');
    if (result.folderScanCache) {
      folderScanCache.shortcodes = new Set(result.folderScanCache.shortcodes || []);
      folderScanCache.lastScan = result.folderScanCache.lastScan;
      folderScanCache.folderPath = result.folderScanCache.folderPath;
      console.log('[Background] Loaded folder scan cache:', folderScanCache.shortcodes.size, 'shortcodes');
    }
  } catch (error) {
    console.error('[Background] Error loading folder scan cache:', error);
  }
}

// Clear folder scan cache
async function clearFolderScanCache() {
  folderScanCache = {
    shortcodes: new Set(),
    lastScan: null,
    folderPath: null
  };
  await chrome.storage.local.remove('folderScanCache');
  console.log('[Background] Folder scan cache cleared');
}

// Initialize folder scan cache on load
loadFolderScanCache();

// ===== Profile Scraping State Persistence =====

// Save profile scraping state
async function saveProfileScrapingState(state) {
  try {
    await chrome.storage.local.set({ savedProfileScrapingState: state });
    console.log('[Background] Profile scraping state saved:', state.collectedPosts?.length, 'posts for', state.username);
  } catch (error) {
    console.error('[Background] Error saving profile scraping state:', error);
  }
}

// Load profile scraping state
async function loadProfileScrapingState() {
  try {
    const result = await chrome.storage.local.get('savedProfileScrapingState');
    if (result.savedProfileScrapingState) {
      const state = result.savedProfileScrapingState;
      // Check if state is less than 24 hours old
      const ageHours = (Date.now() - state.savedAt) / (1000 * 60 * 60);
      if (ageHours < 24) {
        console.log('[Background] Loaded profile scraping state:', state.collectedPosts?.length, 'posts');
        return state;
      } else {
        // State is too old, clear it
        console.log('[Background] Profile scraping state expired, clearing...');
        await chrome.storage.local.remove('savedProfileScrapingState');
      }
    }
    return null;
  } catch (error) {
    console.error('[Background] Error loading profile scraping state:', error);
    return null;
  }
}

// Clear profile scraping state
async function clearProfileScrapingState() {
  try {
    await chrome.storage.local.remove('savedProfileScrapingState');
    console.log('[Background] Profile scraping state cleared');
  } catch (error) {
    console.error('[Background] Error clearing profile scraping state:', error);
  }
}

// Get the set of downloaded shortcodes from storage
async function getDownloadedShortcodes() {
  try {
    const result = await chrome.storage.local.get('downloadedShortcodes');
    return new Set(result.downloadedShortcodes || []);
  } catch (error) {
    console.error('[Background] Error getting downloaded shortcodes:', error);
    return new Set();
  }
}

// Save a shortcode as downloaded (local + optionally sync to Sheets)
async function markAsDownloaded(shortcode, postInfo = null) {
  try {
    const downloaded = await getDownloadedShortcodes();
    downloaded.add(shortcode);
    // Convert Set to Array for storage (limit to last 10000 to prevent storage bloat)
    const downloadedArray = Array.from(downloaded).slice(-10000);
    await chrome.storage.local.set({ downloadedShortcodes: downloadedArray });
    console.log('[Background] Marked as downloaded:', shortcode, '(total:', downloadedArray.length, ')');

    // Sync to Google Sheets if enabled and postInfo provided
    if (postInfo && typeof SheetsSync !== 'undefined' && SheetsSync.config.enabled) {
      const syncResult = await SheetsSync.trackDownload(postInfo);
      console.log('[Background] Sheets sync result:', syncResult);
    }
  } catch (error) {
    console.error('[Background] Error saving downloaded shortcode:', error);
  }
}

// Check if a shortcode has been downloaded (checks all sources: history, folder scan, team sync)
async function isAlreadyDownloaded(shortcode, checkSources = { history: true, folder: true, team: true }) {
  // Check extension download history
  if (checkSources.history) {
    const downloaded = await getDownloadedShortcodes();
    if (downloaded.has(shortcode)) {
      return { downloaded: true, source: 'history' };
    }
  }

  // Check folder scan cache
  if (checkSources.folder && isInFolderScanCache(shortcode)) {
    return { downloaded: true, source: 'folder' };
  }

  // Check team sync (Google Sheets)
  if (checkSources.team && typeof SheetsSync !== 'undefined' && SheetsSync.config.enabled) {
    const teamRecord = SheetsSync.isDownloaded(shortcode);
    if (teamRecord) {
      return { downloaded: true, source: 'team', record: teamRecord };
    }
  }

  return { downloaded: false };
}

// Simple boolean check for backwards compatibility
async function isAlreadyDownloadedSimple(shortcode) {
  const result = await isAlreadyDownloaded(shortcode);
  return result.downloaded;
}

// Extract shortcode from Instagram URL
function extractShortcode(url) {
  const match = url.match(/instagram\.com\/(?:[^\/]+\/)?(p|reel|reels)\/([^\/\?\#]+)/);
  return match ? match[2] : null;
}

// Get download history stats
async function getDownloadStats() {
  const downloaded = await getDownloadedShortcodes();
  return {
    totalDownloaded: downloaded.size
  };
}

// Clear download history
async function clearDownloadHistory() {
  try {
    await chrome.storage.local.set({ downloadedShortcodes: [] });
    console.log('[Background] Download history cleared');
    return true;
  } catch (error) {
    console.error('[Background] Error clearing download history:', error);
    return false;
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message.type || message.action);

  if (message.type === 'POST_DATA_RESPONSE') {
    currentData.postData = message.data;
  } else if (message.type === 'COMMENTS_RESPONSE') {
    currentData.comments = message.data;
  } else if (message.type === 'MEDIA_RESPONSE') {
    currentData.media = message.data;
  } else if (message.type === 'EXTRACTION_PROGRESS') {
    // Forward progress messages to the connected popup/sidepanel
    broadcastToUI({
      type: 'progress',
      message: message.message
    });
  } else if (message.type === 'profileScrapeProgress') {
    // Forward profile scrape progress to popup/sidepanel
    console.log('[Background] Profile scrape progress received');
    broadcastToUI({
      type: 'profileScrapeProgress',
      data: message.data
    });
  } else if (message.type === 'profileScrapeComplete') {
    // Forward profile scrape complete to popup/sidepanel
    console.log('[Background] Profile scrape COMPLETE received, posts:', message.data?.count);
    broadcastToUI({
      type: 'profileScrapeComplete',
      data: message.data
    });
    console.log('[Background] Forwarded profileScrapeComplete to UI');
  } else if (message.type === 'profileChunkPause') {
    // Forward chunk pause to popup/sidepanel
    console.log('[Background] Profile chunk pause received, posts:', message.data?.count);
    broadcastToUI({
      type: 'profileChunkPause',
      data: message.data
    });
    // Also save state to storage
    if (message.data) {
      saveProfileScrapingState({
        collectedPosts: message.data.posts,
        username: message.data.username,
        targetCount: message.data.targetCount,
        savedAt: Date.now()
      });
    }
  } else if (message.type === 'profileResumed') {
    // Forward resumed to popup/sidepanel
    console.log('[Background] Profile resumed');
    broadcastToUI({
      type: 'profileResumed',
      data: message.data
    });
  } else if (message.type === 'profileRateLimited') {
    // Forward rate limited to popup/sidepanel
    console.log('[Background] Profile rate limited:', message.data?.errorStatus);
    broadcastToUI({
      type: 'profileRateLimited',
      data: message.data
    });
    // Also save state to storage
    if (message.data) {
      saveProfileScrapingState({
        collectedPosts: message.data.posts,
        username: message.data.username,
        targetCount: message.data.targetCount,
        savedAt: Date.now()
      });
    }
  } else if (message.type === 'folderScanComplete') {
    // Update in-memory folder scan cache from folder-scan.js
    console.log('[Background] Folder scan complete, updating cache:', message.data?.shortcodes?.length, 'shortcodes');
    if (message.data) {
      updateFolderScanCache(message.data.shortcodes || [], message.data.folderPath);
    }
  } else if (message.type === 'saveProfileScrapingState') {
    // Save profile scraping state
    console.log('[Background] Saving profile scraping state');
    if (message.data) {
      saveProfileScrapingState(message.data);
    }
  }

  // Handle action-based messages (from popup's chrome.runtime.sendMessage)
  if (message.action === 'getDownloadStats') {
    getDownloadStats().then(stats => {
      sendResponse({ count: stats.totalDownloaded });
    });
    return true; // Keep channel open for async response
  } else if (message.action === 'clearDownloadHistory') {
    clearDownloadHistory().then(success => {
      sendResponse({ success });
    });
    return true;
  } else if (message.action === 'downloadCommentScreenshot') {
    // Download comment screenshot to organized folder path
    const { dataUrl, filename } = message;
    console.log('[Background] downloadCommentScreenshot called with filename:', filename);
    console.log('[Background] filename length:', filename?.length, 'starts with:', filename?.substring(0, 80));
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[Background] Comment screenshot download failed:', chrome.runtime.lastError);
        console.error('[Background] Attempted filename was:', filename);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('[Background] Comment screenshot downloaded successfully to:', filename);
        sendResponse({ success: true, downloadId });
      }
    });
    return true; // Keep channel open for async response
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

// Crop screenshot using offscreen document (legacy, kept for compatibility)
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

// Capture screenshot with iPhone mobile emulation using Chrome Debugger API
async function captureMobileScreenshot(tab) {
  // iPhone 14 Pro dimensions
  const IPHONE_WIDTH = 393;
  const IPHONE_HEIGHT = 852;
  const DEVICE_SCALE_FACTOR = 3;
  const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  const debuggeeId = { tabId: tab.id };

  try {
    // Attach debugger to the tab
    await chrome.debugger.attach(debuggeeId, '1.3');
    console.log('[Background] Debugger attached for mobile screenshot');

    // Enable required domains
    await chrome.debugger.sendCommand(debuggeeId, 'Page.enable', {});
    await chrome.debugger.sendCommand(debuggeeId, 'Runtime.enable', {});

    // Enable Emulation domain
    await chrome.debugger.sendCommand(debuggeeId, 'Emulation.setDeviceMetricsOverride', {
      width: IPHONE_WIDTH,
      height: IPHONE_HEIGHT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      mobile: true,
      screenWidth: IPHONE_WIDTH,
      screenHeight: IPHONE_HEIGHT
    });

    // Set mobile user agent
    await chrome.debugger.sendCommand(debuggeeId, 'Emulation.setUserAgentOverride', {
      userAgent: MOBILE_USER_AGENT,
      platform: 'iPhone'
    });

    // Wait for the page to re-render with mobile layout
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Reload the page to get the mobile version from Instagram
    await chrome.debugger.sendCommand(debuggeeId, 'Page.reload', { ignoreCache: true });

    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Click "more" button to expand bio if present
    try {
      const clickResult = await chrome.debugger.sendCommand(debuggeeId, 'Runtime.evaluate', {
        expression: `
          (function() {
            try {
              // Find the "more" span in the bio section
              const spans = document.querySelectorAll('span');
              for (const span of spans) {
                const text = span.textContent.trim().toLowerCase();
                if (text === 'more') {
                  // Check if it's in the profile header area
                  const header = span.closest('header');
                  if (header) {
                    span.click();
                    return 'clicked';
                  }
                }
              }
              return 'not found';
            } catch (err) {
              return 'error: ' + err.message;
            }
          })()
        `,
        returnByValue: true
      });
      console.log('[Background] Bio expand result:', clickResult?.result?.value);
      // Wait for bio to expand
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
      console.warn('[Background] Bio expand attempt failed:', e.message);
      // Continue anyway - don't let this break the screenshot
    }

    // Capture screenshot using debugger (gives us the emulated view)
    // Crop to 1179 × 2161 to show only the top 6 posts (cropping bottom)
    const result = await chrome.debugger.sendCommand(debuggeeId, 'Page.captureScreenshot', {
      format: 'png',
      quality: 100,
      fromSurface: true,
      captureBeyondViewport: false,
      clip: {
        x: 0,
        y: 0,
        width: IPHONE_WIDTH,
        height: 2161 / DEVICE_SCALE_FACTOR, // Convert to CSS pixels (720.33)
        scale: 1
      }
    });

    // Clear device metrics (restore normal view)
    await chrome.debugger.sendCommand(debuggeeId, 'Emulation.clearDeviceMetricsOverride');

    // Detach debugger
    await chrome.debugger.detach(debuggeeId);
    console.log('[Background] Debugger detached, mobile screenshot captured');

    // Reload page to restore desktop view
    chrome.tabs.reload(tab.id);

    // Return as data URL
    return 'data:image/png;base64,' + result.data;

  } catch (error) {
    console.error('[Background] Mobile screenshot error:', error);

    // Try to detach debugger on error
    try {
      await chrome.debugger.detach(debuggeeId);
    } catch (detachError) {
      // Ignore detach errors
    }

    // Fallback to regular screenshot
    console.log('[Background] Falling back to regular screenshot');
    return await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png',
      quality: 100
    });
  }
}

// Render Instagram-style screenshot using offscreen document
async function renderInstagramScreenshot(postInfo, mediaDataUrl, avatarDataUrl) {
  try {
    await setupOffscreenDocument();

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'RENDER_SCREENSHOT',
        postData: postInfo,
        mediaDataUrl: mediaDataUrl,
        avatarDataUrl: avatarDataUrl
      }, (response) => {
        if (response && response.success) {
          resolve(response.dataUrl);
        } else {
          reject(new Error(response?.error || 'Failed to render screenshot'));
        }
      });
    });
  } catch (error) {
    console.error('[Background] Error rendering screenshot:', error);
    throw error;
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

// Helper function to build custom folder name: username_IG_POSTTYPE_YYYYMMDD_shortcode[_collab_user1_user2]
// If profileUsername is provided (from profile scraping), it takes priority as the primary username
function buildFolderName(postInfo, profileUsername = null) {
  // Use profileUsername if provided, otherwise use post's username
  const primaryUsername = profileUsername || postInfo.username || 'unknown';
  const postType = (postInfo.post_type || 'post').toUpperCase();
  const shortcode = postInfo.shortcode || 'post';

  // Look up real name from Sheets sync cache
  let realName = null;
  if (typeof SheetsSync !== 'undefined' && SheetsSync.config.enabled) {
    realName = SheetsSync.lookupName(primaryUsername);
  }

  // Sanitize real name for filesystem (remove invalid characters)
  const sanitizedRealName = realName
    ? realName.replace(/[\/\\:*?"<>|]/g, '_').trim()
    : null;

  // Format date as YYYYMMDD (no dashes)
  let dateStr = 'unknown-date';
  if (postInfo.posted_at) {
    const date = new Date(postInfo.posted_at);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    dateStr = `${year}${month}${day}`;
  }

  // Build base name with optional real name prefix
  let folderName;
  if (sanitizedRealName) {
    folderName = `${sanitizedRealName} - ${primaryUsername}_IG_${postType}_${dateStr}_${shortcode}`;
  } else {
    folderName = `${primaryUsername}_IG_${postType}_${dateStr}_${shortcode}`;
  }

  // DEBUG: Log what we received
  console.log('[Background] buildFolderName - postInfo.collaborators:', postInfo.collaborators);

  // Add collaborators if present (excluding the primary username)
  if (postInfo.collaborators && Array.isArray(postInfo.collaborators) && postInfo.collaborators.length > 0) {
    // Filter out primary username from collaborators list and limit to reasonable number
    const collabsToAdd = postInfo.collaborators
      .filter(c => c !== primaryUsername)
      .slice(0, 3); // Limit to 3 collaborators to avoid overly long filenames

    console.log('[Background] Collaborators to add:', collabsToAdd);

    if (collabsToAdd.length > 0) {
      folderName += '_collab_' + collabsToAdd.join('_');
    }
  }

  console.log('[Background] Final folder name:', folderName);
  return folderName;
}

// Helper function to build base filename prefix
function buildFilePrefix(postInfo, profileUsername = null) {
  return buildFolderName(postInfo, profileUsername);
}

// Threshold for using blob URLs (500KB encoded is roughly where data URLs become problematic)
const LARGE_DATA_THRESHOLD = 500000;

// Helper to create blob URL via offscreen document for large data
async function createBlobUrlViaOffscreen(data, mimeType, id) {
  await setupOffscreenDocument();

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'CREATE_BLOB_URL',
      data: data,
      mimeType: mimeType,
      id: id
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.success) {
        resolve(response.blobUrl);
      } else {
        reject(new Error(response?.error || 'Failed to create blob URL'));
      }
    });
  });
}

// Helper to revoke blob URL after download
async function revokeBlobUrl(blobUrl, id) {
  try {
    await setupOffscreenDocument();
    chrome.runtime.sendMessage({
      type: 'REVOKE_BLOB_URL',
      blobUrl: blobUrl,
      id: id
    });
  } catch (error) {
    console.warn('[Background] Could not revoke blob URL:', error);
  }
}

// Helper function to download data as JSON
async function downloadJSON(data, filename, saveAs = false) {
  const jsonString = JSON.stringify(data, null, 2);

  // Use blob URL for large data to avoid data URL size limits
  if (jsonString.length > LARGE_DATA_THRESHOLD) {
    console.log('[Background] Using blob URL for large JSON:', jsonString.length, 'bytes');
    const blobId = `json_${Date.now()}`;

    try {
      const blobUrl = await createBlobUrlViaOffscreen(jsonString, 'application/json', blobId);
      const downloadId = await downloadFile(blobUrl, filename, saveAs);

      // Revoke blob URL after a delay to ensure download starts
      setTimeout(() => revokeBlobUrl(blobUrl, blobId), 5000);

      return downloadId;
    } catch (error) {
      console.error('[Background] Blob URL failed, falling back to data URL:', error);
      // Fall through to data URL approach
    }
  }

  // Use data URL for smaller data (faster, no offscreen document needed)
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
async function downloadCSV(csvContent, filename, saveAs = false) {
  // Use blob URL for large data to avoid data URL size limits
  if (csvContent.length > LARGE_DATA_THRESHOLD) {
    console.log('[Background] Using blob URL for large CSV:', csvContent.length, 'bytes');
    const blobId = `csv_${Date.now()}`;

    try {
      const blobUrl = await createBlobUrlViaOffscreen(csvContent, 'text/csv;charset=utf-8', blobId);
      const downloadId = await downloadFile(blobUrl, filename, saveAs);

      // Revoke blob URL after a delay to ensure download starts
      setTimeout(() => revokeBlobUrl(blobUrl, blobId), 5000);

      return downloadId;
    } catch (error) {
      console.error('[Background] Blob URL failed, falling back to data URL:', error);
      // Fall through to data URL approach
    }
  }

  // Use data URL for smaller data (faster, no offscreen document needed)
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

// Helper function to get file extension from URL
function getFileExtension(url, isVideo = false) {
  if (isVideo) return 'mp4';

  // Try to extract extension from URL
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const match = pathname.match(/\.([a-z0-9]+)(?:\?|$)/i);
    if (match && match[1]) {
      const ext = match[1].toLowerCase();
      // Common image extensions
      if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
        return ext;
      }
    }
  } catch (e) {
    // Fallback
  }

  // Default fallback
  return 'jpg';
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

// Helper function to fetch a single media item as base64 via content script
async function fetchSingleMediaAsBase64(url, isVideo = false) {
  if (!url) return null;

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      console.error('[Background] No active tab found for media fetch');
      return null;
    }

    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, {
        action: isVideo ? 'captureVideoFrame' : 'fetchMedia',
        mediaItems: [{ image_url: url }],
        videoUrl: url
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Background] Error fetching media:', chrome.runtime.lastError.message);
          resolve(null);
        } else if (response && response.success) {
          // For video frame capture
          if (response.frameDataUrl) {
            console.log('[Background] Got video frame, length:', response.frameDataUrl.length);
            resolve(response.frameDataUrl);
          }
          // For regular media fetch
          else if (response.mediaCache && response.mediaCache[url]) {
            console.log('[Background] Got media, length:', response.mediaCache[url].length);
            resolve(response.mediaCache[url]);
          } else {
            console.error('[Background] No media data in response');
            resolve(null);
          }
        } else {
          console.error('[Background] Media fetch failed, response:', response);
          resolve(null);
        }
      });
    });
  } catch (error) {
    console.error('[Background] Error in fetchSingleMediaAsBase64:', error);
    return null;
  }
}

// Helper function to fetch media via content script
async function fetchMediaViaContentScript(mediaItems) {
  if (!mediaItems || mediaItems.length === 0) {
    console.log('[Background] No media items to fetch');
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
    console.log('[Background] Requesting', mediaItems.length, 'media items from content script...');

    // Send message to content script to fetch media
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'fetchMedia',
        mediaItems: mediaItems
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Background] Error fetching media:', chrome.runtime.lastError.message);
          resolve({});
        } else if (response && response.success) {
          console.log('[Background] SUCCESS! Received', Object.keys(response.mediaCache).length, 'media items');
          resolve(response.mediaCache);
        } else {
          console.error('[Background] Failed to fetch media. Response:', response);
          resolve({});
        }
      });
    });
  } catch (error) {
    console.error('[Background] Error in fetchMediaViaContentScript:', error);
    return {};
  }
}

// Helper function to generate HTML archive
async function generatePostHTML(postData, mediaFilePrefix = null) {
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

  // Fetch all profile pictures via content script (keep avatars as base64 since they're small)
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

  // Helper to get media path (use relative paths instead of base64)
  const getMedia = (item, index) => {
    if (mediaFilePrefix) {
      // Use relative file path with correct extension
      const url = item.video_url || item.image_url;
      const extension = getFileExtension(url, !!item.video_url);
      return `./media/${mediaFilePrefix}_media_${index + 1}.${extension}`;
    } else {
      // Fallback to original URL
      return item.video_url || item.image_url;
    }
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
        const videoSrc = getMedia(item, 0);
        mediaHTML = `<video controls class="post-media"><source src="${videoSrc}" type="video/mp4"></video>`;
      } else if (item.image_url) {
        const imageSrc = getMedia(item, 0);
        mediaHTML = `<img src="${imageSrc}" alt="Post media" class="post-media">`;
      }
    } else {
      const carouselItems = media.map((item, index) => {
        const content = item.video_url
          ? `<video controls class="post-media"><source src="${getMedia(item, index)}" type="video/mp4"></video>`
          : `<img src="${getMedia(item, index)}" alt="Post media ${index + 1}" class="post-media">`;
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
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#fafafa;color:#262626;padding:20px;display:flex;justify-content:center;align-items:flex-start}.container{max-width:470px;width:100%;margin:0 auto;background:white;border:1px solid #dbdbdb;border-radius:8px;overflow:hidden}.post-header{padding:16px;border-bottom:1px solid #efefef;display:flex;align-items:center;justify-content:space-between}.user-info{display:flex;align-items:center;gap:12px}.profile-avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;border:1px solid #dbdbdb}.profile-avatar-placeholder{width:40px;height:40px;border-radius:50%;background:#dbdbdb}.username{font-weight:600;font-size:14px}.full-name{color:#8e8e8e;font-size:12px}.post-date{color:#8e8e8e;font-size:12px}.media-container{background:#000;position:relative;display:flex;align-items:center;justify-content:center;min-height:600px;overflow:hidden;width:100%}img.post-media{max-width:100%;max-height:80vh;width:auto;height:auto;object-fit:contain}video.post-media{height:80vh;width:100%;max-width:100%;display:block;object-fit:cover}.carousel{position:relative;min-height:600px;width:100%}.carousel-container{position:relative;min-height:600px;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden;width:100%}.carousel-item{display:none;width:100%;height:100%;align-items:center;justify-content:center}.carousel-item.active{display:flex}.carousel-btn{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);color:white;border:none;padding:10px 15px;cursor:pointer;font-size:18px;border-radius:4px;z-index:10}.carousel-btn:hover{background:rgba(0,0,0,0.8)}.carousel-btn.prev{left:10px}.carousel-btn.next{right:10px}.carousel-dots{text-align:center;padding:10px;background:#000}.dot{height:8px;width:8px;margin:0 4px;background-color:#bbb;border-radius:50%;display:inline-block;cursor:pointer}.dot.active{background-color:#0095f6}.post-stats{padding:16px;border-bottom:1px solid #efefef}.stats-row{display:flex;gap:16px;margin-bottom:8px}.stat{font-weight:600;font-size:14px}.caption{padding:16px;border-bottom:1px solid #efefef}.caption-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}.caption-avatar{width:32px;height:32px;border-radius:50%;object-fit:cover;border:1px solid #dbdbdb}.caption-avatar-placeholder{width:32px;height:32px;border-radius:50%;background:#dbdbdb}.caption-username{font-weight:600}.caption-text{white-space:pre-wrap;word-wrap:break-word;display:block}.comments-section{max-height:500px;overflow-y:auto;padding:16px}.comments-header{font-weight:600;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #efefef}.comment{margin-bottom:16px}.comment.reply{margin-left:32px;padding-left:16px;border-left:2px solid #efefef}.comment-content{display:flex;gap:12px;align-items:flex-start}.comment-avatar{width:32px;height:32px;border-radius:50%;object-fit:cover;border:1px solid #dbdbdb;flex-shrink:0}.comment-avatar-placeholder{width:32px;height:32px;border-radius:50%;background:#dbdbdb;flex-shrink:0}.comment-body{flex:1}.comment-header{display:flex;align-items:center;gap:8px;margin-bottom:4px}.comment-username{font-weight:600;font-size:14px}.comment-date{color:#8e8e8e;font-size:12px}.comment-text{font-size:14px;margin-bottom:4px;white-space:pre-wrap;word-wrap:break-word}.comment-footer{display:flex;gap:12px;color:#8e8e8e;font-size:12px}.comment-likes{font-weight:600}.replies{margin-top:12px}.no-comments{text-align:center;color:#8e8e8e;padding:40px}.footer{padding:16px;background:#fafafa;border-top:1px solid #efefef;text-align:center;font-size:12px;color:#8e8e8e}.footer a{color:#0095f6;text-decoration:none}.footer a:hover{text-decoration:underline}</style>
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
async function downloadHTML(htmlContent, filename, saveAs = false) {
  // Use blob URL for large data to avoid data URL size limits
  if (htmlContent.length > LARGE_DATA_THRESHOLD) {
    console.log('[Background] Using blob URL for large HTML:', htmlContent.length, 'bytes');
    const blobId = `html_${Date.now()}`;

    try {
      const blobUrl = await createBlobUrlViaOffscreen(htmlContent, 'text/html;charset=utf-8', blobId);
      const downloadId = await downloadFile(blobUrl, filename, saveAs);

      // Revoke blob URL after a delay to ensure download starts
      setTimeout(() => revokeBlobUrl(blobUrl, blobId), 5000);

      return downloadId;
    } catch (error) {
      console.error('[Background] Blob URL failed, falling back to data URL:', error);
      // Fall through to data URL approach
    }
  }

  // Use data URL for smaller data (faster, no offscreen document needed)
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
  return downloadFile(dataUrl, filename, saveAs);
}

// Expose API for popup
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup' || port.name === 'sidepanel') {
    // Store the active port for progress messages (popup or sidepanel)
    if (port.name === 'popup') {
      activePopupPort = port;
      console.log('[Background] Popup connected, progress messages enabled');
    } else {
      activeSidePanelPort = port;
      console.log('[Background] Side panel connected, progress messages enabled');
    }

    // Clear the port reference when disconnected
    port.onDisconnect.addListener(() => {
      if (port.name === 'popup') {
        activePopupPort = null;
        console.log('[Background] Popup disconnected, progress messages disabled');
      } else {
        activeSidePanelPort = null;
        console.log('[Background] Side panel disconnected, progress messages disabled');
      }
    });

    port.onMessage.addListener(async (msg) => {
      try {
        if (msg.action === 'getCurrentData') {
          port.postMessage({
            type: 'currentData',
            data: currentData
          });
        } else if (msg.action === 'downloadMedia') {
          const { media, postInfo, saveAs } = msg.data;

          // Build custom folder name with username parent folder
          const username = postInfo.username || 'unknown';
          const folderName = buildFolderName(postInfo);

          // Look up real name for parent folder
          let realName = null;
          if (typeof SheetsSync !== 'undefined' && SheetsSync.config.enabled) {
            realName = SheetsSync.lookupName(username);
          }
          const sanitizedRealName = realName
            ? realName.replace(/[\/\\:*?"<>|]/g, '_').trim()
            : null;
          const parentFolder = sanitizedRealName
            ? `${sanitizedRealName} - ${username}`
            : username;

          const folderPrefix = `Instagram/${parentFolder}/${folderName}/media`;

          // Build base filename prefix
          const filePrefix = buildFilePrefix(postInfo);

          // Send progress message
          broadcastToUI({
            type: 'progress',
            message: `⬇️ Downloading ${media.length} media files...`
          });

          for (let i = 0; i < media.length; i++) {
            const item = media[i];
            const url = item.video_url || item.image_url;
            const extension = getFileExtension(url, !!item.video_url);

            // Custom filename: USERNAME_POSTTYPE_YYYY-MM-DD_shortcode_media_1.ext
            const filename = `${folderPrefix}/${filePrefix}_media_${i + 1}.${extension}`;

            // Send progress for each file
            broadcastToUI({
              type: 'progress',
              message: `⬇️ Downloading media ${i + 1}/${media.length}...`
            });

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

          // Build file prefix for relative media paths
          const postInfo = currentData.media?.post_info || currentData.comments?.post_info || {};
          const mediaFilePrefix = buildFilePrefix(postInfo);

          const htmlContent = await generatePostHTML(currentData, mediaFilePrefix);
          await downloadHTML(htmlContent, filename, saveAs);

          port.postMessage({
            type: 'success',
            message: 'Downloaded HTML archive'
          });
        } else if (msg.action === 'captureScreenshot') {
          // Render Instagram-style screenshot
          const { filename, saveAs } = msg.data;

          try {
            console.log('[Background] Rendering Instagram-style screenshot...');

            // Get post info from current data
            const postInfo = currentData.media?.post_info || currentData.comments?.post_info || {};
            const media = currentData.media?.media?.[0];

            if (!media) {
              throw new Error('No media available for screenshot');
            }

            // Fetch the first media as base64 (handle videos by capturing a frame)
            const isVideo = !!media.video_url;
            const mediaUrl = media.video_url || media.image_url;
            console.log('[Background] Fetching media for screenshot:', mediaUrl?.substring(0, 50) + '...', 'isVideo:', isVideo);

            const mediaDataUrl = await fetchSingleMediaAsBase64(mediaUrl, isVideo);
            if (!mediaDataUrl) {
              throw new Error('Failed to fetch media for screenshot');
            }
            console.log('[Background] Media fetched successfully, length:', mediaDataUrl.length);

            // Fetch avatar as base64 if available
            let avatarDataUrl = null;
            if (postInfo.profile_pic_url) {
              const avatarCache = await fetchAvatarsViaContentScript([postInfo.profile_pic_url]);
              avatarDataUrl = avatarCache[postInfo.profile_pic_url] || null;
            }

            // Render the screenshot
            const screenshotDataUrl = await renderInstagramScreenshot(postInfo, mediaDataUrl, avatarDataUrl);

            // Download
            await downloadFile(screenshotDataUrl, filename, saveAs);

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
        } else if (msg.action === 'downloadAll') {
          const { saveAs } = msg.data;

          // Get post info from either media or comments data
          const postInfo = currentData.media?.post_info || currentData.comments?.post_info || {};
          const username = postInfo.username || 'unknown';
          const folderName = buildFolderName(postInfo);
          const filePrefix = buildFilePrefix(postInfo);

          // Look up real name for parent folder
          let realName = null;
          if (typeof SheetsSync !== 'undefined' && SheetsSync.config.enabled) {
            realName = SheetsSync.lookupName(username);
          }
          const sanitizedRealName = realName
            ? realName.replace(/[\/\\:*?"<>|]/g, '_').trim()
            : null;
          const parentFolder = sanitizedRealName
            ? `${sanitizedRealName} - ${username}`
            : username;

          // Send initial progress
          broadcastToUI({
            type: 'progress',
            message: '📦 Starting complete download...'
          });

          // Download media
          if (currentData.media && currentData.media.media) {
            const folderPrefix = `Instagram/${parentFolder}/${folderName}/media`;
            const mediaCount = currentData.media.media.length;

            broadcastToUI({
              type: 'progress',
              message: `⬇️ Downloading ${mediaCount} media files...`
            });

            for (let i = 0; i < mediaCount; i++) {
              const item = currentData.media.media[i];
              const url = item.video_url || item.image_url;
              const extension = getFileExtension(url, !!item.video_url);
              const filename = `${folderPrefix}/${filePrefix}_media_${i + 1}.${extension}`;

              broadcastToUI({
                type: 'progress',
                message: `⬇️ Downloading media ${i + 1}/${mediaCount}...`
              });

              // Only prompt saveAs for the first file
              await downloadFile(url, filename, saveAs && i === 0);
            }
          }

          // Download comments as JSON and CSV
          if (currentData.comments && currentData.comments.comments) {
            broadcastToUI({
              type: 'progress',
              message: '💾 Saving comments as JSON and CSV...'
            });

            const jsonFilename = `Instagram/${parentFolder}/${folderName}/comments/${filePrefix}_comments.json`;
            await downloadJSON(currentData.comments, jsonFilename, false);

            // Pass full currentData.comments object (includes post_info and comments)
            const csv = commentsToCSV(currentData.comments);
            const csvFilename = `Instagram/${parentFolder}/${folderName}/comments/${filePrefix}_comments.csv`;
            await downloadCSV(csv, csvFilename, false);
          }

          // Download post metadata
          broadcastToUI({
            type: 'progress',
            message: '📝 Saving post metadata...'
          });

          const metadata = {
            ...postInfo,
            downloaded_at: new Date().toISOString(),
            media_count: currentData.media?.media?.length || 0,
            comment_count: currentData.comments?.total || 0
          };
          const metadataFilename = `Instagram/${parentFolder}/${folderName}/${filePrefix}_metadata.json`;
          await downloadJSON(metadata, metadataFilename, false);

          // Download HTML archive
          broadcastToUI({
            type: 'progress',
            message: '🌐 Generating HTML archive...'
          });

          const htmlContent = await generatePostHTML(currentData, filePrefix);
          const htmlFilename = `Instagram/${parentFolder}/${folderName}/${filePrefix}_archive.html`;
          await downloadHTML(htmlContent, htmlFilename, false);

          // Capture Instagram-style screenshot
          try {
            broadcastToUI({
              type: 'progress',
              message: '📸 Rendering screenshot...'
            });

            const media = currentData.media?.media?.[0];
            if (media) {
              // Fetch the first media as base64 (handle videos by capturing a frame)
              const isVideo = !!media.video_url;
              const mediaUrl = media.video_url || media.image_url;
              console.log('[Background] Fetching media for downloadAll screenshot...', 'isVideo:', isVideo);

              const mediaDataUrl = await fetchSingleMediaAsBase64(mediaUrl, isVideo);

              if (mediaDataUrl) {
                // Fetch avatar as base64 if available
                let avatarDataUrl = null;
                if (postInfo.profile_pic_url) {
                  const avatarCache = await fetchAvatarsViaContentScript([postInfo.profile_pic_url]);
                  avatarDataUrl = avatarCache[postInfo.profile_pic_url] || null;
                }

                // Render the screenshot
                const screenshotDataUrl = await renderInstagramScreenshot(postInfo, mediaDataUrl, avatarDataUrl);

                const screenshotFilename = `Instagram/${parentFolder}/${folderName}/${filePrefix}_screenshot.png`;
                await downloadFile(screenshotDataUrl, screenshotFilename, false);
              } else {
                console.warn('[Background] Could not fetch media for screenshot');
              }
            }

            // Mark as downloaded with full post info for Sheets sync
            const shortcode = postInfo.shortcode;
            if (shortcode) {
              const enrichedPostInfo = {
                ...postInfo,
                media_count: currentData.media?.media?.length || 0,
                comment_count: currentData.comments?.total || currentData.comments?.comments?.length || 0
              };
              await markAsDownloaded(shortcode, enrichedPostInfo);
            }

            port.postMessage({
              type: 'success',
              message: 'Downloaded all content successfully!'
            });
          } catch (error) {
            console.error('[Background] Screenshot error:', error);

            // Still mark as downloaded even if screenshot failed
            const shortcode = postInfo.shortcode;
            if (shortcode) {
              const enrichedPostInfo = {
                ...postInfo,
                media_count: currentData.media?.media?.length || 0,
                comment_count: currentData.comments?.total || currentData.comments?.comments?.length || 0
              };
              await markAsDownloaded(shortcode, enrichedPostInfo);
            }

            port.postMessage({
              type: 'success',
              message: 'Downloaded all content (screenshot failed)'
            });
          }
        } else if (msg.action === 'startBatch') {
          // Start batch processing
          const { urls, skipDownloaded, profileUsername, skipSources } = msg.data;
          batchState.queue = urls;
          batchState.currentIndex = 0;
          batchState.successCount = 0;
          batchState.skippedCount = 0;
          batchState.failedUrls = [];
          batchState.isProcessing = true;
          batchState.port = port;
          batchState.skipDownloaded = skipDownloaded !== false; // Default to true
          batchState.profileUsername = profileUsername || null; // Store profile username for collab handling
          // Skip sources configuration (history, folder, team)
          batchState.skipSources = skipSources || { history: true, folder: true, team: true };
          // Reset rate limiting state for new batch
          batchState.consecutiveErrors = 0;
          batchState.last429Time = null;
          batchState.currentPauseDuration = 0;
          batchState.isPaused = false;

          // Get current tab
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          batchState.tabId = tab.id;

          console.log('[Background] Starting batch processing:', urls.length, 'URLs, skipDownloaded:', batchState.skipDownloaded);
          console.log('[Background] Rate limit protection: Progressive delays enabled, cooldowns every 100 posts, auto-pause on 429');
          processNextBatchUrl();

        } else if (msg.action === 'getDownloadStats') {
          // Get download history statistics
          const stats = await getDownloadStats();
          port.postMessage({
            type: 'downloadStats',
            data: stats
          });

        } else if (msg.action === 'clearDownloadHistory') {
          // Clear download history
          const success = await clearDownloadHistory();
          port.postMessage({
            type: 'downloadHistoryCleared',
            data: { success }
          });

        } else if (msg.action === 'checkIfDownloaded') {
          // Check if specific URLs are already downloaded
          const { urls } = msg.data;
          const results = {};
          for (const url of urls) {
            const shortcode = extractShortcode(url);
            results[url] = shortcode ? await isAlreadyDownloaded(shortcode) : false;
          }
          port.postMessage({
            type: 'downloadedCheckResult',
            data: results
          });

        } else if (msg.action === 'stopBatch') {
          // Stop batch processing and save state for resume
          console.log('[Background] Stopping batch processing');
          batchState.isProcessing = false;

          // Save state for potential resume
          await saveBatchState();

          port.postMessage({
            type: 'batchStopped',
            data: {
              successCount: batchState.successCount,
              failedUrls: batchState.failedUrls,
              canResume: batchState.currentIndex < batchState.queue.length,
              remaining: batchState.queue.length - batchState.currentIndex
            }
          });

        } else if (msg.action === 'getSavedBatchState') {
          // Check if there's a saved batch state to resume
          const savedState = await loadSavedBatchState();
          port.postMessage({
            type: 'savedBatchState',
            data: savedState
          });

        } else if (msg.action === 'resumeBatch') {
          // Resume a previously saved batch
          const savedState = await loadSavedBatchState();
          if (savedState) {
            batchState.queue = savedState.queue;
            batchState.currentIndex = savedState.currentIndex;
            batchState.successCount = savedState.successCount;
            batchState.skippedCount = savedState.skippedCount;
            batchState.failedUrls = savedState.failedUrls;
            batchState.skipDownloaded = savedState.skipDownloaded;
            batchState.profileUsername = savedState.profileUsername || null; // Restore profile username
            batchState.isProcessing = true;
            batchState.port = port;
            batchState.consecutiveErrors = 0;
            batchState.last429Time = null;
            batchState.currentPauseDuration = 0;
            batchState.isPaused = false;

            // Get current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            batchState.tabId = tab.id;

            const remaining = savedState.queue.length - savedState.currentIndex;
            console.log('[Background] Resuming batch:', remaining, 'posts remaining, profileUsername:', batchState.profileUsername);
            port.postMessage({
              type: 'batchResumed',
              data: {
                remaining,
                total: savedState.queue.length,
                alreadyCompleted: savedState.successCount
              }
            });

            processNextBatchUrl();
          } else {
            port.postMessage({
              type: 'error',
              message: 'No saved batch state to resume'
            });
          }

        } else if (msg.action === 'clearSavedBatch') {
          // Clear saved batch state
          await clearSavedBatchState();
          port.postMessage({
            type: 'savedBatchCleared',
            data: { success: true }
          });

        } else if (msg.action === 'filterUrlsByTeamSync') {
          // Filter URLs to exclude ones already downloaded by team
          const { urls } = msg.data;
          const filteredUrls = [];
          const alreadyDownloaded = [];

          if (typeof SheetsSync !== 'undefined' && SheetsSync.config.enabled) {
            for (const url of urls) {
              const shortcode = extractShortcode(url);
              if (shortcode) {
                const downloadRecord = SheetsSync.isDownloaded(shortcode);
                if (downloadRecord) {
                  alreadyDownloaded.push({
                    url,
                    shortcode,
                    downloadedBy: downloadRecord.downloader,
                    downloadedAt: downloadRecord.timestamp
                  });
                } else {
                  filteredUrls.push(url);
                }
              } else {
                filteredUrls.push(url);
              }
            }
          } else {
            // If Team Sync not enabled, return all URLs
            filteredUrls.push(...urls);
          }

          port.postMessage({
            type: 'urlsFilteredByTeam',
            data: {
              filteredUrls,
              alreadyDownloaded,
              originalCount: urls.length,
              filteredCount: filteredUrls.length,
              removedCount: alreadyDownloaded.length
            }
          });

        // ===== GOOGLE SHEETS SYNC HANDLERS =====

        } else if (msg.action === 'configureSheets') {
          // Configure Sheets sync settings
          const { webAppUrl, userId } = msg.data;
          const result = await SheetsSync.configure(webAppUrl, userId);
          port.postMessage({ type: 'sheetsConfigured', data: result });

        } else if (msg.action === 'getSheetsStatus') {
          // Get current sync status
          const status = SheetsSync.getStatus();
          port.postMessage({ type: 'sheetsStatus', data: status });

        } else if (msg.action === 'getRequestBudgetStatus') {
          // Get current request budget status for UI display
          const status = requestBudget.getStatus();
          port.postMessage({ type: 'requestBudgetStatus', data: status });

        } else if (msg.action === 'refreshSheetsCache') {
          // Force refresh cache from Sheets
          const result = await SheetsSync.refreshCache();
          port.postMessage({ type: 'sheetsCacheRefreshed', data: result });

        } else if (msg.action === 'getProfileCompletion') {
          // Get profile completion stats
          const { username } = msg.data;
          const stats = SheetsSync.getProfileStats(username);
          port.postMessage({ type: 'profileCompletion', data: stats });

        } else if (msg.action === 'updateProfileTotal') {
          // Update profile total posts for completion %
          const { username, totalPosts } = msg.data;
          const result = await SheetsSync.updateProfileTotal(username, totalPosts);
          port.postMessage({ type: 'profileTotalUpdated', data: result });

        } else if (msg.action === 'checkSheetsDownloaded') {
          // Check if shortcodes are downloaded in Sheets
          const { shortcodes } = msg.data;
          const results = {};
          shortcodes.forEach(sc => {
            results[sc] = SheetsSync.isDownloaded(sc);
          });
          port.postMessage({ type: 'sheetsDownloadedCheck', data: results });

        } else if (msg.action === 'setSkipTeamDownloaded') {
          // Set skip team downloaded preference
          const { skip } = msg.data;
          const result = await SheetsSync.setSkipTeamDownloaded(skip);
          port.postMessage({ type: 'skipTeamDownloadedSet', data: result });

        } else if (msg.action === 'checkTeamDownloaded') {
          // Check if post was downloaded by another team member
          const { shortcode } = msg.data;
          const record = SheetsSync.isDownloadedByOthers(shortcode);
          port.postMessage({ type: 'teamDownloadedCheck', data: { downloaded: !!record, record } });

        // ===== NAME MAPPING HANDLERS =====

        } else if (msg.action === 'lookupName') {
          // Look up real name for a username
          const { username } = msg.data;
          const realName = SheetsSync.lookupName(username);
          port.postMessage({ type: 'nameLookupResult', data: { username, realName } });

        } else if (msg.action === 'addName') {
          // Add a new name mapping
          const { username, realName } = msg.data;
          const result = await SheetsSync.addName(username, realName);
          port.postMessage({ type: 'nameAdded', data: result });

        } else if (msg.action === 'updateName') {
          // Update an existing name mapping
          const { username, realName } = msg.data;
          const result = await SheetsSync.updateName(username, realName);
          port.postMessage({ type: 'nameUpdated', data: result });

        } else if (msg.action === 'getNames') {
          // Get all name mappings
          const names = SheetsSync.getAllNames();
          port.postMessage({ type: 'namesResult', data: names });

        } else if (msg.action === 'hasNameMapping') {
          // Check if username has a name mapping
          const { username } = msg.data;
          const hasMapping = SheetsSync.hasNameMapping(username);
          const realName = hasMapping ? SheetsSync.lookupName(username) : null;
          port.postMessage({ type: 'hasNameMappingResult', data: { username, hasMapping, realName } });

        // ===== LOCAL FOLDER SCANNING HANDLERS =====

        } else if (msg.action === 'updateFolderScan') {
          // Update folder scan cache with results from popup's File System Access API scan
          const { shortcodes, folderPath } = msg.data;
          updateFolderScanCache(shortcodes, folderPath);
          port.postMessage({
            type: 'folderScanUpdated',
            data: {
              success: true,
              count: shortcodes.length,
              folderPath: folderPath
            }
          });

        } else if (msg.action === 'getFolderScanStats') {
          // Get folder scan statistics
          const stats = getFolderScanStats();
          port.postMessage({ type: 'folderScanStats', data: stats });

        } else if (msg.action === 'clearFolderScanCache') {
          // Clear folder scan cache
          await clearFolderScanCache();
          port.postMessage({ type: 'folderScanCacheCleared', data: { success: true } });

        } else if (msg.action === 'getDownloadSourceStats') {
          // Get combined stats from all download tracking sources
          const historyShortcodes = await getDownloadedShortcodes();
          const folderStats = getFolderScanStats();
          const teamCount = (typeof SheetsSync !== 'undefined' && SheetsSync.config.enabled)
            ? SheetsSync.cache?.downloads?.size || 0
            : 0;

          port.postMessage({
            type: 'downloadSourceStats',
            data: {
              history: {
                count: historyShortcodes.size,
                label: 'Session History'
              },
              folder: {
                count: folderStats.count,
                lastScan: folderStats.lastScan,
                folderPath: folderStats.folderPath,
                label: 'Local Folder'
              },
              team: {
                count: teamCount,
                enabled: typeof SheetsSync !== 'undefined' && SheetsSync.config.enabled,
                label: 'Team Sync'
              }
            }
          });

        } else if (msg.action === 'checkDownloadedAllSources') {
          // Check if shortcodes are downloaded across all sources
          const { shortcodes } = msg.data;
          const results = {};

          for (const shortcode of shortcodes) {
            const check = await isAlreadyDownloaded(shortcode);
            results[shortcode] = check;
          }

          port.postMessage({
            type: 'downloadedCheckAllSources',
            data: results
          });

        // ===== PROFILE SCRAPING STATE HANDLERS =====

        } else if (msg.action === 'saveProfileScrapingState') {
          // Save profile scraping state (from content script)
          await saveProfileScrapingState(msg.data);
          port.postMessage({ type: 'profileScrapingStateSaved', data: { success: true } });

        } else if (msg.action === 'loadProfileScrapingState') {
          // Load saved profile scraping state
          const state = await loadProfileScrapingState();
          port.postMessage({ type: 'profileScrapingStateLoaded', data: state });

        } else if (msg.action === 'clearProfileScrapingState') {
          // Clear profile scraping state
          await clearProfileScrapingState();
          port.postMessage({ type: 'profileScrapingStateCleared', data: { success: true } });

        } else if (msg.action === 'checkSavedProfileScrape') {
          // Check if there's a saved profile scrape for resuming
          const state = await loadProfileScrapingState();
          port.postMessage({
            type: 'savedProfileScrapeState',
            data: state ? {
              exists: true,
              username: state.username,
              count: state.collectedPosts?.length || 0,
              targetCount: state.targetCount,
              savedAt: state.savedAt,
              posts: state.collectedPosts
            } : { exists: false }
          });

        } else if (msg.action === 'captureProfileScreenshot') {
          // Capture visible tab screenshot for profile page with iPhone-style mobile emulation
          const { username, saveAs } = msg.data;

          try {
            // Get the current active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab) {
              throw new Error('No active tab found');
            }

            // Capture using mobile emulation for iPhone-like layout
            const dataUrl = await captureMobileScreenshot(tab);

            // Build filename with real name prefix if available
            const date = new Date();
            const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;

            // Look up real name from Sheets sync cache
            let realName = null;
            if (typeof SheetsSync !== 'undefined' && SheetsSync.config.enabled) {
              realName = SheetsSync.lookupName(username);
            }
            const sanitizedRealName = realName
              ? realName.replace(/[\/\\:*?"<>|]/g, '_').trim()
              : null;

            // Build folder and filename with optional real name prefix
            const folderName = sanitizedRealName
              ? `${sanitizedRealName} - ${username}`
              : username;
            const filePrefix = sanitizedRealName
              ? `${sanitizedRealName} - ${username}`
              : username;
            const filename = `Instagram/${folderName}/${filePrefix}_profile_screenshot_${dateStr}.png`;

            // Download the screenshot
            await downloadFile(dataUrl, filename, saveAs);

            port.postMessage({
              type: 'profileScreenshotCaptured',
              data: { success: true, filename }
            });

            console.log('[Background] Profile screenshot captured:', filename);
          } catch (error) {
            console.error('[Background] Error capturing profile screenshot:', error);
            port.postMessage({
              type: 'profileScreenshotCaptured',
              data: { success: false, error: error.message }
            });
          }
        }
      } catch (error) {
        console.error('[Background] Error:', error);
        port.postMessage({
          type: 'error',
          message: error.message
        });
      }
    });

    // Store port reference for batch processing
    port.onDisconnect.addListener(() => {
      if (batchState.port === port) {
        batchState.port = null;
      }
    });
  }
});

// Batch processing functions
async function processNextBatchUrl() {
  if (!batchState.isProcessing) {
    console.log('[Background] Batch processing stopped');
    return;
  }

  if (batchState.currentIndex >= batchState.queue.length) {
    // Batch complete
    console.log('[Background] Batch processing complete');
    batchState.isProcessing = false;

    // Clear saved batch state since we completed successfully
    await clearSavedBatchState();

    if (batchState.port) {
      batchState.port.postMessage({
        type: 'batchComplete',
        data: {
          successCount: batchState.successCount,
          skippedCount: batchState.skippedCount,
          failedUrls: batchState.failedUrls,
          total: batchState.queue.length
        }
      });
    }
    return;
  }

  // ===== Proactive Rate Limiting Check =====
  // Check if we should pause to avoid hitting rate limits
  if (requestBudget.shouldPauseProactively()) {
    const waitTime = CONFIG.REQUEST_BUDGET?.PROACTIVE_PAUSE_MS || 30000;
    const budgetStatus = requestBudget.getStatus();
    const pauseEndTime = Date.now() + waitTime;
    console.log(`[Background] ⚠️ Proactive pause: ${budgetStatus.current}/${budgetStatus.max} requests in last minute. Pausing ${waitTime/1000}s to avoid 429...`);

    batchState.isPaused = true;

    if (batchState.port) {
      batchState.port.postMessage({
        type: 'batchProgress',
        data: {
          current: batchState.currentIndex + 1,
          total: batchState.queue.length,
          url: 'Proactive pause...',
          successCount: batchState.successCount,
          skippedCount: batchState.skippedCount,
          failedUrls: batchState.failedUrls,
          isPaused: true,
          pauseReason: `Proactive pause (${budgetStatus.current}/${budgetStatus.max} requests) - avoiding rate limit`,
          pauseDuration: waitTime,
          pauseEndTime: pauseEndTime,
          isProactivePause: true,
          requestBudget: budgetStatus
        }
      });
    }

    setTimeout(() => {
      batchState.isPaused = false;
      console.log(`[Background] ⚠️ Proactive pause complete, resuming...`);
      processNextBatchUrl();
    }, waitTime);
    return;
  }

  // Record this request in the budget tracker
  requestBudget.recordRequest();

  const url = batchState.queue[batchState.currentIndex];
  const shortcode = extractShortcode(url);
  const budgetStatus = requestBudget.getStatus();
  console.log('[Background] Processing URL', batchState.currentIndex + 1, '/', batchState.queue.length, ':', url, 'shortcode:', shortcode, `[Budget: ${budgetStatus.current}/${budgetStatus.max}]`);

  // Check if already downloaded (if skip option is enabled)
  if (batchState.skipDownloaded && shortcode) {
    const downloadCheck = await isAlreadyDownloaded(shortcode, {
      history: batchState.skipSources?.history !== false,
      folder: batchState.skipSources?.folder !== false,
      team: batchState.skipSources?.team !== false
    });
    if (downloadCheck.downloaded) {
      console.log('[Background] ⏭️ Skipping already downloaded:', shortcode, '(source:', downloadCheck.source + ')');
      batchState.skippedCount++;
      batchState.currentIndex++;

      // Send progress update with source info
      if (batchState.port) {
        batchState.port.postMessage({
          type: 'batchProgress',
          data: {
            current: batchState.currentIndex,
            total: batchState.queue.length,
            url: url,
            successCount: batchState.successCount,
            skippedCount: batchState.skippedCount,
            failedUrls: batchState.failedUrls,
            skipped: true,
            skipSource: downloadCheck.source
          }
        });
      }

      // Small delay before processing next
      setTimeout(() => processNextBatchUrl(), 100);
      return;
    }
  }

  // Send progress update to popup
  if (batchState.port) {
    batchState.port.postMessage({
      type: 'batchProgress',
      data: {
        current: batchState.currentIndex + 1,
        total: batchState.queue.length,
        url: url,
        successCount: batchState.successCount,
        skippedCount: batchState.skippedCount,
        failedUrls: batchState.failedUrls,
        skipped: false
      }
    });
  }

  try {
    // Navigate to the URL
    await chrome.tabs.update(batchState.tabId, { url: url });
    // Wait for page load and extraction - handled by tab update listener
  } catch (error) {
    console.error('[Background] Failed to navigate to URL:', url, error);
    batchState.failedUrls.push({ url, error: error.message });
    batchState.currentIndex++;

    // Add delay before next URL using CONFIG
    const delay = CONFIG.TIMING.BATCH_DELAY_MIN + Math.random() * (CONFIG.TIMING.BATCH_DELAY_MAX - CONFIG.TIMING.BATCH_DELAY_MIN);
    setTimeout(() => processNextBatchUrl(), delay);
  }
}

// Listen for tab updates to detect page loads during batch processing
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!batchState.isProcessing || tabId !== batchState.tabId) {
    return;
  }

  // Check if page is fully loaded
  if (changeInfo.status === 'complete' && tab.url) {
    console.log('[Background] 🔄 Tab update detected:', tab.url);

    if (tab.url.includes('instagram.com/p/') || tab.url.includes('instagram.com/reel/')) {
      console.log('[Background] ✅ Valid Instagram post/reel detected, starting auto-extraction');

      // Reset current data
      currentData = {
        postData: null,
        comments: null,
        media: null
      };

      // Wait a bit for page to fully render
      await new Promise(resolve => setTimeout(resolve, 2000));

      try {
        // Trigger extraction via content script
        console.log('[Background] 📤 Sending extraction requests to content script...');
        await chrome.tabs.sendMessage(tabId, { action: 'extractMedia' });
        await chrome.tabs.sendMessage(tabId, { action: 'extractComments' });

      // Wait for extractions to complete with exponential backoff polling
      console.log('[Background] Waiting for extraction to complete...');
      const maxWaitTime = CONFIG.TIMING.POLL_MAX_WAIT;
      let pollInterval = CONFIG.TIMING.POLL_INTERVAL_START; // Start at 500ms
      let waited = 0;

      while (waited < maxWaitTime) {
        // Check if both media and comments data are ready (comments can be empty array)
        const mediaReady = currentData.media && currentData.media.media;
        const commentsReady = currentData.comments && Array.isArray(currentData.comments.comments);

        if (mediaReady && commentsReady) {
          const commentCount = currentData.comments.comments.length;
          console.log('[Background] ✅ Extraction complete! Found', commentCount, 'comments in', waited/1000, 's');
          break;
        }

        if (mediaReady && !commentsReady) {
          console.log('[Background] Waiting for comments... (', waited/1000, 's elapsed, next check in', pollInterval, 'ms)');
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
        waited += pollInterval;

        // Exponential backoff: increase interval up to max
        pollInterval = Math.min(
          pollInterval * CONFIG.TIMING.POLL_BACKOFF_MULTIPLIER,
          CONFIG.TIMING.POLL_INTERVAL_MAX
        );
      }

      if (waited >= maxWaitTime) {
        console.warn('[Background] ⚠️ Timeout waiting for extraction. Proceeding with available data...');
      }

      // Trigger download all
      if (currentData.media || currentData.comments) {
        const postInfo = currentData.media?.post_info || currentData.comments?.post_info || {};

        // Check for signs of failed/partial extraction (silent failures)
        // These indicate the data extraction may have failed but didn't throw an error
        const hasZeroEngagement = !postInfo.like_count && !postInfo.comment_count;
        const hasUppercasePostType = postInfo.post_type && postInfo.post_type === postInfo.post_type.toUpperCase() && postInfo.post_type.length > 1;
        const isMissingPostType = !postInfo.post_type;
        const hasMedia = currentData.media?.media?.length > 0;

        // If we have media but suspicious metadata, flag as potential silent failure
        if (hasMedia && (hasZeroEngagement || hasUppercasePostType || isMissingPostType)) {
          const warningReasons = [];
          if (hasZeroEngagement) warningReasons.push('0 likes/comments');
          if (hasUppercasePostType) warningReasons.push(`uppercase post_type: "${postInfo.post_type}"`);
          if (isMissingPostType) warningReasons.push('missing post_type');

          console.warn(`[Background] ⚠️ Possible silent extraction failure for ${tab.url}:`, warningReasons.join(', '));

          // Track this as a potential failure (but still download what we have)
          batchState.failedUrls.push({
            url: tab.url,
            error: `Partial extraction (${warningReasons.join(', ')})`,
            partialData: true,
            shortcode: extractShortcode(tab.url),
            postInfo: postInfo
          });
        }

        // Use profileUsername from batch state if available (for collabs, keeps folder under profile being scraped)
        const username = batchState.profileUsername || postInfo.username || 'unknown';
        const folderName = buildFolderName(postInfo, batchState.profileUsername);
        const filePrefix = buildFilePrefix(postInfo, batchState.profileUsername);

        // Look up real name for parent folder
        let realName = null;
        if (typeof SheetsSync !== 'undefined' && SheetsSync.config.enabled) {
          realName = SheetsSync.lookupName(username);
        }
        const sanitizedRealName = realName
          ? realName.replace(/[\/\\:*?"<>|]/g, '_').trim()
          : null;
        const parentFolder = sanitizedRealName
          ? `${sanitizedRealName} - ${username}`
          : username;

        // Download media
        if (currentData.media && currentData.media.media) {
          const folderPrefix = `Instagram/${parentFolder}/${folderName}/media`;
          for (let i = 0; i < currentData.media.media.length; i++) {
            const item = currentData.media.media[i];
            const url = item.video_url || item.image_url;
            const extension = getFileExtension(url, !!item.video_url);
            const filename = `${folderPrefix}/${filePrefix}_media_${i + 1}.${extension}`;
            await downloadFile(url, filename, false);
          }
        }

        // Download comments as JSON and CSV
        if (currentData.comments && currentData.comments.comments) {
          const jsonFilename = `Instagram/${parentFolder}/${folderName}/comments/${filePrefix}_comments.json`;
          await downloadJSON(currentData.comments, jsonFilename, false);

          // Pass full currentData.comments object (includes post_info and comments)
          const csv = commentsToCSV(currentData.comments);
          const csvFilename = `Instagram/${parentFolder}/${folderName}/comments/${filePrefix}_comments.csv`;
          await downloadCSV(csv, csvFilename, false);
        }

        // Download metadata
        const metadata = {
          ...postInfo,
          downloaded_at: new Date().toISOString(),
          media_count: currentData.media?.media?.length || 0,
          comment_count: currentData.comments?.total || 0
        };
        const metadataFilename = `Instagram/${parentFolder}/${folderName}/${filePrefix}_metadata.json`;
        await downloadJSON(metadata, metadataFilename, false);

        // Download HTML archive (wait a bit to ensure content script is ready for avatar fetching)
        await new Promise(resolve => setTimeout(resolve, 1000));
        const htmlContent = await generatePostHTML(currentData, filePrefix);
        const htmlFilename = `Instagram/${parentFolder}/${folderName}/${filePrefix}_archive.html`;
        await downloadHTML(htmlContent, htmlFilename, false);

        // Capture Instagram-style screenshot
        try {
          console.log('[Background] Rendering batch screenshot...');

          const media = currentData.media?.media?.[0];
          if (media) {
            // Fetch the first media as base64 (handle videos by capturing a frame)
            const isVideo = !!media.video_url;
            const mediaUrl = media.video_url || media.image_url;

            const mediaDataUrl = await fetchSingleMediaAsBase64(mediaUrl, isVideo);

            if (mediaDataUrl) {
              // Fetch avatar as base64 if available
              let avatarDataUrl = null;
              if (postInfo.profile_pic_url) {
                const avatarCache = await fetchAvatarsViaContentScript([postInfo.profile_pic_url]);
                avatarDataUrl = avatarCache[postInfo.profile_pic_url] || null;
              }

              // Render the screenshot
              const screenshotDataUrl = await renderInstagramScreenshot(postInfo, mediaDataUrl, avatarDataUrl);

              const screenshotFilename = `Instagram/${parentFolder}/${folderName}/${filePrefix}_screenshot.png`;
              await downloadFile(screenshotDataUrl, screenshotFilename, false);
            } else {
              console.warn('[Background] Could not fetch media for batch screenshot');
            }
          }
        } catch (error) {
          console.error('[Background] Screenshot failed:', error);
        }

        console.log('[Background] Successfully downloaded:', tab.url);
        batchState.successCount++;

        // Mark this post as downloaded with enriched info for Sheets sync
        const downloadedShortcode = extractShortcode(tab.url);
        if (downloadedShortcode) {
          const enrichedPostInfo = {
            ...postInfo,
            shortcode: downloadedShortcode,
            media_count: currentData.media?.media?.length || 0,
            comment_count: currentData.comments?.total || currentData.comments?.comments?.length || 0
          };
          await markAsDownloaded(downloadedShortcode, enrichedPostInfo);
        }

        // Save batch state periodically (every 5 successful downloads)
        if (batchState.successCount % 5 === 0) {
          await saveBatchState();
        }
      } else {
        throw new Error('Failed to extract data');
      }
    } catch (error) {
      console.error('[Background] Failed to process URL:', tab.url, error);
      const errorMsg = error.message || '';

      // Check if this is a 429 rate limit error
      const is429Error = errorMsg.includes('429') || errorMsg.includes('rate limit') || errorMsg.includes('Rate limit');

      if (is429Error) {
        batchState.consecutiveErrors++;
        batchState.last429Time = Date.now();

        // Calculate pause duration with enhanced recovery (randomized jitter)
        batchState.currentPauseDuration = calculate429RecoveryTime(batchState.consecutiveErrors);

        const maxRetries = CONFIG.TIMING.BATCH_429_HANDLING?.MAX_429_RETRIES || 3;

        if (batchState.consecutiveErrors >= maxRetries) {
          // Too many 429 errors, stop batch processing but save state for resume
          console.error('[Background] 🛑 Too many 429 errors, stopping batch processing');
          batchState.isProcessing = false;
          batchState.failedUrls.push({
            url: tab.url,
            error: 'Rate limited - batch stopped after multiple 429 errors',
            shortcode: extractShortcode(tab.url),
            timestamp: Date.now()
          });

          // Save state for resume capability
          await saveBatchState();
          console.log('[Background] 💾 Batch state saved - can resume later');

          if (batchState.port) {
            batchState.port.postMessage({
              type: 'batchComplete',
              data: {
                successCount: batchState.successCount,
                skippedCount: batchState.skippedCount,
                failedUrls: batchState.failedUrls,
                total: batchState.queue.length,
                stoppedDueToRateLimit: true,
                canResume: true,
                resumeAfterMs: 600000 // Suggest waiting 10 minutes before resume
              }
            });
          }
          return;
        }

        // Pause and retry this URL with enhanced recovery
        const pauseMinutes = Math.round(batchState.currentPauseDuration / 60000);
        const pauseSeconds = Math.round((batchState.currentPauseDuration % 60000) / 1000);
        console.warn(`[Background] 🚫 Rate limited! Pausing for ${pauseMinutes}m ${pauseSeconds}s before retry (attempt ${batchState.consecutiveErrors}/${maxRetries})...`);
        batchState.isPaused = true;

        // Save state in case browser closes during pause
        await saveBatchState();

        if (batchState.port) {
          batchState.port.postMessage({
            type: 'batchProgress',
            data: {
              current: batchState.currentIndex + 1,
              total: batchState.queue.length,
              url: tab.url,
              successCount: batchState.successCount,
              skippedCount: batchState.skippedCount,
              failedUrls: batchState.failedUrls,
              isPaused: true,
              pauseReason: `Rate limited - pausing ${formatDuration(batchState.currentPauseDuration)} (attempt ${batchState.consecutiveErrors}/${maxRetries})`,
              pauseDuration: batchState.currentPauseDuration,
              pauseEndTime: Date.now() + batchState.currentPauseDuration
            }
          });
        }

        // Don't increment currentIndex - we'll retry this URL
        setTimeout(() => {
          batchState.isPaused = false;
          processNextBatchUrl();
        }, batchState.currentPauseDuration);
        return;
      } else {
        // Non-429 error - include more context for debugging
        batchState.failedUrls.push({
          url: tab.url,
          error: errorMsg,
          shortcode: extractShortcode(tab.url),
          timestamp: Date.now()
        });
      }
    }

      // Reset consecutive errors on success
      if (!batchState.failedUrls.find(f => f.url === tab.url)) {
        batchState.consecutiveErrors = 0;
      }

      // Move to next URL with progressive delay
      batchState.currentIndex++;

      // Calculate delay with progressive increase
      let baseDelay = CONFIG.TIMING.BATCH_DELAY_MIN + Math.random() * (CONFIG.TIMING.BATCH_DELAY_MAX - CONFIG.TIMING.BATCH_DELAY_MIN);

      // Progressive delay: add more delay the more posts we've processed
      if (CONFIG.TIMING.BATCH_PROGRESSIVE_DELAY?.ENABLED) {
        const tier = Math.floor(batchState.successCount / (CONFIG.TIMING.BATCH_PROGRESSIVE_DELAY.POSTS_PER_TIER || 50));
        const additionalDelay = Math.min(
          tier * (CONFIG.TIMING.BATCH_PROGRESSIVE_DELAY.DELAY_INCREMENT || 2000),
          CONFIG.TIMING.BATCH_PROGRESSIVE_DELAY.MAX_ADDITIONAL_DELAY || 10000
        );
        baseDelay += additionalDelay;

        if (additionalDelay > 0) {
          console.log(`[Background] 📊 Progressive delay: +${additionalDelay/1000}s (tier ${tier})`);
        }
      }

      // Check for cooldown period
      if (CONFIG.TIMING.BATCH_COOLDOWN?.ENABLED) {
        const postsBeforeCooldown = CONFIG.TIMING.BATCH_COOLDOWN.POSTS_BEFORE_COOLDOWN || 100;
        const cooldownDuration = CONFIG.TIMING.BATCH_COOLDOWN.COOLDOWN_DURATION || 60000;

        if (batchState.successCount > 0 && batchState.successCount % postsBeforeCooldown === 0) {
          console.log(`[Background] ☕ Cooldown: Taking a ${cooldownDuration/1000}s break after ${batchState.successCount} posts...`);

          batchState.isPaused = true;
          const pauseEndTime = Date.now() + cooldownDuration;

          if (batchState.port) {
            batchState.port.postMessage({
              type: 'batchProgress',
              data: {
                current: batchState.currentIndex,
                total: batchState.queue.length,
                url: 'Cooldown break...',
                successCount: batchState.successCount,
                skippedCount: batchState.skippedCount,
                failedUrls: batchState.failedUrls,
                isPaused: true,
                pauseReason: `Cooldown break (${cooldownDuration/1000}s) after ${batchState.successCount} posts`,
                pauseDuration: cooldownDuration,
                pauseEndTime: pauseEndTime
              }
            });
          }

          // Use dedicated setTimeout like proactive pause
          setTimeout(() => {
            batchState.isPaused = false;
            console.log(`[Background] ☕ Cooldown complete, resuming...`);
            processNextBatchUrl();
          }, cooldownDuration);
          return; // Don't continue to normal flow
        }
      }

      console.log(`[Background] ⏱️ Next post in ${(baseDelay/1000).toFixed(1)}s`);
      setTimeout(() => processNextBatchUrl(), baseDelay);
    } else {
      console.log('[Background] ⚠️ Not an Instagram post/reel URL, skipping');
    }
  }
});

console.log('[Instagram Downloader V2] 🚀 Background script loaded - Optimized version');

// Initialize Google Sheets Sync module
if (typeof SheetsSync !== 'undefined') {
  SheetsSync.init().then(enabled => {
    console.log('[Background] SheetsSync initialized:', enabled ? 'ENABLED' : 'disabled');
  }).catch(error => {
    console.error('[Background] SheetsSync init error:', error);
  });
}

// ===== SIDE PANEL API =====

// Enable side panel on Instagram tabs
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only process when page fully loads and URL is available
  if (changeInfo.status === 'complete' && tab.url) {
    const isInstagram = tab.url.includes('instagram.com');

    try {
      await chrome.sidePanel.setOptions({
        tabId,
        path: 'sidepanel.html',
        enabled: isInstagram
      });

      if (isInstagram) {
        console.log('[Background] Side panel enabled for Instagram tab:', tabId);
      }
    } catch (error) {
      // sidePanel API may not be available in older Chrome versions
      console.log('[Background] Could not set side panel options:', error.message);
    }
  }
});

// Handle extension icon click - open side panel on Instagram, popup elsewhere
chrome.action.onClicked.addListener(async (tab) => {
  const isInstagram = tab.url?.includes('instagram.com');

  if (isInstagram) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
      console.log('[Background] Opened side panel for Instagram tab');
    } catch (error) {
      console.log('[Background] Could not open side panel:', error.message);
    }
  }
  // For non-Instagram tabs, the default popup will open automatically
});

// Message handler for opening side panel from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openSidePanel') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]) {
        try {
          await chrome.sidePanel.open({ tabId: tabs[0].id });
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      }
    });
    return true; // Keep channel open for async response
  }

  // Check name mapping for username
  if (message.action === 'checkNameMapping') {
    const { username } = message.data || {};
    console.log('[Background] checkNameMapping request for:', username);

    const enabled = typeof SheetsSync !== 'undefined' && SheetsSync.config.enabled;
    console.log('[Background] SheetsSync enabled:', enabled);

    if (!enabled || !username) {
      console.log('[Background] Returning disabled response');
      sendResponse({ enabled: false });
      return true;
    }

    const hasMapping = SheetsSync.hasNameMapping(username);
    const realName = hasMapping ? SheetsSync.lookupName(username) : null;

    console.log('[Background] Name lookup result - hasMapping:', hasMapping, 'realName:', realName);

    sendResponse({
      enabled: true,
      hasMapping,
      realName,
      username
    });
    return true; // Keep message channel open
  }

  // Add name mapping
  if (message.action === 'addNameMapping') {
    const { username, realName } = message.data || {};

    if (!username || !realName) {
      sendResponse({ success: false, error: 'Missing username or realName' });
      return;
    }

    SheetsSync.addName(username, realName)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true; // Keep channel open for async response
  }
});
