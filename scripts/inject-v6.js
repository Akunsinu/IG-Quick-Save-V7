// inject-v6.js - Parse embedded post data from script tags (THE REAL SOLUTION!)
(function() {
  'use strict';

  console.log('[IG DL v6] Parsing embedded post data from HTML...');

  let cachedPostData = null;

  // Parse post data from embedded script tags
  function parsePostDataFromScripts() {
    try {
      const url = window.location.href;
      const shortcodeMatch = url.match(/\/p\/([^\/\?]+)/);

      if (!shortcodeMatch) {
        return { error: 'Not on a post page' };
      }

      const shortcode = shortcodeMatch[1];
      console.log('[IG DL v6] Looking for shortcode:', shortcode);

      // Find all script tags
      const scripts = document.querySelectorAll('script[type="application/json"]');
      console.log('[IG DL v6] Found', scripts.length, 'JSON script tags');

      for (let i = 0; i < scripts.length; i++) {
        const script = scripts[i];
        const content = script.textContent;

        // Check if this script contains our shortcode
        if (!content.includes(shortcode)) continue;

        console.log('[IG DL v6] Script', i, 'contains shortcode, parsing...');

        try {
          const data = JSON.parse(content);

          // Look for RelayPrefetchedStreamCache in require data
          if (data.require && Array.isArray(data.require)) {
            for (const requireItem of data.require) {
              if (!Array.isArray(requireItem) || requireItem.length < 4) continue;

              const bbox = requireItem[3];
              if (!bbox || !Array.isArray(bbox) || !bbox[0] || !bbox[0].__bbox) continue;

              const bboxRequire = bbox[0].__bbox.require;
              if (!bboxRequire || !Array.isArray(bboxRequire)) continue;

              // Find RelayPrefetchedStreamCache
              for (const cacheItem of bboxRequire) {
                if (!Array.isArray(cacheItem) || cacheItem[0] !== 'RelayPrefetchedStreamCache') continue;

                console.log('[IG DL v6] Found RelayPrefetchedStreamCache!');

                const cacheData = cacheItem[3];
                if (!cacheData || !Array.isArray(cacheData) || cacheData.length < 2) continue;

                const cacheEntry = cacheData[1];
                if (!cacheEntry || !cacheEntry.__bbox || !cacheEntry.__bbox.result) continue;

                const resultData = cacheEntry.__bbox.result.data;
                if (!resultData) continue;

                // Check for post data
                const mediaInfo = resultData.xdt_api__v1__media__shortcode__web_info;
                if (mediaInfo && mediaInfo.items && mediaInfo.items.length > 0) {
                  const post = mediaInfo.items[0];

                  if (post.code === shortcode) {
                    console.log('[IG DL v6] ✅ Found post data!');
                    cachedPostData = post;
                    window.__foundPost = post;
                    return { shortcode, post, method: 'script-tag-parsing' };
                  }
                }
              }
            }
          }

        } catch (parseError) {
          // This script didn't have the data we need, continue
          continue;
        }
      }

      return {
        error: 'Post data not found in page scripts. Page may still be loading.',
        debug: { scriptsChecked: scripts.length }
      };

    } catch (error) {
      console.error('[IG DL v6] Error:', error);
      return { error: error.message };
    }
  }

  // Extract post data
  async function extractPostData() {
    if (cachedPostData) {
      console.log('[IG DL v6] Using cached post data');
      const url = window.location.href;
      const shortcode = url.match(/\/p\/([^\/\?]+)/)[1];
      return { shortcode, post: cachedPostData, method: 'cached' };
    }

    return parsePostDataFromScripts();
  }

  // Extract media from post
  async function extractMedia() {
    try {
      const postData = await extractPostData();
      if (postData.error) return postData;

      const post = postData.post;
      const media = [];

      // Check if it's a carousel (multiple items)
      if (post.carousel_media && Array.isArray(post.carousel_media)) {
        console.log('[IG DL v6] Carousel with', post.carousel_media.length, 'items');

        for (const item of post.carousel_media) {
          media.push(extractMediaItem(item));
        }
      } else {
        // Single item
        media.push(extractMediaItem(post));
      }

      console.log('[IG DL v6] ✅ Extracted', media.length, 'media items');
      return { media };

    } catch (error) {
      console.error('[IG DL v6] Error extracting media:', error);
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

    // Video
    if (item.video_versions && item.video_versions.length > 0) {
      // Get highest quality video (first in array is usually highest)
      const highestQuality = item.video_versions[0];
      mediaItem.video_url = highestQuality.url;
      mediaItem.width = highestQuality.width;
      mediaItem.height = highestQuality.height;

      // Thumbnail
      if (item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates.length > 0) {
        mediaItem.thumbnail_url = item.image_versions2.candidates[0].url;
      }
    }
    // Image
    else if (item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates.length > 0) {
      // Get highest quality image (first in array)
      const highestQuality = item.image_versions2.candidates[0];
      mediaItem.image_url = highestQuality.url;
      mediaItem.width = highestQuality.width;
      mediaItem.height = highestQuality.height;
    }

    return mediaItem;
  }

  // Extract comments from Relay store
  async function extractComments() {
    try {
      const postData = await extractPostData();
      if (postData.error) return postData;

      const post = postData.post;
      const comments = [];

      console.log('[IG DL v6] Attempting to get comments from Relay store...');

      // Try to get comments from Relay environment
      try {
        if (!window.require) {
          throw new Error('window.require not available');
        }

        const XPlatRelay = window.require('XPlatRelayEnvironment');
        const env = XPlatRelay.getRelayEnvironment();
        const store = env._store || env.getStore?.();

        if (store) {
          const source = store.getSource();
          const records = source.toJSON();

          console.log('[IG DL v6] Searching', Object.keys(records).length, 'Relay records for comments...');

          // Search for comment records
          for (const [id, record] of Object.entries(records)) {
            if (!record || !record.__typename) continue;

            // Look for comment types
            if (record.__typename === 'Comment' ||
                record.__typename === 'XDTComment' ||
                id.includes('Comment')) {

              // Check if this comment belongs to our post
              const recordStr = JSON.stringify(record);
              if (recordStr.includes(post.pk) || recordStr.includes(post.code)) {
                console.log('[IG DL v6] Found comment:', record.text?.substring(0, 50));

                comments.push({
                  id: record.pk || record.id,
                  text: record.text || '',
                  created_at: record.created_at || record.created_at_utc,
                  owner: {
                    id: record.user?.pk || record.owner?.pk,
                    username: record.user?.username || record.owner?.username,
                    profile_pic_url: record.user?.profile_pic_url || record.owner?.profile_pic_url
                  },
                  like_count: record.comment_like_count || 0,
                  replies: []
                });
              }
            }

            // Also check for edges with comments
            if (record.edge_media_to_comment || record.edge_media_to_parent_comment) {
              const commentEdge = record.edge_media_to_comment || record.edge_media_to_parent_comment;

              if (commentEdge.edges && Array.isArray(commentEdge.edges)) {
                console.log('[IG DL v6] Found comment edge with', commentEdge.edges.length, 'comments');

                for (const edge of commentEdge.edges) {
                  const comment = edge.node;
                  comments.push({
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
                  });
                }
              }
            }
          }
        }
      } catch (relayError) {
        console.log('[IG DL v6] Could not get comments from Relay:', relayError.message);
      }

      // Fallback: check if comments are in the embedded post data
      if (comments.length === 0 && post.preview_comments && Array.isArray(post.preview_comments)) {
        for (const comment of post.preview_comments) {
          comments.push({
            id: comment.pk,
            text: comment.text,
            created_at: comment.created_at,
            owner: {
              id: comment.user?.pk,
              username: comment.user?.username,
              profile_pic_url: comment.user?.profile_pic_url
            },
            like_count: comment.comment_like_count || 0,
            replies: []
          });
        }
      }

      console.log('[IG DL v6] ✅ Extracted', comments.length, 'comments');

      return {
        total: post.comment_count || comments.length,
        comments,
        note: comments.length === 0 ? 'Comments are loaded separately by Instagram. Try scrolling to the comments section first, then extract again.' : null
      };

    } catch (error) {
      console.error('[IG DL v6] Error extracting comments:', error);
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

  // Initialize - try to parse immediately
  setTimeout(() => {
    const result = parsePostDataFromScripts();

    if (result.post) {
      console.log('[IG DL v6] ✅ Ready! Post data parsed successfully');
      console.log('[IG DL v6] Media type:', result.post.media_type === 2 ? 'Video' : 'Image');
      console.log('[IG DL v6] Has carousel:', !!result.post.carousel_media);
      window.postMessage({ type: 'INJECT_READY' }, '*');
    } else {
      console.log('[IG DL v6] ⚠️ Post data not found yet, will retry...');
    }
  }, 1000);

  // Retry after delay (in case scripts load later)
  setTimeout(() => {
    if (!cachedPostData) {
      console.log('[IG DL v6] Retrying post data extraction...');
      const result = parsePostDataFromScripts();

      if (result.post) {
        console.log('[IG DL v6] ✅ Ready (retry)! Post data parsed successfully');
        window.postMessage({ type: 'INJECT_READY' }, '*');
      }
    }
  }, 3000);

  // Final status
  setTimeout(() => {
    if (cachedPostData) {
      console.log('[IG DL v6] ✅ Final check: Post data cached and ready');
    } else {
      console.error('[IG DL v6] ❌ Final check: Could not find post data in scripts');
    }
  }, 5000);

})();
