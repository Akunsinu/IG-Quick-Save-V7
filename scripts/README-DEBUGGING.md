# Instagram Relay Environment Debugging - Complete Guide

## Overview

This directory contains improved tools for finding and accessing Instagram's Relay environment through React Fiber. The original `inject-v3.js` was unable to locate the Relay environment, so we've created enhanced versions with better search algorithms and diagnostic tools.

## Files in This Directory

### 1. `inject-v3.js` (Original)
The original implementation with limited search capabilities.

**Issues:**
- Only checks 3 fiber properties (memoizedState, memoizedProps, stateNode)
- Limited search depth (50 max, siblings 10, parents 5)
- Weak environment detection
- No debugging output

### 2. `inject-v3-improved.js` (Enhanced Version)
Improved version with comprehensive search algorithm.

**Improvements:**
- Checks 8+ fiber properties including dependencies, updateQueue, alternate
- Increased depth to 100
- Better environment detection with multiple signatures
- Falls back to React DevTools hook
- Enhanced logging

**Usage:** Replace inject-v3.js with this version in your extension.

### 3. `improved-search-function.js` (Standalone Function)
The core search algorithm extracted as a standalone, reusable function.

**Features:**
- Optional debug logging parameter
- Comprehensive property search
- Better environment detection
- Can be imported into other scripts

**Usage:**
```javascript
const env = searchFiberForRelayEnvironment(fiber, 0, new Set(), true);
// Last parameter 'true' enables debug logging
```

### 4. `diagnostic-console-script.js` (Browser Diagnostic)
Complete diagnostic tool to run in browser console.

**What it does:**
- Searches fiber tree with detailed logging
- Shows what properties exist at each level
- Checks window globals
- Checks React DevTools hook
- Saves found environment to `window.__foundRelayEnvironment`

**Usage:**
1. Open Instagram post page
2. Open browser console (F12)
3. Copy and paste entire file contents
4. Press Enter
5. Watch console output

**Expected output if successful:**
```
=== Instagram Relay Environment Diagnostic ===
✅ Found React Fiber key: __reactFiber$5btki0pfeml on element: MAIN
=== Starting Breadth-First Fiber Tree Search ===
Fiber [depth 0]: {...}
  memoizedState properties: [...]
  state[0].memoizedState properties: [...]
  🎯 FOUND RELAY ENVIRONMENT in state[2].memoizedState!

🎉 SUCCESS! Found Relay Environment!
Environment object: {...}
Store: {...}
Record count: 543

✅ Environment saved to window.__foundRelayEnvironment
```

### 5. `quick-test.js` (Quick Browser Test)
Lightweight test script for quick verification.

**What it does:**
- Fast search (limited to 500 nodes)
- Quick checks only
- Shows if environment can be found
- Provides basic troubleshooting tips

**Usage:**
Same as diagnostic script, but faster results.

### 6. `DEBUGGING_GUIDE.md` (Documentation)
Comprehensive guide explaining:
- Problem analysis
- Solution details
- How each improvement works
- Troubleshooting steps
- Alternative approaches

### 7. `README-DEBUGGING.md` (This File)
Quick reference guide for all debugging tools.

## Quick Start

### Step 1: Initial Test
Run `quick-test.js` in browser console to quickly check if the improved algorithm works.

```javascript
// 1. Open Instagram post: https://www.instagram.com/p/XXXXXXXXX/
// 2. Open browser console (F12)
// 3. Copy and paste contents of quick-test.js
// 4. Press Enter
```

**Expected outcome:**
- ✅ Found → The improved version should work
- ❌ Not found → Run full diagnostic (Step 2)

### Step 2: Full Diagnostic
If quick test fails, run full diagnostic script.

```javascript
// Copy and paste contents of diagnostic-console-script.js into console
```

**What to look for:**
- Where in the fiber tree is the search going?
- What properties exist at each level?
- Does it find the environment eventually?
- Is the environment in an unexpected location?

### Step 3: Deploy Improved Version
If diagnostic finds the environment, deploy the improved inject script.

**Option A: Direct replacement**
Replace `inject-v3.js` with `inject-v3-improved.js` in your extension.

**Option B: Merge improvements**
If you have custom modifications to inject-v3.js:
1. Copy the improved `searchFiberForRelayEnvironment` function
2. Replace the original function in your inject-v3.js
3. Add the `isRelayEnvironment` helper function

### Step 4: Test in Extension
1. Reload extension
2. Navigate to Instagram post
3. Wait 15 seconds
4. Check browser console for messages
5. Try downloading media/comments

## Understanding the Search Algorithm

### Original Algorithm Flow
```
Start at root fiber
  → Check memoizedState
  → Check memoizedProps
  → Check stateNode
  → Search child (depth+1, max 50)
  → Search sibling (depth+1, max 10)
  → Search parent (depth+1, max 5)
```

**Problems:**
- Misses many properties where environment could be
- Arbitrary depth limits cut search short
- Doesn't check state linked list thoroughly

### Improved Algorithm Flow
```
Start at root fiber (multiple roots tried)
  → Check memoizedState (all properties)
    → Traverse state linked list (50 states)
      → Check memoizedState, baseState, queue
      → Check ALL properties in each state
  → Check memoizedProps (all properties)
  → Check pendingProps (all properties)
  → Check stateNode (props, state, context, all properties)
  → Check updateQueue (baseState, memoizedState, shared)
  → Check dependencies (context linked list)
  → Check type._context (_currentValue, _currentValue2)
  → Check alternate fiber
  → Search child (depth+1, max 100)
  → Search sibling (depth+1, max 100)
  → Search parent (depth+1, max 20)
```

**Benefits:**
- Comprehensive property coverage
- Deeper traversal
- Better environment detection
- Checks alternative fiber (work-in-progress vs current)

## Common Scenarios

### Scenario 1: Environment Found Immediately
```
[Instagram Downloader v3-improved] Starting...
[Instagram Downloader v3-improved] Found React Fiber: __reactFiber$5btki0pfeml
[Instagram Downloader v3-improved] ✅ Found Relay Environment!
[Instagram Downloader v3-improved] Store structure: {...}
[Instagram Downloader v3-improved] ✅ Ready!
```

**Action:** No action needed, everything works!

### Scenario 2: Environment Found on Retry
```
[Instagram Downloader v3-improved] Starting...
[Instagram Downloader v3-improved] Found React Fiber: __reactFiber$5btki0pfeml
[Instagram Downloader v3-improved] ⚠️ Relay environment not found yet
[Instagram Downloader v3-improved] ✅ Found Relay Environment!
[Instagram Downloader v3-improved] ✅ Ready (retry)!
```

**Action:** Works but needs more initial delay. Consider increasing initial timeout.

### Scenario 3: Environment Not Found
```
[Instagram Downloader v3-improved] Starting...
[Instagram Downloader v3-improved] Found React Fiber: __reactFiber$5btki0pfeml
[Instagram Downloader v3-improved] ⚠️ Relay environment not found yet
[Instagram Downloader v3-improved] ❌ Could not find Relay environment
[Instagram Downloader v3-improved] Try running the diagnostic script in the console
```

**Action:**
1. Run diagnostic script to see where it's searching
2. Check if Instagram changed their structure
3. Try alternative approaches (see below)

### Scenario 4: React Fiber Not Found
```
[Instagram Downloader v3-improved] Starting...
[Instagram Downloader v3-improved] ❌ Could not find Relay environment
```

**Action:**
1. Check if page is fully loaded
2. Verify Instagram hasn't changed their build
3. Check if React DevTools can see the app
4. Try different root elements

## Alternative Approaches

If none of the improved methods work, consider these alternatives:

### 1. Network Interception
Intercept GraphQL responses instead of accessing Relay store.

**Pros:**
- Doesn't depend on React/Relay internals
- Gets data directly from API

**Cons:**
- Requires more complex parsing
- May miss cached data

### 2. Webpack Module Cache
Access Instagram's webpack modules directly.

**Pros:**
- Can access internal modules
- Might find Relay environment in module cache

**Cons:**
- Very fragile, depends on build structure
- Difficult to maintain

### 3. MutationObserver
Watch for DOM changes and extract data from rendered HTML.

**Pros:**
- Doesn't depend on internals at all
- Very reliable

**Cons:**
- Limited data access
- Can't get all metadata

## Troubleshooting Reference

### Error: "React Fiber not found"
**Possible causes:**
- Page not fully loaded
- Instagram changed build configuration
- Different React version

**Solutions:**
- Increase initial delay
- Try different root elements
- Check React DevTools

### Error: "Relay environment not found"
**Possible causes:**
- Environment stored in different location
- Different Relay version
- Environment created after initial search

**Solutions:**
- Run diagnostic script to see search path
- Check window globals
- Add mutation observer
- Increase search depth

### Error: "Found environment but 0 records"
**Possible causes:**
- Records in different property
- Store not populated yet
- Different store structure

**Solutions:**
- Inspect store object in console
- Check `store.getSource()` method
- Look for `__records` instead of `_records`
- Wait longer before accessing

### Error: "Found records but no shortcode match"
**Possible causes:**
- Post not loaded into store yet
- Different record structure
- Shortcode in different property

**Solutions:**
- Wait 30+ seconds after page load
- Inspect record structure
- Check `__typename` field
- Search by ID instead of shortcode

## Advanced Debugging

### Inspect Fiber Tree Manually
```javascript
// Get fiber
const main = document.querySelector('main');
const fiberKey = Object.keys(main).find(k => k.startsWith('__reactFiber'));
const fiber = main[fiberKey];

// Explore structure
console.log('Fiber type:', fiber.type);
console.log('Memoized state:', fiber.memoizedState);
console.log('Memoized props:', fiber.memoizedProps);

// Walk children
let child = fiber.child;
while (child) {
  console.log('Child:', child.type?.name || child.type);
  child = child.sibling;
}
```

### Inspect Store Structure
```javascript
// Assuming you found environment
const env = window.__foundRelayEnvironment;
const store = env._store || env.getStore();

console.log('Store keys:', Object.keys(store));
console.log('Store proto:', Object.getPrototypeOf(store));

// Try different paths to records
console.log('Path 1:', store._recordSource?._records);
console.log('Path 2:', store._recordSource?.__records);
console.log('Path 3:', store.getSource?.()._records);
console.log('Path 4:', store._records);
```

### Monitor Network Requests
```javascript
// Log all GraphQL requests
const originalFetch = window.fetch;
window.fetch = function(...args) {
  if (args[0].includes('graphql')) {
    console.log('GraphQL request:', args);
  }
  return originalFetch.apply(this, args).then(res => {
    if (args[0].includes('graphql')) {
      res.clone().json().then(data => {
        console.log('GraphQL response:', data);
      });
    }
    return res;
  });
};
```

## Success Metrics

You know it's working when:

1. ✅ Console shows "Found Relay Environment"
2. ✅ Console shows "Store structure" with keys
3. ✅ "Searching X relay records" shows 100+ records
4. ✅ Extension can download media/comments
5. ✅ No error messages about "data not loaded"

## Additional Resources

- **DEBUGGING_GUIDE.md** - Detailed explanation of improvements
- **improved-search-function.js** - Standalone search function with documentation
- **diagnostic-console-script.js** - Full diagnostic with inline comments
- **quick-test.js** - Fast test with troubleshooting tips

## Support

If you've tried all the above and still can't find the Relay environment:

1. Check if Instagram rolled out a new version
2. Look for Relay-related changes in Instagram's code
3. Consider alternative data access methods
4. File an issue with diagnostic script output

## Version History

- **v3** - Original implementation with basic fiber search
- **v3-improved** - Enhanced search algorithm with comprehensive property coverage
- **diagnostic** - Browser-based diagnostic tools for debugging

---

Good luck! The diagnostic script should help you find exactly where Instagram is storing the Relay environment.
