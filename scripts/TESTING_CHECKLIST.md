# Testing Checklist for Improved Relay Environment Search

## Pre-Testing Setup

- [ ] Backup original inject-v3.js
- [ ] Read DEBUGGING_GUIDE.md for context
- [ ] Have browser console open (F12)
- [ ] Be on an Instagram post page (e.g., https://www.instagram.com/p/XXXXXXXXX/)

---

## Phase 1: Browser Console Testing (5 minutes)

### Test 1.1: Quick Test
- [ ] Open Instagram post page
- [ ] Wait 15 seconds for page to fully load
- [ ] Open browser console (F12)
- [ ] Copy and paste contents of `quick-test.js`
- [ ] Press Enter
- [ ] Check result:
  - [ ] ✅ Shows "FOUND! at [location]"
  - [ ] ✅ Shows environment object
  - [ ] ✅ Shows store with 100+ records
  - [ ] ❌ Shows "not found" → Proceed to Test 1.2

**Expected output:**
```
=== Quick Relay Environment Test ===
✅ Found React Fiber: __reactFiber$5btki0pfeml
   Root element: MAIN
🔍 Searching for Relay environment...

🎉 FOUND! at state[2].memoizedState
   Node count searched: 47
✅ Relay Environment Found!
✅ Store Found!
✅ Records Found!
   Total records: 543
```

---

### Test 1.2: Full Diagnostic (if quick test failed)
- [ ] Open Instagram post page (refresh if needed)
- [ ] Wait 15 seconds
- [ ] Open browser console (F12)
- [ ] Copy and paste contents of `diagnostic-console-script.js`
- [ ] Press Enter
- [ ] Watch console output carefully
- [ ] Check findings:
  - [ ] ✅ Found environment → Note the location
  - [ ] ❌ Not found after searching → Instagram may have changed structure
- [ ] If found, check:
  - [ ] Environment saved to `window.__foundRelayEnvironment`
  - [ ] Can access: `window.__foundRelayEnvironment._store`
  - [ ] Can access records with count > 100

**Expected output:**
```
=== Instagram Relay Environment Diagnostic ===
✅ Found React Fiber key: __reactFiber$5btki0pfeml on element: MAIN
=== Starting Breadth-First Fiber Tree Search ===
Fiber [depth 0]: {...}
  memoizedState properties: [...]
  state[2].memoizedState properties: [...]
  🎯 FOUND RELAY ENVIRONMENT in state[2].memoizedState!

🎉 SUCCESS! Found Relay Environment!
Record count: 543
✅ Environment saved to window.__foundRelayEnvironment
```

---

### Test 1.3: Manual Inspection (if diagnostic found it)
- [ ] In console, type: `window.__foundRelayEnvironment`
- [ ] Expand the object and verify:
  - [ ] Has `_store` or `getStore` method
  - [ ] Store has `_recordSource` or similar
  - [ ] Can navigate to records object
- [ ] In console, type: `window.__testRelayRecords`
- [ ] Verify:
  - [ ] Records object exists
  - [ ] Has 100+ keys
  - [ ] Some records have `__typename` with "Graph" in name
  - [ ] Some records have `shortcode` property

**What you're looking for:**
```javascript
window.__foundRelayEnvironment
{
  _store: {
    _recordSource: {
      _records: {
        "client:root": {...},
        "Post:12345": { shortcode: "ABC123", __typename: "XDTGraphImage" },
        // ... hundreds more
      }
    },
    _network: {...}
  }
}
```

---

## Phase 2: Extension Integration Testing (10 minutes)

### Test 2.1: Deploy Improved Version
- [ ] Stop/disable extension
- [ ] Replace `inject-v3.js` with `inject-v3-improved.js`
  - **Option A:** Rename inject-v3-improved.js to inject-v3.js
  - **Option B:** Update manifest.json to point to inject-v3-improved.js
- [ ] Reload extension
- [ ] Navigate to Instagram post page
- [ ] Open browser console
- [ ] Wait 15 seconds
- [ ] Check console messages:
  - [ ] ✅ "[Instagram Downloader v3-improved] Starting..."
  - [ ] ✅ "[Instagram Downloader v3-improved] Found React Fiber: ..."
  - [ ] ✅ "[Instagram Downloader v3-improved] ✅ Found Relay Environment!"
  - [ ] ✅ "[Instagram Downloader v3-improved] ✅ Ready!"

**Expected console output:**
```
[Instagram Downloader v3-improved] Starting...
[Instagram Downloader v3-improved] Found React Fiber: __reactFiber$5btki0pfeml
[Instagram Downloader v3-improved] ✅ Found Relay Environment!
[Instagram Downloader v3-improved] Store structure: {
  hasRecordSource: true,
  hasGetSource: true,
  keys: ['_recordSource', '_network', ...]
}
[Instagram Downloader v3-improved] ✅ Ready!
```

---

### Test 2.2: Test Extension Functionality
- [ ] Click extension icon/button
- [ ] Try to download media:
  - [ ] ✅ Works → Success!
  - [ ] ❌ Error about "data not loaded" → Check console
- [ ] Try to download comments:
  - [ ] ✅ Works → Success!
  - [ ] ❌ Error → Check console
- [ ] Check console for:
  - [ ] "[Instagram Downloader v3-improved] Searching for shortcode: ..."
  - [ ] "[Instagram Downloader v3-improved] Searching X relay records"
  - [ ] Value of X should be 100+ (not 0)

---

### Test 2.3: Test Different Post Types

**Single Image Post**
- [ ] Navigate to single image post
- [ ] Wait 15 seconds
- [ ] Try to download media
- [ ] Verify: Downloads 1 image

**Single Video Post**
- [ ] Navigate to single video post
- [ ] Wait 15 seconds
- [ ] Try to download media
- [ ] Verify: Downloads 1 video

**Carousel Post (Multiple Images/Videos)**
- [ ] Navigate to carousel post
- [ ] Wait 15 seconds
- [ ] Try to download media
- [ ] Verify: Downloads all items in carousel

**Post with Comments**
- [ ] Navigate to post with many comments
- [ ] Wait 15 seconds
- [ ] Try to download comments
- [ ] Verify: Gets comment data

---

### Test 2.4: Test Timing Scenarios

**Immediate Click (stress test)**
- [ ] Navigate to Instagram post
- [ ] Immediately click extension (don't wait)
- [ ] Check result:
  - [ ] Shows "Please wait 15 seconds" error (expected)
  - [ ] OR works anyway (improved timing)

**Wait 5 seconds**
- [ ] Navigate to Instagram post
- [ ] Wait 5 seconds
- [ ] Click extension
- [ ] Check result:
  - [ ] Might work (if fast connection)
  - [ ] Might ask to wait longer

**Wait 15+ seconds (normal)**
- [ ] Navigate to Instagram post
- [ ] Wait 15 seconds
- [ ] Click extension
- [ ] Check result:
  - [ ] ✅ Should work reliably

---

## Phase 3: Edge Case Testing (5 minutes)

### Test 3.1: Different Instagram Views
- [ ] Profile page → Should show "Not on a post page" (expected)
- [ ] Home feed → Should show "Not on a post page" (expected)
- [ ] Explore page → Should show "Not on a post page" (expected)
- [ ] Direct post URL → Should work

### Test 3.2: Page Navigation
- [ ] Open post page 1
- [ ] Wait for extension to be ready
- [ ] Navigate to post page 2
- [ ] Wait 15 seconds
- [ ] Try download → Should work
- [ ] Navigate back to post page 1
- [ ] Try download → Should still work

### Test 3.3: Page Refresh
- [ ] Open post page
- [ ] Refresh page (Ctrl+R / Cmd+R)
- [ ] Wait 15 seconds
- [ ] Check console for initialization messages
- [ ] Try download → Should work

---

## Phase 4: Fallback Testing (Optional, 5 minutes)

### Test 4.1: Simulate Primary Method Failure
Only if you want to test the DevTools hook fallback:

- [ ] Open inject-v3-improved.js
- [ ] Temporarily comment out direct fiber search
- [ ] Keep only DevTools hook section
- [ ] Reload extension
- [ ] Test if it still finds environment via DevTools hook

---

## Phase 5: Performance Testing (5 minutes)

### Test 5.1: Check Search Time
- [ ] Open Instagram post
- [ ] Open console
- [ ] Note the timestamp when "[Instagram Downloader v3-improved] Starting..." appears
- [ ] Note the timestamp when "[Instagram Downloader v3-improved] ✅ Found Relay Environment!" appears
- [ ] Calculate difference:
  - [ ] < 100ms = Excellent
  - [ ] 100-500ms = Good
  - [ ] 500-1000ms = Acceptable
  - [ ] > 1000ms = May need optimization

### Test 5.2: Check Resource Usage
- [ ] Open browser Task Manager (Shift+Esc in Chrome)
- [ ] Find the Instagram tab
- [ ] Check memory usage:
  - [ ] No significant increase after extension loads
  - [ ] No memory leaks on page navigation
  - [ ] Extension doesn't slow down page

---

## Troubleshooting Checklist

### If Environment Not Found

- [ ] Verify React Fiber exists:
  ```javascript
  const main = document.querySelector('main');
  Object.keys(main).filter(k => k.startsWith('__reactFiber'))
  // Should return a key like: __reactFiber$5btki0pfeml
  ```

- [ ] Increase initial timeout in inject-v3-improved.js:
  ```javascript
  // Change from:
  setTimeout(() => { findRelayEnvironment(); }, 2000);
  // To:
  setTimeout(() => { findRelayEnvironment(); }, 5000);
  ```

- [ ] Check Instagram version:
  ```javascript
  // In console
  console.log(window.__additionalDataLoaded__); // Should be undefined or {}
  console.log(window._sharedData); // Should be undefined or {}
  // If these have data, Instagram rolled back to old version
  ```

---

### If Found But No Records

- [ ] Check store structure in console:
  ```javascript
  const env = window.__foundRelayEnvironment;
  const store = env._store || env.getStore();
  console.log('Store:', store);
  console.log('Store keys:', Object.keys(store));
  ```

- [ ] Try different record access paths:
  ```javascript
  console.log('Path 1:', store._recordSource?._records);
  console.log('Path 2:', store._recordSource?.__records);
  console.log('Path 3:', store.getSource?.()._records);
  console.log('Path 4:', store._records);
  ```

- [ ] Wait longer (30+ seconds) and try again

---

### If Found But Wrong Post

- [ ] Check shortcode matching:
  ```javascript
  // In console on post page
  const url = window.location.href;
  const shortcode = url.match(/\/p\/([^\/\?]+)/)[1];
  console.log('Looking for:', shortcode);

  const records = window.__testRelayRecords;
  const matches = Object.values(records).filter(r => r?.shortcode === shortcode);
  console.log('Matches:', matches);
  ```

---

## Success Criteria

All tests pass if:

- [x] Quick test or diagnostic finds environment ✅
- [x] Extension console shows "Ready!" message ✅
- [x] Can download media from posts ✅
- [x] Can download comments from posts ✅
- [x] Search finds 100+ relay records ✅
- [x] Works on different post types ✅
- [x] No console errors ✅
- [x] Performance is acceptable (<500ms search time) ✅

---

## Partial Success (Needs Investigation)

If some tests pass but not all:

- Environment found but 0 records → Store structure changed
- Environment found but wrong data → Shortcode matching issue
- Works sometimes but not always → Timing issue
- Slow performance → May need optimization

---

## Failure (Needs Alternative Approach)

If most tests fail:

- Instagram changed their architecture
- Relay is no longer used or accessed differently
- Need to switch to network interception method
- Need to parse HTML instead

---

## Deployment Checklist

Before deploying to users:

- [ ] All Phase 1 tests pass (browser console)
- [ ] All Phase 2 tests pass (extension integration)
- [ ] All Phase 3 tests pass (edge cases)
- [ ] Performance is acceptable
- [ ] No console errors
- [ ] Tested on multiple accounts
- [ ] Tested on multiple post types
- [ ] Tested on different network speeds
- [ ] Backup original version is saved
- [ ] Rollback plan is ready

---

## Rollback Plan

If improved version causes issues:

1. [ ] Restore original inject-v3.js from backup
2. [ ] Reload extension
3. [ ] Verify original version still works
4. [ ] Investigate what went wrong using diagnostic script
5. [ ] Try alternative approaches from DEBUGGING_GUIDE.md

---

## Notes Section

Use this space to record your findings:

**Test Date:** _______________

**Browser:** _______________

**Instagram Version:** _______________

**Quick Test Result:**
- Found: Yes / No
- Location: _______________
- Record Count: _______________

**Extension Test Result:**
- Media Download: Success / Fail
- Comments Download: Success / Fail
- Search Time: _______________ms

**Issues Encountered:**
- _______________
- _______________
- _______________

**Additional Observations:**
- _______________
- _______________
- _______________

---

Good luck with testing!
