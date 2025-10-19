# Testing Checklist ✅

Use this guide to verify the extension works correctly.

## Pre-Testing Setup

- [ ] Chrome browser installed and updated
- [ ] Logged into Instagram account
- [ ] Extension loaded in `chrome://extensions/`
- [ ] Developer mode is ON
- [ ] No errors showing in extension details

## Test 1: Installation Verification

1. [ ] Extension icon appears in Chrome toolbar
2. [ ] Click extension icon - popup opens
3. [ ] Open DevTools (F12) → Console tab
4. [ ] Navigate to `https://www.instagram.com/`
5. [ ] Check console for: `[Instagram Downloader] Content script loaded`
6. [ ] Check console for: `[Instagram Downloader] Inject script loaded`

**Expected Result**: Both scripts load without errors

## Test 2: Basic Data Extraction

1. [ ] Find a public Instagram post with media and comments
   - Suggestion: Use a popular account's recent post
   - Must have at least 1 photo/video
   - Must have at least 5+ comments

2. [ ] Open the post (URL should contain `/p/`)

3. [ ] Click the extension icon

4. [ ] Popup should show: "✅ Ready to extract data from this post"

5. [ ] Click "Extract Post Data" button

6. [ ] Wait 2-3 seconds

7. [ ] Check that stats appear:
   - [ ] Media count > 0
   - [ ] Comment count > 0

8. [ ] Download options section appears

**Expected Result**: Data extraction completes successfully

## Test 3: Media Download

1. [ ] Click "📷 Media" button

2. [ ] Check your Downloads folder

3. [ ] Verify folder structure:
   ```
   Downloads/Instagram/[shortcode]/media/
   ```

4. [ ] Verify media files downloaded:
   - [ ] Files exist
   - [ ] Files open correctly
   - [ ] Images are viewable
   - [ ] Videos play (if post has videos)

**Expected Result**: All media files download successfully

## Test 4: Comments Download (JSON)

1. [ ] Extract data from a post with comments

2. [ ] Click "💬 Comments" button

3. [ ] Click "JSON" button

4. [ ] Check Downloads folder

5. [ ] Verify file exists:
   ```
   Downloads/Instagram/[shortcode]/comments/comments.json
   ```

6. [ ] Open JSON file and verify:
   - [ ] Valid JSON format
   - [ ] Contains "total" and "comments" fields
   - [ ] Comments have: id, text, owner, created_at
   - [ ] Nested replies are included (if any)

**Expected Result**: JSON file downloads with correct structure

## Test 5: Comments Download (CSV)

1. [ ] Extract data from same post

2. [ ] Click "💬 Comments" → "CSV"

3. [ ] Verify file exists:
   ```
   Downloads/Instagram/[shortcode]/comments/comments.csv
   ```

4. [ ] Open CSV file in a spreadsheet program

5. [ ] Verify:
   - [ ] Headers: ID, Username, Text, Created At, Likes, Is Reply
   - [ ] Data rows are properly formatted
   - [ ] Quotes are properly escaped
   - [ ] Nested replies show "Yes" in Is Reply column

**Expected Result**: CSV opens correctly in Excel/Google Sheets

## Test 6: Download Everything

1. [ ] Extract data from a new post (with both media and comments)

2. [ ] Click "⬇️ Download Everything" button

3. [ ] Wait for completion

4. [ ] Check Downloads folder structure:
   ```
   Downloads/Instagram/[shortcode]/
   ├── metadata.json
   ├── media/
   │   └── [files]
   └── comments/
       └── comments.json
   ```

5. [ ] Verify metadata.json contains:
   - [ ] shortcode
   - [ ] url
   - [ ] downloaded_at (timestamp)
   - [ ] media_count
   - [ ] comment_count

**Expected Result**: Complete package downloads successfully

## Test 7: Edge Cases

### Test 7a: Single Image Post
1. [ ] Test on post with 1 image, no carousel
2. [ ] Verify 1 image downloads

### Test 7b: Carousel Post
1. [ ] Test on post with multiple images/videos
2. [ ] Verify all items download (count matches)

### Test 7c: Video Post
1. [ ] Test on video-only post
2. [ ] Verify video downloads and plays

### Test 7d: Post with No Comments
1. [ ] Test on recent post with 0 comments
2. [ ] Verify graceful handling
3. [ ] Should show "0" comments

### Test 7e: Post with Disabled Comments
1. [ ] Test on post with comments disabled
2. [ ] Verify doesn't crash
3. [ ] Should show appropriate message

## Test 8: Error Handling

### Test 8a: Wrong Page Type
1. [ ] Navigate to Instagram home page
2. [ ] Open extension popup
3. [ ] Should show: "⚠️ Please open an Instagram post"
4. [ ] Extract button should be disabled

### Test 8b: Page Not Loaded
1. [ ] Open a post but stop page loading immediately
2. [ ] Try to extract data
3. [ ] Should show error or "No data found"

### Test 8c: Rate Limiting
1. [ ] Download 5+ posts quickly
2. [ ] Monitor for any rate limit warnings
3. [ ] Extension should handle gracefully

## Test 9: Console Errors

1. [ ] Open DevTools Console during all tests

2. [ ] Check for errors in:
   - [ ] Content script tab
   - [ ] Extension background page
   - [ ] Instagram page console

3. [ ] Verify no critical errors appear

**Expected Result**: Only informational logs, no errors

## Test 10: Cleanup Test

1. [ ] Remove extension from Chrome

2. [ ] Reload Instagram page

3. [ ] Verify no leftover scripts running

4. [ ] Re-install extension

5. [ ] Verify it works again

**Expected Result**: Clean install/uninstall

## Debugging Tips

If tests fail, check:

1. **Console Logs**:
   ```javascript
   // In Instagram page console
   window.postMessage({ type: 'EXTRACT_MEDIA' }, '*');
   ```

2. **Extension Background**:
   - Go to `chrome://extensions/`
   - Click "service worker" under extension
   - Check console for errors

3. **Network Tab**:
   - Check if Instagram is blocking requests
   - Look for failed downloads

4. **Permissions**:
   - Verify all permissions granted
   - Check `chrome://extensions/` details

## Performance Benchmarks

Expected performance:

- **Data Extraction**: < 3 seconds
- **Media Download** (single image): < 2 seconds
- **Comments Export**: < 1 second
- **Full Download**: < 10 seconds

If slower:
- Check internet connection
- Check Instagram page load time
- Look for console errors

## Test Report Template

After testing, document results:

```
Test Date: [Date]
Chrome Version: [Version]
Instagram Page Tested: [URL]

✅ Passed Tests: X/10
❌ Failed Tests: X/10

Issues Found:
1. [Issue description]
2. [Issue description]

Notes:
- [Any observations]
```

## Next Steps After Testing

✅ All tests pass → Extension is ready to use!

⚠️ Some tests fail → Check TROUBLESHOOTING section in README.md

❌ Many tests fail → Review installation steps or check console for errors

---

**Happy Testing! 🧪**

Found a bug? Check the README for how to report issues.
