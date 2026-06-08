// inject-v7-final.js - V2 - Optimized with adaptive rate limiting and CONFIG
(function() {
  'use strict';

  console.log('[IG DL V2] 🚀 Starting - Optimized extraction engine loaded...');

  let cachedPostData = null;
  let cachedPostUrl = null;

  // Clear cached post data when URL changes (SPA navigation)
  function clearCacheIfUrlChanged() {
    const currentUrl = window.location.href;
    if (cachedPostUrl && currentUrl !== cachedPostUrl) {
      console.log('[IG DL V2] 🔄 URL changed, clearing cached post data');
      console.log('[IG DL V2]   Old:', cachedPostUrl);
      console.log('[IG DL V2]   New:', currentUrl);
      cachedPostData = null;
      cachedPostUrl = null;
    }
  }

  // Hook into history API to detect SPA navigation
  const originalPushState = history.pushState;
  history.pushState = function() {
    originalPushState.apply(this, arguments);
    console.log('[IG DL V2] 🔄 pushState detected, clearing cache');
    cachedPostData = null;
    cachedPostUrl = null;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function() {
    originalReplaceState.apply(this, arguments);
    console.log('[IG DL V2] 🔄 replaceState detected, clearing cache');
    cachedPostData = null;
    cachedPostUrl = null;
  };

  window.addEventListener('popstate', () => {
    console.log('[IG DL V2] 🔄 popstate detected, clearing cache');
    cachedPostData = null;
    cachedPostUrl = null;
  });

  // Adaptive rate limiting state
  let rateLimitState = {
    graphqlMultiplier: 1,
    commentApiMultiplier: 1,
    replyApiMultiplier: 1,
    last429Time: null
  };

  // Helper to get adaptive delay (increases after 429 errors)
  function getAdaptiveDelay(rateLimitType) {
    const baseDelay = CONFIG.getRandomDelay(rateLimitType);
    const multiplier = rateLimitState[rateLimitType + 'Multiplier'] || 1;
    return baseDelay * multiplier;
  }

  // Helper to record 429 error and increase delays
  function record429Error(rateLimitType) {
    console.warn('[IG DL V2] 🚫 Rate limit detected (429). Adaptive delays activated...');
    rateLimitState.last429Time = Date.now();

    // Increase delay multiplier for this endpoint type
    const multiplierKey = rateLimitType + 'Multiplier';
    rateLimitState[multiplierKey] = Math.min((rateLimitState[multiplierKey] || 1) * CONFIG.RATE_LIMITS[rateLimitType].backoffMultiplier, 4);

    console.log('[IG DL V2] 📊 Adaptive multiplier for', rateLimitType, ':', rateLimitState[multiplierKey] + 'x');
  }

  // Helper function to fetch with timeout using AbortController
  async function fetchWithTimeout(url, options = {}, timeout = CONFIG.API.FETCH_TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  // ============================================================
  // MODERN COMMENT FETCH SUPPORT (V8.3.7)
  // Passively learn Instagram's live comment doc_id + auth tokens from the page's
  // own requests (modeled on profile-scraper.js), then replay them. Always falls
  // back to the REST /comments/ endpoint below, so this can only help.
  // ============================================================
  const igNet = {
    docId: (CONFIG.API && CONFIG.API.GRAPHQL_DOC_ID_FALLBACK) || null,
    wwwClaim: null,
    lastCommentVariables: null,
    sawCommentRequest: false
  };

  function getCookie(name) {
    const safe = name.replace(/[.$?*|{}()\[\]\\\/+^]/g, '\\$&');
    const m = document.cookie.match(new RegExp('(?:^|; )' + safe + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getCsrfToken() {
    return getCookie('csrftoken') || '';
  }

  // Headers Instagram's modern web app sends. X-CSRFToken comes from the csrftoken
  // cookie; X-IG-WWW-Claim is echoed by IG responses (captured live, '0' until then).
  function buildAuthHeaders(extra = {}) {
    const headers = Object.assign({}, CONFIG.API.HEADERS, extra);
    const csrf = getCsrfToken();
    if (csrf) headers['X-CSRFToken'] = csrf;
    headers['X-IG-WWW-Claim'] = igNet.wwwClaim || '0';
    return headers;
  }

  function looksLikeCommentRequest(url, body) {
    if (!url) return false;
    const u = String(url);
    if (u.includes('/api/v1/media/') && u.includes('/comments')) return true;
    if (u.includes('/graphql/query') || u.includes('/api/graphql')) {
      const b = body ? String(body) : '';
      return /comment/i.test(b) || /comment/i.test(u);
    }
    return false;
  }

  function captureFromGraphqlBody(url, body) {
    try {
      const text = (body != null && typeof body === 'string') ? body : '';
      let m = text.match(/(?:^|&)doc_id=(\d+)/);
      if (!m && url) m = String(url).match(/[?&]doc_id=(\d+)/);
      if (m) igNet.docId = m[1];
      const vm = text.match(/(?:^|&)variables=([^&]+)/);
      if (vm) {
        try { igNet.lastCommentVariables = JSON.parse(decodeURIComponent(vm[1])); } catch (e) {}
      }
    } catch (e) {}
  }

  // Install passive fetch + XHR interceptors. Defensive chaining: profile-scraper.js
  // also wraps these, so we capture and call through whatever is already installed.
  (function installCommentInterceptor() {
    try {
      const prevFetch = window.fetch;
      window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        const body = args[1]?.body;
        const response = await prevFetch.apply(this, args);
        try {
          const claim = response.headers && response.headers.get && response.headers.get('x-ig-set-www-claim');
          if (claim) igNet.wwwClaim = claim;
          if (looksLikeCommentRequest(url, body)) {
            igNet.sawCommentRequest = true;
            captureFromGraphqlBody(url, body);
          }
        } catch (e) {}
        return response;
      };
    } catch (e) { console.warn('[IG DL v7] fetch interceptor install failed:', e?.message); }

    try {
      const prevOpen = XMLHttpRequest.prototype.open;
      const prevSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) {
        this.__igUrl = url;
        return prevOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(body) {
        try {
          this.addEventListener('loadend', () => {
            try {
              const claim = this.getResponseHeader && this.getResponseHeader('x-ig-set-www-claim');
              if (claim) igNet.wwwClaim = claim;
              if (looksLikeCommentRequest(this.__igUrl, body)) {
                igNet.sawCommentRequest = true;
                captureFromGraphqlBody(this.__igUrl, body);
              }
            } catch (e) {}
          });
        } catch (e) {}
        return prevSend.apply(this, arguments);
      };
    } catch (e) { console.warn('[IG DL v7] XHR interceptor install failed:', e?.message); }
  })();

  // Best-effort nudge so the page issues a comments request we can learn the doc_id from.
  // Scroll-only (no clicking) to avoid disturbing the page; safe no-op if it fails.
  async function ensureDocIdCaptured() {
    if (igNet.docId) return;
    try { window.scrollTo(0, document.body.scrollHeight); } catch (e) {}
    await new Promise(r => setTimeout(r, 1500));
  }

  // Map a thrown error / status to an internal errorType.
  function classifyErrorType(error) {
    const m = (error && error.message) || '';
    if (m.includes('account_block:feedback_required') || /feedback_required|challenge_required/i.test(m)) return 'feedback_required';
    if (m.includes('account_block:auth') || m.includes('401')) return 'auth';
    if (m.includes('429') || m.includes('403') || /rate limit/i.test(m) || m.includes('HTML instead of JSON')) return 'rate_limit';
    if (/timeout/i.test(m)) return 'timeout';
    if (/network|failed to fetch/i.test(m)) return 'network';
    return 'unknown';
  }

  // Inspect a non-OK response body for account-level blocks (hard-stop conditions).
  async function detectBlockFromResponse(response) {
    try {
      const txt = await response.clone().text();
      if (/feedback_required|challenge_required|spam/i.test(txt)) return 'feedback_required';
      if (/login_required|not[_ ]?logged|checkpoint_required/i.test(txt)) return 'auth';
    } catch (e) {}
    return null;
  }

  // Normalize a comment node (GraphQL or REST shape) to our internal format.
  function normalizeComment(node) {
    const owner = node.owner || node.user || {};
    return {
      id: node.pk || node.id,
      text: node.text || '',
      created_at: node.created_at || node.created_at_utc || 0,
      owner: {
        id: owner.id || owner.pk,
        username: owner.username,
        profile_pic_url: owner.profile_pic_url
      },
      like_count: node.comment_like_count || node.edge_liked_by?.count || node.like_count || 0,
      child_comment_count: node.child_comment_count || node.edge_threaded_comments?.count || 0,
      replies: []
    };
  }

  // Find a comments connection object anywhere in a GraphQL response (schema-tolerant).
  function findCommentConnection(json) {
    const data = (json && json.data) || json;
    if (!data || typeof data !== 'object') return null;
    const isConn = (v) => v && typeof v === 'object' && (Array.isArray(v.edges) || Array.isArray(v.comments));
    for (const k of Object.keys(data)) {
      if (/comment/i.test(k) && isConn(data[k])) return data[k];
    }
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (v && typeof v === 'object') {
        for (const k2 of Object.keys(v)) {
          if (/comment/i.test(k2) && isConn(v[k2])) return v[k2];
        }
      }
    }
    return null;
  }

  // Modern comment fetch using the live-captured doc_id. Best-effort; never throws.
  async function fetchCommentsModern(mediaId, expectedTotal = null) {
    const result = { comments: [], partial: true, errorType: null, resumeCursor: null, source: 'none' };
    if (!igNet.docId || !igNet.lastCommentVariables) {
      console.log('[IG DL v7] Modern fetch skipped (no live doc_id captured yet)');
      return result;
    }
    console.log('[IG DL v7] 🆕 Modern comment fetch using doc_id', igNet.docId);
    try {
      const seen = new Set();
      let cursor = null;
      let hasNext = true;
      let req = 0;
      const maxReq = CONFIG.API.MAX_GRAPHQL_REQUESTS;
      const hardCap = CONFIG.API.MAX_COMMENT_FETCH || Infinity;
      result.source = 'intercept';

      while (hasNext && req < maxReq && result.comments.length < hardCap) {
        req++;
        const variables = Object.assign({}, igNet.lastCommentVariables, { media_id: String(mediaId) });
        if (cursor) variables.after = cursor;
        const bodyParams = new URLSearchParams();
        bodyParams.set('doc_id', igNet.docId);
        bodyParams.set('variables', JSON.stringify(variables));
        bodyParams.set('server_timestamps', 'true');

        const response = await fetchWithTimeout(`${CONFIG.API.BASE_URL}/graphql/query/`, {
          method: 'POST',
          credentials: 'include',
          headers: buildAuthHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
          body: bodyParams.toString()
        });

        if (!response.ok) {
          if (response.status === 429 || response.status === 403) { record429Error('graphql'); result.errorType = 'rate_limit'; }
          console.warn('[IG DL v7] Modern fetch HTTP', response.status, '- falling back to REST');
          break;
        }
        const json = await response.json();
        const conn = findCommentConnection(json);
        if (!conn) { console.warn('[IG DL v7] Modern fetch: no comment connection in response'); break; }
        const edges = conn.edges || conn.comments || [];
        for (const edge of edges) {
          const node = edge.node || edge;
          const id = node.pk || node.id;
          if (id == null || seen.has(String(id))) continue;
          seen.add(String(id));
          result.comments.push(normalizeComment(node));
        }
        const pageInfo = conn.page_info || conn.pageInfo || {};
        hasNext = !!pageInfo.has_next_page;
        cursor = pageInfo.end_cursor || null;
        sendProgress(expectedTotal
          ? `💬 Fetching comments: ${result.comments.length}/${expectedTotal}...`
          : `💬 Fetched ${result.comments.length} comments so far...`);
        if (hasNext && cursor) {
          await new Promise(r => setTimeout(r, getAdaptiveDelay('graphql')));
        } else {
          hasNext = false;
        }
      }
      result.partial = expectedTotal ? result.comments.length < expectedTotal : false;
      result.resumeCursor = cursor;
      console.log('[IG DL v7] 🆕 Modern fetch collected', result.comments.length, 'comments');
    } catch (e) {
      console.warn('[IG DL v7] Modern fetch error (will fall back):', e?.message);
      result.errorType = classifyErrorType(e);
    }
    return result;
  }

  // Helper function to get actionable error message based on error type
  function getActionableError(error, context = '') {
    const errorMsg = error.message || error.toString();

    // Account-level block (action blocked) - hard stop, do not retry
    if (/feedback_required|challenge_required|account_block/i.test(errorMsg)) {
      return {
        error: 'Instagram flagged automated activity (action blocked).',
        type: 'feedback_required',
        guidance: 'Stop and wait several hours before extracting again. Avoid re-running on this account.'
      };
    }

    // Rate limiting detection
    if (error.status === 429 || errorMsg.includes('429') || errorMsg.includes('rate limit') || errorMsg.includes('HTML instead of JSON')) {
      return {
        error: CONFIG.MESSAGES.ERRORS.RATE_LIMITED,
        type: 'rate_limit',
        guidance: 'Wait 5-10 minutes, then try again. Consider using fewer requests or enabling "Skip Replies" mode.'
      };
    }

    // Session/authentication errors
    if (error.status === 401 || error.status === 403 || errorMsg.includes('401') || errorMsg.includes('403')) {
      return {
        error: CONFIG.MESSAGES.ERRORS.SESSION_EXPIRED,
        type: 'auth',
        guidance: 'Refresh the Instagram page and log back in, then try extracting again.'
      };
    }

    // Timeout errors
    if (errorMsg.includes('timeout') || errorMsg.includes('Timeout')) {
      return {
        error: `Request timed out after ${CONFIG.API.FETCH_TIMEOUT/1000}s`,
        type: 'timeout',
        guidance: 'Your connection may be slow. Try refreshing the page and extracting again.'
      };
    }

    // Network errors
    if (errorMsg.includes('network') || errorMsg.includes('Failed to fetch') || error.name === 'NetworkError') {
      return {
        error: CONFIG.MESSAGES.ERRORS.NETWORK_ERROR,
        type: 'network',
        guidance: 'Check your internet connection and try again.'
      };
    }

    // Generic error with context
    return {
      error: `${context ? context + ': ' : ''}${errorMsg}`,
      type: 'unknown',
      guidance: 'Try refreshing the page. If the problem persists, the post may have restricted access.'
    };
  }

  // Helper function to extract owner info from various possible paths
  function getOwnerInfo(post) {
    // Try multiple possible paths where Instagram might store owner info
    // IMPORTANT: Prioritize sources that have username field
    const ownerSources = [
      post.user,                      // NEW: Instagram moved user data here (as of Nov 2024)
      post.owner,                     // OLD: Used to have user data, now just has id
      post.caption?.user,             // Sometimes nested in caption
      post.coauthor_producers?.[0],  // For collaborative posts
    ];

    // DEBUG: Log user/owner object to see if media_count is available
    if (post.user) {
      console.log('[IG DL v7] 🔍 post.user keys:', Object.keys(post.user));
      console.log('[IG DL v7] 🔍 post.user.media_count:', post.user.media_count);
      console.log('[IG DL v7] 🔍 post.user.edge_owner_to_timeline_media:', post.user.edge_owner_to_timeline_media);
    }
    if (post.owner) {
      console.log('[IG DL v7] 🔍 post.owner keys:', Object.keys(post.owner));
      console.log('[IG DL v7] 🔍 post.owner.media_count:', post.owner.media_count);
      console.log('[IG DL v7] 🔍 post.owner.edge_owner_to_timeline_media:', post.owner.edge_owner_to_timeline_media);
    }

    // Find the first source that has username (most important field)
    const owner = ownerSources.find(source => source && source.username);

    if (owner) {
      console.log('[IG DL v7] 🔍 Found owner info from:', owner);
      return {
        username: owner.username,
        full_name: owner.full_name || owner.name || '',
        user_id: owner.pk || owner.id || '',
        profile_pic_url: owner.profile_pic_url || owner.profile_picture || owner.hd_profile_pic_url_info?.url || ''
      };
    }

    // Fallback: try to extract from URL or page DOM
    console.warn('[IG DL v7] ⚠️ Could not find owner info in post data. Trying fallback methods...');

    let username = 'unknown';
    let profilePicUrl = '';

    // Method 1: Try to extract username from page DOM
    try {
      // Try to find the username link in the header
      const usernameLink = document.querySelector('header a[role="link"]');
      if (usernameLink && usernameLink.href) {
        const match = usernameLink.href.match(/instagram\.com\/([^\/\?]+)/);
        if (match) {
          username = match[1];
          console.log('[IG DL v7] 🔍 Found username from DOM:', username);
        }
      }

      // Try to find profile picture
      const headerImg = document.querySelector('header img');
      if (headerImg && headerImg.src) {
        profilePicUrl = headerImg.src;
        console.log('[IG DL v7] 🔍 Found profile pic from DOM:', profilePicUrl);
      }
    } catch (e) {
      console.warn('[IG DL v7] Could not scrape from DOM:', e.message);
    }

    // Method 2: Fall back to URL if DOM scraping failed
    if (username === 'unknown') {
      const urlMatch = window.location.pathname.match(/^\/([^\/]+)\//);
      username = urlMatch ? urlMatch[1] : 'unknown';
      console.log('[IG DL v7] 🔍 Using username from URL:', username);
    }

    return {
      username: username,
      full_name: '',
      user_id: '',
      profile_pic_url: profilePicUrl
    };
  }

  // Helper function to extract collaborator/coauthor usernames
  function getCollaborators(post, primaryUsername) {
    const collaborators = [];

    // DEBUG: Log all keys that might contain collaborator info
    const collabKeys = Object.keys(post).filter(k =>
      k.toLowerCase().includes('coauthor') ||
      k.toLowerCase().includes('collab') ||
      k.toLowerCase().includes('creator') ||
      k.toLowerCase().includes('sponsor')
    );
    if (collabKeys.length > 0) {
      console.log('[IG DL v7] 🔍 Potential collaborator fields found:', collabKeys);
      collabKeys.forEach(key => {
        console.log('[IG DL v7] 🔍', key, ':', JSON.stringify(post[key])?.substring(0, 200));
      });
    }

    // Check coauthor_producers (Instagram's collaboration feature)
    if (post.coauthor_producers && Array.isArray(post.coauthor_producers)) {
      console.log('[IG DL v7] 👥 Found coauthor_producers:', post.coauthor_producers.length);
      for (const coauthor of post.coauthor_producers) {
        if (coauthor.username && coauthor.username !== primaryUsername) {
          collaborators.push(coauthor.username);
        }
      }
    }

    // Also check invited_coauthor_producers (pending collaborations)
    if (post.invited_coauthor_producers && Array.isArray(post.invited_coauthor_producers)) {
      console.log('[IG DL v7] 👥 Found invited_coauthor_producers:', post.invited_coauthor_producers.length);
      for (const coauthor of post.invited_coauthor_producers) {
        if (coauthor.username && coauthor.username !== primaryUsername && !collaborators.includes(coauthor.username)) {
          collaborators.push(coauthor.username);
        }
      }
    }

    // Check for sponsor_tags (branded content / paid partnerships)
    if (post.sponsor_tags && Array.isArray(post.sponsor_tags)) {
      console.log('[IG DL v7] 👥 Found sponsor_tags:', post.sponsor_tags.length);
      for (const sponsor of post.sponsor_tags) {
        const sponsorUsername = sponsor.sponsor?.username || sponsor.username;
        if (sponsorUsername && sponsorUsername !== primaryUsername && !collaborators.includes(sponsorUsername)) {
          collaborators.push(sponsorUsername);
        }
      }
    }

    // Check for usertags (tagged users in the post)
    if (post.usertags && post.usertags.in && Array.isArray(post.usertags.in)) {
      console.log('[IG DL v7] 👥 Found usertags:', post.usertags.in.length);
      for (const tag of post.usertags.in) {
        const taggedUsername = tag.user?.username;
        if (taggedUsername && taggedUsername !== primaryUsername && !collaborators.includes(taggedUsername)) {
          // Only add as collaborator if they appear in multiple places or it's a collab post
          // For now, we'll skip usertags as they're different from true collaborators
        }
      }
    }

    console.log('[IG DL v7] 👥 Collaborators found:', collaborators.length > 0 ? collaborators : 'none');
    return collaborators;
  }

  // Helper function to build post metadata object
  // Consolidates duplicate code from extractComments() and extractMedia()
  function buildPostInfo(post) {
    const urlType = window.location.href.includes('/reel/') ? 'reel' : 'p';
    const ownerInfo = getOwnerInfo(post);
    const collaborators = getCollaborators(post, ownerInfo.username);

    return {
      username: ownerInfo.username,
      full_name: ownerInfo.full_name,
      user_id: ownerInfo.user_id,
      profile_pic_url: ownerInfo.profile_pic_url,
      collaborators: collaborators,  // Array of collaborator usernames
      post_url: `https://www.instagram.com/${urlType}/` + post.code,
      post_type: urlType === 'reel' ? 'reel' : 'post',
      shortcode: post.code,
      caption: post.caption?.text || '',
      like_count: post.like_count || 0,
      comment_count: post.comment_count || 0,
      posted_at: post.taken_at ? new Date(post.taken_at * 1000).toISOString() : '',
      posted_at_timestamp: post.taken_at || 0,
      media_type: post.media_type === 2 ? 'Video' : post.media_type === 8 ? 'Carousel' : 'Image',
      is_video: post.media_type === 2
    };
  }

  // Parse post data from script tags
  function parsePostDataFromScripts() {
    try {
      const url = window.location.href;
      const shortcodeMatch = url.match(/\/(p|reel)\/([^\/\?]+)/);

      if (!shortcodeMatch) {
        return { error: 'Not on a post or reel page' };
      }

      const contentType = shortcodeMatch[1]; // 'p' or 'reel'
      const shortcode = shortcodeMatch[2];

      const scripts = document.querySelectorAll('script[type="application/json"]');

      for (let i = 0; i < scripts.length; i++) {
        const script = scripts[i];
        const content = script.textContent;

        if (!content.includes(shortcode)) continue;

        try {
          const data = JSON.parse(content);

          if (data.require && Array.isArray(data.require)) {
            for (const requireItem of data.require) {
              if (!Array.isArray(requireItem) || requireItem.length < 4) continue;

              const bbox = requireItem[3];
              if (!bbox || !Array.isArray(bbox) || !bbox[0] || !bbox[0].__bbox) continue;

              const bboxRequire = bbox[0].__bbox.require;
              if (!bboxRequire || !Array.isArray(bboxRequire)) continue;

              for (const cacheItem of bboxRequire) {
                if (!Array.isArray(cacheItem) || cacheItem[0] !== 'RelayPrefetchedStreamCache') continue;

                const cacheData = cacheItem[3];
                if (!cacheData || !Array.isArray(cacheData) || cacheData.length < 2) continue;

                const cacheEntry = cacheData[1];
                if (!cacheEntry || !cacheEntry.__bbox || !cacheEntry.__bbox.result) continue;

                const resultData = cacheEntry.__bbox.result.data;
                if (!resultData) continue;

                const mediaInfo = resultData.xdt_api__v1__media__shortcode__web_info;
                if (mediaInfo && mediaInfo.items && mediaInfo.items.length > 0) {
                  const post = mediaInfo.items[0];

                  if (post.code === shortcode) {
                    console.log('[IG DL V2] ✅ Found post data!');

                    // DEBUG: Log the full post structure to see what fields are available
                    console.log('[IG DL V2] 🔍 DEBUG - Post object keys:', Object.keys(post));
                    console.log('[IG DL V2] 🔍 DEBUG - Owner object:', post.owner);
                    console.log('[IG DL V2] 🔍 DEBUG - User object:', post.user);

                    // Check alternative owner fields
                    if (post.owner) {
                      console.log('[IG DL V2] 🔍 DEBUG - Owner keys:', Object.keys(post.owner));
                    }
                    if (post.user) {
                      console.log('[IG DL V2] 🔍 DEBUG - User keys:', Object.keys(post.user));
                    }

                    cachedPostData = post;
                    cachedPostUrl = window.location.href;
                    window.__foundPost = post;
                    return { shortcode, post, method: 'script-tag-parsing' };
                  }
                }
              }
            }
          }

        } catch (parseError) {
          continue;
        }
      }

      return { error: 'Post data not found' };

    } catch (error) {
      console.error('[IG DL v7] Error:', error);
      return { error: error.message };
    }
  }

  // Extract post data
  async function extractPostData() {
    // Check if URL changed since we cached (SPA navigation)
    clearCacheIfUrlChanged();

    if (cachedPostData) {
      const url = window.location.href;
      const shortcodeMatch = url.match(/\/(p|reel)\/([^\/\?]+)/);
      const shortcode = shortcodeMatch ? shortcodeMatch[2] : '';
      return { shortcode, post: cachedPostData, method: 'cached' };
    }

    return parsePostDataFromScripts();
  }

  // Fetch comments via GraphQL endpoint (fallback method)
  async function fetchCommentsViaGraphQL(shortcode, expectedTotal = null) {
    console.log('[IG DL v7] 🔄 Trying GraphQL fallback method...');
    console.log('[IG DL v7] Shortcode:', shortcode);
    sendProgress('🔄 Fetching comments via GraphQL...');

    try {
      const allComments = [];
      let hasNextPage = true;
      let endCursor = null;
      let requestCount = 0;
      const maxRequests = CONFIG.API.MAX_GRAPHQL_REQUESTS;

      while (hasNextPage && requestCount < maxRequests) {
        requestCount++;

        const variables = {
          shortcode: shortcode,
          first: CONFIG.API.COMMENTS_PER_PAGE,
          after: endCursor
        };

        const url = `${CONFIG.API.BASE_URL}${CONFIG.API.GRAPHQL_ENDPOINT}?query_hash=${CONFIG.API.GRAPHQL_QUERY_HASH}&variables=${encodeURIComponent(JSON.stringify(variables))}`;
        console.log('[IG DL v7] GraphQL Request', requestCount, '...');

        const response = await fetchWithTimeout(url, {
          method: 'GET',
          credentials: 'include',
          headers: buildAuthHeaders()
        });

        if (!response.ok) {
          if (response.status === 429) {
            record429Error('graphql');
          }
          console.error('[IG DL v7] GraphQL HTTP Error:', response.status);
          throw new Error(`GraphQL HTTP ${response.status}`);
        }

        const data = await response.json();
        const media = data?.data?.shortcode_media;

        if (!media || !media.edge_media_to_comment) {
          console.warn('[IG DL v7] GraphQL: No comment data in response');
          break;
        }

        const edges = media.edge_media_to_comment.edges || [];
        const pageInfo = media.edge_media_to_comment.page_info;

        console.log('[IG DL v7] GraphQL: Got', edges.length, 'comments. Total:', allComments.length + edges.length);

        // Send progress update
        const newTotal = allComments.length + edges.length;
        const progressMsg = expectedTotal
          ? `💬 Fetching comments: ${newTotal}/${expectedTotal}...`
          : `💬 Fetched ${newTotal} comments so far...`;
        sendProgress(progressMsg);

        // Convert GraphQL format to our format
        for (const edge of edges) {
          const node = edge.node;

          // Debug: Check if this is a reply or parent comment
          const isReply = node.did_report_as_spam !== undefined ? false : null; // GraphQL doesn't clearly indicate parent vs reply

          allComments.push({
            id: node.id,
            text: node.text || '',
            created_at: node.created_at || 0,
            owner: {
              id: node.owner?.id,
              username: node.owner?.username,
              profile_pic_url: node.owner?.profile_pic_url
            },
            like_count: node.edge_liked_by?.count || 0,
            child_comment_count: node.edge_threaded_comments?.count || 0,
            replies: [] // Would need separate query for replies
          });
        }

        console.log('[IG DL v7] GraphQL batch sample:', {
          total: edges.length,
          first_comment: edges[0]?.node?.text?.substring(0, 30),
          has_child_counts: edges.filter(e => e.node.edge_threaded_comments?.count > 0).length
        });

        hasNextPage = pageInfo?.has_next_page || false;
        endCursor = pageInfo?.end_cursor || null;

        if (hasNextPage && endCursor) {
          console.log('[IG DL v7] GraphQL: More pages available');
          const delay = getAdaptiveDelay('graphql');
          console.log('[IG DL v7] Using adaptive delay:', delay, 'ms');
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.log('[IG DL v7] GraphQL: No more pages');
          break;
        }
      }

      console.log('[IG DL v7] ✅ GraphQL fetched', allComments.length, 'comments');
      sendProgress(`✅ Fetched all ${allComments.length} comments successfully!`);
      return allComments;

    } catch (error) {
      console.error('[IG DL v7] GraphQL method failed:', error);
      sendProgress(`❌ Error fetching comments: ${error.message}`);
      throw error;
    }
  }

  // Fetch child comments (replies) for a parent comment
  async function fetchChildComments(mediaId, commentId) {
    try {
      const allReplies = [];
      let hasMore = true;
      let minId = null;
      let requestCount = 0;
      let isRateLimited = false;
      const maxRequests = CONFIG.API.MAX_CHILD_COMMENT_REQUESTS;

      while (hasMore && requestCount < maxRequests) {
        requestCount++;

        // Build URL with pagination
        let url = `${CONFIG.API.BASE_URL}/api/v1/media/${mediaId}/comments/${commentId}/child_comments/`;
        if (minId) {
          url += `?min_id=${minId}`;
        }

        // RETRY LOGIC: Try up to 3 times with exponential backoff
        let data = null;
        let retryCount = 0;
        const maxRetries = CONFIG.API.MAX_RETRIES;

        while (retryCount < maxRetries) {
          try {
            const response = await fetchWithTimeout(url, {
              method: 'GET',
              credentials: 'include',
              headers: buildAuthHeaders()
            });

            if (!response.ok) {
              // Record rate limit and increase delays
              if (response.status === 429) {
                record429Error('commentApi');
                isRateLimited = true;
              }
              // Rate limit or server error - retry with backoff
              if (response.status === 429 || response.status >= 500) {
                throw new Error(`HTTP ${response.status}: ${response.statusText} (retryable)`);
              }
              console.warn('[IG DL v7] ⚠️ Child comment fetch failed:', response.status, response.statusText);
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // Check content type before parsing
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
              console.warn('[IG DL v7] ⚠️ Got HTML instead of JSON for child comments (likely rate limited)');
              console.warn('[IG DL v7] Content-Type:', contentType);
              throw new Error('Rate limited - got HTML instead of JSON (retryable)');
            }

            data = await response.json();
            break; // Success, exit retry loop

          } catch (error) {
            retryCount++;

            if (retryCount >= maxRetries) {
              console.warn('[IG DL v7] ⚠️ Failed to fetch child comments after', maxRetries, 'retries');
              console.warn('[IG DL v7] Skipping replies for comment', commentId);
              return []; // Return empty, don't break entire process
            }

            // Exponential backoff using CONFIG
            const backoffDelay = Math.pow(CONFIG.API.RETRY_BACKOFF_MULTIPLIER, retryCount) * CONFIG.API.RETRY_BACKOFF_BASE;
            console.warn('[IG DL v7] ⚠️ Child comment request failed, retrying in', backoffDelay, 'ms (attempt', retryCount + 1, '/', maxRetries, ')');
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
          }
        }

        if (!data || !data.child_comments || !Array.isArray(data.child_comments)) {
          console.warn('[IG DL v7] ⚠️ No child_comments array in response for comment', commentId);
          break;
        }

        // Add replies from this page
        for (const reply of data.child_comments) {
          allReplies.push({
            id: reply.pk || reply.id,
            text: reply.text || '',
            created_at: reply.created_at || reply.created_at_utc || 0,
            owner: {
              id: reply.user?.pk,
              username: reply.user?.username,
              profile_pic_url: reply.user?.profile_pic_url
            },
            like_count: reply.comment_like_count || 0,
            replies: [] // Replies to replies not typically supported by Instagram
          });
        }

        // Check if there are more replies to fetch
        if (data.has_more_tail_child_comments && data.next_min_id) {
          minId = data.next_min_id;
          // Delay to avoid rate limiting using CONFIG
          const delay = CONFIG.getRandomDelay('replyPagination');
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          hasMore = false;
        }
      }

      return allReplies;

    } catch (error) {
      console.error('[IG DL v7] ❌ Error fetching child comments:', error.message);
      return []; // Return empty array on error, don't break the whole process
    }
  }

  // Fetch comments using direct API call (tested and working!)
  async function fetchCommentsViaAPI(mediaId, expectedTotal = null, skipReplies = false) {
    console.log('[IG DL v7] 🚀 fetchCommentsViaAPI() called with mediaId:', mediaId);
    if (expectedTotal) {
      console.log('[IG DL v7] Expected total comments (from post):', expectedTotal);
    }
    if (skipReplies) {
      console.log('[IG DL v7] ⚡ SKIP REPLIES MODE - Will only fetch parent comments to avoid rate limiting');
    }

    const allComments = [];
    let totalReplies = 0;
    let hasMore = true;
    let maxId = null;
    let requestCount = 0;
    const maxRequests = CONFIG.API.MAX_API_REQUESTS;
    const hardCap = CONFIG.API.MAX_COMMENT_FETCH || Infinity;
    let consecutiveEmptyResponses = 0;
    let isRateLimited = false;
    let aborted = false;       // stopped early due to an error (block or exhausted retries)
    let abortType = null;      // errorType describing why we aborted

    try {
      console.log('[IG DL v7] Fetching comments via direct API call...');

      // Fetch main comments with pagination
      while (hasMore && requestCount < maxRequests && allComments.length < hardCap) {
        requestCount++;

        // Build URL with pagination
        let url = `${CONFIG.API.BASE_URL}/api/v1/media/${mediaId}/comments/?can_support_threading=true&permalink_enabled=false`;
        if (maxId) {
          url += `&max_id=${maxId}`;
        }

        console.log('[IG DL v7] Request', requestCount, '- Fetching main comments from:', url);

        // RETRY LOGIC: Try up to 3 times with exponential backoff
        let data = null;
        let retryCount = 0;
        const maxRetries = CONFIG.API.MAX_RETRIES;

        while (retryCount < maxRetries) {
          try {
            const response = await fetchWithTimeout(url, {
              method: 'GET',
              credentials: 'include',
              headers: buildAuthHeaders()
            });

            if (!response.ok) {
              // Account-level blocks are hard-stops (retrying escalates them)
              const blockType = await detectBlockFromResponse(response);
              if (blockType === 'feedback_required') {
                abortType = 'feedback_required';
                throw new Error('account_block:feedback_required');
              }
              if (blockType === 'auth' || response.status === 401) {
                abortType = 'auth';
                throw new Error('account_block:auth');
              }
              // 429/403 = rate limit (retryable with backoff)
              if (response.status === 429 || response.status === 403) {
                record429Error('commentApi');
                isRateLimited = true;
                throw new Error(`HTTP ${response.status} (retryable rate limit)`);
              }
              // Server error - retry with backoff
              if (response.status >= 500) {
                throw new Error(`HTTP ${response.status}: ${response.statusText} (retryable)`);
              }
              // Other client error - don't retry
              console.error('[IG DL v7] ❌ HTTP Error:', response.status, response.statusText);
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            data = await response.json();
            break; // Success, exit retry loop

          } catch (error) {
            // Account-level block: abort immediately, keep what we collected
            if (error.message && error.message.startsWith('account_block:')) {
              console.error('[IG DL v7] 🛑 Account-level block detected:', error.message);
              aborted = true;
              break;
            }

            retryCount++;

            // Check if this is a rate limit error
            if (error.message && (error.message.includes('rate limited') || error.message.includes('HTML instead of JSON') || error.message.includes('429') || error.message.includes('403'))) {
              isRateLimited = true;
              console.error('[IG DL v7] 🚫 RATE LIMITED by Instagram!');
            }

            if (retryCount >= maxRetries) {
              console.error('[IG DL v7] ❌ Failed after', maxRetries, 'retries:', error.message);
              aborted = true;
              abortType = isRateLimited ? 'rate_limit' : classifyErrorType(error);
              break;
            }

            // Exponential backoff using CONFIG
            const backoffDelay = Math.pow(CONFIG.API.RETRY_BACKOFF_MULTIPLIER, retryCount) * CONFIG.API.RETRY_BACKOFF_BASE;
            console.warn('[IG DL v7] ⚠️ Request failed, retrying in', backoffDelay, 'ms (attempt', retryCount + 1, '/', maxRetries, ')');
            console.warn('[IG DL v7] Error:', error.message);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
          }
        }

        // If the retry loop aborted (hard block or exhausted retries), stop paginating but KEEP what we have
        if (aborted) {
          console.warn('[IG DL v7] ⚠️ Stopping pagination early; keeping', allComments.length, 'comments collected so far');
          break;
        }

        // DETAILED DEBUGGING: Log API response structure
        console.log('[IG DL v7] 📊 API Response Details:');
        console.log('  - Comments in this batch:', data.comments?.length || 0);
        console.log('  - has_more_comments:', data.has_more_comments);
        console.log('  - next_max_id:', data.next_max_id || 'null');
        console.log('  - comment_count (from API):', data.comment_count || 'not provided');
        console.log('  - Status:', data.status);

        if (!data.comments || !Array.isArray(data.comments)) {
          console.warn('[IG DL v7] ⚠️ No comments array in response. Data structure:', Object.keys(data));
          console.warn('[IG DL v7] Full response:', data);
          consecutiveEmptyResponses++;

          // If we get multiple empty responses in a row, stop
          if (consecutiveEmptyResponses >= 3) {
            console.error('[IG DL v7] ❌ Got 3 consecutive empty responses, stopping pagination');
            break;
          }

          // Otherwise, try to continue if we have next_max_id
          if (data.next_max_id) {
            console.log('[IG DL v7] ⚠️ Trying to continue with next_max_id despite empty response...');
            maxId = data.next_max_id;
            await new Promise(resolve => setTimeout(resolve, 1500)); // Longer delay
            continue;
          } else {
            break;
          }
        }

        // Reset empty response counter if we got data
        consecutiveEmptyResponses = 0;

        // Add comments from this page (temporarily without replies)
        for (const comment of data.comments) {
          allComments.push({
            id: comment.pk || comment.id,
            text: comment.text || '',
            created_at: comment.created_at || comment.created_at_utc || 0,
            owner: {
              id: comment.user?.pk,
              username: comment.user?.username,
              profile_pic_url: comment.user?.profile_pic_url
            },
            like_count: comment.comment_like_count || 0,
            child_comment_count: comment.child_comment_count || 0,
            replies: []
          });
        }

        console.log('[IG DL v7] ✅ Got', data.comments.length, 'main comments in this batch. Total so far:', allComments.length);

        // RELAXED PAGINATION: Try to continue even if Instagram says there's no more
        // This works around Instagram's API bug where has_more_comments is false prematurely
        const shouldContinue = data.next_max_id && (
          data.has_more_comments ||
          (expectedTotal && allComments.length < expectedTotal)
        );

        if (shouldContinue) {
          maxId = data.next_max_id;

          if (!data.has_more_comments && expectedTotal && allComments.length < expectedTotal) {
            console.log('[IG DL v7] ⚠️ Instagram says no more comments, but we haven\'t reached expected total');
            console.log('  - Instagram API has_more_comments:', data.has_more_comments);
            console.log('  - But next_max_id exists:', data.next_max_id);
            console.log('  - Current:', allComments.length, '/ Expected:', expectedTotal);
            console.log('  - 🔄 Trying to fetch more anyway (Instagram API bug workaround)...');
          } else {
            console.log('[IG DL v7] ➡️ More comments available, next_max_id:', maxId);
          }

          // Delay to avoid rate limiting using adaptive delays
          const delay = getAdaptiveDelay('commentApi');
          console.log('[IG DL v7] Waiting', delay, 'ms before next request (adaptive)...');
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          hasMore = false;
          console.log('[IG DL v7] 🛑 Pagination stopped:');
          console.log('  - has_more_comments:', data.has_more_comments);
          console.log('  - next_max_id:', data.next_max_id || 'null');
          console.log('  - Total parent comments fetched:', allComments.length);

          if (expectedTotal && allComments.length < expectedTotal) {
            console.warn('[IG DL v7] ⚠️ WARNING: Stopped pagination but haven\'t reached expected total');
            console.warn('  - Expected:', expectedTotal, '| Fetched:', allComments.length);
            console.warn('  - This is likely Instagram API pagination bug (known since Sept 2024)');
          }
        }
      }

      console.log('[IG DL v7] ✅ Fetched total of', allComments.length, 'main comments');

      // Now fetch replies for each comment that has them
      totalReplies = 0;

      if (skipReplies) {
        console.log('[IG DL v7] ⚡ Skipping reply fetching (skipReplies mode enabled)');
      } else if (isRateLimited) {
        console.log('[IG DL v7] 🚫 Skipping reply fetching (rate limited)');
        console.log('[IG DL v7] You can try extracting again in 5-10 minutes to get replies');
      } else {
        console.log('[IG DL v7] Checking for replies...');

        for (let i = 0; i < allComments.length; i++) {
          const comment = allComments[i];

          if (comment.child_comment_count > 0) {
            console.log(`[IG DL v7] Fetching ${comment.child_comment_count} replies for comment ${i + 1}/${allComments.length}...`);

            const replies = await fetchChildComments(mediaId, comment.id);
            comment.replies = replies;
            totalReplies += replies.length;

            console.log(`[IG DL v7] ✅ Got ${replies.length} replies`);

            // Delay between parent comments to avoid rate limiting using CONFIG
            const delay = CONFIG.getRandomDelay('commentApi');
            console.log(`[IG DL v7] Waiting ${delay}ms before fetching next comment's replies...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      console.log('[IG DL v7] ✅ Fetched total of', totalReplies, 'replies across all comments');

      const grandTotal = allComments.length + totalReplies;
      console.log('[IG DL v7] ✅ Grand total:', allComments.length, 'parent comments +', totalReplies, 'replies =', grandTotal, 'total');

      // VERIFICATION: Compare against post's comment count (if provided)
      if (expectedTotal) {
        console.log('[IG DL v7] 📊 VERIFICATION CHECK:');
        console.log('  - Post shows total:', expectedTotal, 'comments');
        console.log('  - We fetched:', grandTotal, 'comments (parents + replies)');

        if (grandTotal >= expectedTotal) {
          console.log('  - ✅ SUCCESS! We got all', expectedTotal, 'comments');
          console.log('  - Note: Instagram count may include hidden/deleted comments');
        } else {
          const missing = expectedTotal - grandTotal;
          const percentage = Math.round((grandTotal / expectedTotal) * 100);
          console.log('  - ⚠️ INCOMPLETE: Missing', missing, 'comments (' + percentage + '% complete)');
          console.log('  - This may be due to Instagram API pagination bug (known issue since Sept 2024)');
        }
      }

      const reachedExpected = expectedTotal ? grandTotal >= expectedTotal : true;
      return {
        comments: allComments,
        totalReplies,
        partial: aborted || !reachedExpected,
        errorType: aborted ? (abortType || 'unknown') : null,
        resumeCursor: maxId || null
      };

    } catch (error) {
      // NEVER discard: return whatever we accumulated so far
      console.error('[IG DL v7] Error fetching via API (returning partial):', error);
      return {
        comments: allComments,
        totalReplies,
        partial: true,
        errorType: classifyErrorType(error),
        resumeCursor: maxId || null
      };
    }
  }

  // Helper to send progress updates
  function sendProgress(message) {
    window.postMessage({ type: 'EXTRACTION_PROGRESS', message }, window.location.origin);
  }

  // Extract comments
  async function extractComments() {
    console.log('[IG DL V2] 🎯 extractComments() function called!');
    sendProgress('⏳ Starting comment extraction...');

    // Accumulate across all mechanisms, deduped by comment id. We NEVER discard what we
    // collected: even on rate-limit / error we return the partial set with a status flag.
    const accumulated = new Map();
    let post = null;
    let postInfo = null;
    let worstErrorType = null;
    let sawAbort = false;

    const SEVERITY = { feedback_required: 5, auth: 4, rate_limit: 3, timeout: 2, network: 1, unknown: 1 };
    const ERR_TEXT = {
      feedback_required: { error: 'Instagram flagged automated activity (action blocked).', guidance: 'Stop and wait several hours before extracting again. Avoid re-running on this account.' },
      auth: { error: 'Instagram session/login issue.', guidance: 'Refresh Instagram, make sure you are logged in, then try again.' },
      rate_limit: { error: 'Rate limited by Instagram before all comments were fetched.', guidance: 'Partial comments were saved. Wait 5-10 minutes and re-run to collect more.' },
      timeout: { error: 'Timed out before all comments were fetched.', guidance: 'Partial comments were saved. Re-run to collect more.' },
      network: { error: 'Network error during comment fetch.', guidance: 'Partial comments were saved. Check your connection and re-run.' },
      unknown: { error: 'Comment fetch stopped early.', guidance: 'Partial comments were saved. Re-run to try collecting more.' }
    };

    const mergeErr = (t) => { if (t && (!worstErrorType || (SEVERITY[t] || 0) > (SEVERITY[worstErrorType] || 0))) worstErrorType = t; };
    const addAll = (list) => {
      for (const c of (list || [])) {
        const id = c && c.id;
        if (id == null) continue;
        if (!accumulated.has(String(id))) accumulated.set(String(id), c);
      }
    };
    const buildResult = (extra = {}) => {
      const comments = Array.from(accumulated.values());
      const totalReplies = comments.reduce((s, c) => s + (c.replies?.length || 0), 0);
      const totalFetched = comments.length + totalReplies;
      const expected = (post && post.comment_count) || comments.length;
      const partial = extra.forcePartial === true || sawAbort || (expected ? totalFetched < expected : false);
      const errType = extra.errorType || worstErrorType || null;
      const txt = (partial && errType) ? (ERR_TEXT[errType] || { error: null, guidance: null }) : { error: null, guidance: null };
      console.log('[IG DL v7] 📊 extractComments result:', { fetched: totalFetched, expected, partial, source: extra.source || 'mixed', errorType: errType });
      return {
        post_info: postInfo || (post ? buildPostInfo(post) : {}),
        total: expected,
        total_expected: expected,
        total_fetched: totalFetched,
        total_comments: comments.length,
        total_replies: totalReplies,
        comments,
        partial,
        complete: !partial,
        source: extra.source || 'mixed',
        errorType: errType,
        error: txt.error,
        guidance: txt.guidance,
        resumeCursor: extra.resumeCursor || null,
        note: null
      };
    };

    try {
      const postData = await extractPostData();
      if (postData.error) {
        console.error('[IG DL V2] ❌ Error getting post data:', postData.error);
        return postData;
      }
      post = postData.post;
      postInfo = buildPostInfo(post);
      const mediaId = post.pk || post.id;

      console.log('[IG DL v7] Fetching comments for shortcode:', post.code, '| expected:', post.comment_count);
      sendProgress(`📊 Found ${post.comment_count} total comments to fetch...`);

      // Phase 0: best-effort capture of a live doc_id (scroll-only nudge)
      await ensureDocIdCaptured();

      let source = 'none';

      // Phase 1: modern doc_id GraphQL (primary when a live doc_id was captured)
      try {
        const modern = await fetchCommentsModern(mediaId, post.comment_count);
        addAll(modern.comments);
        if (modern.comments.length) source = 'intercept';
        mergeErr(modern.errorType);
      } catch (e) { mergeErr(classifyErrorType(e)); }

      // Phase 1b: legacy GraphQL hash (cheap; usually empty on modern logged-in sessions)
      if (accumulated.size === 0) {
        try {
          const legacy = await fetchCommentsViaGraphQL(post.code, post.comment_count);
          addAll(legacy);
          if (legacy.length) source = (source === 'none') ? 'graphql' : 'mixed';
        } catch (e) { mergeErr(classifyErrorType(e)); }
      }

      // Phase 2: REST top-up when below ~95% of expected (and not hard-blocked)
      const expected = post.comment_count || 0;
      const need = expected ? accumulated.size < expected * 0.95 : accumulated.size === 0;
      if (need && worstErrorType !== 'feedback_required' && worstErrorType !== 'auth') {
        sendProgress(`🔄 Have ${accumulated.size}/${expected}. Fetching more via REST API...`);
        const rest = await fetchCommentsViaAPI(mediaId, expected, true);
        addAll(rest.comments);
        if (rest.comments.length) source = (source === 'none') ? 'rest' : 'mixed';
        if (rest.partial) mergeErr(rest.errorType);
        if (['rate_limit', 'feedback_required', 'auth'].includes(rest.errorType)) sawAbort = true;
        return buildResult({ source, resumeCursor: rest.resumeCursor });
      }

      return buildResult({ source });

    } catch (error) {
      console.error('[IG DL v7] ❌ Error extracting comments:', error);
      mergeErr(classifyErrorType(error));
      // NEVER discard: return whatever we collected before the error
      return buildResult({ forcePartial: true });
    }
  }

  // Extract media
  async function extractMedia() {
    try {
      sendProgress('📸 Extracting media from post...');
      const postData = await extractPostData();
      if (postData.error) return postData;

      const post = postData.post;
      const media = [];

      if (post.carousel_media && Array.isArray(post.carousel_media)) {
        sendProgress(`📸 Found ${post.carousel_media.length} media items in carousel...`);
        for (let i = 0; i < post.carousel_media.length; i++) {
          const item = post.carousel_media[i];
          media.push(extractMediaItem(item));
          sendProgress(`📸 Extracted media ${i + 1}/${post.carousel_media.length}...`);
        }
      } else {
        sendProgress('📸 Extracting single media item...');
        media.push(extractMediaItem(post));
      }

      // Build post metadata using helper function (same as in extractComments)
      const postInfo = buildPostInfo(post);

      sendProgress(`✅ Successfully extracted ${media.length} media items!`);
      return {
        media,
        post_info: postInfo
      };

    } catch (error) {
      sendProgress(`❌ Error extracting media: ${error.message}`);
      return { error: error.message };
    }
  }

  // Extract single media item
  function extractMediaItem(item) {
    const mediaItem = {
      type: item.media_type === 2 ? 'Video' : 'Image',
      id: item.pk || item.id || '',
      shortcode: item.code || ''
    };

    if (item.video_versions && item.video_versions.length > 0) {
      const highestQuality = item.video_versions[0];
      mediaItem.video_url = highestQuality.url;
      mediaItem.width = highestQuality.width;
      mediaItem.height = highestQuality.height;

      if (item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates.length > 0) {
        mediaItem.thumbnail_url = item.image_versions2.candidates[0].url;
      }
    }
    else if (item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates.length > 0) {
      const highestQuality = item.image_versions2.candidates[0];
      mediaItem.image_url = highestQuality.url;
      mediaItem.width = highestQuality.width;
      mediaItem.height = highestQuality.height;
    }

    return mediaItem;
  }

  // Message handler
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;

    if (event.data.type === 'EXTRACT_POST_DATA') {
      console.log('[IG DL v7] 🔔 EXTRACT_POST_DATA message received!');
      const data = await extractPostData();
      console.log('[IG DL v7] 📤 Sending POST_DATA_RESPONSE');
      window.postMessage({ type: 'POST_DATA_RESPONSE', data }, window.location.origin);
    } else if (event.data.type === 'EXTRACT_COMMENTS') {
      console.log('[IG DL v7] 🔔 EXTRACT_COMMENTS message received!');
      const data = await extractComments();
      console.log('[IG DL v7] 📤 Sending COMMENTS_RESPONSE with', data.comments?.length || 0, 'comments');
      window.postMessage({ type: 'COMMENTS_RESPONSE', data }, window.location.origin);
    } else if (event.data.type === 'EXTRACT_MEDIA') {
      console.log('[IG DL v7] 🔔 EXTRACT_MEDIA message received!');
      const data = await extractMedia();
      console.log('[IG DL v7] 📤 Sending MEDIA_RESPONSE');
      window.postMessage({ type: 'MEDIA_RESPONSE', data }, window.location.origin);
    }
  });

  // Initialize
  setTimeout(() => {
    const result = parsePostDataFromScripts();

    if (result.post) {
      console.log('[IG DL V2] ✅ Ready! Post data parsed successfully');
      console.log('[IG DL V2] 📝 Tip: Scroll to comments section before extracting for complete data');
      console.log('[IG DL V2] 🚀 Features: Adaptive rate limiting · Fetch timeouts · Smart error handling');
      window.postMessage({ type: 'INJECT_READY' }, window.location.origin);
    }
  }, 1000);

})();
