// folder-scan.js - Dedicated folder scanning page for IG Quick Save

// DOM Elements
const scanArea = document.getElementById('scanArea');
const scanIcon = document.getElementById('scanIcon');
const scanBtn = document.getElementById('scanBtn');
const progress = document.getElementById('progress');
const results = document.getElementById('results');
const postsFound = document.getElementById('postsFound');
const foldersScanned = document.getElementById('foldersScanned');
const scanTime = document.getElementById('scanTime');
const folderPath = document.getElementById('folderPath');
const errorMsg = document.getElementById('errorMsg');
const actions = document.getElementById('actions');
const rescanBtn = document.getElementById('rescanBtn');
const closeBtn = document.getElementById('closeBtn');

// State
let lastScanResults = null;

// Extract shortcode from folder name pattern: username_IG_POSTTYPE_YYYYMMDD_shortcode[_collab_...]
function extractShortcodeFromFolderName(folderName) {
  const match = folderName.match(/_IG_(?:POST|REEL)_\d{8}_([a-zA-Z0-9_-]+?)(?:_collab_|$)/);
  return match ? match[1] : null;
}

// Scan the selected folder
async function scanFolder() {
  const startTime = Date.now();

  try {
    // Check if File System Access API is available
    if (!('showDirectoryPicker' in window)) {
      showError('File System Access API not supported in this browser.');
      return;
    }

    // Update UI to scanning state
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';
    scanArea.classList.add('scanning');
    scanArea.classList.remove('complete');
    scanIcon.textContent = '🔍';
    progress.classList.add('active');
    progress.textContent = 'Opening folder picker...';
    results.classList.add('hidden');
    errorMsg.classList.add('hidden');
    actions.classList.add('hidden');

    // Request folder access
    const dirHandle = await window.showDirectoryPicker({
      mode: 'read',
      startIn: 'downloads'
    });

    progress.textContent = 'Scanning folders...';

    const shortcodes = new Set();
    let folderCount = 0;

    // Recursive function to scan directories
    async function scanDirectory(handle, depth = 0) {
      // Limit depth to avoid scanning too deep
      if (depth > 4) return;

      for await (const entry of handle.values()) {
        if (entry.kind === 'directory') {
          folderCount++;

          // Try to extract shortcode from folder name
          const shortcode = extractShortcodeFromFolderName(entry.name);
          if (shortcode) {
            shortcodes.add(shortcode);
          }

          // Update progress periodically
          if (folderCount % 25 === 0) {
            progress.textContent = `Scanning... ${shortcodes.size} posts found in ${folderCount} folders`;
          }

          // Recursively scan subdirectories
          try {
            const subDirHandle = await handle.getDirectoryHandle(entry.name);
            await scanDirectory(subDirHandle, depth + 1);
          } catch (e) {
            // Permission denied or other error, skip this folder
            console.log('[FolderScan] Skipping folder:', entry.name, e.message);
          }
        }
      }
    }

    await scanDirectory(dirHandle);

    const endTime = Date.now();
    const scanDuration = ((endTime - startTime) / 1000).toFixed(1);

    // Store results
    lastScanResults = {
      shortcodes: Array.from(shortcodes),
      folderPath: dirHandle.name,
      folderCount: folderCount,
      scanTime: scanDuration
    };

    // Save results to storage directly (more reliable than port messaging)
    try {
      await chrome.storage.local.set({
        folderScanCache: {
          shortcodes: lastScanResults.shortcodes,
          lastScan: Date.now(),
          folderPath: lastScanResults.folderPath
        }
      });
      console.log('[FolderScan] Results saved to storage:', lastScanResults.shortcodes.length, 'shortcodes');

      // Also notify background script via message (so it updates its in-memory cache)
      chrome.runtime.sendMessage({
        type: 'folderScanComplete',
        data: {
          shortcodes: lastScanResults.shortcodes,
          folderPath: lastScanResults.folderPath
        }
      }).catch(e => {
        // Background might not be listening, but storage is already saved
        console.log('[FolderScan] Background notification skipped:', e.message);
      });
    } catch (e) {
      console.error('[FolderScan] Error saving to storage:', e);
    }

    // Update UI with results
    scanArea.classList.remove('scanning');
    scanArea.classList.add('complete');
    scanIcon.textContent = '✅';
    scanBtn.textContent = 'Scan Complete';
    progress.textContent = '';
    progress.classList.remove('active');

    postsFound.textContent = shortcodes.size.toLocaleString();
    foldersScanned.textContent = folderCount.toLocaleString();
    scanTime.textContent = `${scanDuration}s`;
    folderPath.textContent = `📂 ${dirHandle.name}`;

    results.classList.remove('hidden');
    actions.classList.remove('hidden');

  } catch (error) {
    if (error.name === 'AbortError') {
      // User cancelled
      resetUI();
      progress.textContent = 'Scan cancelled';
    } else {
      console.error('[FolderScan] Error:', error);
      showError('Failed to scan folder: ' + error.message);
    }
  }
}

// Show error message
function showError(message) {
  errorMsg.textContent = message;
  errorMsg.classList.remove('hidden');
  resetUI();
}

// Reset UI to initial state
function resetUI() {
  scanBtn.disabled = false;
  scanBtn.textContent = 'Select Instagram Folder';
  scanArea.classList.remove('scanning', 'complete');
  scanIcon.textContent = '📂';
  progress.classList.remove('active');
}

// Close tab
function closePage() {
  window.close();
}

// Event listeners
scanBtn.addEventListener('click', scanFolder);
rescanBtn.addEventListener('click', () => {
  results.classList.add('hidden');
  actions.classList.add('hidden');
  resetUI();
  scanFolder();
});
closeBtn.addEventListener('click', closePage);

// Load existing scan data on page load
async function loadExistingData() {
  try {
    const result = await chrome.storage.local.get('folderScanCache');
    if (result.folderScanCache && result.folderScanCache.shortcodes) {
      const cache = result.folderScanCache;
      const scanDate = new Date(cache.lastScan);
      const timeAgo = getTimeAgo(scanDate);

      postsFound.textContent = cache.shortcodes.length.toLocaleString();
      foldersScanned.textContent = '-';
      scanTime.textContent = timeAgo;
      folderPath.textContent = `📂 ${cache.folderPath || 'Unknown'}`;

      results.classList.remove('hidden');
      actions.classList.remove('hidden');

      progress.textContent = `Last scan: ${timeAgo}`;
      scanBtn.textContent = 'Scan Again';
    }
  } catch (e) {
    console.log('[FolderScan] No existing data');
  }
}

// Helper function to format time ago
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

// Initialize
loadExistingData();
