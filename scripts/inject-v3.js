// inject-v3.js - Access Instagram's Relay Store through React Fiber
(function() {
  'use strict';

  console.log('[Instagram Downloader v3] Starting...');

  let relayEnvironment = null;
  let relayStore = null;

  // Find Relay environment by traversing React Fiber
  function findRelayEnvironment() {
    try {
      // Try multiple root elements
      const roots = [
        document.querySelector('main'),
        document.querySelector('#react-root'),
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
          console.log('[Instagram Downloader v3] Found React Fiber:', fiberKey);
          const fiber = root[fiberKey];
          const env = searchFiberForRelayEnvironment(fiber, 0);

          if (env) {
            console.log('[Instagram Downloader v3] ✅ Found Relay Environment!');
            relayEnvironment = env;
            relayStore = env._store || env.getStore?.();
            return true;
          }
        }
      }
    } catch (error) {
      console.error('[Instagram Downloader v3] Error finding Relay:', error);
    }

    return false;
  }

  // Recursively search fiber tree for Relay environment
  function searchFiberForRelayEnvironment(fiber, depth = 0, visited = new Set()) {
    if (!fiber || depth > 50) return null;
    if (visited.has(fiber)) return null;
    visited.add(fiber);

    try {
      // Check current fiber's memoizedState
      if (fiber.memoizedState) {
        const state = fiber.memoizedState;

        // Check if this state has the environment
        if (state.environment && state.environment._store) {
          return state.environment;
        }

        // State can be a linked list, traverse it
        let currentState = state;
        while (currentState) {
          if (currentState.memoizedState?.environment?._store) {
            return currentState.memoizedState.environment;
          }
          if (currentState.baseState?.environment?._store) {
            return currentState.baseState.environment;
          }
          currentState = currentState.next;
        }
      }

      // Check memoizedProps
      if (fiber.memoizedProps) {
        const props = fiber.memoizedProps;
        if (props.environment && props.environment._store) {
          return props.environment;
        }
      }

      // Check stateNode (for class components)
      if (fiber.stateNode) {
        const instance = fiber.stateNode;
        if (instance.props?.environment?._store) {
          return instance.props.environment;
        }
        if (instance.state?.environment?._store) {
          return instance.state.environment;
        }
      }

      // Search children
      if (fiber.child) {
        const result = searchFiberForRelayEnvironment(fiber.child, depth + 1, visited);
        if (result) return result;
      }

      // Search siblings (but limit depth)
      if (depth < 10 && fiber.sibling) {
        const result = searchFiberForRelayEnvironment(fiber.sibling, depth + 1, visited);
        if (result) return result;
      }

      // Search return (parent) occasionally
      if (depth < 5 && fiber.return) {
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
      console.error('[Instagram Downloader v3] Error accessing store records:', e);
    }

    return {};
  }

  // Find post by shortcode in Relay store
  function findPostByShortcode(shortcode) {
    console.log('[Instagram Downloader v3] Searching for shortcode:', shortcode);

    const records = getAllRelayRecords();
    const recordCount = Object.keys(records).length;
    console.log('[Instagram Downloader v3] Searching', recordCount, 'relay records');

    // Search through all records
    for (const [id, record] of Object.entries(records)) {
      if (!record) continue;

      try {
        // Direct shortcode match
        if (record.shortcode === shortcode) {
          console.log('[Instagram Downloader v3] ✅ Found by direct shortcode match');
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
            console.log('[Instagram Downloader v3] ✅ Found by typename + shortcode');
            return record;
          }
        }

      } catch (e) {
        continue;
      }
    }

    console.warn('[Instagram Downloader v3] Post not found in Relay store');
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
      console.error('[Instagram Downloader v3] Error:', error);
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
      console.error('[Instagram Downloader v3] Error extracting media:', error);
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
      console.error('[Instagram Downloader v3] Error extracting comments:', error);
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
      console.log('[Instagram Downloader v3] ✅ Ready!');
      window.postMessage({ type: 'INJECT_READY' }, '*');
    } else {
      console.warn('[Instagram Downloader v3] ⚠️ Relay environment not found yet');
      // Try again after more delay
      setTimeout(() => {
        const retryFound = findRelayEnvironment();
        if (retryFound) {
          console.log('[Instagram Downloader v3] ✅ Ready (retry)!');
          window.postMessage({ type: 'INJECT_READY' }, '*');
        } else {
          console.error('[Instagram Downloader v3] ❌ Could not find Relay environment');
        }
      }, 5000);
    }
  }, 2000);

})();
