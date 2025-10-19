# Testing Guide for Instagram Combined Downloader

## Current Status

### ✅ Working Features
- **Media Download**: Successfully extracts and downloads images/videos from posts
- **Post Data Extraction**: Parses embedded data from Instagram's script tags
- **JSON/CSV Export**: File downloads work correctly with data URLs

### 🔄 Testing Required
- **Comments Download**: Just implemented using ESUIT's exact API method (PolarisApiInjectPlugin)

## How to Test

### Step 1: Reload the Extension

1. Open Chrome and go to `chrome://extensions`
2. Find "Instagram Post & Comments Downloader"
3. Click the reload button (circular arrow icon)
4. Make sure the extension is enabled

### Step 2: Test the API Method in Console

Before testing the full extension, let's verify the API method works:

1. Go to an Instagram post with comments (e.g., any popular post)
2. Open Chrome DevTools (F12 or Ctrl+Shift+I)
3. Go to the **Console** tab
4. Copy and paste the entire contents of `TEST_COMMENTS_API.js` into the console
5. Press Enter to run it

#### Expected Results:

**If API method works:**
```
[TEST] Starting comments API test...
[TEST] ✅ window.require is available
[TEST] ✅ PolarisApiInjectPlugin loaded: {apiGet: ƒ, ...}
[TEST] ✅ apiGet method exists
[TEST] ✅ On post page with shortcode: ABC123
[TEST] ✅ Found media ID: 1234567890
[TEST] Attempting to fetch comments...
[TEST] ✅ API Response: {data: {...}, status: "ok"}
[TEST] ✅ SUCCESS! Fetched X comments
```

**If API method doesn't work:**
- You'll see ❌ error messages indicating which step failed
- Share the console output so we can try alternative methods

### Step 3: Test the Extension

1. Go to an Instagram post with comments
2. Click the extension icon in Chrome toolbar
3. Click **"Extract Data"** button
4. Wait 3-5 seconds for the data to load

#### Check the Results:

**In the extension popup:**
- You should see: "Media: X items found"
- You should see: "Comments: X found"

**In the browser console (F12):**
- Look for `[IG DL v7]` log messages
- Check if you see: `✅ PolarisApiInjectPlugin loaded successfully`
- Check if you see: `✅ Fetched X comments from API`

### Step 4: Download Comments

1. In the extension popup, click **"Download JSON"** or **"Download CSV"**
2. Check the downloaded file

#### Expected Content:

**JSON file should contain:**
```json
{
  "total": 4,
  "comments": [
    {
      "id": "...",
      "text": "Great post!",
      "created_at": 1234567890,
      "owner": {
        "username": "user123",
        ...
      },
      "like_count": 5
    },
    ...
  ]
}
```

**CSV file should have:**
```
id,text,created_at,owner.username,like_count
123,"Great post!",1234567890,user123,5
...
```

## Troubleshooting

### Problem: "PolarisApiInjectPlugin not available"

This means Instagram changed their internal module name or structure.

**Solution:**
1. Run the test script in console
2. Share the error message
3. We'll try alternative modules:
   - `IGDApi`
   - `PolarisWebGraph`
   - Direct API fetch

### Problem: "window.require is not available"

This is rare but means Instagram changed how they load modules.

**Solution:**
1. Check if Instagram changed their architecture
2. We may need to use direct fetch() calls instead

### Problem: "0 comments downloaded" but test script works

This means the extension code has an issue, not the API method.

**Solution:**
1. Check browser console for errors
2. Look for the exact error message in `[IG DL v7]` logs
3. Share the error so we can fix the integration

### Problem: Extension shows comments count but can't download

**Possible Causes:**
1. The comment count comes from embedded data (post.comment_count)
2. But actual comment fetching is failing
3. This is the current situation we're debugging

**Next Steps:**
- Run TEST_COMMENTS_API.js to isolate the issue
- If test works but extension doesn't, it's an integration bug
- If test fails, we need an alternative API method

## What to Share for Debugging

If anything doesn't work, please share:

1. **Test script output** - The full console output from TEST_COMMENTS_API.js
2. **Extension console logs** - All `[IG DL v7]` messages
3. **Error messages** - Any errors (red text in console)
4. **Downloaded file content** - What the JSON/CSV file actually contains
5. **Post URL** - The Instagram post you're testing with (if public)

## Next Steps Based on Results

### If TEST_COMMENTS_API.js succeeds:
✅ The API method works!
→ We just need to fix integration in the extension

### If TEST_COMMENTS_API.js fails:
❌ Need alternative approach
→ Options:
  1. Try different Instagram module
  2. Use direct fetch() with Instagram's cookies
  3. Search Relay store differently
  4. Wait for comments to load, then extract from DOM

---

## Recent Updates (inject-v7-final.js)

Latest improvements:
- ✅ Added check for window.require existence
- ✅ Better error handling for module loading
- ✅ Logs available methods if apiGet not found
- ✅ More detailed API call logging
- ✅ Shows full response object for debugging
