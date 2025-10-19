// TEST SCRIPT - Check reply comment structure and fetch them
(async function testReplies() {
  console.log('=== TESTING REPLY COMMENTS ===\n');

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

  // Step 1: Fetch main comments
  console.log('\n--- STEP 1: Fetch Main Comments ---');
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

  const data = await response.json();
  console.log('Main comments response:', data);
  console.log('Number of main comments:', data.comments?.length || 0);

  if (!data.comments || data.comments.length === 0) {
    console.log('❌ No comments found');
    return;
  }

  // Step 2: Examine comment structure for reply info
  console.log('\n--- STEP 2: Check Comment Structure ---');
  const firstComment = data.comments[0];
  console.log('First comment structure:', firstComment);
  console.log('\nLooking for reply indicators...');

  const replyFields = [
    'child_comment_count',
    'has_more_child_comments',
    'num_child_comments',
    'comment_count',
    'preview_child_comments',
    'child_comments'
  ];

  replyFields.forEach(field => {
    if (firstComment[field] !== undefined) {
      console.log(`✅ Found field: ${field} =`, firstComment[field]);
    }
  });

  // Step 3: Find a comment with replies
  console.log('\n--- STEP 3: Find Comment With Replies ---');
  let commentWithReplies = null;

  for (const comment of data.comments) {
    const hasReplies =
      (comment.child_comment_count && comment.child_comment_count > 0) ||
      (comment.num_child_comments && comment.num_child_comments > 0) ||
      (comment.comment_count && comment.comment_count > 0);

    if (hasReplies) {
      commentWithReplies = comment;
      console.log('✅ Found comment with replies!');
      console.log('Comment ID:', comment.pk || comment.id);
      console.log('Comment text:', comment.text);
      console.log('Reply count:', comment.child_comment_count || comment.num_child_comments || comment.comment_count);
      break;
    }
  }

  if (!commentWithReplies) {
    console.log('ℹ️ No comments with replies found in this post');
    console.log('Try a different post with threaded comments');
    return;
  }

  // Step 4: Try to fetch replies
  console.log('\n--- STEP 4: Fetch Replies ---');
  const commentId = commentWithReplies.pk || commentWithReplies.id;

  // Try different possible endpoints
  const endpointsToTry = [
    `/api/v1/media/${mediaId}/comments/${commentId}/child_comments/`,
    `/api/v1/media/${commentId}/comments/`,
    `/api/v1/comments/${commentId}/child_comments/`
  ];

  for (const endpoint of endpointsToTry) {
    console.log(`\nTrying: https://www.instagram.com${endpoint}`);

    try {
      const repliesResponse = await fetch(
        `https://www.instagram.com${endpoint}`,
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

      console.log('Status:', repliesResponse.status);

      if (repliesResponse.ok) {
        const repliesData = await repliesResponse.json();
        console.log('✅ SUCCESS! Replies data:', repliesData);

        if (repliesData.child_comments) {
          console.log('✅ Found', repliesData.child_comments.length, 'replies');
          console.log('Sample reply:', repliesData.child_comments[0]);

          // Check for pagination
          if (repliesData.has_more_child_comments) {
            console.log('ℹ️ More replies available, next_max_child_comment_id:', repliesData.next_max_child_comment_id);
          }

          return {
            endpoint: endpoint,
            replies: repliesData.child_comments,
            hasMore: repliesData.has_more_child_comments,
            nextId: repliesData.next_max_child_comment_id
          };
        }
      } else {
        const errorText = await repliesResponse.text();
        console.log('❌ Error:', errorText.substring(0, 200));
      }
    } catch (error) {
      console.log('❌ Error:', error.message);
    }
  }

  console.log('\n=== TEST COMPLETE ===');
})();
