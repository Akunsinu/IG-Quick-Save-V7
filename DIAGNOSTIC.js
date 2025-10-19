// DIAGNOSTIC SCRIPT - Copy and paste this entire script into Console on an Instagram post page
// This will show us what data sources are actually available

(function() {
  console.log('========================================');
  console.log('INSTAGRAM DATA DIAGNOSTIC');
  console.log('========================================\n');

  const url = window.location.href;
  const shortcodeMatch = url.match(/\/p\/([^\/\?]+)/);

  console.log('📍 URL:', url);
  console.log('📍 Shortcode:', shortcodeMatch ? shortcodeMatch[1] : 'NOT A POST PAGE');
  console.log('\n');

  // Check 1: window.__additionalDataLoaded__
  console.log('1️⃣ window.__additionalDataLoaded__');
  if (window.__additionalDataLoaded__) {
    console.log('   ✅ EXISTS');
    const paths = Object.keys(window.__additionalDataLoaded__);
    console.log('   📁 Paths:', paths);

    let foundPost = false;
    for (const [path, data] of Object.entries(window.__additionalDataLoaded__)) {
      console.log(`   🔍 Checking path: ${path}`);

      if (data && typeof data === 'object') {
        console.log('      - Has data:', !!data);
        console.log('      - Has graphql:', !!data.graphql);
        console.log('      - Has shortcode_media:', !!data.graphql?.shortcode_media);

        if (data.graphql && data.graphql.shortcode_media) {
          foundPost = true;
          console.log('      ✅ FOUND POST DATA HERE!');
          console.log('      - Type:', data.graphql.shortcode_media.__typename);
          console.log('      - Shortcode:', data.graphql.shortcode_media.shortcode);
          console.log('      - Is video:', data.graphql.shortcode_media.is_video);
          console.log('      - Has display_url:', !!data.graphql.shortcode_media.display_url);
          console.log('      - Has video_url:', !!data.graphql.shortcode_media.video_url);
          console.log('      - Has carousel:', !!data.graphql.shortcode_media.edge_sidecar_to_children);
          console.log('      - Has comments:', !!data.graphql.shortcode_media.edge_media_to_parent_comment);

          // Show the actual structure
          console.log('      📊 Full structure keys:', Object.keys(data.graphql.shortcode_media));
        }
      }
    }

    if (!foundPost) {
      console.log('   ❌ No shortcode_media found in any path');
    }
  } else {
    console.log('   ❌ DOES NOT EXIST');
  }
  console.log('\n');

  // Check 2: window._sharedData
  console.log('2️⃣ window._sharedData');
  if (window._sharedData) {
    console.log('   ✅ EXISTS');
    console.log('   📁 Keys:', Object.keys(window._sharedData));

    if (window._sharedData.entry_data) {
      console.log('   📁 entry_data keys:', Object.keys(window._sharedData.entry_data));

      if (window._sharedData.entry_data.PostPage) {
        console.log('   ✅ HAS PostPage');
        const postPage = window._sharedData.entry_data.PostPage[0];
        console.log('   - Has graphql:', !!postPage?.graphql);
        console.log('   - Has shortcode_media:', !!postPage?.graphql?.shortcode_media);

        if (postPage?.graphql?.shortcode_media) {
          console.log('   ✅ FOUND POST DATA HERE!');
        }
      } else {
        console.log('   ❌ No PostPage in entry_data');
      }
    }
  } else {
    console.log('   ❌ DOES NOT EXIST');
  }
  console.log('\n');

  // Check 3: Script tags
  console.log('3️⃣ Script Tags');
  const scripts = document.querySelectorAll('script:not([src])');
  console.log(`   📄 Found ${scripts.length} inline scripts`);

  let foundInScript = 0;
  scripts.forEach((script, i) => {
    const content = script.textContent;
    if (content.includes('shortcode_media') && shortcodeMatch && content.includes(shortcodeMatch[1])) {
      foundInScript++;
      console.log(`   ✅ Script ${i} contains "shortcode_media" and shortcode`);
      console.log(`      First 200 chars: ${content.substring(0, 200)}...`);
    }
  });

  if (foundInScript === 0) {
    console.log('   ❌ No scripts contain shortcode_media for this post');
  }
  console.log('\n');

  // Check 4: React Fiber
  console.log('4️⃣ React Fiber');
  const roots = [
    document.querySelector('#react-root'),
    document.querySelector('main'),
    document.body
  ];

  let fiberFound = false;
  for (const root of roots) {
    if (!root) continue;

    const keys = Object.keys(root).filter(k =>
      k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
    );

    if (keys.length > 0) {
      console.log(`   ✅ Found React Fiber on ${root.tagName}: ${keys[0]}`);
      fiberFound = true;
      break;
    }
  }

  if (!fiberFound) {
    console.log('   ❌ No React Fiber found');
  }
  console.log('\n');

  // Check 5: Instagram internals
  console.log('5️⃣ Instagram Internals');
  console.log('   - window.require:', typeof window.require);
  console.log('   - window.requireLazy:', typeof window.requireLazy);
  console.log('   - window.__d:', typeof window.__d);
  console.log('\n');

  // Check 6: DOM media
  console.log('6️⃣ DOM Media Elements');
  const articleImages = document.querySelectorAll('article img');
  const articleVideos = document.querySelectorAll('article video');
  console.log(`   - article img: ${articleImages.length}`);
  console.log(`   - article video: ${articleVideos.length}`);

  if (articleImages.length > 0) {
    const largeImages = Array.from(articleImages).filter(img =>
      img.naturalWidth >= 300 || img.width >= 300
    );
    console.log(`   - Large images (300px+): ${largeImages.length}`);
  }
  console.log('\n');

  // Summary
  console.log('========================================');
  console.log('SUMMARY');
  console.log('========================================');

  const checks = {
    '__additionalDataLoaded__': !!window.__additionalDataLoaded__,
    '_sharedData': !!window._sharedData,
    'PostPage in _sharedData': !!window._sharedData?.entry_data?.PostPage,
    'shortcode_media in scripts': foundInScript > 0,
    'React Fiber': fiberFound,
    'Instagram require': !!(window.require || window.requireLazy)
  };

  console.table(checks);

  console.log('\n📋 COPY THE ABOVE OUTPUT AND SEND IT');
  console.log('========================================\n');

})();
