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

  // Helper function to fetch image and convert to base64
  async function imageUrlToBase64(url) {
    if (!url) return '';

    try {
      // Profile pictures are publicly accessible, no credentials needed
      const response = await fetch(url);

      if (!response.ok) {
        console.error('[Content] Failed to fetch image:', url, response.status);
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
      console.error('[Content] Error converting image to base64:', error);
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
        return imageUrlToBase64(url);
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
    }
    return true; // Keep channel open for async response
  });

})();
