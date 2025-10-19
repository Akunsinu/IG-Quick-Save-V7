// inject-v4-debug.js - Enhanced debugging to find where the store actually is
(function() {
  'use strict';

  console.log('[IG DL v4-debug] Starting with enhanced debugging...');

  let relayStore = null;
  let relayEnvironment = null;

  // Deep inspect an object for Relay-like properties
  function deepInspectForRelay(obj, depth = 0, maxDepth = 3, path = 'root') {
    if (!obj || depth > maxDepth || typeof obj !== 'object') return null;

    // Check if this is a Relay environment
    if (obj._store || (obj.getStore && typeof obj.getStore === 'function')) {
      console.log('[IG DL v4-debug] 🎯 Found Relay-like object at:', path);
      console.log('[IG DL v4-debug]   - Has _store:', !!obj._store);
      console.log('[IG DL v4-debug]   - Has getStore:', !!obj.getStore);
      console.log('[IG DL v4-debug]   - Keys:', Object.keys(obj).slice(0, 10));
      return obj;
    }

    // Recursively check properties
    try {
      for (const key in obj) {
        if (key.startsWith('_') || key === 'constructor' || key === 'prototype') continue;

        try {
          const value = obj[key];
          if (value && typeof value === 'object') {
            const found = deepInspectForRelay(value, depth + 1, maxDepth, `${path}.${key}`);
            if (found) return found;
          }
        } catch (e) {
          // Property access failed, skip
        }
      }
    } catch (e) {
      // Object enumeration failed
    }

    return null;
  }

  // Hook window.__d
  function hookModuleLoader() {
    let originalDefine = window.__d;
    let moduleCount = 0;

    const defineInterceptor = function(moduleName, dependencies, factory, ...rest) {
      moduleCount++;

      // Log all relay-related modules with more detail
      if (moduleName && typeof moduleName === 'string' && moduleName.toLowerCase().includes('relay')) {
        console.log('[IG DL v4-debug] 📦 Relay module #' + moduleCount + ':', moduleName);
      }

      // Wrap factory to inspect what it returns and receives
      const wrappedFactory = function(...args) {
        const moduleExports = factory.apply(this, args);

        // Detailed inspection for relay modules
        if (moduleName && typeof moduleName === 'string' && moduleName.toLowerCase().includes('relay')) {
          console.log('[IG DL v4-debug] 📦 Module exports for:', moduleName);

          if (moduleExports) {
            console.log('[IG DL v4-debug]   - Export type:', typeof moduleExports);
            console.log('[IG DL v4-debug]   - Export keys:', Object.keys(moduleExports || {}).slice(0, 20));

            // Deep inspect the exports
            const found = deepInspectForRelay(moduleExports, 0, 2, moduleName);
            if (found) {
              relayEnvironment = found;
              relayStore = found._store || found.getStore?.();
              window.__igRelayEnvironment = found;
              window.__igRelayStore = relayStore;
              console.log('[IG DL v4-debug] ✅ CAPTURED RELAY from module exports!');
            }
          }

          // Also inspect the arguments passed to the factory
          console.log('[IG DL v4-debug]   - Factory received', args.length, 'arguments');
          for (let i = 0; i < args.length && i < 5; i++) {
            const arg = args[i];
            if (arg && typeof arg === 'object') {
              console.log('[IG DL v4-debug]   - Arg[' + i + '] keys:', Object.keys(arg).slice(0, 10));

              const foundInArg = deepInspectForRelay(arg, 0, 2, `${moduleName}.arg[${i}]`);
              if (foundInArg) {
                relayEnvironment = foundInArg;
                relayStore = foundInArg._store || foundInArg.getStore?.();
                window.__igRelayEnvironment = foundInArg;
                window.__igRelayStore = relayStore;
                console.log('[IG DL v4-debug] ✅ CAPTURED RELAY from module args!');
              }
            }
          }
        }

        return moduleExports;
      };

      if (originalDefine) {
        return originalDefine.call(this, moduleName, dependencies, wrappedFactory, ...rest);
      } else {
        return wrappedFactory();
      }
    };

    if (window.__d) {
      originalDefine = window.__d;
      window.__d = defineInterceptor;
      console.log('[IG DL v4-debug] ✅ Hooked existing __d');
    } else {
      Object.defineProperty(window, '__d', {
        get() { return defineInterceptor; },
        set(value) { originalDefine = value; },
        configurable: true
      });
      console.log('[IG DL v4-debug] ✅ Set up __d interceptor (will activate when __d is defined)');
    }
  }

  // Try window.require with deep inspection
  function tryWindowRequire() {
    if (!window.require) {
      console.log('[IG DL v4-debug] ❌ window.require not available');
      return false;
    }

    console.log('[IG DL v4-debug] 🔍 Trying window.require...');

    const modules = [
      'relay-runtime',
      'RelayModernEnvironment',
      'RelayPublishQueue',
      'RelayEnvironmentProvider'
    ];

    for (const modName of modules) {
      try {
        const mod = window.require(modName);
        console.log('[IG DL v4-debug] 📦 Loaded via require:', modName);
        console.log('[IG DL v4-debug]   - Type:', typeof mod);

        if (mod && typeof mod === 'object') {
          console.log('[IG DL v4-debug]   - Keys:', Object.keys(mod).slice(0, 20));

          // Deep inspect
          const found = deepInspectForRelay(mod, 0, 3, `require('${modName}')`);
          if (found) {
            relayEnvironment = found;
            relayStore = found._store || found.getStore?.();
            window.__igRelayEnvironment = found;
            window.__igRelayStore = relayStore;
            console.log('[IG DL v4-debug] ✅ CAPTURED RELAY from require!');
            return true;
          }
        }
      } catch (e) {
        console.log('[IG DL v4-debug] ⚠️ Failed to require:', modName, e.message);
      }
    }

    return false;
  }

  // Try to find Relay in global scope
  function scanGlobalScope() {
    console.log('[IG DL v4-debug] 🔍 Scanning global scope for Relay...');

    const globalKeys = Object.keys(window);
    const relayLikeKeys = globalKeys.filter(k =>
      k.toLowerCase().includes('relay') ||
      k.toLowerCase().includes('store') ||
      k.toLowerCase().includes('environment')
    );

    console.log('[IG DL v4-debug] Found', relayLikeKeys.length, 'relay-like global keys:', relayLikeKeys);

    for (const key of relayLikeKeys) {
      try {
        const value = window[key];
        if (value && typeof value === 'object') {
          const found = deepInspectForRelay(value, 0, 2, `window.${key}`);
          if (found) {
            relayEnvironment = found;
            relayStore = found._store || found.getStore?.();
            window.__igRelayEnvironment = found;
            window.__igRelayStore = relayStore;
            console.log('[IG DL v4-debug] ✅ CAPTURED RELAY from global scope!');
            return true;
          }
        }
      } catch (e) {
        // Skip
      }
    }

    return false;
  }

  // Get records from store
  function getAllRelayRecords() {
    if (!relayStore) {
      console.log('[IG DL v4-debug] ❌ No relay store to get records from');
      return {};
    }

    console.log('[IG DL v4-debug] 🔍 Trying to get records from store...');
    console.log('[IG DL v4-debug] Store keys:', Object.keys(relayStore).slice(0, 20));

    try {
      // Try different structures
      const attempts = [
        () => relayStore._recordSource?._records,
        () => relayStore._recordSource?.__records,
        () => relayStore.getSource?.()._records,
        () => relayStore.getSource?.().__records,
        () => relayStore._records,
        () => relayStore.__records,
        () => relayStore.getRecords?.()
      ];

      for (let i = 0; i < attempts.length; i++) {
        try {
          const records = attempts[i]();
          if (records && typeof records === 'object') {
            const count = Object.keys(records).length;
            if (count > 0) {
              console.log('[IG DL v4-debug] ✅ Found', count, 'records via method', i);
              return records;
            }
          }
        } catch (e) {
          // Try next method
        }
      }

    } catch (e) {
      console.error('[IG DL v4-debug] Error accessing records:', e);
    }

    console.log('[IG DL v4-debug] ⚠️ Could not find records in store');
    return {};
  }

  // Find post by shortcode
  function findPostByShortcode(shortcode) {
    console.log('[IG DL v4-debug] 🔍 Searching for shortcode:', shortcode);

    const records = getAllRelayRecords();
    const recordCount = Object.keys(records).length;
    console.log('[IG DL v4-debug] Searching', recordCount, 'records');

    if (recordCount === 0) return null;

    // Search
    for (const [id, record] of Object.entries(records)) {
      if (!record) continue;

      try {
        if (record.shortcode === shortcode) {
          console.log('[IG DL v4-debug] ✅ Found post! Type:', record.__typename);
          return record;
        }
      } catch (e) {
        continue;
      }
    }

    console.log('[IG DL v4-debug] ❌ Post not found in', recordCount, 'records');
    return null;
  }

  // Extract post data
  async function extractPostData() {
    try {
      const url = window.location.href;
      const shortcodeMatch = url.match(/\/p\/([^\/\?]+)/);

      if (!shortcodeMatch) {
        return { error: 'Not on a post page' };
      }

      const shortcode = shortcodeMatch[1];

      if (!relayStore) {
        console.log('[IG DL v4-debug] ❌ No relay store available');
        return {
          error: 'Relay store not captured. Check console for debug info.',
          debug: {
            storeFound: false,
            environmentFound: !!relayEnvironment
          }
        };
      }

      const postRecord = findPostByShortcode(shortcode);

      if (postRecord) {
        return {
          shortcode,
          post: postRecord,
          method: 'relay-store-debug'
        };
      }

      return {
        error: 'Post not found in Relay store',
        debug: {
          storeFound: !!relayStore,
          recordCount: Object.keys(getAllRelayRecords()).length
        }
      };

    } catch (error) {
      console.error('[IG DL v4-debug] Error:', error);
      return { error: error.message };
    }
  }

  // Extract media
  async function extractMedia() {
    try {
      const postData = await extractPostData();
      if (postData.error) return postData;

      const post = postData.post;
      const media = [];

      if (post.edge_sidecar_to_children?.edges) {
        for (const edge of post.edge_sidecar_to_children.edges) {
          media.push({
            type: edge.node.__typename,
            id: edge.node.id,
            url: edge.node.is_video ? edge.node.video_url : edge.node.display_url
          });
        }
      } else {
        media.push({
          type: post.__typename,
          id: post.id,
          url: post.is_video ? post.video_url : post.display_url
        });
      }

      return { media };
    } catch (error) {
      return { error: error.message };
    }
  }

  // Extract comments
  async function extractComments() {
    try {
      const postData = await extractPostData();
      if (postData.error) return postData;

      const post = postData.post;
      const commentEdge = post.edge_media_to_parent_comment ||
                         post.edge_media_preview_comment ||
                         post.edge_media_to_comment;

      const comments = [];
      if (commentEdge?.edges) {
        for (const edge of commentEdge.edges) {
          comments.push({
            id: edge.node.id,
            text: edge.node.text,
            owner: edge.node.owner?.username
          });
        }
      }

      return {
        total: commentEdge?.count || comments.length,
        comments
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  // Message handler
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;

    if (event.data.type === 'EXTRACT_POST_DATA') {
      const data = await extractPostData();
      window.postMessage({ type: 'POST_DATA_RESPONSE', data }, '*');
    } else if (event.data.type === 'EXTRACT_COMMENTS') {
      const data = await extractComments();
      window.postMessage({ type: 'COMMENTS_RESPONSE', data }, '*');
    } else if (event.data.type === 'EXTRACT_MEDIA') {
      const data = await extractMedia();
      window.postMessage({ type: 'MEDIA_RESPONSE', data }, '*');
    }
  });

  // Initialize
  hookModuleLoader();

  // Try multiple strategies
  setTimeout(() => {
    console.log('[IG DL v4-debug] === Running detection strategies ===');

    if (!relayStore) tryWindowRequire();
    if (!relayStore) scanGlobalScope();

    if (relayStore) {
      const recordCount = Object.keys(getAllRelayRecords()).length;
      console.log('[IG DL v4-debug] ✅ SUCCESS! Store has', recordCount, 'records');
      window.postMessage({ type: 'INJECT_READY' }, '*');
    } else {
      console.log('[IG DL v4-debug] ⚠️ Relay store not found yet, will keep trying...');
    }
  }, 3000);

  // Final check
  setTimeout(() => {
    if (relayStore) {
      console.log('[IG DL v4-debug] ✅ Final check: Store active');
    } else {
      console.log('[IG DL v4-debug] ❌ Final check: Store NOT captured');
      console.log('[IG DL v4-debug] 📋 Please share this console output for debugging');
    }
  }, 10000);

})();
