// Content script - bridges between the page and the extension
(function() {
  'use strict';

  console.log('[Instagram Downloader] Content script loaded');

  let isInjected = false;

  // Inject the page script
  function injectScript() {
    if (isInjected) return;

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('scripts/inject-v7-final.js');
    script.onload = function() {
      this.remove();
      console.log('[Instagram Downloader] Inject script loaded successfully');
    };
    (document.head || document.documentElement).appendChild(script);
    isInjected = true;
  }

  // Inject as soon as possible
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectScript);
  } else {
    injectScript();
  }

  // Listen for messages from the injected script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    // Forward responses to background script
    if (event.data.type === 'POST_DATA_RESPONSE' ||
        event.data.type === 'COMMENTS_RESPONSE' ||
        event.data.type === 'MEDIA_RESPONSE' ||
        event.data.type === 'INJECT_READY') {
      chrome.runtime.sendMessage(event.data);
    }
  });

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
      window.postMessage({ type: 'EXTRACT_POST_DATA' }, '*');
    } else if (request.action === 'extractComments') {
      window.postMessage({ type: 'EXTRACT_COMMENTS' }, '*');
    } else if (request.action === 'extractMedia') {
      window.postMessage({ type: 'EXTRACT_MEDIA' }, '*');
    } else if (request.action === 'getPageInfo') {
      // Return basic page information
      sendResponse({
        url: window.location.href,
        isPostPage: /\/p\/[^\/]+/.test(window.location.href)
      });
    } else if (request.action === 'fetchAvatars') {
      // Fetch multiple avatar URLs and convert to base64
      const urls = request.urls || [];

      console.log('[Content] Received fetchAvatars request');
      console.log('[Content] URLs to fetch:', urls);
      console.log('[Content] Fetching', urls.length, 'avatars...');

      Promise.all(urls.map((url, index) => {
        console.log(`[Content] Fetching avatar ${index + 1}/${urls.length}:`, url);
        return urlToBase64(url, 'avatar');
      }))
        .then(base64Array => {
          const avatarCache = {};
          urls.forEach((url, index) => {
            if (base64Array[index]) {
              avatarCache[url] = base64Array[index];
              console.log(`[Content] ✓ Avatar ${index + 1} converted (${base64Array[index].substring(0, 50)}...)`);
            } else {
              console.warn(`[Content] ✗ Avatar ${index + 1} failed:`, url);
            }
          });

          console.log('[Content] SUCCESS! Converted', Object.keys(avatarCache).length, 'avatars to base64');
          console.log('[Content] Sending response back to background...');
          sendResponse({ success: true, avatarCache });
        })
        .catch(error => {
          console.error('[Content] Error fetching avatars:', error);
          sendResponse({ success: false, error: error.message });
        });

      return true; // Keep channel open for async response
    } else if (request.action === 'fetchMedia') {
      // Fetch media (images and videos) and convert to base64
      const mediaItems = request.mediaItems || [];

      console.log('[Content] Received fetchMedia request');
      console.log('[Content] Media items to fetch:', mediaItems.length);

      Promise.all(mediaItems.map(async (item, index) => {
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
        .then(base64Array => {
          const mediaCache = {};
          mediaItems.forEach((item, index) => {
            const url = item.video_url || item.image_url;
            if (url && base64Array[index]) {
              mediaCache[url] = base64Array[index];
            }
          });

          const totalSizeKB = Object.values(mediaCache).reduce((sum, b64) => sum + b64.length, 0) / 1024;
          console.log('[Content] SUCCESS! Converted', Object.keys(mediaCache).length, 'media items');
          console.log('[Content] Total size:', Math.round(totalSizeKB), 'KB');
          console.log('[Content] Sending response back to background...');
          sendResponse({ success: true, mediaCache });
        })
        .catch(error => {
          console.error('[Content] Error fetching media:', error);
          sendResponse({ success: false, error: error.message });
        });

      return true; // Keep channel open for async response
    }
    return true; // Keep channel open for async response
  });

})();
