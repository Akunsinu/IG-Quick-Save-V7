// inject-v7-final.js - Read comments from Relay store after user scrolls to them
(function() {
  'use strict';

  console.log('[IG DL v7] Starting - will read comments from Relay store...');

  let cachedPostData = null;

  // Parse post data from script tags
  function parsePostDataFromScripts() {
    try {
      const url = window.location.href;
      const shortcodeMatch = url.match(/\/p\/([^\/\?]+)/);

      if (!shortcodeMatch) {
        return { error: 'Not on a post page' };
      }

      const shortcode = shortcodeMatch[1];

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

      return { error: 'Post data not found' };

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

  // Fetch child comments (replies) for a parent comment
  async function fetchChildComments(mediaId, commentId) {
    try {
      const allReplies = [];
      let hasMore = true;
      let minId = null;
      let requestCount = 0;
      const maxRequests = 20; // Safety limit for replies

      while (hasMore && requestCount < maxRequests) {
        requestCount++;

        // Build URL with pagination
        let url = `https://www.instagram.com/api/v1/media/${mediaId}/comments/${commentId}/child_comments/`;
        if (minId) {
          url += `?min_id=${minId}`;
        }

        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'X-IG-App-ID': '936619743392459',
            'X-ASBD-ID': '198387',
            'X-Requested-With': 'XMLHttpRequest'
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.child_comments || !Array.isArray(data.child_comments)) {
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
          await new Promise(resolve => setTimeout(resolve, 300));
        } else {
          hasMore = false;
        }
      }

      return allReplies;

    } catch (error) {
      console.error('[IG DL v7] Error fetching child comments:', error);
      return []; // Return empty array on error, don't break the whole process
    }
  }

  // Fetch comments using direct API call (tested and working!)
  async function fetchCommentsViaAPI(mediaId) {
    try {
      console.log('[IG DL v7] Fetching comments via direct API call...');

      const allComments = [];
      let hasMore = true;
      let maxId = null;
      let requestCount = 0;
      const maxRequests = 50; // Safety limit

      // Fetch main comments with pagination
      while (hasMore && requestCount < maxRequests) {
        requestCount++;

        // Build URL with pagination
        let url = `https://www.instagram.com/api/v1/media/${mediaId}/comments/?can_support_threading=true&permalink_enabled=false`;
        if (maxId) {
          url += `&max_id=${maxId}`;
        }

        console.log('[IG DL v7] Request', requestCount, '- Fetching main comments from:', url);

        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'X-IG-App-ID': '936619743392459',
            'X-ASBD-ID': '198387',
            'X-Requested-With': 'XMLHttpRequest'
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.comments || !Array.isArray(data.comments)) {
          console.warn('[IG DL v7] No comments array in response');
          break;
        }

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

        console.log('[IG DL v7] Got', data.comments.length, 'main comments in this batch. Total so far:', allComments.length);

        // Check if there are more comments to fetch
        if (data.has_more_comments && data.next_max_id) {
          maxId = data.next_max_id;
          console.log('[IG DL v7] More comments available, next_max_id:', maxId);
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          hasMore = false;
          console.log('[IG DL v7] No more main comments to fetch');
        }
      }

      console.log('[IG DL v7] ✅ Fetched total of', allComments.length, 'main comments');

      // Now fetch replies for each comment that has them
      console.log('[IG DL v7] Checking for replies...');
      let totalReplies = 0;

      for (let i = 0; i < allComments.length; i++) {
        const comment = allComments[i];

        if (comment.child_comment_count > 0) {
          console.log(`[IG DL v7] Fetching ${comment.child_comment_count} replies for comment ${i + 1}/${allComments.length}...`);

          const replies = await fetchChildComments(mediaId, comment.id);
          comment.replies = replies;
          totalReplies += replies.length;

          console.log(`[IG DL v7] ✅ Got ${replies.length} replies`);

          // Small delay between reply fetches
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      console.log('[IG DL v7] ✅ Fetched total of', totalReplies, 'replies across all comments');
      console.log('[IG DL v7] ✅ Grand total:', allComments.length, 'comments +', totalReplies, 'replies =', allComments.length + totalReplies, 'total');

      return allComments;

    } catch (error) {
      console.error('[IG DL v7] Error fetching via API:', error);
      throw error;
    }
  }

  // Extract comments
  async function extractComments() {
    try {
      const postData = await extractPostData();
      if (postData.error) return postData;

      const post = postData.post;

      console.log('[IG DL v7] Fetching comments for media ID:', post.pk);
      console.log('[IG DL v7] Post has', post.comment_count, 'total comments');

      // Fetch comments using direct API call (tested and working!)
      const comments = await fetchCommentsViaAPI(post.pk);

      console.log('[IG DL v7] ✅ Extracted', comments.length, 'comments');

      // Count total replies
      const totalReplies = comments.reduce((sum, comment) => sum + (comment.replies?.length || 0), 0);

      // Build post metadata
      const postInfo = {
        username: post.owner?.username || 'unknown',
        full_name: post.owner?.full_name || '',
        user_id: post.owner?.pk || post.owner?.id || '',
        profile_pic_url: post.owner?.profile_pic_url || '',
        post_url: 'https://www.instagram.com/p/' + post.code,
        shortcode: post.code,
        caption: post.caption?.text || '',
        like_count: post.like_count || 0,
        comment_count: post.comment_count || 0,
        posted_at: post.taken_at ? new Date(post.taken_at * 1000).toISOString() : '',
        posted_at_timestamp: post.taken_at || 0,
        media_type: post.media_type === 2 ? 'Video' : post.media_type === 8 ? 'Carousel' : 'Image',
        is_video: post.media_type === 2
      };

      return {
        post_info: postInfo,
        total: post.comment_count || comments.length,
        total_comments: comments.length,
        total_replies: totalReplies,
        comments,
        note: null
      };

    } catch (error) {
      console.error('[IG DL v7] Error extracting comments:', error);

      // If API fails, show helpful error
      return {
        total: 0,
        comments: [],
        error: 'Could not fetch comments: ' + error.message,
        note: 'Please make sure you are logged into Instagram and have access to view comments on this post.'
      };
    }
  }

  // Extract media
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

      // Build post metadata (same as in extractComments)
      const postInfo = {
        username: post.owner?.username || 'unknown',
        full_name: post.owner?.full_name || '',
        user_id: post.owner?.pk || post.owner?.id || '',
        profile_pic_url: post.owner?.profile_pic_url || '',
        post_url: 'https://www.instagram.com/p/' + post.code,
        shortcode: post.code,
        caption: post.caption?.text || '',
        like_count: post.like_count || 0,
        comment_count: post.comment_count || 0,
        posted_at: post.taken_at ? new Date(post.taken_at * 1000).toISOString() : '',
        posted_at_timestamp: post.taken_at || 0,
        media_type: post.media_type === 2 ? 'Video' : post.media_type === 8 ? 'Carousel' : 'Image',
        is_video: post.media_type === 2
      };

      return {
        media,
        post_info: postInfo
      };

    } catch (error) {
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
    const result = parsePostDataFromScripts();

    if (result.post) {
      console.log('[IG DL v7] ✅ Ready! Post data parsed');
      console.log('[IG DL v7] 📝 To get comments: Scroll to comments section, then extract again');
      window.postMessage({ type: 'INJECT_READY' }, '*');
    }
  }, 1000);

})();
