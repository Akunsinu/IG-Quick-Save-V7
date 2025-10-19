// New inject script - Access Instagram's internal Relay Store
(function() {
  'use strict';

  console.log('[Instagram Downloader v2] Inject script loaded');

  // Hook into Instagram's module system to capture the Relay store
  let relayStore = null;
  let requireFunc = null;

  // Wait for Instagram's require function
  function waitForInstagram(callback) {
    let attempts = 0;
    const maxAttempts = 100;

    const checkInterval = setInterval(() => {
      attempts++;

      // Check if we can access Instagram's require
      if (window.require || window.requireLazy) {
        console.log('[Instagram Downloader v2] Instagram require found');
        requireFunc = window.require;

        // Try to find the Relay store
        tryFindRelayStore();

        if (relayStore) {
          clearInterval(checkInterval);
          console.log('[Instagram Downloader v2] Relay store found!');
          callback();
        }
      }

      if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        console.warn('[Instagram Downloader v2] Timeout waiting for Relay store');
        callback(); // Continue anyway, we'll try other methods
      }
    }, 100);
  }

  // Try to find Instagram's Relay store
  function tryFindRelayStore() {
    // Method 1: Check if already exposed
    if (window.__relayStore) {
      relayStore = window.__relayStore;
      return;
    }

    // Method 2: Try to find in DOM elements
    try {
      const roots = [document.body, document.querySelector('#react-root'), document.querySelector('main')];

      for (const root of roots) {
        if (!root) continue;

        const keys = Object.keys(root);
        for (const key of keys) {
          if (key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')) {
            const fiber = root[key];
            const store = findRelayStoreInFiber(fiber);
            if (store) {
              relayStore = store;
              window.__relayStore = store; // Cache it
              console.log('[Instagram Downloader v2] Found Relay store in React fiber');
              return;
            }
          }
        }
      }
    } catch (e) {
      console.error('[Instagram Downloader v2] Error finding Relay store:', e);
    }
  }

  // Search React fiber for Relay store
  function findRelayStoreInFiber(fiber, depth = 0) {
    if (!fiber || depth > 30) return null;

    try {
      // Check for Relay environment
      if (fiber.memoizedState) {
        const state = fiber.memoizedState;
        if (state && state.environment && state.environment._store) {
          return state.environment._store;
        }
      }

      // Check props
      if (fiber.memoizedProps) {
        const props = fiber.memoizedProps;
        if (props.environment && props.environment._store) {
          return props.environment._store;
        }
      }

      // Search children
      if (fiber.child) {
        const result = findRelayStoreInFiber(fiber.child, depth + 1);
        if (result) return result;
      }

      // Search siblings
      if (depth < 5 && fiber.sibling) {
        const result = findRelayStoreInFiber(fiber.sibling, depth + 1);
        if (result) return result;
      }
    } catch (e) {
      // Continue searching
    }

    return null;
  }

  // Extract post data from Instagram's page data
  async function extractPostData() {
    try {
      const url = window.location.href;
      const shortcodeMatch = url.match(/\/p\/([^\/\?]+)/);

      if (!shortcodeMatch) {
        return { error: 'Not on a post page' };
      }

      const shortcode = shortcodeMatch[1];
      console.log('[Instagram Downloader v2] Extracting for shortcode:', shortcode);

      // Method 1: Try window.__additionalDataLoaded__ (most reliable for posts)
      if (window.__additionalDataLoaded__) {
        for (const [path, data] of Object.entries(window.__additionalDataLoaded__)) {
          if (data && data.graphql && data.graphql.shortcode_media) {
            console.log('[Instagram Downloader v2] Found via __additionalDataLoaded__');
            return {
              shortcode,
              post: data.graphql.shortcode_media,
              method: 'additionalDataLoaded'
            };
          }
        }
      }

      // Method 2: Try window._sharedData
      if (window._sharedData && window._sharedData.entry_data && window._sharedData.entry_data.PostPage) {
        const postData = window._sharedData.entry_data.PostPage[0];
        if (postData && postData.graphql && postData.graphql.shortcode_media) {
          console.log('[Instagram Downloader v2] Found via _sharedData');
          return {
            shortcode,
            post: postData.graphql.shortcode_media,
            method: 'sharedData'
          };
        }
      }

      // Method 3: Parse from page <script> tags containing post data
      const scripts = document.querySelectorAll('script:not([src])');
      for (const script of scripts) {
        const content = script.textContent;

        // Look for shortcode_media in scripts
        if (content.includes('shortcode_media') && content.includes(shortcode)) {
          try {
            // Try to extract JSON from various patterns
            const patterns = [
              /window\.__additionalDataLoaded__\([^,]+,\s*({.+?})\);/,
              /window\._sharedData\s*=\s*({.+?});/,
              /"shortcode_media"\s*:\s*({.+?"__typename")/
            ];

            for (const pattern of patterns) {
              const match = content.match(pattern);
              if (match) {
                try {
                  const data = JSON.parse(match[1]);
                  if (data.shortcode_media || data.graphql?.shortcode_media) {
                    const postData = data.shortcode_media || data.graphql.shortcode_media;
                    console.log('[Instagram Downloader v2] Found via script parsing');
                    return {
                      shortcode,
                      post: postData,
                      method: 'scriptParsing'
                    };
                  }
                } catch (e) {
                  continue;
                }
              }
            }
          } catch (e) {
            continue;
          }
        }
      }

      // Method 4: Try Relay store if we have it
      if (relayStore) {
        console.log('[Instagram Downloader v2] Trying Relay store...');
        const postData = findPostInRelayStore(shortcode);
        if (postData) {
          console.log('[Instagram Downloader v2] Found via Relay store');
          return {
            shortcode,
            post: postData,
            method: 'relayStore'
          };
        }
      }

      // All methods failed
      return {
        error: 'Could not find post data. Please refresh the page and wait 10 seconds before extracting.',
        debug: {
          hasAdditionalData: !!window.__additionalDataLoaded__,
          hasSharedData: !!window._sharedData,
          hasRelayStore: !!relayStore,
          scriptsChecked: scripts.length
        }
      };

    } catch (error) {
      console.error('[Instagram Downloader v2] Error:', error);
      return { error: error.message };
    }
  }

  // Find post data in Relay store
  function findPostInRelayStore(shortcode) {
    if (!relayStore) return null;

    try {
      // Relay stores data with keys like "client:root:__connection..."
      // We need to find the post by shortcode
      const records = relayStore.getRecords();

      for (const [id, record] of Object.entries(records || {})) {
        if (record && record.shortcode === shortcode) {
          return record;
        }
      }
    } catch (e) {
      console.error('[Instagram Downloader v2] Error accessing Relay store:', e);
    }

    return null;
  }

  // Extract media URLs
  async function extractMedia() {
    try {
      const postData = await extractPostData();
      if (postData.error) return postData;

      const post = postData.post;
      const media = [];

      // Check for carousel (multiple items)
      if (post.edge_sidecar_to_children) {
        for (const edge of post.edge_sidecar_to_children.edges) {
          media.push(extractMediaItem(edge.node));
        }
      } else {
        // Single item
        media.push(extractMediaItem(post));
      }

      return { media };
    } catch (error) {
      console.error('[Instagram Downloader v2] Error extracting media:', error);
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

  // Extract comments
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
      console.error('[Instagram Downloader v2] Error extracting comments:', error);
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
  waitForInstagram(() => {
    window.postMessage({ type: 'INJECT_READY' }, '*');
  });

})();
