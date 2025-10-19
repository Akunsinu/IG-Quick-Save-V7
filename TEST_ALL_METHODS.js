// COMPREHENSIVE TEST - Try all possible methods to fetch comments
(async function testAllMethods() {
  console.log('=== COMPREHENSIVE COMMENTS API TEST ===\n');

  // Get current post info
  const url = window.location.href;
  const shortcodeMatch = url.match(/\/p\/([^\/\?]+)/);

  if (!shortcodeMatch) {
    console.error('❌ Not on a post page');
    return;
  }

  const shortcode = shortcodeMatch[1];
  console.log('📍 Post shortcode:', shortcode);

  // Find media ID from embedded data
  let mediaId = null;
  let postData = null;

  const scripts = document.querySelectorAll('script[type="application/json"]');
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
              if (post.code === shortcode) {
                mediaId = post.pk;
                postData = post;
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
    console.error('❌ Could not find media ID');
    return;
  }

  console.log('✅ Media ID:', mediaId);
  console.log('✅ Post has', postData.comment_count, 'total comments\n');

  // ============================================================
  // METHOD 1: PolarisApiInjectPlugin
  // ============================================================
  console.log('--- METHOD 1: PolarisApiInjectPlugin ---');
  try {
    if (!window.require) {
      console.log('❌ window.require not available');
    } else {
      const plugin = window.require('PolarisApiInjectPlugin');
      console.log('Module result:', plugin);

      if (plugin && plugin.apiGet) {
        const response = await plugin.apiGet(
          '/api/v1/media/' + mediaId + '/comments/',
          { query: { can_support_threading: true }, path: { id: mediaId } }
        );
        console.log('✅ SUCCESS! Response:', response);
        if (response?.data?.comments) {
          console.log('✅ Got', response.data.comments.length, 'comments');
          return response.data.comments;
        }
      } else {
        console.log('❌ Module undefined or no apiGet method');
      }
    }
  } catch (e) {
    console.log('❌ Error:', e.message);
  }

  // ============================================================
  // METHOD 2: Direct fetch with credentials
  // ============================================================
  console.log('\n--- METHOD 2: Direct fetch() ---');
  try {
    const response = await fetch(
      `https://www.instagram.com/api/v1/media/${mediaId}/comments/?can_support_threading=true&permalink_enabled=false`,
      {
        method: 'GET',
        credentials: 'include',
        headers: {
          'X-IG-App-ID': '936619743392459',
          'X-ASBD-ID': '198387',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      console.log('✅ SUCCESS! Response:', data);
      if (data.comments) {
        console.log('✅ Got', data.comments.length, 'comments');
        return data.comments;
      }
    } else {
      console.log('❌ HTTP', response.status, response.statusText);
      const text = await response.text();
      console.log('Response:', text.substring(0, 200));
    }
  } catch (e) {
    console.log('❌ Error:', e.message);
  }

  // ============================================================
  // METHOD 3: Try other Instagram modules
  // ============================================================
  console.log('\n--- METHOD 3: Alternative modules ---');

  const modulesToTry = [
    'IGDApi',
    'PolarisAPIUtils',
    'PolarisWebGraph',
    'WebGraphQL',
    'RelayAPIConfigDefaults',
    'PolarisGraphQLBlueServiceClient'
  ];

  for (const moduleName of modulesToTry) {
    try {
      const module = window.require(moduleName);
      console.log(`${moduleName}:`, module ? 'loaded' : 'undefined');
      if (module) {
        console.log('  Methods:', Object.keys(module).slice(0, 10));
      }
    } catch (e) {
      console.log(`${moduleName}: error -`, e.message);
    }
  }

  // ============================================================
  // METHOD 4: Search for API functions in window.require
  // ============================================================
  console.log('\n--- METHOD 4: Search require modules ---');
  try {
    // Try to find all modules with 'api' or 'comment' in them
    console.log('Searching for API-related modules...');

    // This is a hack - try common module IDs
    for (let i = 0; i < 100; i++) {
      try {
        const mod = window.require(i.toString());
        if (mod && typeof mod === 'object') {
          const keys = Object.keys(mod);
          if (keys.some(k => k.toLowerCase().includes('comment') || k.toLowerCase().includes('api'))) {
            console.log(`Module ${i}:`, keys);
          }
        }
      } catch (e) {
        // Skip
      }
    }
  } catch (e) {
    console.log('Error searching modules:', e.message);
  }

  // ============================================================
  // METHOD 5: Check if requireLazy works
  // ============================================================
  console.log('\n--- METHOD 5: requireLazy ---');
  if (window.requireLazy) {
    console.log('✅ requireLazy exists');
    try {
      window.requireLazy(['PolarisApiInjectPlugin'], (module) => {
        console.log('requireLazy result:', module);
      });
    } catch (e) {
      console.log('❌ Error:', e.message);
    }
  } else {
    console.log('❌ requireLazy not available');
  }

  // ============================================================
  // METHOD 6: Look for existing API client instances
  // ============================================================
  console.log('\n--- METHOD 6: Search window for API clients ---');
  const searchProps = ['_sharedData', '__additionalDataLoaded__', 'requireLazy', '__d', '_deferredData'];
  searchProps.forEach(prop => {
    if (window[prop]) {
      console.log(`✅ window.${prop} exists`);
    }
  });

  console.log('\n=== TEST COMPLETE ===');
  console.log('If none of the methods worked, we need to use a different approach.');
})();
