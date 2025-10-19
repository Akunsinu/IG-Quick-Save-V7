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
    }
    return true; // Keep channel open for async response
  });

})();
