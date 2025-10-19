// inject-v3-improved.js - Enhanced Relay Store access with better Fiber search
(function() {
  'use strict';

  console.log('[Instagram Downloader v3-improved] Starting...');

  let relayEnvironment = null;
  let relayStore = null;

  // Helper function to check if something looks like a Relay environment
  function isRelayEnvironment(obj) {
    if (!obj || typeof obj !== 'object') return false;

    // Check for common Relay environment signatures
    return (
      (obj._store && typeof obj._store === 'object') ||
      (obj.getStore && typeof obj.getStore === 'function') ||
      (obj.__internal && obj.__internal.recordSource) ||
      (obj.configName && obj._network) || // Relay Modern
      (obj._recordSource && obj._network) // Alternative structure
    );
  }

  // Find Relay environment by traversing React Fiber
  function findRelayEnvironment() {
    try {
      // Try multiple root elements
      const roots = [
        document.querySelector('main'),
        document.querySelector('#react-root'),
        document.querySelector('[data-testid="user-avatar"]')?.closest('div'),
        document.body
      ];

      for (const root of roots) {
        if (!root) continue;

        // Find React Fiber key
        const fiberKey = Object.keys(root).find(key =>
          key.startsWith('__reactFiber') ||
          key.startsWith('__reactInternalInstance')
        );

        if (fiberKey) {
          console.log('[Instagram Downloader v3-improved] Found React Fiber:', fiberKey);
          const fiber = root[fiberKey];

          // Try with debug mode first for a few nodes
          const env = searchFiberForRelayEnvironment(fiber, 0);

          if (env) {
            console.log('[Instagram Downloader v3-improved] ✅ Found Relay Environment!');
            relayEnvironment = env;
            relayStore = env._store || env.getStore?.();

            // Log store info
            if (relayStore) {
              console.log('[Instagram Downloader v3-improved] Store structure:', {
                hasRecordSource: !!relayStore._recordSource,
                hasGetSource: !!(relayStore.getSource),
                keys: Object.keys(relayStore)
              });
            }

            return true;
          }
        }
      }

      // Try alternative: React DevTools hook
      if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers) {
        console.log('[Instagram Downloader v3-improved] Trying React DevTools hook...');
        const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;

        for (const [id, renderer] of hook.renderers) {
          if (renderer.findFiberByHostInstance) {
            const mainEl = document.querySelector('main');
            if (mainEl) {
              try {
                const fiber = renderer.findFiberByHostInstance(mainEl);
                if (fiber) {
                  const env = searchFiberForRelayEnvironment(fiber, 0);
                  if (env) {
                    console.log('[Instagram Downloader v3-improved] ✅ Found via DevTools hook!');
                    relayEnvironment = env;
                    relayStore = env._store || env.getStore?.();
                    return true;
                  }
                }
              } catch (e) {
                // Continue to next renderer
              }
            }
          }
        }
      }

    } catch (error) {
      console.error('[Instagram Downloader v3-improved] Error finding Relay:', error);
    }

    return false;
  }

  // IMPROVED: Recursively search fiber tree for Relay environment
  function searchFiberForRelayEnvironment(fiber, depth = 0, visited = new Set()) {
    if (!fiber || depth > 100) return null; // Increased depth limit
    if (visited.has(fiber)) return null;
    visited.add(fiber);

    try {
      // 1. Check memoizedState (hooks state for function components)
      if (fiber.memoizedState) {
        const state = fiber.memoizedState;

        // Direct check
        if (isRelayEnvironment(state.environment)) {
          return state.environment;
        }

        // Check all properties of memoizedState
        for (const key in state) {
          if (isRelayEnvironment(state[key])) {
            return state[key];
          }
        }

        // Traverse state linked list (for hooks)
        let currentState = state;
        let stateDepth = 0;
        while (currentState && stateDepth < 50) {
          // Check memoizedState property
          if (currentState.memoizedState) {
            if (isRelayEnvironment(currentState.memoizedState)) {
              return currentState.memoizedState;
            }

            // Check properties within memoizedState
            if (typeof currentState.memoizedState === 'object') {
              for (const key in currentState.memoizedState) {
                if (isRelayEnvironment(currentState.memoizedState[key])) {
                  return currentState.memoizedState[key];
                }
              }
            }
          }

          // Check baseState property
          if (currentState.baseState) {
            if (isRelayEnvironment(currentState.baseState)) {
              return currentState.baseState;
            }
            if (currentState.baseState.environment && isRelayEnvironment(currentState.baseState.environment)) {
              return currentState.baseState.environment;
            }
          }

          // Check queue
          if (currentState.queue) {
            if (isRelayEnvironment(currentState.queue.lastRenderedState)) {
              return currentState.queue.lastRenderedState;
            }
          }

          currentState = currentState.next;
          stateDepth++;
        }
      }

      // 2. Check memoizedProps
      if (fiber.memoizedProps) {
        const props = fiber.memoizedProps;

        // Check environment property
        if (isRelayEnvironment(props.environment)) {
          return props.environment;
        }

        // Check all props
        for (const key in props) {
          if (isRelayEnvironment(props[key])) {
            return props[key];
          }
        }
      }

      // 3. Check pendingProps
      if (fiber.pendingProps) {
        const props = fiber.pendingProps;

        if (isRelayEnvironment(props.environment)) {
          return props.environment;
        }

        for (const key in props) {
          if (isRelayEnvironment(props[key])) {
            return props[key];
          }
        }
      }

      // 4. Check stateNode (for class components and DOM nodes)
      if (fiber.stateNode && typeof fiber.stateNode === 'object') {
        const instance = fiber.stateNode;

        // Skip DOM nodes
        if (!(instance instanceof Element)) {
          // Check props
          if (instance.props) {
            if (isRelayEnvironment(instance.props.environment)) {
              return instance.props.environment;
            }
            for (const key in instance.props) {
              if (isRelayEnvironment(instance.props[key])) {
                return instance.props[key];
              }
            }
          }

          // Check state
          if (instance.state) {
            if (isRelayEnvironment(instance.state.environment)) {
              return instance.state.environment;
            }
            for (const key in instance.state) {
              if (isRelayEnvironment(instance.state[key])) {
                return instance.state[key];
              }
            }
          }

          // Check context
          if (instance.context && isRelayEnvironment(instance.context)) {
            return instance.context;
          }

          // Check other properties
          for (const key in instance) {
            if (key !== 'props' && key !== 'state' && key !== 'refs') {
              if (isRelayEnvironment(instance[key])) {
                return instance[key];
              }
            }
          }
        }
      }

      // 5. Check updateQueue
      if (fiber.updateQueue) {
        const queue = fiber.updateQueue;

        if (isRelayEnvironment(queue.baseState)) {
          return queue.baseState;
        }

        if (isRelayEnvironment(queue.memoizedState)) {
          return queue.memoizedState;
        }

        // Check shared
        if (queue.shared && isRelayEnvironment(queue.shared.pending)) {
          return queue.shared.pending;
        }
      }

      // 6. Check dependencies (React Context)
      if (fiber.dependencies) {
        const deps = fiber.dependencies;

        if (deps.firstContext) {
          let ctx = deps.firstContext;
          let ctxDepth = 0;
          while (ctx && ctxDepth < 20) {
            if (isRelayEnvironment(ctx.context)) {
              return ctx.context;
            }
            if (isRelayEnvironment(ctx.memoizedValue)) {
              return ctx.memoizedValue;
            }
            ctx = ctx.next;
            ctxDepth++;
          }
        }
      }

      // 7. Check type (component type/function)
      if (fiber.type && typeof fiber.type === 'object') {
        // Check context on component type
        if (fiber.type._context && isRelayEnvironment(fiber.type._context._currentValue)) {
          return fiber.type._context._currentValue;
        }

        if (fiber.type._context && isRelayEnvironment(fiber.type._context._currentValue2)) {
          return fiber.type._context._currentValue2;
        }
      }

      // 8. Check alternate fiber (work-in-progress vs current)
      if (fiber.alternate && !visited.has(fiber.alternate)) {
        visited.add(fiber.alternate);
        const altEnv = searchFiberForRelayEnvironment(fiber.alternate, depth, visited);
        if (altEnv) return altEnv;
      }

      // 9. Traverse tree - children first, then siblings, then parents
      if (fiber.child) {
        const result = searchFiberForRelayEnvironment(fiber.child, depth + 1, visited);
        if (result) return result;
      }

      if (fiber.sibling) {
        const result = searchFiberForRelayEnvironment(fiber.sibling, depth + 1, visited);
        if (result) return result;
      }

      // Only traverse up occasionally to avoid infinite loops
      if (depth < 20 && fiber.return) {
        const result = searchFiberForRelayEnvironment(fiber.return, depth + 1, visited);
        if (result) return result;
      }

    } catch (e) {
      // Silent fail, continue searching
    }

    return null;
  }

  // Get all records from Relay store
  function getAllRelayRecords() {
    if (!relayStore) return {};

    try {
      // Try different store structures
      if (relayStore._recordSource) {
        return relayStore._recordSource._records || relayStore._recordSource.__records || {};
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
      if (relayStore.getRecords && typeof relayStore.getRecords === 'function') {
        return relayStore.getRecords();
      }

    } catch (e) {
      console.error('[Instagram Downloader v3-improved] Error accessing store records:', e);
    }

    return {};
  }

  // Find post by shortcode in Relay store
  function findPostByShortcode(shortcode) {
    console.log('[Instagram Downloader v3-improved] Searching for shortcode:', shortcode);

    const records = getAllRelayRecords();
    const recordCount = Object.keys(records).length;
    console.log('[Instagram Downloader v3-improved] Searching', recordCount, 'relay records');

    // Search through all records
    for (const [id, record] of Object.entries(records)) {
      if (!record) continue;

      try {
        // Direct shortcode match
        if (record.shortcode === shortcode) {
          console.log('[Instagram Downloader v3-improved] ✅ Found by direct shortcode match');
          return record;
        }

        // Check __typename to identify post types
        const typename = record.__typename;
        if (typename === 'XDTGraphSidecar' ||
            typename === 'XDTGraphImage' ||
            typename === 'XDTGraphVideo' ||
            typename === 'GraphSidecar' ||
            typename === 'GraphImage' ||
            typename === 'GraphVideo') {

          if (record.shortcode === shortcode) {
            console.log('[Instagram Downloader v3-improved] ✅ Found by typename + shortcode');
            return record;
          }
        }

      } catch (e) {
        continue;
      }
    }

    console.warn('[Instagram Downloader v3-improved] Post not found in Relay store');
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

      // Try to find Relay environment if we don't have it
      if (!relayEnvironment) {
        const found = findRelayEnvironment();
        if (!found) {
          return {
            error: 'Could not access Instagram data. Please refresh the page and wait 15 seconds.',
            debug: {
              relayEnvironmentFound: false,
              method: 'fiber-search-failed'
            }
          };
        }
      }

      // Search for post in Relay store
      const postRecord = findPostByShortcode(shortcode);

      if (postRecord) {
        return {
          shortcode,
          post: postRecord,
          method: 'relay-store'
        };
      }

      // If not found, return debug info
      const records = getAllRelayRecords();
      return {
        error: 'Post data not loaded yet. Please wait 15 seconds and try again.',
        debug: {
          relayEnvironmentFound: !!relayEnvironment,
          relayStoreFound: !!relayStore,
          recordCount: Object.keys(records).length,
          method: 'relay-store-no-match'
        }
      };

    } catch (error) {
      console.error('[Instagram Downloader v3-improved] Error:', error);
      return { error: error.message };
    }
  }

  // Extract media from post record
  async function extractMedia() {
    try {
      const postData = await extractPostData();
      if (postData.error) return postData;

      const post = postData.post;
      const media = [];

      // Handle carousel (multiple items)
      if (post.edge_sidecar_to_children?.edges) {
        for (const edge of post.edge_sidecar_to_children.edges) {
          media.push(extractMediaItem(edge.node));
        }
      } else {
        // Single item
        media.push(extractMediaItem(post));
      }

      return { media };
    } catch (error) {
      console.error('[Instagram Downloader v3-improved] Error extracting media:', error);
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
      // Get highest resolution image
      let imageUrl = item.display_url;

      if (item.display_resources && item.display_resources.length > 0) {
        const highestRes = item.display_resources[item.display_resources.length - 1];
        imageUrl = highestRes.src;
      }

      mediaItem.image_url = imageUrl;
    }

    return mediaItem;
  }

  // Extract comments from post record
  async function extractComments() {
    try {
      const postData = await extractPostData();
      if (postData.error) return postData;

      const post = postData.post;
      const comments = [];

      // Try different comment edge names
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

          // Extract replies
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
      console.error('[Instagram Downloader v3-improved] Error extracting comments:', error);
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

  // Initialize - try to find Relay environment immediately
  setTimeout(() => {
    const found = findRelayEnvironment();
    if (found) {
      console.log('[Instagram Downloader v3-improved] ✅ Ready!');
      window.postMessage({ type: 'INJECT_READY' }, '*');
    } else {
      console.warn('[Instagram Downloader v3-improved] ⚠️ Relay environment not found yet');
      // Try again after more delay
      setTimeout(() => {
        const retryFound = findRelayEnvironment();
        if (retryFound) {
          console.log('[Instagram Downloader v3-improved] ✅ Ready (retry)!');
          window.postMessage({ type: 'INJECT_READY' }, '*');
        } else {
          console.error('[Instagram Downloader v3-improved] ❌ Could not find Relay environment');
          console.log('[Instagram Downloader v3-improved] Try running the diagnostic script in the console');
        }
      }, 5000);
    }
  }, 2000);

})();
