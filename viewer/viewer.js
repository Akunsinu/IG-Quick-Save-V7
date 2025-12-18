// State
let posts = [];
let currentView = 'grid';
let currentPostIndex = 0;
let currentMediaIndex = 0;

// Account picker state
let scannedAccounts = {}; // { username: { postFolders: [dirHandle, ...], postCount: N } }
let selectedAccounts = new Set();
let rootDirHandle = null;

// Theme toggle
const themeToggle = document.getElementById('themeToggle');

// Initialize theme from localStorage
function initTheme() {
  const savedTheme = localStorage.getItem('viewerTheme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeButton(savedTheme);
}

function updateThemeButton(theme) {
  if (themeToggle) {
    themeToggle.textContent = theme === 'dark' ? '🌙' : '☀️';
    themeToggle.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('viewerTheme', newTheme);
  updateThemeButton(newTheme);
}

// Initialize theme on load
initTheme();

// Theme toggle event listener
themeToggle?.addEventListener('click', toggleTheme);

// Real name lookup helpers for export paths
async function getRealNameForUser(username) {
  console.log('[Viewer] getRealNameForUser called for:', username);
  console.log('[Viewer] chrome.runtime available:', typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');
  console.log('[Viewer] Extension ID:', chrome.runtime?.id);

  return new Promise((resolve) => {
    try {
      if (!chrome?.runtime?.sendMessage) {
        console.error('[Viewer] chrome.runtime.sendMessage not available!');
        resolve(null);
        return;
      }

      console.log('[Viewer] Sending checkNameMapping message...');
      chrome.runtime.sendMessage({
        action: 'checkNameMapping',
        data: { username }
      }, (response) => {
        console.log('[Viewer] Got response, lastError:', chrome.runtime.lastError);
        if (chrome.runtime.lastError) {
          console.warn('[Viewer] checkNameMapping error:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        console.log('[Viewer] checkNameMapping response for', username, ':', JSON.stringify(response));
        if (response?.enabled && response?.hasMapping && response?.realName) {
          console.log('[Viewer] Found real name:', response.realName);
          resolve(response.realName);
        } else {
          console.log('[Viewer] No real name found. enabled:', response?.enabled, 'hasMapping:', response?.hasMapping);
          resolve(null);
        }
      });
    } catch (error) {
      console.error('[Viewer] getRealNameForUser error:', error);
      resolve(null);
    }
  });
}

async function getParentFolder(username) {
  const realName = await getRealNameForUser(username);
  console.log('[Viewer] getParentFolder for', username, '- realName:', realName);
  if (realName) {
    const sanitizedRealName = realName.replace(/[\/\\:*?"<>|]/g, '_').trim();
    return `${sanitizedRealName} - ${username}`;
  }
  return username;
}

// Extract real name from source path (e.g., "Instagram/Aakash - username/..." -> "Aakash")
function extractRealNameFromPath(sourcePath, username) {
  if (!sourcePath) return null;

  // Split path and find the parent folder (second segment after "Instagram/")
  const parts = sourcePath.split('/');
  // Path format: Instagram/{parentFolder}/{postFolder}/...
  // parentFolder might be "RealName - username" or just "username"

  for (const part of parts) {
    // Check if this part contains " - username"
    const suffix = ` - ${username}`;
    if (part.endsWith(suffix)) {
      // Extract the real name part
      return part.slice(0, -suffix.length);
    }
  }
  return null;
}

// DOM Elements
const welcomeScreen = document.getElementById('welcomeScreen');
const postsContainer = document.getElementById('postsContainer');
const loading = document.getElementById('loading');
const gridView = document.getElementById('gridView');
const feedView = document.getElementById('feedView');
const emptyState = document.getElementById('emptyState');
const viewToggle = document.getElementById('viewToggle');
const modalOverlay = document.getElementById('modalOverlay');
const modalMedia = document.getElementById('modalMedia');
const modalHeader = document.getElementById('modalHeader');
const modalCaption = document.getElementById('modalCaption');
const modalComments = document.getElementById('modalComments');
const modalFooter = document.getElementById('modalFooter');
const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const typeFilter = document.getElementById('typeFilter');

// Check if File System Access API is supported
const supportsDirectoryPicker = typeof window.showDirectoryPicker === 'function';

// Select folder buttons
document.getElementById('selectFolderBtn').addEventListener('click', selectFolder);
document.getElementById('welcomeBtn').addEventListener('click', selectFolder);

// Fallback file input for Safari and other browsers
const fallbackUpload = document.getElementById('fallbackUpload');
const fileInput = document.getElementById('fileInput');
const selectFilesBtn = document.getElementById('selectFilesBtn');

// Show fallback if directory picker not supported
if (!supportsDirectoryPicker) {
  fallbackUpload.classList.remove('hidden');
  document.getElementById('welcomeBtn').classList.add('hidden');
  document.getElementById('selectFolderBtn').classList.add('hidden');
}

selectFilesBtn?.addEventListener('click', () => fileInput.click());
fileInput?.addEventListener('change', handleFileSelect);

// View toggle
viewToggle.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    viewToggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    renderPosts();
  });
});

// Filters
searchInput.addEventListener('input', renderPosts);
sortSelect.addEventListener('change', renderPosts);
typeFilter.addEventListener('change', renderPosts);

// Modal close
document.getElementById('modalClose').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  if (!modalOverlay.classList.contains('active')) return;
  if (e.key === 'Escape') closeModal();
  if (e.key === 'ArrowLeft') navigateModal(-1);
  if (e.key === 'ArrowRight') navigateModal(1);
});

// Select folder using File System Access API
async function selectFolder() {
  // Check if API is supported
  if (!supportsDirectoryPicker) {
    fallbackUpload.classList.remove('hidden');
    alert('Your browser does not support folder selection.\n\nPlease use the file picker below to select files from your Instagram folder, or use Chrome for the best experience.');
    return;
  }

  try {
    console.log('Opening folder picker...');
    const dirHandle = await window.showDirectoryPicker();
    console.log('Folder selected:', dirHandle.name);
    rootDirHandle = dirHandle;

    welcomeScreen.classList.add('hidden');
    loading.classList.remove('hidden');
    updateLoadingText('Scanning for accounts...');

    // Phase 1: Scan for accounts (metadata only, no media loading)
    scannedAccounts = {};
    await scanForAccounts(dirHandle);

    const accountNames = Object.keys(scannedAccounts);
    console.log('Scan complete. Found', accountNames.length, 'accounts');

    loading.classList.add('hidden');

    if (accountNames.length > 0) {
      // Show account picker
      showAccountPicker();
    } else {
      welcomeScreen.classList.remove('hidden');
      alert('No Instagram posts found in this folder.\n\nMake sure you selected a folder containing posts downloaded with IG Quick Save.\n\nExpected structure:\nInstagram/\n  username/\n    username_POST_date_code/\n      *_metadata.json\n      media/');
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Error selecting folder:', err);
      console.error('Error details:', err.message, err.stack);
      alert('Error reading folder: ' + err.message + '\n\nPlease try again or check the browser console for details.');
    }
    loading.classList.add('hidden');
    welcomeScreen.classList.remove('hidden');
  }
}

// Update loading text
function updateLoadingText(text) {
  const loadingText = document.getElementById('loadingText');
  if (loadingText) {
    loadingText.textContent = text;
  }
}

// Phase 1: Scan folder structure for accounts without loading media
async function scanForAccounts(dirHandle, path = '', depth = 0) {
  const maxDepth = 5;

  if (depth > maxDepth) {
    return;
  }

  try {
    for await (const entry of dirHandle.values()) {
      try {
        if (entry.kind === 'directory') {
          // Check if this folder has a metadata file (it's a post folder)
          const metadata = await findMetadataQuick(entry);

          if (metadata && metadata.username) {
            // This is a post folder - add to the account
            const username = metadata.username;
            if (!scannedAccounts[username]) {
              scannedAccounts[username] = {
                postFolders: [],
                postCount: 0,
                latestPost: null
              };
            }
            scannedAccounts[username].postFolders.push({
              handle: entry,
              metadata: metadata
            });
            scannedAccounts[username].postCount++;

            // Track latest post date for sorting
            if (metadata.posted_at) {
              const postDate = new Date(metadata.posted_at);
              if (!scannedAccounts[username].latestPost || postDate > scannedAccounts[username].latestPost) {
                scannedAccounts[username].latestPost = postDate;
              }
            }
          } else {
            // Not a post folder - recurse into it
            await scanForAccounts(entry, path + entry.name + '/', depth + 1);
          }
        }
      } catch (entryErr) {
        console.warn('Error scanning entry:', entry.name, entryErr.message);
      }
    }
  } catch (scanErr) {
    console.error('Error scanning directory:', path, scanErr.message);
  }
}

// Quick metadata check - only reads the JSON, doesn't load media
async function findMetadataQuick(dirHandle) {
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('_metadata.json')) {
        try {
          const file = await entry.getFile();
          const text = await file.text();
          return JSON.parse(text);
        } catch (e) {
          // Silently skip invalid metadata files
        }
      }
    }
  } catch (e) {
    // Silently skip inaccessible folders
  }
  return null;
}

// Show account picker UI
function showAccountPicker() {
  const accountPicker = document.getElementById('accountPicker');
  const accountList = document.getElementById('accountPickerList');

  // Sort accounts by post count (descending)
  const sortedAccounts = Object.entries(scannedAccounts)
    .sort((a, b) => b[1].postCount - a[1].postCount);

  // Select all by default
  selectedAccounts = new Set(sortedAccounts.map(([username]) => username));

  // Render account list
  accountList.innerHTML = sortedAccounts.map(([username, data]) => {
    const initial = username.charAt(0).toUpperCase();
    return `
      <div class="account-picker-item selected" data-username="${escapeHtml(username)}">
        <div class="account-picker-checkbox"></div>
        <div class="account-picker-avatar">${initial}</div>
        <div class="account-picker-info">
          <div class="account-picker-username">${escapeHtml(username)}</div>
          <div class="account-picker-stats">${data.postCount} post${data.postCount !== 1 ? 's' : ''}</div>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers
  accountList.querySelectorAll('.account-picker-item').forEach(item => {
    item.addEventListener('click', () => {
      const username = item.dataset.username;
      if (selectedAccounts.has(username)) {
        selectedAccounts.delete(username);
        item.classList.remove('selected');
      } else {
        selectedAccounts.add(username);
        item.classList.add('selected');
      }
      updateAccountPickerSummary();
    });
  });

  updateAccountPickerSummary();
  accountPicker.classList.remove('hidden');
}

// Update account picker summary
function updateAccountPickerSummary() {
  const summary = document.getElementById('accountPickerSummary');
  const loadBtn = document.getElementById('accountPickerLoad');
  const totalPosts = Array.from(selectedAccounts).reduce((sum, username) => {
    return sum + (scannedAccounts[username]?.postCount || 0);
  }, 0);

  summary.textContent = `${selectedAccounts.size} account${selectedAccounts.size !== 1 ? 's' : ''} selected (${totalPosts} posts)`;
  loadBtn.disabled = selectedAccounts.size === 0;
}

// Account picker button handlers
document.getElementById('selectAllAccounts')?.addEventListener('click', () => {
  selectedAccounts = new Set(Object.keys(scannedAccounts));
  document.querySelectorAll('.account-picker-item').forEach(item => {
    item.classList.add('selected');
  });
  updateAccountPickerSummary();
});

document.getElementById('deselectAllAccounts')?.addEventListener('click', () => {
  selectedAccounts.clear();
  document.querySelectorAll('.account-picker-item').forEach(item => {
    item.classList.remove('selected');
  });
  updateAccountPickerSummary();
});

document.getElementById('accountPickerCancel')?.addEventListener('click', () => {
  document.getElementById('accountPicker').classList.add('hidden');
  welcomeScreen.classList.remove('hidden');
  scannedAccounts = {};
  selectedAccounts.clear();
});

document.getElementById('accountPickerLoad')?.addEventListener('click', loadSelectedAccounts);

// Phase 2: Load posts from selected accounts
async function loadSelectedAccounts() {
  if (selectedAccounts.size === 0) return;

  const accountPicker = document.getElementById('accountPicker');
  accountPicker.classList.add('hidden');
  loading.classList.remove('hidden');

  posts = [];
  let loadedCount = 0;
  const totalPosts = Array.from(selectedAccounts).reduce((sum, username) => {
    return sum + (scannedAccounts[username]?.postCount || 0);
  }, 0);

  try {
    for (const username of selectedAccounts) {
      const accountData = scannedAccounts[username];
      if (!accountData) continue;

      for (const { handle, metadata } of accountData.postFolders) {
        loadedCount++;
        updateLoadingText(`Loading posts... ${loadedCount}/${totalPosts}`);

        try {
          const post = await loadPost(handle, metadata);
          if (post) {
            posts.push(post);
          }
        } catch (err) {
          console.warn('Error loading post:', metadata?.shortcode, err.message);
        }
      }
    }

    console.log('Loading complete. Loaded', posts.length, 'posts');
    loading.classList.add('hidden');

    if (posts.length > 0) {
      postsContainer.classList.remove('hidden');
      viewToggle.classList.remove('hidden');
      updateStats();
      renderPosts();
    } else {
      welcomeScreen.classList.remove('hidden');
      alert('Failed to load any posts. Please try again.');
    }
  } catch (err) {
    console.error('Error loading posts:', err);
    loading.classList.add('hidden');
    welcomeScreen.classList.remove('hidden');
    alert('Error loading posts: ' + err.message);
  }
}

// Handle file input for browsers without directory picker (Safari fallback)
async function handleFileSelect(event) {
  const files = Array.from(event.target.files);
  if (files.length === 0) return;

  console.log('Files selected:', files.length);
  welcomeScreen.classList.add('hidden');
  loading.classList.remove('hidden');

  try {
    posts = await processFilesFromInput(files);
    console.log('Processing complete. Found', posts.length, 'posts');

    loading.classList.add('hidden');

    if (posts.length > 0) {
      postsContainer.classList.remove('hidden');
      viewToggle.classList.remove('hidden');
      updateStats();
      renderPosts();
    } else {
      welcomeScreen.classList.remove('hidden');
      alert('No Instagram posts found in the selected files.\n\nMake sure you selected files from a folder containing posts downloaded with IG Quick Save.');
    }
  } catch (err) {
    console.error('Error processing files:', err);
    alert('Error processing files: ' + err.message);
    loading.classList.add('hidden');
    welcomeScreen.classList.remove('hidden');
  }
}

// Process files from file input (Safari fallback)
async function processFilesFromInput(files) {
  const foundPosts = [];
  const folderMap = new Map(); // folder path -> files

  // Group files by their parent folder
  for (const file of files) {
    // webkitRelativePath gives us the path like "Instagram/username_POST_date/media/file.jpg"
    const path = file.webkitRelativePath || file.name;
    const parts = path.split('/');

    // Find the post folder (one containing _metadata.json or has /media/ subfolder)
    for (let i = 0; i < parts.length; i++) {
      const folderPath = parts.slice(0, i + 1).join('/');
      if (!folderMap.has(folderPath)) {
        folderMap.set(folderPath, []);
      }
      folderMap.get(folderPath).push({ file, relativePath: parts.slice(i + 1).join('/') });
    }
  }

  console.log('Found', folderMap.size, 'unique paths');

  // Find folders that have metadata files
  for (const [folderPath, folderFiles] of folderMap) {
    const metadataFile = folderFiles.find(f => f.relativePath.endsWith('_metadata.json') && !f.relativePath.includes('/'));

    if (metadataFile) {
      console.log('Found metadata in:', folderPath);

      try {
        const metadataText = await metadataFile.file.text();
        const metadata = JSON.parse(metadataText);

        const post = {
          ...metadata,
          media: [],
          comments: [],
          avatars: {}
        };

        // Get media files
        const mediaFiles = folderFiles.filter(f => f.relativePath.startsWith('media/'));
        for (const mediaFile of mediaFiles) {
          post.media.push({
            name: mediaFile.relativePath.replace('media/', ''),
            type: mediaFile.file.type.startsWith('video') ? 'video' : 'image',
            url: URL.createObjectURL(mediaFile.file)
          });
        }
        post.media.sort((a, b) => a.name.localeCompare(b.name));

        // Get comments
        const commentsFile = folderFiles.find(f => f.relativePath.startsWith('comments/') && f.relativePath.endsWith('.json'));
        if (commentsFile) {
          try {
            const commentsText = await commentsFile.file.text();
            const commentsData = JSON.parse(commentsText);
            post.comments = commentsData.comments || [];
            post.totalComments = commentsData.total || post.comments.length;
          } catch (e) {
            console.error('Error reading comments:', e);
          }
        }

        // Get avatars from HTML archive
        const archiveFile = folderFiles.find(f => f.relativePath.endsWith('_archive.html') && !f.relativePath.includes('/'));
        if (archiveFile) {
          try {
            const html = await archiveFile.file.text();
            const avatarRegex = /<img\s+src="(data:image\/[^"]+)"\s+alt="([^"]+)"\s+class="[^"]*avatar[^"]*"/g;
            let match;
            while ((match = avatarRegex.exec(html)) !== null) {
              const [, base64, username] = match;
              if (username && base64) post.avatars[username] = base64;
            }
          } catch (e) {
            console.error('Error reading HTML archive:', e);
          }
        }

        if (post.media.length > 0 || post.comments.length > 0) {
          foundPosts.push(post);
        }
      } catch (e) {
        console.error('Error processing folder:', folderPath, e);
      }
    }
  }

  return foundPosts;
}

// Scan folder recursively for Instagram posts
async function scanFolder(dirHandle, path = '', depth = 0) {
  const foundPosts = [];
  const maxDepth = 5; // Prevent infinite recursion

  if (depth > maxDepth) {
    console.log('Max depth reached at:', path);
    return foundPosts;
  }

  console.log('Scanning:', path || dirHandle.name);

  try {
    for await (const entry of dirHandle.values()) {
      try {
        if (entry.kind === 'directory') {
          console.log('  Found directory:', entry.name);

          // Check if this looks like an Instagram post folder
          const metadata = await findMetadata(entry);

          if (metadata) {
            console.log('  Found metadata in:', entry.name);
            // Pass the full source path: parent folder path + post folder name
            const sourcePath = path + entry.name;
            const post = await loadPost(entry, metadata, sourcePath);
            if (post) {
              console.log('  Loaded post:', post.username, post.shortcode, '| sourcePath:', sourcePath);
              foundPosts.push(post);
            }
          } else {
            // Recurse into subdirectories
            const subPosts = await scanFolder(entry, path + entry.name + '/', depth + 1);
            foundPosts.push(...subPosts);
          }
        } else if (entry.kind === 'file') {
          // Check if there's a metadata file directly in this folder
          if (entry.name.endsWith('_metadata.json')) {
            console.log('  Found metadata file:', entry.name);
          }
        }
      } catch (entryErr) {
        console.warn('Error processing entry:', entry.name, entryErr.message);
      }
    }
  } catch (scanErr) {
    console.error('Error scanning directory:', path, scanErr.message);
  }

  return foundPosts;
}

// Find metadata.json in a folder
async function findMetadata(dirHandle) {
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('_metadata.json')) {
        try {
          const file = await entry.getFile();
          const text = await file.text();
          return JSON.parse(text);
        } catch (e) {
          console.error('Error reading metadata file:', entry.name, e.message);
        }
      }
    }
  } catch (e) {
    console.error('Error iterating folder for metadata:', e.message);
  }
  return null;
}

// Load a post from a folder
async function loadPost(dirHandle, metadata, sourcePath = '') {
  const post = {
    ...metadata,
    media: [],
    comments: [],
    avatars: {}, // Map of username -> base64 avatar
    folderHandle: dirHandle,
    sourcePath: sourcePath // Track where this post was loaded from (e.g., "Instagram/Aakash - username/username_IG_POST_...")
  };

  // Load media files
  try {
    const mediaHandle = await dirHandle.getDirectoryHandle('media');
    for await (const entry of mediaHandle.values()) {
      if (entry.kind === 'file') {
        try {
          const file = await entry.getFile();
          post.media.push({
            name: entry.name,
            type: file.type.startsWith('video') ? 'video' : 'image',
            url: URL.createObjectURL(file)
          });
        } catch (fileErr) {
          console.warn('Error loading media file:', entry.name, fileErr.message);
        }
      }
    }
    // Sort media by name
    post.media.sort((a, b) => a.name.localeCompare(b.name));
    console.log('  Loaded', post.media.length, 'media files');
  } catch (e) {
    // No media folder - that's ok
    console.log('  No media folder found');
  }

  // Load comments
  try {
    const commentsHandle = await dirHandle.getDirectoryHandle('comments');
    for await (const entry of commentsHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.json')) {
        try {
          const file = await entry.getFile();
          const text = await file.text();
          const data = JSON.parse(text);
          post.comments = data.comments || [];
          post.totalComments = data.total || post.comments.length;
          console.log('  Loaded', post.comments.length, 'comments');
        } catch (e) {
          console.error('Error reading comments:', e.message);
        }
      }
    }
  } catch (e) {
    // No comments folder - that's ok
    console.log('  No comments folder found');
  }

  // Load avatars from HTML archive
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('_archive.html')) {
        try {
          const file = await entry.getFile();
          const html = await file.text();

          // Extract avatars from HTML - they're in img tags with base64 src
          // Pattern: <img src="data:image/..." alt="username" class="...-avatar">
          const avatarRegex = /<img\s+src="(data:image\/[^"]+)"\s+alt="([^"]+)"\s+class="[^"]*avatar[^"]*"/g;
          let match;
          while ((match = avatarRegex.exec(html)) !== null) {
            const [, base64, username] = match;
            if (username && base64 && !post.avatars[username]) {
              post.avatars[username] = base64;
            }
          }

          // Also try alternate pattern where class comes before src
          const avatarRegex2 = /<img[^>]*class="[^"]*avatar[^"]*"[^>]*src="(data:image\/[^"]+)"[^>]*alt="([^"]+)"/g;
          while ((match = avatarRegex2.exec(html)) !== null) {
            const [, base64, username] = match;
            if (username && base64 && !post.avatars[username]) {
              post.avatars[username] = base64;
            }
          }

          // Try to find profile avatar specifically (may have different pattern)
          const profileAvatarMatch = html.match(/class="profile-avatar"[^>]*src="(data:image\/[^"]+)"/);
          if (profileAvatarMatch && post.username) {
            post.avatars[post.username] = profileAvatarMatch[1];
          }

          // Alternate: src before class
          const profileAvatarMatch2 = html.match(/src="(data:image\/[^"]+)"[^>]*alt="([^"]+)"[^>]*class="profile-avatar"/);
          if (profileAvatarMatch2) {
            post.avatars[profileAvatarMatch2[2]] = profileAvatarMatch2[1];
          }

          console.log('  Loaded', Object.keys(post.avatars).length, 'avatars from HTML');
        } catch (e) {
          console.error('Error reading HTML archive:', e.message);
        }
        break; // Only need one HTML file
      }
    }
  } catch (e) {
    console.log('  No HTML archive found');
  }

  return post;
}

// Update stats
function updateStats() {
  document.getElementById('totalPosts').textContent = posts.length;
  document.getElementById('totalMedia').textContent = posts.reduce((sum, p) => sum + p.media.length, 0);
  document.getElementById('totalComments').textContent = posts.reduce((sum, p) => sum + (p.totalComments || p.comments.length), 0);
}

// Filter and sort posts
function getFilteredPosts() {
  let filtered = [...posts];

  // Search filter
  const search = searchInput.value.toLowerCase();
  if (search) {
    filtered = filtered.filter(p =>
      (p.username || '').toLowerCase().includes(search) ||
      (p.caption || '').toLowerCase().includes(search)
    );
  }

  // Type filter
  const type = typeFilter.value;
  if (type !== 'all') {
    filtered = filtered.filter(p => {
      if (type === 'image') return p.media.length === 1 && p.media[0].type === 'image';
      if (type === 'video') return p.media.some(m => m.type === 'video');
      if (type === 'carousel') return p.media.length > 1;
      return true;
    });
  }

  // Sort
  const sort = sortSelect.value;
  filtered.sort((a, b) => {
    if (sort === 'newest') return new Date(b.posted_at || 0) - new Date(a.posted_at || 0);
    if (sort === 'oldest') return new Date(a.posted_at || 0) - new Date(b.posted_at || 0);
    if (sort === 'most-liked') return (b.like_count || 0) - (a.like_count || 0);
    if (sort === 'most-comments') return (b.comment_count || 0) - (a.comment_count || 0);
    return 0;
  });

  return filtered;
}

// Render posts
function renderPosts() {
  const filtered = getFilteredPosts();

  if (filtered.length === 0) {
    gridView.classList.add('hidden');
    feedView.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  if (currentView === 'grid') {
    gridView.classList.remove('hidden');
    feedView.classList.add('hidden');
    renderGridView(filtered);
  } else {
    gridView.classList.add('hidden');
    feedView.classList.remove('hidden');
    renderFeedView(filtered);
  }
}

// Render grid view
function renderGridView(postsToRender) {
  gridView.innerHTML = postsToRender.map((post, index) => {
    const media = post.media[0];
    const isVideo = post.media.some(m => m.type === 'video');
    const isCarousel = post.media.length > 1;
    const postIndex = posts.indexOf(post);
    const username = post.username || 'Unknown';
    const hasLongCaption = post.caption && post.caption.length > 100;
    const captionId = `grid-caption-${postIndex}`;

    return `
      <div class="grid-item" data-post-index="${postIndex}">
        <div class="grid-item-media" data-action="open-modal">
          ${media ? (media.type === 'video'
            ? `<video src="${media.url}" muted></video>`
            : `<img src="${media.url}" alt="">`)
            : '<div style="background: var(--bg-tertiary); width: 100%; height: 100%;"></div>'}
          <div class="grid-item-overlay">
            <span class="grid-stat">❤️ ${formatNumber(post.like_count || 0)}</span>
            <span class="grid-stat">💬 ${formatNumber(post.comment_count || 0)}</span>
          </div>
          ${isCarousel ? '<span class="grid-item-type">📷</span>' : ''}
          ${isVideo && !isCarousel ? '<span class="grid-item-type">▶️</span>' : ''}
        </div>
        <div class="grid-item-info">
          <div class="grid-item-header">
            ${renderAvatar(username, post.avatars, 'grid-item-avatar')}
            <span class="grid-item-username">${escapeHtml(username)}</span>
          </div>
          ${post.caption ? `
            <div class="grid-item-caption" id="${captionId}">${escapeHtml(post.caption)}</div>
            ${hasLongCaption ? `
              <div class="grid-item-caption-more" data-caption-id="${captionId}">more</div>
            ` : ''}
          ` : ''}
          <div class="grid-item-stats">
            <span>❤️ ${formatNumber(post.like_count || 0)}</span>
            <span>💬 ${formatNumber(post.comment_count || 0)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers for opening modal
  gridView.querySelectorAll('.grid-item-media').forEach(item => {
    item.addEventListener('click', () => {
      const postIndex = parseInt(item.closest('.grid-item').dataset.postIndex);
      openModal(postIndex);
    });
  });

  // Add click handlers for caption expand/collapse
  gridView.querySelectorAll('.grid-item-caption-more').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const captionId = btn.dataset.captionId;
      const caption = document.getElementById(captionId);
      if (caption.classList.contains('expanded')) {
        caption.classList.remove('expanded');
        btn.textContent = 'more';
      } else {
        caption.classList.add('expanded');
        btn.textContent = 'less';
      }
    });
  });
}

// Get avatar initial(s) from username
function getAvatarInitial(username) {
  if (!username) return '?';
  return username.charAt(0).toUpperCase();
}

// Generate a consistent color based on username
function getAvatarColor(username) {
  const colors = [
    'linear-gradient(45deg, #f09433, #dc2743)',
    'linear-gradient(45deg, #4f5bd5, #962fbf)',
    'linear-gradient(45deg, #00c6ff, #0072ff)',
    'linear-gradient(45deg, #11998e, #38ef7d)',
    'linear-gradient(45deg, #ee0979, #ff6a00)',
    'linear-gradient(45deg, #7f00ff, #e100ff)',
    'linear-gradient(45deg, #fc4a1a, #f7b733)',
    'linear-gradient(45deg, #00b4db, #0083b0)',
  ];
  if (!username) return colors[0];
  const hash = username.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

// Render avatar HTML - uses actual image if available, fallback to initial
function renderAvatar(username, avatars, cssClass = 'feed-avatar') {
  const initial = getAvatarInitial(username);
  const color = getAvatarColor(username);

  if (avatars && avatars[username]) {
    return `<img src="${avatars[username]}" alt="${escapeHtml(username)}" class="${cssClass}">`;
  }

  return `<div class="${cssClass}" style="background: ${color};">${initial}</div>`;
}

// Format relative time like Instagram
function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffWeeks === 1) return '1 week ago';
  if (diffWeeks < 4) return `${diffWeeks} weeks ago`;

  return date.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });
}

// Render feed view
function renderFeedView(postsToRender) {
  feedView.innerHTML = postsToRender.map((post, index) => {
    const media = post.media[0];
    const postIndex = posts.indexOf(post);
    const relativeTime = formatRelativeTime(post.posted_at);
    const username = post.username || 'Unknown';
    const captionId = `caption-${postIndex}`;
    const hasLongCaption = post.caption && post.caption.length > 125;

    return `
      <article class="feed-post" data-post-index="${postIndex}">
        <header class="feed-post-header">
          ${renderAvatar(username, post.avatars, 'feed-avatar')}
          <div>
            <div class="feed-username">${escapeHtml(username)}</div>
          </div>
        </header>
        <div class="feed-media-container" data-action="open-modal">
          ${media ? (media.type === 'video'
            ? `<video class="feed-media" src="${media.url}" controls></video>`
            : `<img class="feed-media" src="${media.url}" alt="">`)
            : '<div class="feed-media" style="background: var(--bg-tertiary);"></div>'}
          ${post.media.length > 1 ? `
            <div class="feed-carousel-dots">
              ${post.media.map((_, i) => `<div class="feed-carousel-dot ${i === 0 ? 'active' : ''}"></div>`).join('')}
            </div>
          ` : ''}
        </div>
        <div class="feed-actions">
          <div class="feed-actions-left">
            <button class="feed-action-btn like-btn" title="Like"><svg><use href="#icon-heart"></use></svg></button>
            <button class="feed-action-btn" data-action="open-modal" title="Comment"><svg><use href="#icon-comment"></use></svg></button>
            <button class="feed-action-btn" title="Share"><svg><use href="#icon-share"></use></svg></button>
          </div>
          <div class="feed-actions-right">
            <button class="feed-action-btn" title="Save"><svg><use href="#icon-save"></use></svg></button>
          </div>
        </div>
        <div class="feed-stats">${formatNumber(post.like_count || 0)} likes</div>
        ${post.caption ? `
          <div class="feed-caption-section">
            <div class="feed-caption" id="${captionId}">
              <span class="feed-caption-username">${escapeHtml(username)}</span>${escapeHtml(post.caption)}
            </div>
            ${hasLongCaption ? `
              <div class="feed-caption-more" data-caption-id="${captionId}">more</div>
            ` : ''}
          </div>
        ` : ''}
        ${post.comment_count > 0 ? `
          <div class="feed-view-comments" data-action="open-modal">
            View all ${formatNumber(post.comment_count)} comments
          </div>
        ` : ''}
        <div class="feed-time">${relativeTime}</div>
      </article>
    `;
  }).join('');

  // Add click handlers
  feedView.querySelectorAll('[data-action="open-modal"]').forEach(el => {
    el.addEventListener('click', (e) => {
      const postEl = e.target.closest('.feed-post');
      if (postEl) {
        openModal(parseInt(postEl.dataset.postIndex));
      }
    });
  });

  feedView.querySelectorAll('.feed-caption-more').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleCaption(btn.dataset.captionId, btn);
    });
  });
}

// Toggle caption expand/collapse
function toggleCaption(captionId, btn) {
  const caption = document.getElementById(captionId);
  if (caption.classList.contains('expanded')) {
    caption.classList.remove('expanded');
    btn.textContent = 'more';
  } else {
    caption.classList.add('expanded');
    btn.textContent = 'less';
  }
}

// Open modal
function openModal(postIndex) {
  currentPostIndex = postIndex;
  currentMediaIndex = 0;
  const post = posts[postIndex];

  updateModalMedia(post);

  // Reset caption expanded state
  modalCaption.classList.remove('expanded');

  // Header
  const username = post.username || 'Unknown';
  const relativeTime = formatRelativeTime(post.posted_at);

  modalHeader.innerHTML = `
    ${renderAvatar(username, post.avatars, 'feed-avatar')}
    <div>
      <div class="feed-username">${escapeHtml(username)}</div>
    </div>
  `;

  // Caption (separate section) - with expand/collapse for long captions
  if (post.caption) {
    const hasLongCaption = post.caption.length > 150;
    modalCaption.innerHTML = `
      <div class="modal-caption-content">
        ${renderAvatar(username, post.avatars, 'comment-avatar')}
        <div class="modal-caption-text">
          <div class="modal-caption-body" id="modalCaptionBody">
            <span class="modal-caption-username">${escapeHtml(username)}</span>${escapeHtml(post.caption)}
          </div>
          ${hasLongCaption ? `<span class="modal-caption-more" id="modalCaptionMore">more</span>` : ''}
          <div class="modal-caption-time">${relativeTime}</div>
        </div>
      </div>
    `;
    modalCaption.style.display = 'block';

    // Add click handler for expand/collapse
    if (hasLongCaption) {
      const captionMore = document.getElementById('modalCaptionMore');
      const captionBody = document.getElementById('modalCaptionBody');
      captionMore?.addEventListener('click', () => {
        if (captionBody.classList.contains('expanded')) {
          captionBody.classList.remove('expanded');
          modalCaption.classList.remove('expanded');
          captionMore.textContent = 'more';
        } else {
          captionBody.classList.add('expanded');
          modalCaption.classList.add('expanded');
          captionMore.textContent = 'less';
        }
      });
    }
  } else {
    modalCaption.innerHTML = '';
    modalCaption.style.display = 'none';
  }

  // Comments
  if (post.comments.length > 0) {
    const totalComments = countAllComments(post.comments);
    modalComments.innerHTML = `
      <div class="modal-comments-search">
        <input type="text" id="commentSearchInput" placeholder="Search comments...">
        <span class="modal-comments-search-icon">🔍</span>
        <button class="modal-comments-search-clear" id="commentSearchClear">×</button>
      </div>
      <div class="modal-comments-header">
        <span>Comments</span>
        <span class="modal-comments-count" id="commentsCount">${totalComments} comments</span>
      </div>
      <div class="modal-comments-list" id="commentsListContainer">
        ${post.comments.map((comment, idx) => renderCommentWithId(comment, post.avatars, idx)).join('')}
      </div>
      <div class="no-results hidden" id="noCommentsResults">No comments matching your search</div>
    `;

    // Add event listeners for comment search
    const commentSearchInput = document.getElementById('commentSearchInput');
    const commentSearchClear = document.getElementById('commentSearchClear');
    if (commentSearchInput) {
      commentSearchInput.addEventListener('input', filterComments);
    }
    if (commentSearchClear) {
      commentSearchClear.addEventListener('click', clearCommentSearch);
    }

    // Store current post comments for filtering
    window.currentPostComments = post.comments;
    window.currentPostAvatars = post.avatars;
  } else {
    modalComments.innerHTML = `
      <div class="empty-state">
        <p>No comments available</p>
      </div>
    `;
  }

  // Footer
  modalFooter.innerHTML = `
    <div class="modal-stats">${formatNumber(post.like_count || 0)} likes</div>
  `;

  modalOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  // Show/hide export comments button based on whether post has comments
  showExportCommentsButton();
}

// Update modal media
function updateModalMedia(post) {
  const media = post.media[currentMediaIndex];

  if (!media) {
    modalMedia.innerHTML = '<div style="padding: 40px; color: var(--text-secondary);">No media available</div>';
    return;
  }

  const hasMultiple = post.media.length > 1;

  modalMedia.innerHTML = `
    ${media.type === 'video'
      ? `<video src="${media.url}" controls autoplay style="max-width: 100%; max-height: 100%;"></video>`
      : `<img src="${media.url}" alt="" style="max-width: 100%; max-height: 100%;">`}
    ${hasMultiple ? `
      <button class="feed-carousel-btn prev" id="carouselPrev">❮</button>
      <button class="feed-carousel-btn next" id="carouselNext">❯</button>
      <div class="feed-carousel-dots" style="position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);">
        ${post.media.map((_, i) => `<div class="feed-carousel-dot ${i === currentMediaIndex ? 'active' : ''}" data-media-index="${i}"></div>`).join('')}
      </div>
    ` : ''}
  `;

  // Add carousel event listeners
  if (hasMultiple) {
    document.getElementById('carouselPrev')?.addEventListener('click', (e) => {
      e.stopPropagation();
      changeMedia(-1);
    });
    document.getElementById('carouselNext')?.addEventListener('click', (e) => {
      e.stopPropagation();
      changeMedia(1);
    });
    modalMedia.querySelectorAll('.feed-carousel-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        goToMedia(parseInt(dot.dataset.mediaIndex));
      });
    });
  }
}

// Change media in carousel
function changeMedia(delta) {
  const post = posts[currentPostIndex];
  currentMediaIndex = (currentMediaIndex + delta + post.media.length) % post.media.length;
  updateModalMedia(post);
}

// Go to specific media
function goToMedia(index) {
  currentMediaIndex = index;
  updateModalMedia(posts[currentPostIndex]);
}

// Navigate modal between posts
function navigateModal(delta) {
  const filtered = getFilteredPosts();
  const currentFiltered = filtered.indexOf(posts[currentPostIndex]);
  const newIndex = currentFiltered + delta;

  if (newIndex >= 0 && newIndex < filtered.length) {
    currentPostIndex = posts.indexOf(filtered[newIndex]);
    currentMediaIndex = 0;
    openModal(currentPostIndex);
  }
}

// Count all comments including replies
function countAllComments(comments) {
  let count = 0;
  for (const comment of comments) {
    count++;
    if (comment.replies && comment.replies.length > 0) {
      count += countAllComments(comment.replies);
    }
  }
  return count;
}

// Render comment with ID for filtering
function renderCommentWithId(comment, avatars = {}, index, parentIndex = '') {
  const date = comment.created_at ? new Date(comment.created_at * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric'
  }) : '';
  // Try multiple paths since comment structure can vary between API versions
  const commentUsername = comment.owner?.username ||
                          comment.user?.username ||
                          comment.username ||
                          'Unknown';
  const commentId = parentIndex ? `${parentIndex}-${index}` : `${index}`;
  const commentText = comment.text || '';
  const likeCount = comment.like_count || 0;
  const timestamp = comment.created_at || 0;

  return `
    <div class="comment" data-comment-id="${commentId}" data-username="${escapeHtml(commentUsername).toLowerCase()}" data-text="${escapeHtml(commentText).toLowerCase()}" data-commenter="${escapeHtml(commentUsername)}" data-likes="${likeCount}" data-timestamp="${timestamp}">
      ${renderAvatar(commentUsername, avatars, 'comment-avatar')}
      <div class="comment-content">
        <span class="comment-username">${escapeHtml(commentUsername)}</span>
        <span class="comment-text" data-original="${escapeHtml(commentText)}">${escapeHtml(commentText)}</span>
        <div class="comment-meta">
          <span>${date}</span>
          <span>${formatNumber(likeCount)} likes</span>
          <button class="comment-screenshot-btn" title="Export comment as screenshot">📸</button>
        </div>
        ${comment.replies && comment.replies.length > 0 ? `
          <div class="comment-replies">
            ${comment.replies.map((reply, replyIdx) => renderCommentWithId(reply, avatars, replyIdx, commentId)).join('')}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// Filter comments based on search input
function filterComments() {
  const searchInput = document.getElementById('commentSearchInput');
  const clearBtn = document.getElementById('commentSearchClear');
  const searchIcon = document.querySelector('.modal-comments-search-icon');
  const countEl = document.getElementById('commentsCount');
  const noResults = document.getElementById('noCommentsResults');
  const container = document.getElementById('commentsListContainer');

  if (!searchInput || !container) return;

  const query = searchInput.value.toLowerCase().trim();

  // Toggle clear button visibility
  if (clearBtn && searchIcon) {
    if (query) {
      clearBtn.classList.add('visible');
      searchIcon.style.display = 'none';
    } else {
      clearBtn.classList.remove('visible');
      searchIcon.style.display = 'block';
    }
  }

  const comments = container.querySelectorAll('.comment');
  let visibleCount = 0;
  let totalCount = comments.length;

  comments.forEach(comment => {
    const username = comment.dataset.username || '';
    const text = comment.dataset.text || '';
    const textEl = comment.querySelector('.comment-text');
    const originalText = textEl?.dataset.original || '';

    if (!query) {
      // No search - show all, remove highlights
      comment.classList.remove('hidden');
      if (textEl) textEl.innerHTML = originalText;
      visibleCount++;
    } else if (username.includes(query) || text.includes(query)) {
      // Match found - show and highlight
      comment.classList.remove('hidden');
      visibleCount++;

      // Highlight matching text
      if (textEl && text.includes(query)) {
        const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
        textEl.innerHTML = originalText.replace(regex, '<span class="comment-highlight">$1</span>');
      } else if (textEl) {
        textEl.innerHTML = originalText;
      }
    } else {
      // No match - hide
      comment.classList.add('hidden');
      if (textEl) textEl.innerHTML = originalText;
    }
  });

  // Update count
  if (countEl) {
    if (query) {
      countEl.textContent = `${visibleCount} of ${totalCount} comments`;
    } else {
      countEl.textContent = `${totalCount} comments`;
    }
  }

  // Show/hide no results message
  if (noResults) {
    if (query && visibleCount === 0) {
      noResults.classList.remove('hidden');
    } else {
      noResults.classList.add('hidden');
    }
  }
}

// Clear comment search
function clearCommentSearch() {
  const searchInput = document.getElementById('commentSearchInput');
  if (searchInput) {
    searchInput.value = '';
    filterComments();
    searchInput.focus();
  }
}

// Escape regex special characters
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Close modal
function closeModal() {
  modalOverlay.classList.remove('active');
  document.body.style.overflow = '';

  // Stop any playing videos
  const video = modalMedia.querySelector('video');
  if (video) video.pause();
}

// Helper: Format number
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// Helper: Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Build filename matching extension naming convention: username_IG_POSTTYPE_YYYYMMDD_shortcode[_collab_user1_user2]
// Build unified comment screenshot filename
// Format: username_IG_POST_{POSTDATE}_{SHORTCODE}_COMMENT_{COMMENT_NUMBER}_{COMMENT_DATE}_{COMMENT_AUTHOR}
function buildCommentFilename(post, comment, commentIndex, realName = null) {
  const username = post.username || 'unknown';
  const shortcode = post.shortcode || 'post';

  // Build prefix with real name if available
  let prefix = username;
  if (realName) {
    const sanitizedRealName = realName.replace(/[\/\\:*?"<>|]/g, '_').trim();
    prefix = `${sanitizedRealName} - ${username}`;
  }

  // Post date
  let postDateStr = 'unknown';
  if (post.posted_at) {
    const date = new Date(post.posted_at);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    postDateStr = `${year}${month}${day}`;
  }

  // Comment date
  let commentDateStr = 'unknown';
  const commentTimestamp = comment.created_at || comment.timestamp;
  if (commentTimestamp) {
    // Handle both Unix timestamp (seconds) and milliseconds
    const ts = commentTimestamp > 9999999999 ? commentTimestamp : commentTimestamp * 1000;
    const date = new Date(ts);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      commentDateStr = `${year}${month}${day}`;
    }
  }

  // Comment author (stays as username only)
  const commentAuthor = comment.owner?.username ||
                        comment.user?.username ||
                        comment.username ||
                        'unknown';

  // Comment number (1-indexed)
  const commentNum = String(commentIndex + 1).padStart(3, '0');

  return `${prefix}_IG_POST_${postDateStr}_${shortcode}_COMMENT_${commentNum}_${commentDateStr}_${commentAuthor}`;
}

function buildFilePrefix(post) {
  const username = post.username || 'unknown';
  const postType = (post.post_type || 'POST').toUpperCase();
  const shortcode = post.shortcode || 'post';

  let dateStr = 'unknown-date';
  if (post.posted_at) {
    const date = new Date(post.posted_at);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    dateStr = `${year}${month}${day}`;
  }

  // Build base name
  let filePrefix = `${username}_IG_${postType}_${dateStr}_${shortcode}`;

  // Add collaborators if present
  if (post.collaborators && Array.isArray(post.collaborators) && post.collaborators.length > 0) {
    const collabsToAdd = post.collaborators
      .filter(c => c !== username)
      .slice(0, 3); // Limit to 3 collaborators

    if (collabsToAdd.length > 0) {
      filePrefix += '_collab_' + collabsToAdd.join('_');
    }
  }

  return filePrefix;
}

// Download current media
function downloadCurrentMedia() {
  const post = posts[currentPostIndex];
  if (!post || !post.media || !post.media[currentMediaIndex]) {
    alert('No media available to download');
    return;
  }

  const media = post.media[currentMediaIndex];
  const filePrefix = buildFilePrefix(post);
  const ext = media.type === 'video' ? 'mp4' : 'jpg';
  const filename = `${filePrefix}_media_${currentMediaIndex + 1}.${ext}`;

  // Create download link
  const a = document.createElement('a');
  a.href = media.url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Download media button event listener
document.getElementById('downloadMediaBtn')?.addEventListener('click', downloadCurrentMedia);

// SVG icons for screenshot export (inline since screenshot is rendered separately)
const screenshotIcons = {
  heart: `<svg viewBox="0 0 24 24"><path fill="none" stroke="#262626" stroke-width="2" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`,
  comment: `<svg viewBox="0 0 24 24"><path fill="none" stroke="#262626" stroke-width="2" d="M20.656 17.008a9.993 9.993 0 1 0-3.59 3.615L22 22z"/></svg>`,
  share: `<svg viewBox="0 0 24 24"><path fill="none" stroke="#262626" stroke-width="2" stroke-linejoin="round" d="M22 3L9.218 10.083"/><path fill="none" stroke="#262626" stroke-width="2" stroke-linejoin="round" d="M11.698 20.334L22 3 2 3l7.218 7.084 2.48 10.25z"/></svg>`,
  save: `<svg viewBox="0 0 24 24"><path fill="none" stroke="#262626" stroke-width="2" stroke-linejoin="round" d="M20 21l-8-7.56L4 21V3h16v18z"/></svg>`
};

// Create screenshot container with Instagram-style post
function createScreenshotContainer(post, media, videoFrameDataUrl = null) {
  const container = document.createElement('div');
  container.className = 'screenshot-container';

  const username = post.username || 'Unknown';
  const initial = username.charAt(0).toUpperCase();
  const avatarSrc = post.avatars?.[username];
  const formattedDate = post.posted_at ? new Date(post.posted_at).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  }) : '';

  // Use full caption - no truncation
  const caption = post.caption || '';

  // For videos, use the captured frame data URL; for images, use the media URL
  const mediaSrc = media.type === 'video' && videoFrameDataUrl ? videoFrameDataUrl : media.url;

  container.innerHTML = `
    <div class="screenshot-post">
      <div class="screenshot-header">
        ${avatarSrc
          ? `<img class="screenshot-avatar" src="${avatarSrc}" alt="${escapeHtml(username)}">`
          : `<div class="screenshot-avatar">${initial}</div>`
        }
        <span class="screenshot-username">${escapeHtml(username)}</span>
      </div>
      <img class="screenshot-media" src="${mediaSrc}" alt="">
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
        <div class="screenshot-stats">
          <span class="screenshot-likes">${formatNumber(post.like_count || 0)} likes</span>
          <span class="screenshot-comments">${formatNumber(post.comment_count || post.comments?.length || 0)} comments</span>
        </div>
        ${caption ? `
          <div class="screenshot-caption">
            <strong>${escapeHtml(username)}</strong> ${escapeHtml(caption)}
          </div>
        ` : ''}
        ${formattedDate ? `<div class="screenshot-time">${formattedDate}</div>` : ''}
      </div>
    </div>
  `;

  return container;
}

// Capture a frame from a video element and return as data URL
async function captureVideoFrame(videoUrl) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.src = videoUrl;

    video.onloadeddata = () => {
      // Seek to 1 second or 10% of duration, whichever is smaller
      video.currentTime = Math.min(1, video.duration * 0.1);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        resolve(dataUrl);
      } catch (error) {
        reject(error);
      }
    };

    video.onerror = () => reject(new Error('Failed to load video'));

    // Fallback timeout
    setTimeout(() => {
      if (video.readyState >= 2) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth || 400;
          canvas.height = video.videoHeight || 400;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.9));
        } catch (e) {
          reject(new Error('Video frame capture timed out'));
        }
      } else {
        reject(new Error('Video failed to load'));
      }
    }, 5000);
  });
}

// Export screenshot of current post
async function exportScreenshot() {
  const post = posts[currentPostIndex];
  if (!post) {
    alert('No post selected');
    return;
  }

  const media = post.media[currentMediaIndex];
  if (!media) {
    alert('No media available');
    return;
  }

  // Show loading state
  const btn = document.getElementById('screenshotBtn');
  const originalText = btn.textContent;
  btn.textContent = '⏳ Creating...';
  btn.disabled = true;

  try {
    // For videos, capture a frame first
    let videoFrameDataUrl = null;
    if (media.type === 'video') {
      try {
        videoFrameDataUrl = await captureVideoFrame(media.url);
      } catch (videoError) {
        console.warn('Could not capture video frame:', videoError);
        // Continue with a placeholder or the first frame attempt
      }
    }

    // Create screenshot container with video frame if available
    const container = createScreenshotContainer(post, media, videoFrameDataUrl);
    document.body.appendChild(container);

    // Wait for images to load
    const images = container.querySelectorAll('img');
    await Promise.all(Array.from(images).map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve; // Continue even if image fails
      });
    }));

    // Small delay for rendering
    await new Promise(resolve => setTimeout(resolve, 200));

    // Capture with html2canvas
    const screenshotPost = container.querySelector('.screenshot-post');
    const canvas = await html2canvas(screenshotPost, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      allowTaint: true
    });

    // Download
    const link = document.createElement('a');
    const filePrefix = buildFilePrefix(post);
    link.download = `${filePrefix}_screenshot.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();

    // Cleanup
    document.body.removeChild(container);
  } catch (error) {
    console.error('Screenshot failed:', error);
    alert('Failed to create screenshot: ' + error.message);
  } finally {
    // Restore button state
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// Screenshot button event listener
document.getElementById('screenshotBtn')?.addEventListener('click', exportScreenshot);

// Export all comments button
const exportAllCommentsBtn = document.getElementById('exportAllCommentsBtn');

// Show export all comments button when a post with comments is viewed
function showExportCommentsButton() {
  const post = posts[currentPostIndex];
  if (exportAllCommentsBtn && post?.comments?.length > 0) {
    exportAllCommentsBtn.style.display = 'inline-flex';
  } else if (exportAllCommentsBtn) {
    exportAllCommentsBtn.style.display = 'none';
  }
}

// Pre-fetch and cache an avatar as base64
async function prefetchAvatarAsBase64(url, timeout = 5000) {
  if (!url || url.startsWith('data:')) {
    return url; // Already base64 or empty
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const timer = setTimeout(() => {
      img.src = '';
      resolve(null);
    }, timeout);

    img.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 150;
        canvas.height = img.naturalHeight || 150;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const base64 = canvas.toDataURL('image/jpeg', 0.8);
        resolve(base64);
      } catch (e) {
        console.warn('[Avatar Prefetch] Canvas conversion failed:', e);
        resolve(null);
      }
    };

    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };

    img.src = url;
  });
}

// Export all comments as screenshots to organized folder
async function exportAllComments() {
  const post = posts[currentPostIndex];
  if (!post || !post.comments || post.comments.length === 0) {
    alert('No comments to export. Please open a post with comments first.');
    return;
  }

  const btn = exportAllCommentsBtn;
  const originalText = btn.textContent;
  btn.disabled = true;

  try {
    // Flatten all comments including replies
    const allComments = [];
    function collectComments(comments, depth = 0) {
      for (const comment of comments) {
        allComments.push({ comment, depth });
        if (comment.replies && comment.replies.length > 0) {
          collectComments(comment.replies, depth + 1);
        }
      }
    }
    collectComments(post.comments);

    const totalComments = allComments.length;
    let successCount = 0;
    let failCount = 0;

    // Use the source path where the post was loaded from
    // This preserves the original folder structure including real name prefix
    const username = post.username || 'unknown';
    const basePath = post.sourcePath
      ? `${post.sourcePath}/comments/screenshots`
      : `Instagram/${username}/${buildFilePrefix(post)}/comments/screenshots`;

    // Extract real name from source path for filename prefix
    const realName = extractRealNameFromPath(post.sourcePath, username);
    console.log('[Viewer] Export path:', basePath, '| realName from path:', realName);

    // Initialize avatar cache from post.avatars (already base64)
    const avatarCache = { ...(post.avatars || {}) };

    // Collect unique avatar URLs that need fetching
    const avatarsToFetch = new Map();
    for (const { comment } of allComments) {
      const commenter = comment.owner?.username ||
                        comment.user?.username ||
                        comment.username ||
                        'unknown';

      if (!avatarCache[commenter]) {
        const avatarUrl = comment.owner?.profile_pic_url ||
                          comment.user?.profile_pic_url ||
                          comment.profile_pic_url;
        if (avatarUrl && !avatarUrl.startsWith('data:')) {
          avatarsToFetch.set(commenter, avatarUrl);
        }
      }
    }

    // Pre-fetch avatars in batches to avoid overwhelming the browser
    const AVATAR_BATCH_SIZE = 50;
    const avatarEntries = Array.from(avatarsToFetch.entries());
    const totalAvatarsToFetch = avatarEntries.length;

    if (totalAvatarsToFetch > 0) {
      console.log(`[Export Comments] Pre-fetching ${totalAvatarsToFetch} avatars...`);
      btn.textContent = `💬 Loading avatars 0/${totalAvatarsToFetch}...`;

      for (let i = 0; i < avatarEntries.length; i += AVATAR_BATCH_SIZE) {
        const batch = avatarEntries.slice(i, i + AVATAR_BATCH_SIZE);
        btn.textContent = `💬 Loading avatars ${Math.min(i + AVATAR_BATCH_SIZE, totalAvatarsToFetch)}/${totalAvatarsToFetch}...`;

        // Fetch batch in parallel
        const results = await Promise.all(
          batch.map(async ([commenter, url]) => {
            const base64 = await prefetchAvatarAsBase64(url);
            return [commenter, base64];
          })
        );

        // Store results in cache
        for (const [commenter, base64] of results) {
          if (base64) {
            avatarCache[commenter] = base64;
          }
        }

        // Small delay between batches to let browser breathe
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(`[Export Comments] Avatar prefetch complete. Cached ${Object.keys(avatarCache).length} avatars.`);
    }

    // Process comments in batches to prevent memory issues
    const COMMENT_BATCH_SIZE = 100;

    for (let i = 0; i < totalComments; i++) {
      const { comment } = allComments[i];
      const commenter = comment.owner?.username ||
                        comment.user?.username ||
                        comment.username ||
                        'unknown';

      // Debug: log comment structure for first few comments
      if (i < 3) {
        console.log(`[Export Comments] Comment ${i + 1}:`, {
          'resolved commenter': commenter,
          'has cached avatar': !!avatarCache[commenter]
        });
      }

      // Update button with progress
      btn.textContent = `💬 Exporting ${i + 1}/${totalComments}...`;

      try {
        // Create a temporary comment element for screenshot
        // Pass the avatar cache to use pre-fetched base64 avatars
        const tempCommentEl = createTempCommentElement(comment, post, avatarCache);

        // Create screenshot container using existing function
        const container = createCommentScreenshotContainer(tempCommentEl, post, avatarCache);
        document.body.appendChild(container);

        // Wait for any images to load (should be instant since base64)
        const imgs = container.querySelectorAll('img');
        await Promise.all(Array.from(imgs).map(img => {
          if (img.complete) return Promise.resolve();
          return new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve;
          });
        }));

        // Small delay for rendering
        await new Promise(resolve => setTimeout(resolve, 50));

        // Capture with html2canvas
        const screenshotComment = container.querySelector('.screenshot-comment');
        const canvas = await html2canvas(screenshotComment, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
          allowTaint: true
        });

        // Build filename using unified format (with real name prefix)
        const commentFilename = buildCommentFilename(post, comment, i, realName);
        const filename = `${basePath}/${commentFilename}.png`;
        const dataUrl = canvas.toDataURL('image/png');

        // Download using chrome.downloads API for folder path support
        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: 'downloadCommentScreenshot',
            dataUrl: dataUrl,
            filename: filename
          }, (response) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(response);
            }
          });
        });

        // Cleanup
        document.body.removeChild(container);

        successCount++;

        // Small delay between downloads
        await new Promise(resolve => setTimeout(resolve, 100));

        // Pause briefly every batch to let browser garbage collect
        if ((i + 1) % COMMENT_BATCH_SIZE === 0) {
          console.log(`[Export Comments] Completed batch ${Math.floor((i + 1) / COMMENT_BATCH_SIZE)}, pausing for GC...`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }

      } catch (error) {
        console.error(`Failed to export comment ${i + 1}:`, error);
        failCount++;
      }
    }

    // Show completion message
    if (failCount === 0) {
      alert(`Successfully exported ${successCount} comment screenshots to:\n${basePath}`);
    } else {
      alert(`Exported ${successCount} comment screenshots.\n${failCount} failed.\n\nSaved to: ${basePath}`);
    }

  } catch (error) {
    console.error('Export all comments failed:', error);
    alert('Failed to export comments: ' + error.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// Create a temporary comment element with required data attributes for screenshot
function createTempCommentElement(comment, post, avatarCache = null) {
  // Get username from owner object (matches how comments are stored)
  // Try multiple paths since comment structure can vary
  const commenterUsername = comment.owner?.username ||
                            comment.user?.username ||
                            comment.username ||
                            'unknown';

  const el = document.createElement('div');
  el.className = 'comment';
  el.dataset.commenter = commenterUsername;
  el.dataset.likes = comment.like_count || 0;
  el.dataset.timestamp = comment.created_at || 0;

  // Create comment text span with original text
  const textSpan = document.createElement('span');
  textSpan.className = 'comment-text';
  textSpan.dataset.original = comment.text || '';
  textSpan.textContent = comment.text || '';
  el.appendChild(textSpan);

  // Store avatar - prefer pre-fetched cache, then post.avatars, then original URLs
  // This is critical because html2canvas can't load cross-origin URLs
  const avatarUrl = (avatarCache && avatarCache[commenterUsername]) ||
                    (post.avatars && post.avatars[commenterUsername]) ||
                    comment.owner?.profile_pic_url ||
                    comment.user?.profile_pic_url ||
                    comment.profile_pic_url;
  if (avatarUrl) {
    el.dataset.avatar = avatarUrl;
  }

  return el;
}

// Export all comments button event listener
exportAllCommentsBtn?.addEventListener('click', exportAllComments);

// Create comment screenshot container
function createCommentScreenshotContainer(commentEl, post, avatarCache = null) {
  const container = document.createElement('div');
  container.className = 'screenshot-container';

  const commenter = commentEl.dataset.commenter || 'Unknown';
  const commentText = commentEl.querySelector('.comment-text')?.dataset.original || '';
  const likeCount = parseInt(commentEl.dataset.likes) || 0;
  const timestamp = parseInt(commentEl.dataset.timestamp) || 0;

  // Format the date
  const dateStr = timestamp ? new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  }) : '';

  // Get commenter avatar - check dataset first, then avatarCache, then post.avatars
  const commenterInitial = commenter.charAt(0).toUpperCase();
  const commenterAvatar = commentEl.dataset.avatar ||
                          (avatarCache && avatarCache[commenter]) ||
                          post.avatars?.[commenter];

  // Get post author info for context
  const postUsername = post.username || 'Unknown';
  const postAuthorInitial = postUsername.charAt(0).toUpperCase();
  const postAuthorAvatar = (avatarCache && avatarCache[postUsername]) ||
                           post.avatars?.[postUsername];

  container.innerHTML = `
    <div class="screenshot-comment">
      <div class="screenshot-comment-header">
        ${commenterAvatar
          ? `<img class="screenshot-comment-avatar" src="${commenterAvatar}" alt="${escapeHtml(commenter)}">`
          : `<div class="screenshot-comment-avatar">${commenterInitial}</div>`
        }
        <div class="screenshot-comment-body">
          <div>
            <span class="screenshot-comment-username">${escapeHtml(commenter)}</span>
            <span class="screenshot-comment-text">${escapeHtml(commentText)}</span>
          </div>
          <div class="screenshot-comment-meta">
            ${dateStr ? `<span>${dateStr}</span>` : ''}
            <span>${formatNumber(likeCount)} likes</span>
          </div>
        </div>
      </div>
      <div class="screenshot-comment-context">
        ${postAuthorAvatar
          ? `<img class="screenshot-comment-context-avatar" src="${postAuthorAvatar}" alt="${escapeHtml(postUsername)}">`
          : `<div class="screenshot-comment-context-avatar">${postAuthorInitial}</div>`
        }
        <span>Comment on @${escapeHtml(postUsername)}'s post</span>
      </div>
    </div>
  `;

  return container;
}

// Find a comment object by its ID path (e.g., "5" or "3-2" for reply)
function findCommentById(comments, commentId) {
  const parts = commentId.split('-').map(Number);
  let current = comments[parts[0]];

  if (!current) return null;

  // Navigate to nested reply if needed
  for (let i = 1; i < parts.length; i++) {
    if (!current.replies || !current.replies[parts[i]]) {
      return null;
    }
    current = current.replies[parts[i]];
  }

  return current;
}

// Get the flat index of a comment (for filename numbering)
function getFlatCommentIndex(comments, commentId) {
  const parts = commentId.split('-').map(Number);
  let index = 0;

  // Count all comments before this one (flattened)
  function countBefore(commentList, targetParts, depth = 0) {
    for (let i = 0; i < commentList.length; i++) {
      if (depth === 0 && i === targetParts[0] && targetParts.length === 1) {
        // Found the target at top level
        return index;
      }

      if (depth === 0 && i === targetParts[0] && targetParts.length > 1) {
        // Target is in replies of this comment
        index++; // Count this comment
        if (commentList[i].replies) {
          return countBefore(commentList[i].replies, targetParts.slice(1), depth + 1);
        }
      }

      if (depth > 0 && i === targetParts[0] && targetParts.length === 1) {
        // Found nested target
        return index;
      }

      if (depth > 0 && i === targetParts[0] && targetParts.length > 1) {
        index++;
        if (commentList[i].replies) {
          return countBefore(commentList[i].replies, targetParts.slice(1), depth + 1);
        }
      }

      // Count this comment and all its replies
      index++;
      if (commentList[i].replies) {
        index += countAllComments(commentList[i].replies);
      }

      if (depth === 0 && i < targetParts[0]) {
        continue;
      }
    }
    return index;
  }

  // Simpler approach: flatten and find
  const allComments = [];
  function flatten(commentList) {
    for (const comment of commentList) {
      allComments.push(comment);
      if (comment.replies && comment.replies.length > 0) {
        flatten(comment.replies);
      }
    }
  }
  flatten(comments);

  const targetComment = findCommentById(comments, commentId);
  if (targetComment) {
    const foundIndex = allComments.indexOf(targetComment);
    if (foundIndex !== -1) return foundIndex;
  }

  // Fallback to parsing the ID
  return parts[0];
}

// Export individual comment screenshot
// Uses the same logic as exportAllComments for consistency
async function exportCommentScreenshot(commentEl) {
  const post = posts[currentPostIndex];
  if (!post) {
    alert('No post context available');
    return;
  }

  // Get the button that was clicked and show loading state
  const btn = commentEl.querySelector('.comment-screenshot-btn');
  const originalText = btn?.textContent;
  if (btn) {
    btn.textContent = '⏳';
    btn.disabled = true;
  }

  try {
    // Get comment ID and find the actual comment object from post.comments
    // This avoids DOM data-attribute limitations for large comments
    const commentId = commentEl.dataset.commentId || '0';
    const comment = findCommentById(post.comments, commentId);

    if (!comment) {
      throw new Error('Comment not found in post data');
    }

    // Get flat index for filename
    const commentIndex = getFlatCommentIndex(post.comments, commentId);

    // Extract real name from source path for filename prefix
    const postUsername = post.username || 'unknown';
    const realName = extractRealNameFromPath(post.sourcePath, postUsername);

    // Build avatar cache - start with post.avatars, then prefetch if needed
    const avatarCache = { ...(post.avatars || {}) };

    const commenter = comment.owner?.username ||
                      comment.user?.username ||
                      comment.username ||
                      'unknown';

    // Prefetch avatar if not already cached
    if (!avatarCache[commenter]) {
      const avatarUrl = comment.owner?.profile_pic_url ||
                        comment.user?.profile_pic_url ||
                        comment.profile_pic_url;
      if (avatarUrl && !avatarUrl.startsWith('data:')) {
        const base64 = await prefetchAvatarAsBase64(avatarUrl);
        if (base64) {
          avatarCache[commenter] = base64;
        }
      }
    }

    // Create temp element using the same function as batch export
    const tempCommentEl = createTempCommentElement(comment, post, avatarCache);

    // Create screenshot container with avatar cache
    const container = createCommentScreenshotContainer(tempCommentEl, post, avatarCache);
    document.body.appendChild(container);

    // Wait for any images to load
    const images = container.querySelectorAll('img');
    await Promise.all(Array.from(images).map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      });
    }));

    // Small delay for rendering
    await new Promise(resolve => setTimeout(resolve, 150));

    // Capture with html2canvas
    const screenshotComment = container.querySelector('.screenshot-comment');
    const canvas = await html2canvas(screenshotComment, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      allowTaint: true
    });

    // Build filename using unified format (with real name prefix)
    const filename = buildCommentFilename(post, comment, commentIndex, realName) + '.png';

    // Download
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();

    // Cleanup
    document.body.removeChild(container);

  } catch (error) {
    console.error('Comment screenshot failed:', error);
    alert('Failed to create comment screenshot: ' + error.message);
  } finally {
    // Restore button state
    if (btn) {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }
}

// Event delegation for comment screenshot buttons
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('comment-screenshot-btn')) {
    e.stopPropagation();
    const commentEl = e.target.closest('.comment');
    if (commentEl) {
      exportCommentScreenshot(commentEl);
    }
  }
});

// Bulk export all comments for an account
const bulkExportCommentsBtn = document.getElementById('bulkExportCommentsBtn');

bulkExportCommentsBtn?.addEventListener('click', showBulkExportAccountPicker);

// Show account picker for bulk comment export
function showBulkExportAccountPicker() {
  // Get unique accounts from loaded posts that have comments
  const accountsWithComments = {};

  for (const post of posts) {
    if (post.comments && post.comments.length > 0) {
      const username = post.username || 'unknown';
      if (!accountsWithComments[username]) {
        accountsWithComments[username] = {
          postCount: 0,
          commentCount: 0
        };
      }
      accountsWithComments[username].postCount++;

      // Count all comments including replies
      function countComments(comments) {
        let count = 0;
        for (const comment of comments) {
          count++;
          if (comment.replies && comment.replies.length > 0) {
            count += countComments(comment.replies);
          }
        }
        return count;
      }
      accountsWithComments[username].commentCount += countComments(post.comments);
    }
  }

  const accountNames = Object.keys(accountsWithComments);

  if (accountNames.length === 0) {
    alert('No posts with comments found. Load some posts with comments first.');
    return;
  }

  // If only one account, export directly
  if (accountNames.length === 1) {
    const username = accountNames[0];
    const data = accountsWithComments[username];
    if (confirm(`Export all ${data.commentCount} comment screenshots from @${username}?\n\nThis will export comments from ${data.postCount} posts.`)) {
      bulkExportCommentsForAccount(username);
    }
    return;
  }

  // Multiple accounts - show picker
  const choices = accountNames.map(username => {
    const data = accountsWithComments[username];
    return `@${username} (${data.commentCount} comments from ${data.postCount} posts)`;
  });

  const choice = prompt(
    `Multiple accounts found. Enter the username to export comments for:\n\n${choices.join('\n')}\n\nOr type "all" to export from all accounts.`
  );

  if (!choice) return;

  if (choice.toLowerCase() === 'all') {
    if (confirm(`Export ALL comment screenshots from all ${accountNames.length} accounts?`)) {
      bulkExportCommentsForAllAccounts(accountsWithComments);
    }
  } else {
    const username = choice.replace('@', '').trim();
    if (accountsWithComments[username]) {
      bulkExportCommentsForAccount(username);
    } else {
      alert(`Account "${username}" not found. Please enter an exact username.`);
    }
  }
}

// Export all comments for a specific account
async function bulkExportCommentsForAccount(targetUsername) {
  const btn = bulkExportCommentsBtn;
  const originalText = btn.textContent;
  btn.disabled = true;

  try {
    // Get all posts for this account that have comments
    const accountPosts = posts.filter(p =>
      (p.username || 'unknown') === targetUsername &&
      p.comments &&
      p.comments.length > 0
    );

    if (accountPosts.length === 0) {
      alert(`No posts with comments found for @${targetUsername}`);
      return;
    }

    // Count total comments
    let totalComments = 0;
    for (const post of accountPosts) {
      function countComments(comments) {
        let count = 0;
        for (const comment of comments) {
          count++;
          if (comment.replies && comment.replies.length > 0) {
            count += countComments(comment.replies);
          }
        }
        return count;
      }
      totalComments += countComments(post.comments);
    }

    btn.textContent = `💬 Exporting 0/${totalComments}...`;

    let exportedCount = 0;
    let failCount = 0;

    // Process each post
    for (let postIdx = 0; postIdx < accountPosts.length; postIdx++) {
      const post = accountPosts[postIdx];

      // Flatten all comments including replies
      const allComments = [];
      function collectComments(comments, depth = 0) {
        for (const comment of comments) {
          allComments.push({ comment, depth });
          if (comment.replies && comment.replies.length > 0) {
            collectComments(comment.replies, depth + 1);
          }
        }
      }
      collectComments(post.comments);

      // Use the source path where the post was loaded from
      const basePath = post.sourcePath
        ? `${post.sourcePath}/comments/screenshots`
        : `Instagram/${targetUsername}/${buildFilePrefix(post)}/comments/screenshots`;

      // Extract real name from source path for filename prefix
      const realName = extractRealNameFromPath(post.sourcePath, targetUsername);
      console.log('[Viewer] Bulk export path:', basePath, '| realName:', realName);

      // Initialize avatar cache from post.avatars
      const avatarCache = { ...(post.avatars || {}) };

      // Collect unique avatar URLs that need fetching
      const avatarsToFetch = new Map();
      for (const { comment } of allComments) {
        const commenter = comment.owner?.username ||
                          comment.user?.username ||
                          comment.username ||
                          'unknown';

        if (!avatarCache[commenter]) {
          const avatarUrl = comment.owner?.profile_pic_url ||
                            comment.user?.profile_pic_url ||
                            comment.profile_pic_url;
          if (avatarUrl && !avatarUrl.startsWith('data:')) {
            avatarsToFetch.set(commenter, avatarUrl);
          }
        }
      }

      // Pre-fetch avatars
      if (avatarsToFetch.size > 0) {
        btn.textContent = `💬 Loading avatars for post ${postIdx + 1}/${accountPosts.length}...`;

        const results = await Promise.all(
          Array.from(avatarsToFetch.entries()).map(async ([commenter, url]) => {
            const base64 = await prefetchAvatarAsBase64(url);
            return [commenter, base64];
          })
        );

        for (const [commenter, base64] of results) {
          if (base64) {
            avatarCache[commenter] = base64;
          }
        }
      }

      // Process comments for this post
      for (let i = 0; i < allComments.length; i++) {
        const { comment } = allComments[i];
        const commenter = comment.owner?.username ||
                          comment.user?.username ||
                          comment.username ||
                          'unknown';

        exportedCount++;
        btn.textContent = `💬 Exporting ${exportedCount}/${totalComments}...`;

        try {
          // Create temporary comment element
          const tempCommentEl = createTempCommentElement(comment, post, avatarCache);

          // Create screenshot container
          const container = createCommentScreenshotContainer(tempCommentEl, post, avatarCache);
          document.body.appendChild(container);

          // Wait for images
          const images = container.querySelectorAll('img');
          await Promise.all(Array.from(images).map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise(resolve => {
              img.onload = resolve;
              img.onerror = resolve;
            });
          }));

          await new Promise(resolve => setTimeout(resolve, 50));

          // Capture with html2canvas
          const screenshotComment = container.querySelector('.screenshot-comment');
          const canvas = await html2canvas(screenshotComment, {
            backgroundColor: '#ffffff',
            scale: 2,
            useCORS: true,
            allowTaint: true
          });

          // Build filename using unified format (with real name prefix)
          const commentFilename = buildCommentFilename(post, comment, i, realName);
          const filename = `${basePath}/${commentFilename}.jpg`;

          // Download via extension
          const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

          await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              action: 'downloadCommentScreenshot',
              dataUrl: dataUrl,
              filename: filename
            }, response => {
              if (response?.success) {
                resolve();
              } else {
                reject(new Error(response?.error || 'Download failed'));
              }
            });
          });

          // Cleanup
          document.body.removeChild(container);

        } catch (err) {
          console.warn('Failed to export comment:', err.message);
          failCount++;
        }

        // Brief pause every 10 comments to prevent overwhelming browser
        if (exportedCount % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }

    // Done
    if (failCount === 0) {
      alert(`Successfully exported ${exportedCount} comment screenshots for @${targetUsername}!`);
    } else {
      alert(`Exported ${exportedCount - failCount} comment screenshots for @${targetUsername}.\n${failCount} failed.`);
    }

  } catch (error) {
    console.error('Bulk export failed:', error);
    alert('Export failed: ' + error.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// Export all comments for all accounts
async function bulkExportCommentsForAllAccounts(accountsWithComments) {
  const btn = bulkExportCommentsBtn;
  const originalText = btn.textContent;
  btn.disabled = true;

  const accountNames = Object.keys(accountsWithComments);
  let totalExported = 0;
  let totalFailed = 0;

  try {
    for (let i = 0; i < accountNames.length; i++) {
      const username = accountNames[i];
      btn.textContent = `💬 Account ${i + 1}/${accountNames.length}: @${username}...`;

      // Use the single account export function but track results
      await bulkExportCommentsForAccountSilent(username, (exported, failed) => {
        totalExported += exported;
        totalFailed += failed;
      });
    }

    alert(`Bulk export complete!\n\nExported ${totalExported} comment screenshots from ${accountNames.length} accounts.${totalFailed > 0 ? `\n${totalFailed} failed.` : ''}`);

  } catch (error) {
    console.error('Bulk export all failed:', error);
    alert('Export failed: ' + error.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// Silent version of bulk export for multi-account export
async function bulkExportCommentsForAccountSilent(targetUsername, onComplete) {
  let exportedCount = 0;
  let failCount = 0;

  try {
    const accountPosts = posts.filter(p =>
      (p.username || 'unknown') === targetUsername &&
      p.comments &&
      p.comments.length > 0
    );

    for (const post of accountPosts) {
      const allComments = [];
      function collectComments(comments, depth = 0) {
        for (const comment of comments) {
          allComments.push({ comment, depth });
          if (comment.replies && comment.replies.length > 0) {
            collectComments(comment.replies, depth + 1);
          }
        }
      }
      collectComments(post.comments);

      // Use the source path where the post was loaded from
      const basePath = post.sourcePath
        ? `${post.sourcePath}/comments/screenshots`
        : `Instagram/${targetUsername}/${buildFilePrefix(post)}/comments/screenshots`;

      // Extract real name from source path for filename prefix
      const realName = extractRealNameFromPath(post.sourcePath, targetUsername);

      const avatarCache = { ...(post.avatars || {}) };

      // Pre-fetch avatars
      const avatarsToFetch = new Map();
      for (const { comment } of allComments) {
        const commenter = comment.owner?.username || comment.user?.username || comment.username || 'unknown';
        if (!avatarCache[commenter]) {
          const avatarUrl = comment.owner?.profile_pic_url || comment.user?.profile_pic_url || comment.profile_pic_url;
          if (avatarUrl && !avatarUrl.startsWith('data:')) {
            avatarsToFetch.set(commenter, avatarUrl);
          }
        }
      }

      if (avatarsToFetch.size > 0) {
        const results = await Promise.all(
          Array.from(avatarsToFetch.entries()).map(async ([commenter, url]) => {
            const base64 = await prefetchAvatarAsBase64(url);
            return [commenter, base64];
          })
        );
        for (const [commenter, base64] of results) {
          if (base64) avatarCache[commenter] = base64;
        }
      }

      for (let i = 0; i < allComments.length; i++) {
        const { comment } = allComments[i];
        const commenter = comment.owner?.username || comment.user?.username || comment.username || 'unknown';

        try {
          const tempCommentEl = createTempCommentElement(comment, post, avatarCache);
          const container = createCommentScreenshotContainer(tempCommentEl, post, avatarCache);
          document.body.appendChild(container);

          const images = container.querySelectorAll('img');
          await Promise.all(Array.from(images).map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise(resolve => {
              img.onload = resolve;
              img.onerror = resolve;
            });
          }));

          await new Promise(resolve => setTimeout(resolve, 50));

          const screenshotComment = container.querySelector('.screenshot-comment');
          const canvas = await html2canvas(screenshotComment, {
            backgroundColor: '#ffffff',
            scale: 2,
            useCORS: true,
            allowTaint: true
          });

          // Build filename using unified format (with real name prefix)
          const commentFilename = buildCommentFilename(post, comment, i, realName);
          const filename = `${basePath}/${commentFilename}.jpg`;
          const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

          await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              action: 'downloadCommentScreenshot',
              dataUrl: dataUrl,
              filename: filename
            }, response => {
              if (response?.success) resolve();
              else reject(new Error(response?.error || 'Download failed'));
            });
          });

          document.body.removeChild(container);
          exportedCount++;

        } catch (err) {
          failCount++;
        }

        if ((exportedCount + failCount) % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
  } catch (error) {
    console.error('Silent bulk export failed:', error);
  }

  if (onComplete) {
    onComplete(exportedCount, failCount);
  }
}
