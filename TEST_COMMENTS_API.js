// TEST SCRIPT - Run this in browser console on an Instagram post page
// This tests if PolarisApiInjectPlugin can fetch comments

(async function testCommentsAPI() {
  console.log('[TEST] Starting comments API test...');

  // Step 1: Check if window.require exists
  if (!window.require) {
    console.error('[TEST] ❌ window.require is not available');
    return;
  }
  console.log('[TEST] ✅ window.require is available');

  // Step 2: Try to load PolarisApiInjectPlugin
  let apiPlugin;
  try {
    apiPlugin = window.require('PolarisApiInjectPlugin');
    console.log('[TEST] ✅ PolarisApiInjectPlugin loaded:', apiPlugin);
  } catch (error) {
    console.error('[TEST] ❌ Failed to load PolarisApiInjectPlugin:', error);
    return;
  }

  if (!apiPlugin) {
    console.error('[TEST] ❌ PolarisApiInjectPlugin is undefined/null');
    return;
  }

  // Step 3: Check if apiGet method exists
  if (!apiPlugin.apiGet) {
    console.error('[TEST] ❌ PolarisApiInjectPlugin.apiGet method not found');
    console.log('[TEST] Available methods:', Object.keys(apiPlugin));
    return;
  }
  console.log('[TEST] ✅ apiGet method exists');

  // Step 4: Get media ID from current post
  const url = window.location.href;
  const shortcodeMatch = url.match(/\/p\/([^\/\?]+)/);

  if (!shortcodeMatch) {
    console.error('[TEST] ❌ Not on a post page');
    return;
  }

  console.log('[TEST] ✅ On post page with shortcode:', shortcodeMatch[1]);

  // Step 5: Get media ID from embedded data
  const scripts = document.querySelectorAll('script[type="application/json"]');
  let mediaId = null;

  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
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
              if (post.code === shortcodeMatch[1]) {
                mediaId = post.pk;
                break;
              }
            }
          }
          if (mediaId) break;
        }
        if (mediaId) break;
      }
    } catch (e) {
      continue;
    }
  }

  if (!mediaId) {
    console.error('[TEST] ❌ Could not find media ID in embedded data');
    return;
  }

  console.log('[TEST] ✅ Found media ID:', mediaId);

  // Step 6: Try to fetch comments using the API
  console.log('[TEST] Attempting to fetch comments...');

  try {
    const response = await apiPlugin.apiGet(
      '/api/v1/media/' + mediaId + '/comments/',
      {
        query: {
          can_support_threading: true,
          sort_order: 'popular'
        },
        path: { id: mediaId }
      }
    );

    console.log('[TEST] ✅ API Response:', response);

    if (response && response.data) {
      const comments = response.data.comments || [];
      console.log('[TEST] ✅ SUCCESS! Fetched', comments.length, 'comments');
      console.log('[TEST] Sample comment:', comments[0]);
      return comments;
    } else {
      console.warn('[TEST] ⚠️ Response received but no data property');
      console.log('[TEST] Full response:', response);
    }

  } catch (error) {
    console.error('[TEST] ❌ API call failed:', error);
    console.error('[TEST] Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
  }
})();
