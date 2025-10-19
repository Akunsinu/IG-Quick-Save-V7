// inject-v5.js - Use XPlatRelayEnvironment.getRelayEnvironment() - THE SOLUTION!
(function() {
  'use strict';

  console.log('[IG DL v5] Starting - using XPlatRelayEnvironment...');

  let relayEnvironment = null;
  let relayStore = null;

  // Get Relay environment from XPlatRelayEnvironment module
  function getRelayEnvironment() {
    try {
      if (!window.require) {
        console.log('[IG DL v5] ❌ window.require not available yet');
        return false;
      }

      const XPlatRelay = window.require('XPlatRelayEnvironment');
      if (!XPlatRelay || !XPlatRelay.getRelayEnvironment) {
        console.log('[IG DL v5] ❌ XPlatRelayEnvironment.getRelayEnvironment not available');
        return false;
      }

      relayEnvironment = XPlatRelay.getRelayEnvironment();

      if (!relayEnvironment) {
        console.log('[IG DL v5] ❌ getRelayEnvironment() returned null');
        return false;
      }

      relayStore = relayEnvironment._store || relayEnvironment.getStore?.();

      if (!relayStore) {
        console.log('[IG DL v5] ❌ Could not get store from environment');
        return false;
      }

      window.__igRelayEnvironment = relayEnvironment;
      window.__igRelayStore = relayStore;

      console.log('[IG DL v5] ✅ Got Relay Environment!');
      console.log('[IG DL v5] Config:', relayEnvironment.configName);

      return true;

    } catch (error) {
      console.error('[IG DL v5] Error getting environment:', error);
      return false;
    }
  }

  // Get all records from store
  function getAllRelayRecords() {
    if (!relayStore) {
      console.log('[IG DL v5] ❌ No store available');
      return {};
    }

    try {
      const source = relayStore.getSource();
      if (!source) {
        console.log('[IG DL v5] ❌ Could not get source from store');
        return {};
      }

      const records = source.toJSON();
      console.log('[IG DL v5] 📊 Total records:', Object.keys(records).length);

      return records;

    } catch (error) {
      console.error('[IG DL v5] Error getting records:', error);
      return {};
    }
  }

  // Find post by shortcode
  function findPostByShortcode(shortcode) {
    console.log('[IG DL v5] 🔍 Searching for shortcode:', shortcode);

    const records = getAllRelayRecords();
    const recordCount = Object.keys(records).length;

    if (recordCount === 0) {
      console.log('[IG DL v5] ❌ No records in store');
      return null;
    }

    // Search all records
    for (const [id, record] of Object.entries(records)) {
      if (!record) continue;

      try {
        // Direct shortcode match
        if (record.shortcode === shortcode) {
          console.log('[IG DL v5] ✅ Found by shortcode! Type:', record.__typename);
          return record;
        }

        // Check typename for media types
        const typename = record.__typename;
        if (typename && (
          typename.includes('Graph') ||
          typename.includes('XDT') ||
          typename.includes('Media')
        )) {
          if (record.shortcode === shortcode) {
            console.log('[IG DL v5] ✅ Found by typename+shortcode! Type:', typename);
            return record;
          }
        }

      } catch (e) {
        continue;
      }
    }

    // Show what we have for debugging
    console.log('[IG DL v5] ❌ Post not found. Record types present:');
    const types = {};
    for (const record of Object.values(records)) {
      if (record && record.__typename) {
        types[record.__typename] = (types[record.__typename] || 0) + 1;
      }
    }
    console.table(types);

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

      // Get environment if we don't have it
      if (!relayEnvironment) {
        const success = getRelayEnvironment();
        if (!success) {
          return {
            error: 'Could not access Relay environment. Please wait 10 seconds and try again.',
            debug: {
              hasRequire: !!window.require,
              environmentFound: false
            }
          };
        }
      }

      // Wait a moment for data to load
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Search for post
      const postRecord = findPostByShortcode(shortcode);

      if (postRecord) {
        console.log('[IG DL v5] ✅ Successfully extracted post data');
        return {
          shortcode,
          post: postRecord,
          method: 'xplat-relay-environment'
        };
      }

      // Post not found - might not be loaded yet
      const records = getAllRelayRecords();
      return {
        error: 'Post data not loaded yet. Please wait 15 seconds and try again.',
        debug: {
          environmentFound: !!relayEnvironment,
          storeFound: !!relayStore,
          recordCount: Object.keys(records).length,
          shortcode: shortcode
        }
      };

    } catch (error) {
      console.error('[IG DL v5] Error:', error);
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

      // Handle carousel (multiple items)
      if (post.edge_sidecar_to_children?.edges) {
        for (const edge of post.edge_sidecar_to_children.edges) {
          media.push(extractMediaItem(edge.node));
        }
      } else {
        // Single item
        media.push(extractMediaItem(post));
      }

      console.log('[IG DL v5] ✅ Extracted', media.length, 'media items');
      return { media };

    } catch (error) {
      console.error('[IG DL v5] Error extracting media:', error);
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

      console.log('[IG DL v5] ✅ Extracted', comments.length, 'comments');
      return {
        total: commentEdge?.count || comments.length,
        comments
      };

    } catch (error) {
      console.error('[IG DL v5] Error extracting comments:', error);
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

  // Initialize - try to get environment immediately
  setTimeout(() => {
    const success = getRelayEnvironment();

    if (success) {
      const recordCount = Object.keys(getAllRelayRecords()).length;
      console.log('[IG DL v5] ✅ Ready! Store has', recordCount, 'records');
      window.postMessage({ type: 'INJECT_READY' }, '*');
    } else {
      console.log('[IG DL v5] ⚠️ Environment not ready, will retry...');
    }
  }, 2000);

  // Retry after longer delay
  setTimeout(() => {
    if (!relayEnvironment) {
      console.log('[IG DL v5] Retrying to get environment...');
      const success = getRelayEnvironment();

      if (success) {
        const recordCount = Object.keys(getAllRelayRecords()).length;
        console.log('[IG DL v5] ✅ Ready (retry)! Store has', recordCount, 'records');
        window.postMessage({ type: 'INJECT_READY' }, '*');
      }
    }
  }, 5000);

  // Final status
  setTimeout(() => {
    if (relayEnvironment) {
      const recordCount = Object.keys(getAllRelayRecords()).length;
      console.log('[IG DL v5] ✅ Final check: Active with', recordCount, 'records');
    } else {
      console.error('[IG DL v5] ❌ Final check: Failed to get environment');
    }
  }, 10000);

})();
