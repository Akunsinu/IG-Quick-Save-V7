// Content script V2 - bridges between the page and the extension
(function() {
  'use strict';

  console.log('[Instagram Downloader V2] Content script loaded');

  let isInjected = false;
  let isProfileScraperInjected = false;

  // Inject the page scripts (config first, then inject script)
  function injectScript() {
    if (isInjected) return;

    // First inject config.js
    const configScript = document.createElement('script');
    configScript.src = chrome.runtime.getURL('config.js');
    configScript.onload = function() {
      console.log('[Instagram Downloader] Config loaded');

      // Then inject the main script
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('scripts/inject-v7-final.js');
      script.onload = function() {
        this.remove();
        console.log('[Instagram Downloader] Inject script loaded successfully');
      };
      (document.head || document.documentElement).appendChild(script);
      configScript.remove();
    };
    (document.head || document.documentElement).appendChild(configScript);
    isInjected = true;
  }

  // Inject the profile scraper script
  function injectProfileScraper() {
    if (isProfileScraperInjected) return;

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('scripts/profile-scraper.js');
    script.onload = function() {
      this.remove();
      console.log('[Instagram Downloader] Profile scraper loaded successfully');
    };
    (document.head || document.documentElement).appendChild(script);
    isProfileScraperInjected = true;
  }

  // Inject as soon as possible
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectScript();
      injectProfileScraper();
    });
  } else {
    injectScript();
    injectProfileScraper();
  }

  // Listen for messages from the injected script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    // Forward responses to background script
    if (event.data.type === 'POST_DATA_RESPONSE' ||
        event.data.type === 'COMMENTS_RESPONSE' ||
        event.data.type === 'MEDIA_RESPONSE' ||
        event.data.type === 'INJECT_READY' ||
        event.data.type === 'EXTRACTION_PROGRESS') {
      console.log('[Content] 📤 Forwarding', event.data.type, 'to background script');
      chrome.runtime.sendMessage(event.data);
    }

    // Profile scraper messages
    if (event.data.type === 'PROFILE_SCRAPE_PROGRESS') {
      console.log('[Content] 📤 Profile scrape progress:', event.data.count);
      chrome.runtime.sendMessage({
        type: 'profileScrapeProgress',
        data: {
          count: event.data.count,
          targetCount: event.data.targetCount
        }
      });
    }

    if (event.data.type === 'PROFILE_SCRAPE_COMPLETE') {
      console.log('[Content] 📤 Profile scrape complete:', event.data.count, 'posts');
      chrome.runtime.sendMessage({
        type: 'profileScrapeComplete',
        data: {
          posts: event.data.posts,
          postUrls: event.data.postUrls,
          count: event.data.count,
          username: event.data.username
        }
      });
    }

    if (event.data.type === 'PROFILE_STATUS_RESPONSE') {
      // Store for later retrieval
      window.__profileStatus = event.data;
    }

    if (event.data.type === 'PROFILE_SCRAPER_READY') {
      console.log('[Content] ✅ Profile scraper ready for:', event.data.username);
    }
  });

  // Helper function to capture a frame from a video URL
  async function captureVideoFrame(videoUrl) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;
      video.src = videoUrl;

      video.onloadeddata = () => {
        // Seek to 1 second or 10% of duration, whichever is smaller
        video.currentTime = Math.min(1, video.duration * 0.1);
      };

      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
          resolve(dataUrl);
        } catch (error) {
          reject(error);
        }
      };

      video.onerror = () => reject(new Error('Failed to load video'));

      // Fallback timeout
      setTimeout(() => {
        if (video.readyState >= 2) {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || 400;
            canvas.height = video.videoHeight || 400;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.9));
          } catch (e) {
            reject(new Error('Video frame capture timed out'));
          }
        } else {
          reject(new Error('Video failed to load'));
        }
      }, 5000);
    });
  }

  // Helper function to fetch image/video and convert to base64
  async function urlToBase64(url, type = 'image') {
    if (!url) return '';

    try {
      // Media is publicly accessible, no credentials needed
      const response = await fetch(url);

      if (!response.ok) {
        console.error(`[Content] Failed to fetch ${type}:`, url, response.status);
        return '';
      }

      const blob = await response.blob();

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error(`[Content] Error converting ${type} to base64:`, error);
      return '';
    }
  }

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractPostData') {
      console.log('[Content] 📩 Received extractPostData request, forwarding to inject script');
      window.postMessage({ type: 'EXTRACT_POST_DATA' }, '*');
      return false; // No async response needed
    } else if (request.action === 'extractComments') {
      console.log('[Content] 📩 Received extractComments request, forwarding to inject script');
      window.postMessage({ type: 'EXTRACT_COMMENTS' }, '*');
      return false; // No async response needed
    } else if (request.action === 'extractMedia') {
      console.log('[Content] 📩 Received extractMedia request, forwarding to inject script');
      window.postMessage({ type: 'EXTRACT_MEDIA' }, '*');
      return false; // No async response needed
    } else if (request.action === 'getPageInfo') {
      // Return basic page information
      sendResponse({
        url: window.location.href,
        isPostPage: /\/(p|reel)\/[^\/]+/.test(window.location.href)
      });
      return false; // Sync response
    } else if (request.action === 'fetchAvatars') {
      // Fetch multiple avatar URLs and convert to base64
      const urls = request.urls || [];

      console.log('[Content] Received fetchAvatars request');
      console.log('[Content] URLs to fetch:', urls);
      console.log('[Content] Fetching', urls.length, 'avatars...');

      Promise.allSettled(urls.map((url, index) => {
        console.log(`[Content] Fetching avatar ${index + 1}/${urls.length}:`, url);
        return urlToBase64(url, 'avatar');
      }))
        .then(results => {
          const avatarCache = {};
          let successCount = 0;
          let failCount = 0;

          urls.forEach((url, index) => {
            const result = results[index];
            if (result.status === 'fulfilled' && result.value) {
              avatarCache[url] = result.value;
              successCount++;
              console.log(`[Content] ✓ Avatar ${index + 1} converted (${result.value.substring(0, 50)}...)`);
            } else {
              failCount++;
              console.warn(`[Content] ✗ Avatar ${index + 1} failed:`, url, result.reason || 'empty result');
            }
          });

          console.log(`[Content] Converted ${successCount}/${urls.length} avatars (${failCount} failed)`);
          console.log('[Content] Sending response back to background...');
          sendResponse({ success: true, avatarCache, successCount, failCount });
        })
        .catch(error => {
          console.error('[Content] Error in avatar processing:', error);
          sendResponse({ success: false, error: error.message });
        });

      return true; // Keep channel open for async response
    } else if (request.action === 'fetchMedia') {
      // Fetch media (images and videos) and convert to base64
      const mediaItems = request.mediaItems || [];

      console.log('[Content] Received fetchMedia request');
      console.log('[Content] Media items to fetch:', mediaItems.length);

      Promise.allSettled(mediaItems.map(async (item, index) => {
        const url = item.video_url || item.image_url;
        const type = item.video_url ? 'video' : 'image';

        if (!url) {
          console.warn(`[Content] ✗ Media ${index + 1} has no URL`);
          return null;
        }

        console.log(`[Content] Fetching ${type} ${index + 1}/${mediaItems.length}:`, url.substring(0, 100) + '...');
        const base64 = await urlToBase64(url, type);

        if (base64) {
          const sizeKB = Math.round(base64.length / 1024);
          console.log(`[Content] ✓ ${type} ${index + 1} converted (${sizeKB} KB)`);
        } else {
          console.warn(`[Content] ✗ ${type} ${index + 1} failed`);
        }

        return base64;
      }))
        .then(results => {
          const mediaCache = {};
          let successCount = 0;
          let failCount = 0;

          mediaItems.forEach((item, index) => {
            const url = item.video_url || item.image_url;
            const result = results[index];

            if (url && result.status === 'fulfilled' && result.value) {
              mediaCache[url] = result.value;
              successCount++;
            } else {
              failCount++;
            }
          });

          const totalSizeKB = Object.values(mediaCache).reduce((sum, b64) => sum + b64.length, 0) / 1024;
          console.log(`[Content] Converted ${successCount}/${mediaItems.length} media items (${failCount} failed)`);
          console.log('[Content] Total size:', Math.round(totalSizeKB), 'KB');
          console.log('[Content] Sending response back to background...');
          sendResponse({ success: true, mediaCache });
        })
        .catch(error => {
          console.error('[Content] Error fetching media:', error);
          sendResponse({ success: false, error: error.message });
        });

      return true; // Keep channel open for async response
    } else if (request.action === 'captureVideoFrame') {
      // Capture a frame from a video URL
      const videoUrl = request.videoUrl;
      console.log('[Content] Capturing video frame from:', videoUrl?.substring(0, 50) + '...');

      captureVideoFrame(videoUrl)
        .then(frameDataUrl => {
          console.log('[Content] Video frame captured, length:', frameDataUrl?.length || 0);
          sendResponse({ success: true, frameDataUrl });
        })
        .catch(error => {
          console.error('[Content] Error capturing video frame:', error);
          sendResponse({ success: false, error: error.message });
        });

      return true; // Keep channel open for async response
    } else if (request.action === 'hideAvatar') {
      // Hide user's avatar in "Add a comment" section for screenshot
      console.log('[Content] Hiding avatar for screenshot...');

      // Create and inject style element
      const styleId = 'instagram-dl-hide-avatar';
      let styleElement = document.getElementById(styleId);

      if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = styleId;
        styleElement.textContent = `
          /* Hide profile picture in comment input area */
          img[src*="t51.2885-19"][alt=""][draggable="false"] {
            display: none !important;
          }
        `;
        document.head.appendChild(styleElement);
      }

      sendResponse({ success: true });
      return false; // Sync response
    } else if (request.action === 'restoreAvatar') {
      // Restore user's avatar after screenshot
      console.log('[Content] Restoring avatar...');

      const styleId = 'instagram-dl-hide-avatar';
      const styleElement = document.getElementById(styleId);

      if (styleElement) {
        styleElement.remove();
      }

      sendResponse({ success: true });
      return false; // Sync response
    } else if (request.action === 'startProfileScrape') {
      // Start profile scraping
      console.log('[Content] 📩 Starting profile scrape, count:', request.count);
      injectProfileScraper(); // Ensure it's injected
      window.postMessage({
        type: 'START_PROFILE_SCRAPE',
        count: request.count || 0
      }, '*');
      sendResponse({ success: true });
      return false;
    } else if (request.action === 'stopProfileScrape') {
      // Stop profile scraping
      console.log('[Content] 📩 Stopping profile scrape');
      window.postMessage({ type: 'STOP_PROFILE_SCRAPE' }, '*');
      sendResponse({ success: true });
      return false;
    } else if (request.action === 'getProfileStatus') {
      // Get profile status
      console.log('[Content] 📩 Getting profile status');

      // Check if we're on a profile page by URL
      const path = window.location.pathname;
      const excludedPaths = ['/p/', '/reel/', '/reels/', '/explore/', '/direct/', '/accounts/', '/stories/'];
      const isProfile = !excludedPaths.some(p => path.includes(p));

      // Try to get username from page or URL
      let username = null;
      const headerUsername = document.querySelector('header h2 span');
      if (headerUsername) {
        username = headerUsername.innerText.trim();
      } else {
        const urlMatch = path.match(/^\/([^\/]+)\/?$/);
        if (urlMatch && !['explore', 'direct', 'accounts', 'stories', 'reels'].includes(urlMatch[1])) {
          username = urlMatch[1];
        }
      }

      sendResponse({
        isProfilePage: isProfile && username,
        username: username
      });
      return false;
    } else if (request.action === 'getProfilePostCount') {
      // Get the post count from a profile page
      console.log('[Content] 📩 Getting profile post count');

      let postCount = null;
      let username = null;

      try {
        // Try to get username
        const headerUsername = document.querySelector('header h2 span');
        if (headerUsername) {
          username = headerUsername.innerText.trim();
        } else {
          const urlMatch = window.location.pathname.match(/^\/([^\/]+)\/?$/);
          if (urlMatch) username = urlMatch[1];
        }

        // Method 1: Look for the stats list (posts, followers, following)
        // The structure is typically: <ul><li>X posts</li><li>Y followers</li><li>Z following</li></ul>
        const statsUl = document.querySelector('header section ul');
        if (statsUl) {
          const firstLi = statsUl.querySelector('li');
          if (firstLi) {
            // Look for the number in the first li (posts count)
            const spans = firstLi.querySelectorAll('span');
            for (const span of spans) {
              const text = span.innerText.trim();
              // Check if it's just a number (could be formatted like "1,234")
              const numMatch = text.replace(/,/g, '').match(/^(\d+)$/);
              if (numMatch) {
                postCount = parseInt(numMatch[1], 10);
                console.log('[Content] Found post count in stats:', postCount);
                break;
              }
            }
          }
        }

        // Method 2: Look for "X posts" text pattern anywhere in header
        if (postCount === null) {
          const headerSection = document.querySelector('header section');
          if (headerSection) {
            const allSpans = headerSection.querySelectorAll('span');
            for (const span of allSpans) {
              const text = span.innerText.trim().toLowerCase();
              const match = text.match(/^([\d,]+)\s*posts?$/);
              if (match) {
                postCount = parseInt(match[1].replace(/,/g, ''), 10);
                console.log('[Content] Found post count from text pattern:', postCount);
                break;
              }
            }
          }
        }

        // Method 3: Try the specific xpath-like structure from the user's example
        if (postCount === null) {
          const postSpan = document.querySelector('header section ul li span span span');
          if (postSpan) {
            const text = postSpan.innerText.trim().replace(/,/g, '');
            if (/^\d+$/.test(text)) {
              postCount = parseInt(text, 10);
              console.log('[Content] Found post count from nested span:', postCount);
            }
          }
        }

        // Method 4: Look for meta content with post count
        if (postCount === null) {
          const metaDesc = document.querySelector('meta[name="description"]');
          if (metaDesc) {
            const content = metaDesc.getAttribute('content') || '';
            const match = content.match(/([\d,]+)\s*Posts?/i);
            if (match) {
              postCount = parseInt(match[1].replace(/,/g, ''), 10);
              console.log('[Content] Found post count from meta:', postCount);
            }
          }
        }

      } catch (error) {
        console.error('[Content] Error getting post count:', error);
      }

      console.log('[Content] Profile post count result:', { username, postCount });
      sendResponse({
        success: postCount !== null,
        username: username,
        postCount: postCount
      });
      return false;
    }
  });

})();
