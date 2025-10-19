# Update Notes - inject-v2.js

## What Was Fixed

### Previous Version (inject.js) - Issues:
❌ **Downloaded wrong media**: Got thumbnails, profile pics, and other page images instead of actual post content
❌ **Found 0 comments**: DOM scraping couldn't access Instagram's comment data
❌ **Unreliable extraction**: Tried 6 different methods, all based on DOM scraping

### New Version (inject-v2.js) - Improvements:
✅ **Accesses Instagram's internal data stores** (same method as ESUIT extensions)
✅ **Gets actual high-resolution media** from `shortcode_media` object
✅ **Properly extracts comments** with nested replies
✅ **4 prioritized methods** in order of reliability:

1. `window.__additionalDataLoaded__` - Instagram's primary data store (most reliable)
2. `window._sharedData` - Instagram's legacy data store
3. Script tag parsing - Extract JSON from page scripts
4. Relay Store - Direct access to Instagram's GraphQL cache

## Technical Changes

### How It Works Now

```javascript
// Priority 1: Check Instagram's modern data store
if (window.__additionalDataLoaded__) {
  for (const [path, data] of Object.entries(window.__additionalDataLoaded__)) {
    if (data?.graphql?.shortcode_media) {
      // Found it! This contains:
      // - display_url: High-res image
      // - video_url: Video file (if video post)
      // - edge_sidecar_to_children: Carousel items
      // - edge_media_to_parent_comment: Comments with replies
      return { shortcode, post: data.graphql.shortcode_media };
    }
  }
}
```

### What the Data Looks Like

The `shortcode_media` object contains:

```javascript
{
  "__typename": "GraphImage" | "GraphVideo" | "GraphSidecar",
  "id": "3234567890123456789",
  "shortcode": "C0xZAL2Jjb3",
  "display_url": "https://instagram...cdninstagram.com/...jpg",  // HIGH-RES IMAGE
  "display_resources": [                                          // Multiple resolutions
    { "src": "...", "config_width": 640, "config_height": 800 },
    { "src": "...", "config_width": 1080, "config_height": 1350 }  // We use highest
  ],
  "is_video": false,
  "video_url": "...",  // Only if is_video: true
  "edge_sidecar_to_children": {  // Only if carousel
    "edges": [
      { "node": { /* same structure */ } },
      { "node": { /* same structure */ } }
    ]
  },
  "edge_media_to_parent_comment": {
    "count": 127,
    "edges": [
      {
        "node": {
          "id": "comment_id",
          "text": "Comment text",
          "created_at": 1234567890,
          "owner": { "username": "user", "profile_pic_url": "..." },
          "edge_liked_by": { "count": 42 },
          "edge_threaded_comments": {  // Nested replies
            "edges": [ /* reply nodes */ ]
          }
        }
      }
    ]
  }
}
```

## How to Test the Update

### Step 1: Reload Extension
1. Go to `chrome://extensions`
2. Find "Instagram Post & Comments Downloader"
3. Click **Reload** (circular arrow icon)

### Step 2: Open Console to Monitor
1. Go to any Instagram post (e.g., `https://www.instagram.com/p/C0xZAL2Jjb3/`)
2. Press **F12** to open DevTools
3. Go to **Console** tab
4. **Wait 10 seconds** for page to load

### Step 3: Extract Data
1. Click the extension icon
2. Click "Extract Post Data"
3. Watch the console

### Expected Console Output

✅ **Success (Method 1 - Best):**
```
[Instagram Downloader v2] Inject script loaded
[Instagram Downloader v2] Instagram require found
[Instagram Downloader v2] Extracting for shortcode: C0xZAL2Jjb3
[Instagram Downloader v2] Found via __additionalDataLoaded__
```

✅ **Success (Method 2 - Good):**
```
[Instagram Downloader v2] Found via _sharedData
```

✅ **Success (Method 3 - Acceptable):**
```
[Instagram Downloader v2] Found via script parsing
```

⚠️ **Fallback (Method 4):**
```
[Instagram Downloader v2] Relay store found!
[Instagram Downloader v2] Trying Relay store...
[Instagram Downloader v2] Found via Relay store
```

❌ **Failure:**
```
Could not find post data. Please refresh the page and wait 10 seconds before extracting.
debug: {
  hasAdditionalData: false,
  hasSharedData: false,
  hasRelayStore: false,
  scriptsChecked: 15
}
```

## Verifying the Fix

### Test 1: Media Quality
**Old version:** Downloaded profile pics, thumbnails, story icons
**New version:** Should download actual post images at high resolution

Download a single image post and check:
- File size should be 100KB+ (not 10KB thumbnails)
- Image dimensions should be 1080x1080 or larger
- No profile pictures in the download

### Test 2: Comments Extraction
**Old version:** Found 0 comments
**New version:** Should find all loaded comments (up to ~50 initial)

Download comments as JSON and verify:
- `total` field shows comment count
- `comments` array has entries
- Each comment has `text`, `owner.username`, `created_at`
- Replies are nested in `replies[]` array

## If It Still Doesn't Work

### Debug Step 1: Check what data is available

Paste in Console:
```javascript
console.log('Data sources available:');
console.log('1. __additionalDataLoaded__:', !!window.__additionalDataLoaded__);
console.log('2. _sharedData:', !!window._sharedData);

if (window.__additionalDataLoaded__) {
  console.log('Paths:', Object.keys(window.__additionalDataLoaded__));

  for (const [path, data] of Object.entries(window.__additionalDataLoaded__)) {
    if (data?.graphql?.shortcode_media) {
      console.log('✅ FOUND IT at path:', path);
      console.log('Post type:', data.graphql.shortcode_media.__typename);
      console.log('Has media:', !!data.graphql.shortcode_media.display_url);
      console.log('Has comments:', !!data.graphql.shortcode_media.edge_media_to_parent_comment);
    }
  }
}
```

### Debug Step 2: Manual extraction test

If the above shows `✅ FOUND IT`, but extension still fails, test manually:

```javascript
// Trigger extraction manually
window.postMessage({ type: 'EXTRACT_MEDIA' }, '*');

// Listen for response
window.addEventListener('message', (e) => {
  if (e.data.type === 'MEDIA_RESPONSE') {
    console.log('MEDIA RESPONSE:', e.data.data);
  }
});
```

## Files Changed

- ✏️ `/scripts/content.js` - Line 14: Changed to load `inject-v2.js`
- ✏️ `/manifest.json` - Line 39: Changed web_accessible_resources to `inject-v2.js`
- ➕ `/scripts/inject-v2.js` - New file with proper Instagram data access

## Rollback Instructions

If v2 doesn't work and you want to go back to v1:

1. Edit `scripts/content.js` line 14:
   ```javascript
   script.src = chrome.runtime.getURL('scripts/inject.js');  // Change back
   ```

2. Edit `manifest.json` line 39:
   ```json
   "resources": ["scripts/inject.js"],  // Change back
   ```

3. Reload extension in `chrome://extensions`

## What's Next

If this version works correctly, you should see:
- ✅ Actual post media downloading (not thumbnails)
- ✅ Comments extracting successfully
- ✅ Console shows which method succeeded

If you still see issues, please share:
1. Full console output
2. Result of Debug Step 1 above
3. Which method succeeded (if any)
