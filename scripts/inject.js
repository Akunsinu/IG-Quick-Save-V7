// This script runs in the Instagram page context and can access their internal APIs
(function() {
  'use strict';

  console.log('[Instagram Downloader] Inject script loaded');

  // Wait for Instagram's data to be available
  function waitForInstagram(callback) {
    let attempts = 0;
    const maxAttempts = 50;

    const checkInterval = setInterval(() => {
      attempts++;

      // Check if Instagram has loaded
      if (window._sharedData ||
          window.__additionalDataLoaded__ ||
          document.querySelector('script[type="application/ld+json"]')) {
        clearInterval(checkInterval);
        console.log('[Instagram Downloader] Instagram data detected');
        callback();
      }

      if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        console.warn('[Instagram Downloader] Timeout waiting for Instagram data');
      }
    }, 100);
  }

  // Extract post data using multiple methods
  async function extractPostData() {
    try {
      const url = window.location.href;
      const shortcodeMatch = url.match(/\/p\/([^\/\?]+)/);

      if (!shortcodeMatch) {
        return { error: 'Not on a post page' };
      }

      const shortcode = shortcodeMatch[1];
      console.log('[Instagram Downloader] Extracting data for shortcode:', shortcode);

      // Try multiple methods to find post data
      let postData = null;

      // Method 1: Check window.__additionalDataLoaded__
      postData = extractFromAdditionalData(shortcode);
      if (postData) {
        console.log('[Instagram Downloader] Found data via __additionalDataLoaded__');
        return { shortcode, post: postData, method: 'additionalData' };
      }

      // Method 2: Check window._sharedData
      postData = extractFromSharedData(shortcode);
      if (postData) {
        console.log('[Instagram Downloader] Found data via _sharedData');
        return { shortcode, post: postData, method: 'sharedData' };
      }

      // Method 3: Parse from page scripts
      postData = extractFromPageScripts();
      if (postData) {
        console.log('[Instagram Downloader] Found data via page scripts');
        return { shortcode, post: postData, method: 'pageScripts' };
      }

      // Method 4: Try React fiber
      postData = findPostDataInPage();
      if (postData) {
        console.log('[Instagram Downloader] Found data via React fiber');
        return { shortcode, post: postData, method: 'reactFiber' };
      }

      // Method 5: Extract from DOM directly
      postData = extractFromDOM();
      if (postData) {
        console.log('[Instagram Downloader] Found data via DOM extraction');
        return { shortcode, post: postData, method: 'dom' };
      }

      // All methods failed - provide helpful error
      console.error('[Instagram Downloader] Could not find post data using any method');

      // Return error with instructions
      return {
        error: 'Could not extract post data. Please try:\n1. Refresh the page and wait 10 seconds\n2. Scroll down to load all media\n3. Make sure you\'re logged into Instagram',
        debug: {
          hasAdditionalData: !!window.__additionalDataLoaded__,
          hasSharedData: !!window._sharedData,
          hasScripts: document.querySelectorAll('script').length,
          hasImages: document.querySelectorAll('article img').length,
          hasVideos: document.querySelectorAll('article video').length,
          url: url
        }
      };

    } catch (error) {
      console.error('[Instagram Downloader] Error extracting post data:', error);
      return { error: error.message, stack: error.stack };
    }
  }

  // Method 1: Extract from __additionalDataLoaded__
  function extractFromAdditionalData(shortcode) {
    if (!window.__additionalDataLoaded__) return null;

    try {
      const paths = Object.keys(window.__additionalDataLoaded__);

      for (const path of paths) {
        const data = window.__additionalDataLoaded__[path];

        // Check for post data in graphql
        if (data && data.graphql && data.graphql.shortcode_media) {
          return data.graphql.shortcode_media;
        }

        // Check for direct shortcode_media
        if (data && data.shortcode_media) {
          return data.shortcode_media;
        }

        // Check if path contains our shortcode
        if (path.includes(shortcode) && data) {
          if (data.graphql) return data.graphql.shortcode_media || data;
          return data;
        }
      }
    } catch (e) {
      console.error('Error in extractFromAdditionalData:', e);
    }

    return null;
  }

  // Method 2: Extract from _sharedData
  function extractFromSharedData(shortcode) {
    if (!window._sharedData) return null;

    try {
      const data = window._sharedData;

      // Check entry_data.PostPage
      if (data.entry_data && data.entry_data.PostPage) {
        const postPage = data.entry_data.PostPage[0];
        if (postPage && postPage.graphql && postPage.graphql.shortcode_media) {
          return postPage.graphql.shortcode_media;
        }
      }

      // Check other possible locations
      if (data.graphql && data.graphql.shortcode_media) {
        return data.graphql.shortcode_media;
      }
    } catch (e) {
      console.error('Error in extractFromSharedData:', e);
    }

    return null;
  }

  // Method 3: Extract from page scripts
  function extractFromPageScripts() {
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');

      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);

          // Check if it's a SocialMediaPosting
          if (data['@type'] === 'SocialMediaPosting') {
            return convertLDJsonToPostData(data);
          }
        } catch (e) {
          continue;
        }
      }

      // Also try to find inline scripts with window._sharedData
      const allScripts = document.querySelectorAll('script:not([src])');
      for (const script of allScripts) {
        const content = script.textContent;
        if (content.includes('window._sharedData')) {
          try {
            // Try to extract and eval the data
            const match = content.match(/window\._sharedData\s*=\s*({.+?});/);
            if (match) {
              const data = JSON.parse(match[1]);
              if (data.entry_data && data.entry_data.PostPage) {
                return data.entry_data.PostPage[0].graphql.shortcode_media;
              }
            }
          } catch (e) {
            continue;
          }
        }
      }
    } catch (e) {
      console.error('Error in extractFromPageScripts:', e);
    }

    return null;
  }

  // Convert LD+JSON format to Instagram post format
  function convertLDJsonToPostData(ldData) {
    return {
      __typename: ldData.image ? 'GraphImage' : 'GraphVideo',
      id: ldData.identifier || '',
      shortcode: window.location.pathname.split('/p/')[1]?.split('/')[0] || '',
      display_url: ldData.image || ldData.thumbnail || '',
      is_video: !!ldData.video,
      video_url: ldData.video || null,
      edge_media_to_caption: {
        edges: ldData.caption ? [{
          node: { text: ldData.caption }
        }] : []
      },
      edge_media_to_comment: {
        count: ldData.commentCount || 0,
        edges: []
      },
      taken_at_timestamp: ldData.uploadDate ? new Date(ldData.uploadDate).getTime() / 1000 : 0
    };
  }

  // Method 4: Extract from React Fiber (original method)
  function findPostDataInPage() {
    try {
      // Try to find React root
      const possibleRoots = [
        document.querySelector('#react-root'),
        document.querySelector('main'),
        document.querySelector('article'),
        document.body
      ];

      for (const root of possibleRoots) {
        if (!root) continue;

        const fiber = Object.keys(root).find(key =>
          key.startsWith('__reactFiber') ||
          key.startsWith('__reactInternalInstance') ||
          key.startsWith('__reactProps')
        );

        if (fiber) {
          const data = findPostInFiber(root[fiber]);
          if (data) return data;
        }
      }
    } catch (error) {
      console.error('Error in findPostDataInPage:', error);
    }

    return null;
  }

  // Recursively search React fiber for post data
  function findPostInFiber(fiber, depth = 0) {
    if (!fiber || depth > 20) return null;

    try {
      // Check memoizedProps
      if (fiber.memoizedProps) {
        const props = fiber.memoizedProps;

        // Look for post data in various prop names
        if (props.post) return props.post;
        if (props.media) return props.media;
        if (props.shortcode_media) return props.shortcode_media;
        if (props.data && props.data.shortcode_media) return props.data.shortcode_media;
      }

      // Check memoizedState
      if (fiber.memoizedState) {
        const state = fiber.memoizedState;
        if (state && typeof state === 'object') {
          if (state.post) return state.post;
          if (state.media) return state.media;
        }
      }

      // Search children
      if (fiber.child) {
        const result = findPostInFiber(fiber.child, depth + 1);
        if (result) return result;
      }

      // Search siblings
      if (fiber.sibling) {
        const result = findPostInFiber(fiber.sibling, depth + 1);
        if (result) return result;
      }
    } catch (e) {
      // Continue searching even if one fiber node fails
    }

    return null;
  }

  // Method 5: Extract from DOM directly (enhanced)
  function extractFromDOM() {
    try {
      console.log('[Instagram Downloader] Attempting DOM extraction...');

      // Try multiple selectors for images and videos
      const imageSelectors = [
        'article img',
        'div[role="dialog"] img',
        'main img',
        'img[src*="cdninstagram"]',
        'img[src*="fbcdn"]'
      ];

      const videoSelectors = [
        'article video',
        'div[role="dialog"] video',
        'main video',
        'video[src*="cdninstagram"]',
        'video[src*="fbcdn"]'
      ];

      let images = [];
      let videos = [];

      // Try each selector until we find media
      for (const selector of imageSelectors) {
        images = Array.from(document.querySelectorAll(selector));
        if (images.length > 0) {
          console.log(`[Instagram Downloader] Found images using selector: ${selector}`);
          break;
        }
      }

      for (const selector of videoSelectors) {
        videos = Array.from(document.querySelectorAll(selector));
        if (videos.length > 0) {
          console.log(`[Instagram Downloader] Found videos using selector: ${selector}`);
          break;
        }
      }

      console.log(`[Instagram Downloader] Found ${images.length} images, ${videos.length} videos`);

      if (images.length === 0 && videos.length === 0) {
        console.log('[Instagram Downloader] No media found in DOM');
        return null;
      }

      // Filter out small images (profile pics, icons, etc) - keep only content images
      const contentImages = images.filter(img => {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        // Instagram post images are typically at least 300px
        return width >= 150 && height >= 150;
      });

      console.log(`[Instagram Downloader] Filtered to ${contentImages.length} content images`);

      // Get highest resolution image URLs
      const imageUrls = contentImages.map(img => {
        // Try to get srcset for higher res
        if (img.srcset) {
          const srcsetUrls = img.srcset.split(',').map(s => {
            const parts = s.trim().split(' ');
            return { url: parts[0], width: parseInt(parts[1]) || 0 };
          });
          // Get highest resolution
          srcsetUrls.sort((a, b) => b.width - a.width);
          if (srcsetUrls.length > 0) {
            return srcsetUrls[0].url;
          }
        }
        return img.src;
      });

      // Get video URLs
      const videoUrls = videos.map(video => video.src).filter(src => src && src.length > 0);

      // Determine if single or carousel
      const totalMedia = imageUrls.length + videoUrls.length;

      if (totalMedia === 0) {
        console.log('[Instagram Downloader] No valid media URLs found');
        return null;
      }

      const shortcode = window.location.pathname.split('/p/')[1]?.split('/')[0] || '';

      // Build post data
      if (totalMedia === 1) {
        // Single media post
        return {
          __typename: videoUrls.length > 0 ? 'GraphVideo' : 'GraphImage',
          id: shortcode,
          shortcode: shortcode,
          display_url: imageUrls[0] || videoUrls[0],
          is_video: videoUrls.length > 0,
          video_url: videoUrls[0] || null,
          edge_media_to_comment: {
            count: 0,
            edges: []
          }
        };
      } else {
        // Carousel post
        const children = [];

        // Add images
        imageUrls.forEach(url => {
          children.push({
            node: {
              __typename: 'GraphImage',
              id: '',
              shortcode: '',
              display_url: url,
              is_video: false
            }
          });
        });

        // Add videos
        videoUrls.forEach(url => {
          children.push({
            node: {
              __typename: 'GraphVideo',
              id: '',
              shortcode: '',
              display_url: url,
              video_url: url,
              is_video: true
            }
          });
        });

        return {
          __typename: 'GraphSidecar',
          id: shortcode,
          shortcode: shortcode,
          edge_sidecar_to_children: {
            edges: children
          },
          edge_media_to_comment: {
            count: 0,
            edges: []
          }
        };
      }

    } catch (e) {
      console.error('[Instagram Downloader] Error in extractFromDOM:', e);
    }

    return null;
  }

  // Extract comments from the post
  async function extractComments() {
    try {
      const postData = await extractPostData();

      if (postData.error) {
        return postData;
      }

      const post = postData.post;
      const comments = [];

      // Try to extract from various comment edge locations
      const commentEdges = [
        post.edge_media_to_parent_comment,
        post.edge_media_preview_comment,
        post.edge_media_to_comment
      ];

      for (const commentEdge of commentEdges) {
        if (commentEdge && commentEdge.edges && commentEdge.edges.length > 0) {
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
            if (comment.edge_threaded_comments && comment.edge_threaded_comments.edges) {
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
          break; // Found comments, stop checking other edges
        }
      }

      // Also try to scrape comments from DOM if API data is unavailable
      if (comments.length === 0) {
        const domComments = extractCommentsFromDOM();
        if (domComments.length > 0) {
          comments.push(...domComments);
        }
      }

      return {
        total: post.edge_media_to_comment?.count || comments.length,
        comments: comments
      };

    } catch (error) {
      console.error('[Instagram Downloader] Error extracting comments:', error);
      return { error: error.message };
    }
  }

  // Fallback: Extract comments from DOM
  function extractCommentsFromDOM() {
    const comments = [];

    try {
      const commentElements = document.querySelectorAll('article ul ul li, article ul li');

      for (const el of commentElements) {
        const usernameEl = el.querySelector('a[href^="/"]');
        const textEl = el.querySelector('span');

        if (usernameEl && textEl) {
          comments.push({
            id: `dom_${comments.length}`,
            text: textEl.textContent || '',
            created_at: Math.floor(Date.now() / 1000),
            owner: {
              id: '',
              username: usernameEl.textContent || '',
              profile_pic_url: ''
            },
            like_count: 0,
            replies: []
          });
        }
      }
    } catch (e) {
      console.error('Error extracting comments from DOM:', e);
    }

    return comments;
  }

  // Extract media URLs from the post
  async function extractMedia() {
    try {
      const postData = await extractPostData();

      if (postData.error) {
        return postData;
      }

      const post = postData.post;
      const media = [];

      // Check if it's a carousel
      if (post.edge_sidecar_to_children && post.edge_sidecar_to_children.edges) {
        for (const edge of post.edge_sidecar_to_children.edges) {
          const item = edge.node;
          media.push(extractMediaItem(item));
        }
      } else {
        // Single media item
        media.push(extractMediaItem(post));
      }

      return { media: media };

    } catch (error) {
      console.error('[Instagram Downloader] Error extracting media:', error);
      return { error: error.message };
    }
  }

  // Extract media item details
  function extractMediaItem(item) {
    const mediaItem = {
      type: item.__typename || (item.is_video ? 'GraphVideo' : 'GraphImage'),
      id: item.id || '',
      shortcode: item.shortcode || ''
    };

    if (item.is_video) {
      mediaItem.video_url = item.video_url;
      mediaItem.thumbnail_url = item.display_url;
      mediaItem.has_audio = item.has_audio;
    } else {
      mediaItem.image_url = item.display_url;

      // Try to get higher resolution
      if (item.display_resources && item.display_resources.length > 0) {
        const highRes = item.display_resources[item.display_resources.length - 1];
        mediaItem.image_url = highRes.src;
      }
    }

    mediaItem.width = item.dimensions?.width;
    mediaItem.height = item.dimensions?.height;

    return mediaItem;
  }

  // Listen for messages from content script
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;

    if (event.data.type === 'EXTRACT_POST_DATA') {
      const data = await extractPostData();
      window.postMessage({
        type: 'POST_DATA_RESPONSE',
        data: data
      }, '*');
    } else if (event.data.type === 'EXTRACT_COMMENTS') {
      const data = await extractComments();
      window.postMessage({
        type: 'COMMENTS_RESPONSE',
        data: data
      }, '*');
    } else if (event.data.type === 'EXTRACT_MEDIA') {
      const data = await extractMedia();
      window.postMessage({
        type: 'MEDIA_RESPONSE',
        data: data
      }, '*');
    }
  });

  // Wait for Instagram to load, then signal ready
  waitForInstagram(() => {
    window.postMessage({ type: 'INJECT_READY' }, '*');
  });

})();
