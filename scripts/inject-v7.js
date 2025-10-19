// inject-v7.js - Use Instagram's internal IGDApi to fetch comments (ESUIT's method!)
(function() {
  'use strict';

  console.log('[IG DL v7] Starting - using IGDApi for comments...');

  let cachedPostData = null;
  let IGDApi = null;

  // Initialize Instagram's API module
  function initIGDApi() {
    try {
      if (!window.require) {
        console.log('[IG DL v7] window.require not available yet');
        return false;
      }

      IGDApi = window.require('IGDApi');

      if (!IGDApi) {
        console.log('[IG DL v7] IGDApi module not available');
        return false;
      }

      console.log('[IG DL v7] ✅ IGDApi module loaded');
      return true;

    } catch (error) {
      console.log('[IG DL v7] Could not load IGDApi:', error.message);
      return false;
    }
  }

  // Parse post data from embedded script tags (same as v6)
  function parsePostDataFromScripts() {
    try {
      const url = window.location.href;
      const shortcodeMatch = url.match(/\/p\/([^\/\?]+)/);

      if (!shortcodeMatch) {
        return { error: 'Not on a post page' };
      }

      const shortcode = shortcodeMatch[1];
      console.log('[IG DL v7] Looking for shortcode:', shortcode);

      const scripts = document.querySelectorAll('script[type="application/json"]');
      console.log('[IG DL v7] Found', scripts.length, 'JSON script tags');

      for (let i = 0; i < scripts.length; i++) {
        const script = scripts[i];
        const content = script.textContent;

        if (!content.includes(shortcode)) continue;

        console.log('[IG DL v7] Script', i, 'contains shortcode, parsing...');

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
                    console.log('[IG DL v7] ✅ Found post data!');
                    cachedPostData = post;
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

      return {
        error: 'Post data not found in page scripts.',
        debug: { scriptsChecked: scripts.length }
      };

    } catch (error) {
      console.error('[IG DL v7] Error:', error);
      return { error: error.message };
    }
  }

  // Extract post data
  async function extractPostData() {
    if (cachedPostData) {
      const url = window.location.href;
      const shortcode = url.match(/\/p\/([^\/\?]+)/)[1];
      return { shortcode, post: cachedPostData, method: 'cached' };
    }

    return parsePostDataFromScripts();
  }

  // Fetch comments using Instagram's internal IGDApi (ESUIT's method)
  async function fetchCommentsViaAPI(mediaId) {
    try {
      if (!IGDApi) {
        const success = initIGDApi();
        if (!success) {
          throw new Error('IGDApi not available');
        }
      }

      console.log('[IG DL v7] Fetching comments for media ID:', mediaId);

      // Use Instagram's internal REST API (same as ESUIT)
      const response = await IGDApi.apiGet(
        '/api/v1/media/' + mediaId + '/comments/',
        {
          query: {
            can_support_threading: true,
            sort_order: 'chronological'
          },
          path: { id: mediaId }
        }
      );

      console.log('[IG DL v7] API response:', response);

      if (response && response.comments) {
        return response.comments;
      }

      return [];

    } catch (error) {
      console.error('[IG DL v7] Error fetching comments via API:', error);
      throw error;
    }
  }

  // Extract comments
  async function extractComments() {
    try {
      const postData = await extractPostData();
      if (postData.error) return postData;

      const post = postData.post;
      const comments = [];

      console.log('[IG DL v7] Attempting to fetch comments via IGDApi...');

      try {
        // Fetch comments using Instagram's internal API
        const apiComments = await fetchCommentsViaAPI(post.pk);

        console.log('[IG DL v7] Fetched', apiComments.length, 'comments from API');

        // Transform API response to our format
        for (const comment of apiComments) {
          comments.push({
            id: comment.pk || comment.id,
            text: comment.text || '',
            created_at: comment.created_at || comment.created_at_utc,
            owner: {
              id: comment.user?.pk,
              username: comment.user?.username,
              profile_pic_url: comment.user?.profile_pic_url
            },
            like_count: comment.comment_like_count || 0,
            replies: [] // TODO: Fetch nested comments if needed
          });
        }

      } catch (apiError) {
        console.log('[IG DL v7] API fetch failed:', apiError.message);
        console.log('[IG DL v7] Falling back to embedded preview comments...');

        // Fallback: use preview_comments from embedded data
        if (post.preview_comments && Array.isArray(post.preview_comments)) {
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
      }

      console.log('[IG DL v7] ✅ Extracted', comments.length, 'comments');

      return {
        total: post.comment_count || comments.length,
        comments,
        note: comments.length === 0 ? 'Could not fetch comments via API. Instagram may have changed their API structure.' : null
      };

    } catch (error) {
      console.error('[IG DL v7] Error extracting comments:', error);
      return { error: error.message };
    }
  }

  // Extract media (same as v6)
  async function extractMedia() {
    try {
      const postData = await extractPostData();
      if (postData.error) return postData;

      const post = postData.post;
      const media = [];

      if (post.carousel_media && Array.isArray(post.carousel_media)) {
        for (const item of post.carousel_media) {
          media.push(extractMediaItem(item));
        }
      } else {
        media.push(extractMediaItem(post));
      }

      console.log('[IG DL v7] ✅ Extracted', media.length, 'media items');
      return { media };

    } catch (error) {
      console.error('[IG DL v7] Error extracting media:', error);
      return { error: error.message };
    }
  }

  // Extract single media item (same as v6)
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
  setTimeout(() => {
    // Try to load IGDApi
    initIGDApi();

    // Parse post data
    const result = parsePostDataFromScripts();

    if (result.post) {
      console.log('[IG DL v7] ✅ Ready! Post data parsed');
      window.postMessage({ type: 'INJECT_READY' }, '*');
    } else {
      console.log('[IG DL v7] ⚠️ Post data not found yet');
    }
  }, 1000);

  setTimeout(() => {
    if (cachedPostData) {
      console.log('[IG DL v7] ✅ Final check: Ready with IGDApi');
    } else {
      console.error('[IG DL v7] ❌ Final check: Post data not found');
    }
  }, 3000);

})();
