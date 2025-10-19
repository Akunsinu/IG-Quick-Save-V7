// inject-v4.js - Hook into Instagram's module loader like ESUIT does
(function() {
  'use strict';

  console.log('[Instagram Downloader v4] Hooking into Instagram module system...');

  let relayStore = null;
  let relayEnvironment = null;

  // Hook window.__d (Instagram's module definition function)
  function hookModuleLoader() {
    // Save original __d if it exists
    let originalDefine = window.__d;

    // Create our interceptor
    const defineInterceptor = function(moduleName, dependencies, factory, ...rest) {

      // Log relay-related modules
      if (moduleName && typeof moduleName === 'string' && moduleName.includes('relay')) {
        console.log('[Instagram Downloader v4] Relay module loading:', moduleName);
      }

      // Wrap the factory function to intercept its execution
      const wrappedFactory = function(...args) {
        // Call original factory
        const moduleExports = factory.apply(this, args);

        // Check if this module is the Relay store we're looking for
        if (moduleName && typeof moduleName === 'string') {

          // Check for RelayPublishQueue or similar
          if (moduleName.includes('RelayPublishQueue') ||
              moduleName.includes('RelayModernEnvironment') ||
              moduleName.includes('relay-runtime')) {
            console.log('[Instagram Downloader v4] ⭐ Found Relay module:', moduleName);

            // Try to find the store or environment in the exports
            if (moduleExports) {
              if (moduleExports._store) {
                relayStore = moduleExports._store;
                window.__igRelayStore = moduleExports._store;
                console.log('[Instagram Downloader v4] ✅ Captured Relay store from exports!');
              }
              if (moduleExports.getStore && typeof moduleExports.getStore === 'function') {
                try {
                  relayStore = moduleExports.getStore();
                  window.__igRelayStore = relayStore;
                  console.log('[Instagram Downloader v4] ✅ Captured Relay store via getStore()!');
                } catch (e) {}
              }
            }
          }
        }

        // Also check the module's arguments for Relay environment
        // Instagram often passes the environment as a dependency
        for (let i = 0; i < args.length; i++) {
          const arg = args[i];
          if (arg && typeof arg === 'object') {
            // Check if this looks like a Relay environment
            if (arg._store || arg.getStore) {
              relayEnvironment = arg;
              relayStore = arg._store || arg.getStore?.();
              window.__igRelayEnvironment = arg;
              if (relayStore) {
                window.__igRelayStore = relayStore;
                console.log('[Instagram Downloader v4] ✅ Found Relay environment in module args!');
              }
            }
          }
        }

        return moduleExports;
      };

      // Call original __d with our wrapped factory
      if (originalDefine) {
        return originalDefine.call(this, moduleName, dependencies, wrappedFactory, ...rest);
      } else {
        // If __d doesn't exist yet, just call the factory
        return wrappedFactory();
      }
    };

    // Replace window.__d with our interceptor
    if (window.__d) {
      originalDefine = window.__d;
      window.__d = defineInterceptor;
    } else {
      // If __d doesn't exist yet, set it up to be intercepted when it does
      Object.defineProperty(window, '__d', {
        get() {
          return defineInterceptor;
        },
        set(value) {
          originalDefine = value;
          // Don't actually set __d to value, keep our interceptor
        },
        configurable: true
      });
    }

    console.log('[Instagram Downloader v4] Module loader hook installed');
  }

  // Alternative: Try to use window.require directly
  function tryWindowRequire() {
    if (!window.require) return false;

    console.log('[Instagram Downloader v4] Trying window.require...');

    try {
      // Try to require relay modules directly
      const possibleModules = [
        'RelayModernEnvironment',
        'relay-runtime',
        'RelayPublishQueue',
        'RelayEnvironmentProvider'
      ];

      for (const modName of possibleModules) {
        try {
          const mod = window.require(modName);
          console.log('[Instagram Downloader v4] Loaded module via require:', modName);

          if (mod && mod._store) {
            relayStore = mod._store;
            window.__igRelayStore = relayStore;
            console.log('[Instagram Downloader v4] ✅ Got store from require!');
            return true;
          }
        } catch (e) {
          // Module not found, continue
        }
      }
    } catch (e) {
      console.error('[Instagram Downloader v4] Error with require:', e);
    }

    return false;
  }

  // Get all records from Relay store
  function getAllRelayRecords() {
    if (!relayStore) return {};

    try {
      // Try different store structures
      if (relayStore._recordSource) {
        return relayStore._recordSource._records ||
               relayStore._recordSource.__records || {};
      }
      if (relayStore.getSource) {
        const source = relayStore.getSource();
        return source._records || source.__records || {};
      }
      if (relayStore._records) {
        return relayStore._records;
      }
      if (relayStore.__records) {
        return relayStore.__records;
      }

      // Try calling methods
      if (typeof relayStore.getRecords === 'function') {
        return relayStore.getRecords() || {};
      }

      // ESUIT approach: check if it's a RelayRecordSourceProxy
      if (typeof relayStore.get === 'function') {
        // This is the proxy itself, try to access internal records
        if (relayStore.__sources) {
          // Get records from all sources
          const allRecords = {};
          for (const source of relayStore.__sources || []) {
            Object.assign(allRecords, source._records || source.__records || {});
          }
          return allRecords;
        }
      }

    } catch (e) {
      console.error('[Instagram Downloader v4] Error accessing store records:', e);
    }

    return {};
  }

  // Find post by shortcode
  function findPostByShortcode(shortcode) {
    console.log('[Instagram Downloader v4] Searching for shortcode:', shortcode);

    const records = getAllRelayRecords();
    const recordCount = Object.keys(records).length;
    console.log('[Instagram Downloader v4] Searching', recordCount, 'relay records');

    if (recordCount === 0) {
      console.warn('[Instagram Downloader v4] No records found in store');
      return null;
    }

    // Search through all records
    for (const [id, record] of Object.entries(records)) {
      if (!record) continue;

      try {
        // Direct shortcode match
        if (record.shortcode === shortcode) {
          console.log('[Instagram Downloader v4] ✅ Found by direct shortcode match');
          return record;
        }

        // Check __typename for post types
        const typename = record.__typename;
        if (typename === 'XDTGraphSidecar' ||
            typename === 'XDTGraphImage' ||
            typename === 'XDTGraphVideo' ||
            typename === 'GraphSidecar' ||
            typename === 'GraphImage' ||
            typename === 'GraphVideo') {

          if (record.shortcode === shortcode) {
            console.log('[Instagram Downloader v4] ✅ Found by typename + shortcode');
            return record;
          }
        }
      } catch (e) {
        continue;
      }
    }

    console.warn('[Instagram Downloader v4] Post not found in', recordCount, 'records');
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

      // Wait a bit for store to populate if we just got it
      if (relayStore && getAllRelayRecords().length === 0) {
        console.log('[Instagram Downloader v4] Store found but empty, waiting...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Try to get store if we don't have it
      if (!relayStore) {
        console.log('[Instagram Downloader v4] No store yet, trying window.require...');
        tryWindowRequire();
      }

      if (!relayStore) {
        return {
          error: 'Relay store not available. Please refresh and wait 20 seconds.',
          debug: {
            storeFound: !!relayStore,
            environmentFound: !!relayEnvironment,
            method: 'hook-failed'
          }
        };
      }

      // Search for post
      const postRecord = findPostByShortcode(shortcode);

      if (postRecord) {
        return {
          shortcode,
          post: postRecord,
          method: 'relay-store-hook'
        };
      }

      const records = getAllRelayRecords();
      return {
        error: 'Post data not found in Relay store. Try refreshing the page.',
        debug: {
          storeFound: !!relayStore,
          recordCount: Object.keys(records).length,
          method: 'relay-store-no-match'
        }
      };

    } catch (error) {
      console.error('[Instagram Downloader v4] Error:', error);
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

      // Handle carousel
      if (post.edge_sidecar_to_children?.edges) {
        for (const edge of post.edge_sidecar_to_children.edges) {
          media.push(extractMediaItem(edge.node));
        }
      } else {
        media.push(extractMediaItem(post));
      }

      return { media };
    } catch (error) {
      console.error('[Instagram Downloader v4] Error extracting media:', error);
      return { error: error.message };
    }
  }

  // Extract single media item
  function extractMediaItem(item) {
    const mediaItem = {
      type: item.__typename || (item.is_video ? 'GraphVideo' : 'GraphImage'),
      id: item.id || '',
      shortcode: item.shortcode || ''
    };

    if (item.is_video) {
      mediaItem.video_url = item.video_url;
      mediaItem.thumbnail_url = item.display_url;
    } else {
      let imageUrl = item.display_url;

      if (item.display_resources && item.display_resources.length > 0) {
        const highestRes = item.display_resources[item.display_resources.length - 1];
        imageUrl = highestRes.src;
      }

      mediaItem.image_url = imageUrl;
    }

    return mediaItem;
  }

  // Extract comments
  async function extractComments() {
    try {
      const postData = await extractPostData();
      if (postData.error) return postData;

      const post = postData.post;
      const comments = [];

      const commentEdge = post.edge_media_to_parent_comment ||
                         post.edge_media_preview_comment ||
                         post.edge_media_to_comment;

      if (commentEdge && commentEdge.edges) {
        for (const edge of commentEdge.edges) {
          const comment = edge.node;
          const commentData = {
            id: comment.id,
            text: comment.text,
            created_at: comment.created_at,
            owner: {
              id: comment.owner?.id,
              username: comment.owner?.username,
              profile_pic_url: comment.owner?.profile_pic_url
            },
            like_count: comment.edge_liked_by?.count || 0,
            replies: []
          };

          if (comment.edge_threaded_comments?.edges) {
            for (const replyEdge of comment.edge_threaded_comments.edges) {
              const reply = replyEdge.node;
              commentData.replies.push({
                id: reply.id,
                text: reply.text,
                created_at: reply.created_at,
                owner: {
                  id: reply.owner?.id,
                  username: reply.owner?.username,
                  profile_pic_url: reply.owner?.profile_pic_url
                },
                like_count: reply.edge_liked_by?.count || 0
              });
            }
          }

          comments.push(commentData);
        }
      }

      return {
        total: commentEdge?.count || comments.length,
        comments
      };

    } catch (error) {
      console.error('[Instagram Downloader v4] Error extracting comments:', error);
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

  // Initialize - install hook immediately
  hookModuleLoader();

  // Also try window.require after a delay
  setTimeout(() => {
    if (!relayStore) {
      tryWindowRequire();
    }

    if (relayStore) {
      console.log('[Instagram Downloader v4] ✅ Ready!');
      window.postMessage({ type: 'INJECT_READY' }, '*');
    } else {
      console.warn('[Instagram Downloader v4] ⚠️ Relay store not captured yet');
    }
  }, 3000);

  // Final check after longer delay
  setTimeout(() => {
    if (relayStore) {
      const recordCount = Object.keys(getAllRelayRecords()).length;
      console.log('[Instagram Downloader v4] ✅ Store has', recordCount, 'records');
    } else {
      console.error('[Instagram Downloader v4] ❌ Failed to capture Relay store');
    }
  }, 10000);

})();
