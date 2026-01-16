// profile-scraper.js - Intercepts Instagram's GraphQL requests to extract post URLs from profiles
(function() {
  'use strict';

  console.log('[IG Profile Scraper] 🚀 Profile scraper loaded');

  // Configuration (will be overridden by CONFIG if available)
  const SCRAPE_CONFIG = {
    POSTS_PER_CHUNK: 50,          // Pause every 50 posts
    CHUNK_PAUSE_MS: 30000,        // 30 second pause between chunks
    SCROLL_DELAY_MS: 1500,        // Delay between scroll attempts
    MAX_NO_NEW_POSTS_ATTEMPTS: 5, // Stop after this many attempts with no new posts
  };

  // Try to load config from window (injected by content script)
  if (typeof window.CONFIG !== 'undefined' && window.CONFIG.TIMING?.PROFILE_SCRAPING) {
    const cfg = window.CONFIG.TIMING.PROFILE_SCRAPING;
    SCRAPE_CONFIG.POSTS_PER_CHUNK = cfg.POSTS_PER_CHUNK || SCRAPE_CONFIG.POSTS_PER_CHUNK;
    SCRAPE_CONFIG.CHUNK_PAUSE_MS = cfg.CHUNK_PAUSE_MS || SCRAPE_CONFIG.CHUNK_PAUSE_MS;
    SCRAPE_CONFIG.SCROLL_DELAY_MS = cfg.SCROLL_DELAY_MS || SCRAPE_CONFIG.SCROLL_DELAY_MS;
    SCRAPE_CONFIG.MAX_NO_NEW_POSTS_ATTEMPTS = cfg.MAX_NO_NEW_POSTS_ATTEMPTS || SCRAPE_CONFIG.MAX_NO_NEW_POSTS_ATTEMPTS;
    console.log('[IG Profile Scraper] Loaded config:', SCRAPE_CONFIG);
  }

  // State management
  let collectedPosts = [];
  let isCollecting = false;
  let targetPostCount = 0;
  let stopRequested = false;
  let currentUsername = null;
  let scrollAttempts = 0;
  let lastPostCount = 0;
  let noNewPostsCount = 0;

  // Chunk management state
  let lastChunkBoundary = 0;      // Posts count at last chunk boundary
  let isPausedForChunk = false;   // Currently paused between chunks
  let chunkPauseTimeout = null;   // Timeout for auto-resume
  let manualPauseRequested = false; // User requested manual pause

  // Get username from page
  function getUsername() {
    if (currentUsername) return currentUsername;

    // Try to get from header - multiple selectors for different Instagram layouts
    const headerSelectors = [
      'header h2 span',
      'header section h2',
      'header a[href*="/"] span',
      '[role="main"] header h2'
    ];

    for (const selector of headerSelectors) {
      const el = document.querySelector(selector);
      if (el && el.innerText) {
        currentUsername = el.innerText.trim();
        if (currentUsername && currentUsername.length > 0) {
          return currentUsername;
        }
      }
    }

    // Try from URL - handle both /username/ and /username formats
    const urlMatch = window.location.pathname.match(/^\/([^\/\?]+)\/?$/);
    if (urlMatch && !['p', 'reel', 'reels', 'explore', 'direct', 'accounts', 'stories'].includes(urlMatch[1])) {
      currentUsername = urlMatch[1];
      return currentUsername;
    }

    return null;
  }

  // Check if we're on a profile page
  function isProfilePage() {
    const path = window.location.pathname;
    const excludedPaths = ['/p/', '/reel/', '/reels/', '/explore/', '/direct/', '/accounts/', '/stories/'];
    if (excludedPaths.some(p => path.includes(p))) return false;

    // Check if it looks like a profile (has tablist or post grid)
    const tablist = document.querySelector('[role="tablist"]');
    const postGrid = document.querySelector('article a[href*="/p/"]');
    return tablist !== null || postGrid !== null;
  }

  // Parse post data from GraphQL response node
  function parsePostData(node) {
    const takenAt = node?.taken_at;
    const timestamp = takenAt ? takenAt * 1000 : null;
    const code = node?.code || '';

    return {
      code: code,
      postId: node?.pk || null,
      mediaType: node?.media_type || null,
      likesCount: node?.like_count || 0,
      commentsCount: node?.comment_count || 0,
      viewCount: node?.view_count || node?.play_count || 0,
      caption: node?.caption?.text || '',
      createDate: timestamp ? new Date(timestamp).toISOString() : '',
      userName: node?.user?.username || getUsername() || '',
      postUrl: code ? `https://www.instagram.com/p/${code}/` : ''
    };
  }

  // Parse posts from DOM (for initially loaded posts)
  function parsePostsFromDOM() {
    const posts = [];
    const postLinks = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');

    console.log('[IG Profile Scraper] 🔍 Found', postLinks.length, 'post links in DOM');

    postLinks.forEach(link => {
      const href = link.getAttribute('href');
      const match = href.match(/\/(p|reel)\/([^\/]+)/);
      if (match) {
        const code = match[2];
        // Check if not already collected
        if (!posts.some(p => p.code === code) && !collectedPosts.some(p => p.code === code)) {
          posts.push({
            code: code,
            postId: null,
            mediaType: match[1] === 'reel' ? 2 : 1,
            likesCount: 0,
            commentsCount: 0,
            viewCount: 0,
            caption: '',
            createDate: '',
            userName: getUsername() || '',
            postUrl: `https://www.instagram.com${href.startsWith('/') ? '' : '/'}${href}`
          });
        }
      }
    });

    return posts;
  }

  // Add posts to collection
  function addPosts(posts) {
    if (!isCollecting) return;

    let addedCount = 0;
    for (const post of posts) {
      if (post.code && !collectedPosts.some(p => p.code === post.code)) {
        collectedPosts.push(post);
        addedCount++;
      }
    }

    if (addedCount > 0) {
      console.log(`[IG Profile Scraper] ➕ Added ${addedCount} new posts. Total: ${collectedPosts.length}/${targetPostCount || '∞'}`);

      // Calculate current chunk
      const currentChunk = Math.floor(collectedPosts.length / SCRAPE_CONFIG.POSTS_PER_CHUNK);
      const totalChunks = targetPostCount > 0 ? Math.ceil(targetPostCount / SCRAPE_CONFIG.POSTS_PER_CHUNK) : '?';

      // Notify about progress with chunk info
      window.postMessage({
        type: 'PROFILE_SCRAPE_PROGRESS',
        count: collectedPosts.length,
        targetCount: targetPostCount,
        currentChunk: currentChunk + 1,
        totalChunks: totalChunks,
        isPaused: isPausedForChunk
      }, '*');

      // Check if we've crossed a chunk boundary
      const newChunkBoundary = Math.floor(collectedPosts.length / SCRAPE_CONFIG.POSTS_PER_CHUNK);
      // Trigger chunk pause if: we crossed a boundary AND (no target OR we haven't reached target)
      if (newChunkBoundary > lastChunkBoundary && (targetPostCount === 0 || collectedPosts.length < targetPostCount)) {
        lastChunkBoundary = newChunkBoundary;
        triggerChunkPause();
        return; // Stop adding more posts until pause ends
      }
    }

    // Check if we've reached target
    if (targetPostCount > 0 && collectedPosts.length >= targetPostCount) {
      console.log('[IG Profile Scraper] ✅ Reached target post count');
      finishCollection();
    }
  }

  // Trigger a pause between chunks
  function triggerChunkPause() {
    console.log(`[IG Profile Scraper] ⏸️ Chunk boundary reached at ${collectedPosts.length} posts. Pausing for ${SCRAPE_CONFIG.CHUNK_PAUSE_MS / 1000}s...`);

    isPausedForChunk = true;

    // Save progress immediately
    saveProgressToStorage();

    // Notify popup about chunk pause
    window.postMessage({
      type: 'PROFILE_SCRAPE_CHUNK_PAUSE',
      count: collectedPosts.length,
      targetCount: targetPostCount,
      pauseDuration: SCRAPE_CONFIG.CHUNK_PAUSE_MS,
      posts: collectedPosts,
      username: currentUsername
    }, '*');

    // Set timeout for auto-resume (unless manual pause requested)
    if (!manualPauseRequested) {
      chunkPauseTimeout = setTimeout(() => {
        resumeFromChunkPause();
      }, SCRAPE_CONFIG.CHUNK_PAUSE_MS);
    }
  }

  // Resume from chunk pause
  function resumeFromChunkPause() {
    if (!isPausedForChunk) return;

    console.log('[IG Profile Scraper] ▶️ Resuming after chunk pause...');
    isPausedForChunk = false;
    manualPauseRequested = false;

    if (chunkPauseTimeout) {
      clearTimeout(chunkPauseTimeout);
      chunkPauseTimeout = null;
    }

    // Notify popup
    window.postMessage({
      type: 'PROFILE_SCRAPE_RESUMED',
      count: collectedPosts.length,
      targetCount: targetPostCount
    }, '*');

    // Continue scrolling
    if (isCollecting && !stopRequested) {
      scrollToLoadMore();
    }
  }

  // Manual pause (user clicked pause)
  function requestManualPause() {
    console.log('[IG Profile Scraper] 🛑 Manual pause requested');
    manualPauseRequested = true;

    if (chunkPauseTimeout) {
      clearTimeout(chunkPauseTimeout);
      chunkPauseTimeout = null;
    }

    // If not already paused, pause now
    if (!isPausedForChunk) {
      isPausedForChunk = true;
      saveProgressToStorage();

      window.postMessage({
        type: 'PROFILE_SCRAPE_CHUNK_PAUSE',
        count: collectedPosts.length,
        targetCount: targetPostCount,
        pauseDuration: 0, // Indefinite until user resumes
        posts: collectedPosts,
        username: currentUsername,
        isManualPause: true
      }, '*');
    }
  }

  // Save progress to storage (for persistence across page refresh)
  function saveProgressToStorage() {
    const state = {
      collectedPosts: collectedPosts,
      username: currentUsername,
      targetCount: targetPostCount,
      savedAt: Date.now()
    };

    // Send to content script to save via chrome.storage
    window.postMessage({
      type: 'PROFILE_SCRAPE_SAVE_STATE',
      state: state
    }, '*');

    console.log('[IG Profile Scraper] 💾 Progress saved:', collectedPosts.length, 'posts');
  }

  // Scroll to trigger more posts loading
  async function scrollToLoadMore() {
    if (!isCollecting || stopRequested) {
      if (stopRequested) finishCollection();
      return;
    }

    // Don't scroll if paused for chunk
    if (isPausedForChunk) {
      console.log('[IG Profile Scraper] ⏸️ Scrolling paused for chunk break');
      return;
    }

    scrollAttempts++;
    console.log(`[IG Profile Scraper] 📜 Scroll attempt ${scrollAttempts}...`);

    // First, collect any posts visible in DOM
    const domPosts = parsePostsFromDOM();
    if (domPosts.length > 0) {
      addPosts(domPosts);
    }

    // Check if we've reached target
    if (targetPostCount > 0 && collectedPosts.length >= targetPostCount) {
      return;
    }

    // Check if paused after adding posts (chunk boundary hit)
    if (isPausedForChunk) {
      return;
    }

    // Check if we're making progress
    if (collectedPosts.length === lastPostCount) {
      noNewPostsCount++;
      console.log(`[IG Profile Scraper] ⚠️ No new posts found (attempt ${noNewPostsCount}/${SCRAPE_CONFIG.MAX_NO_NEW_POSTS_ATTEMPTS})`);

      if (noNewPostsCount >= SCRAPE_CONFIG.MAX_NO_NEW_POSTS_ATTEMPTS) {
        console.log('[IG Profile Scraper] 📭 No more posts available after multiple attempts');
        finishCollection();
        return;
      }
    } else {
      noNewPostsCount = 0;
      lastPostCount = collectedPosts.length;
    }

    // Scroll down to load more
    const postLinks = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
    if (postLinks.length > 0) {
      const lastPost = postLinks[postLinks.length - 1];
      lastPost.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      window.scrollBy(0, window.innerHeight);
    }

    // Wait and then try again (using config delay)
    setTimeout(() => {
      if (isCollecting && !stopRequested && !isPausedForChunk) {
        scrollToLoadMore();
      }
    }, SCRAPE_CONFIG.SCROLL_DELAY_MS);
  }

  // Start collection process
  function startCollection(count = 0, existingPosts = null) {
    console.log('[IG Profile Scraper] 🎬 Starting collection, target:', count || 'all', existingPosts ? `(resuming from ${existingPosts.length})` : '');

    // If resuming, use existing posts
    collectedPosts = existingPosts || [];
    isCollecting = true;
    targetPostCount = count;
    stopRequested = false;
    currentUsername = getUsername();
    scrollAttempts = 0;
    lastPostCount = collectedPosts.length;
    noNewPostsCount = 0;

    // Reset chunk state
    lastChunkBoundary = Math.floor(collectedPosts.length / SCRAPE_CONFIG.POSTS_PER_CHUNK);
    isPausedForChunk = false;
    manualPauseRequested = false;
    if (chunkPauseTimeout) {
      clearTimeout(chunkPauseTimeout);
      chunkPauseTimeout = null;
    }

    // Send started message
    window.postMessage({
      type: 'PROFILE_SCRAPE_PROGRESS',
      count: collectedPosts.length,
      targetCount: targetPostCount,
      currentChunk: lastChunkBoundary + 1,
      totalChunks: targetPostCount > 0 ? Math.ceil(targetPostCount / SCRAPE_CONFIG.POSTS_PER_CHUNK) : '?'
    }, '*');

    // First, collect posts already visible in DOM
    const initialPosts = parsePostsFromDOM();
    console.log('[IG Profile Scraper] 📋 Found', initialPosts.length, 'initial posts in DOM');

    if (initialPosts.length > 0) {
      addPosts(initialPosts);
    }

    // Check if we already have enough
    if (targetPostCount > 0 && collectedPosts.length >= targetPostCount) {
      finishCollection();
      return;
    }

    // Check if paused (hit chunk boundary already)
    if (isPausedForChunk) {
      return;
    }

    // Start scrolling to load more
    setTimeout(() => scrollToLoadMore(), 500);
  }

  // Stop collection
  function stopCollection() {
    console.log('[IG Profile Scraper] 🛑 Stop requested');
    stopRequested = true;
    finishCollection();
  }

  // Finish collection and send results
  function finishCollection() {
    if (!isCollecting) return; // Prevent double finish

    isCollecting = false;
    stopRequested = false;

    console.log('[IG Profile Scraper] ✅ Collection finished with', collectedPosts.length, 'posts');

    // Trim to target if we overshot
    let finalPosts = collectedPosts;
    if (targetPostCount > 0 && collectedPosts.length > targetPostCount) {
      finalPosts = collectedPosts.slice(0, targetPostCount);
    }

    // Extract just the URLs for the batch download
    const postUrls = finalPosts.map(p => p.postUrl);

    window.postMessage({
      type: 'PROFILE_SCRAPE_COMPLETE',
      posts: finalPosts,
      postUrls: postUrls,
      count: finalPosts.length,
      username: currentUsername
    }, '*');
  }

  // Helper to check if URL is a GraphQL endpoint
  function isGraphQLEndpoint(url) {
    if (!url) return false;
    return url.includes('/graphql/query') || url.includes('/api/graphql') || url.includes('/graphql');
  }

  // Helper to process GraphQL response data
  function processGraphQLResponse(data) {
    // Handle user timeline (posts) response
    if (data?.data?.xdt_api__v1__feed__user_timeline_graphql_connection) {
      const connection = data.data.xdt_api__v1__feed__user_timeline_graphql_connection;
      const edges = connection.edges || [];

      console.log('[IG Profile Scraper] 📥 Intercepted API response:', edges.length, 'posts with full metadata');

      const posts = edges.map(edge => parsePostData(edge.node));

      // Update existing posts with richer data or add new ones
      posts.forEach(post => {
        const existing = collectedPosts.find(p => p.code === post.code);
        if (existing) {
          Object.assign(existing, post);
        } else {
          collectedPosts.push(post);
        }
      });

      notifyProgress();
      return true;
    }

    // Handle user clips (reels) response
    if (data?.data?.xdt_api__v1__clips__user__connection_v2) {
      const connection = data.data.xdt_api__v1__clips__user__connection_v2;
      const edges = connection.edges || [];

      console.log('[IG Profile Scraper] 📥 Intercepted reels response:', edges.length, 'reels');

      const posts = edges
        .filter(edge => edge.node?.media)
        .map(edge => parsePostData(edge.node.media));

      posts.forEach(post => {
        const existing = collectedPosts.find(p => p.code === post.code);
        if (existing) {
          Object.assign(existing, post);
        } else {
          collectedPosts.push(post);
        }
      });

      notifyProgress();
      return true;
    }

    return false;
  }

  // Helper to send progress notification
  function notifyProgress() {
    const currentChunk = Math.floor(collectedPosts.length / SCRAPE_CONFIG.POSTS_PER_CHUNK);
    const totalChunks = targetPostCount > 0 ? Math.ceil(targetPostCount / SCRAPE_CONFIG.POSTS_PER_CHUNK) : '?';

    window.postMessage({
      type: 'PROFILE_SCRAPE_PROGRESS',
      count: collectedPosts.length,
      targetCount: targetPostCount,
      currentChunk: currentChunk + 1,
      totalChunks: totalChunks,
      isPaused: isPausedForChunk
    }, '*');

    // Check if we've reached target (for API interception path)
    if (isCollecting && targetPostCount > 0 && collectedPosts.length >= targetPostCount) {
      console.log('[IG Profile Scraper] ✅ Reached target post count via API interception');
      finishCollection();
    }
  }

  // Fetch Interception - capture fetch API responses
  (function() {
    const originalFetch = window.fetch;

    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

      if (isCollecting && !stopRequested && isGraphQLEndpoint(url)) {
        try {
          // Clone response to read body without consuming it
          const clone = response.clone();
          const text = await clone.text();
          const data = JSON.parse(text);

          // Check for rate limiting
          if (response.status === 403 || response.status === 429) {
            console.error(`[IG Profile Scraper] 🚫 Rate limited via fetch! Status: ${response.status}`);
            saveProgressToStorage();
            window.postMessage({
              type: 'PROFILE_SCRAPE_RATE_LIMITED',
              count: collectedPosts.length,
              targetCount: targetPostCount,
              posts: collectedPosts,
              username: currentUsername,
              errorStatus: response.status
            }, '*');
            isCollecting = false;
            isPausedForChunk = true;
          } else {
            processGraphQLResponse(data);
          }
        } catch (e) {
          // Not JSON or parsing error, ignore
        }
      }

      return response;
    };
  })();

  // XHR Interception - capture API responses for richer data
  (function() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
      this._url = url;
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
      // Add error/status listener for rate limit detection
      this.addEventListener('loadend', function() {
        if (!isCollecting) return;

        // Detect rate limiting (403 or 429)
        if (isGraphQLEndpoint(this._url)) {
          if (this.status === 403 || this.status === 429) {
            console.error(`[IG Profile Scraper] 🚫 Rate limited! Status: ${this.status}`);

            // Save progress and notify about rate limit
            saveProgressToStorage();

            window.postMessage({
              type: 'PROFILE_SCRAPE_RATE_LIMITED',
              count: collectedPosts.length,
              targetCount: targetPostCount,
              posts: collectedPosts,
              username: currentUsername,
              errorStatus: this.status
            }, '*');

            // Stop collecting
            isCollecting = false;
            isPausedForChunk = true;
          }
        }
      });

      this.addEventListener('load', function() {
        if (!isCollecting) return;
        if (stopRequested) return;

        // Check if this is a GraphQL request with post data
        if (isGraphQLEndpoint(this._url) &&
            (this.responseType === '' || this.responseType === 'text')) {
          try {
            const data = JSON.parse(this.responseText);
            processGraphQLResponse(data);
          } catch (e) {
            // Not JSON or parsing error, ignore
          }
        }
      });

      return originalSend.apply(this, arguments);
    };
  })();

  // Listen for commands from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data.type === 'START_PROFILE_SCRAPE') {
      const count = event.data.count || 0;
      const existingPosts = event.data.existingPosts || null;
      startCollection(count, existingPosts);
    }

    if (event.data.type === 'STOP_PROFILE_SCRAPE') {
      stopCollection();
    }

    if (event.data.type === 'PAUSE_PROFILE_SCRAPE') {
      // User requested manual pause
      requestManualPause();
    }

    if (event.data.type === 'RESUME_PROFILE_SCRAPE') {
      // Resume from chunk pause (either auto or manual)
      resumeFromChunkPause();
    }

    if (event.data.type === 'CONTINUE_NOW_PROFILE_SCRAPE') {
      // Skip the countdown and continue immediately
      resumeFromChunkPause();
    }

    if (event.data.type === 'GET_PROFILE_STATUS') {
      window.postMessage({
        type: 'PROFILE_STATUS_RESPONSE',
        isProfilePage: isProfilePage(),
        username: getUsername(),
        isCollecting: isCollecting,
        collectedCount: collectedPosts.length,
        isPaused: isPausedForChunk,
        isManualPause: manualPauseRequested
      }, '*');
    }
  });

  // Notify that scraper is ready
  setTimeout(() => {
    const username = getUsername();
    const onProfile = isProfilePage();
    console.log('[IG Profile Scraper] Status check - isProfilePage:', onProfile, 'username:', username);

    if (onProfile) {
      console.log('[IG Profile Scraper] ✅ Ready on profile page:', username);
      window.postMessage({
        type: 'PROFILE_SCRAPER_READY',
        username: username
      }, '*');
    }
  }, 1000);

})();
