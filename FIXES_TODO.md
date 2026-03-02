# IG Quick Save V8 - Issue Tracker & Fix Log

Generated from comprehensive 4-agent code review on 2026-03-02.
Reference this file if context is lost. All issues from the review are documented here.

---

## COMPLETED

### [DONE] Batch Sheets Sync Unreliable (V8.2.6 - d2ea905)
- **Problem:** Each batch post fired an individual HTTP POST to Google Apps Script. Failures silently lost. `trackBatchDownloads()` existed but was never called.
- **Fix:** Accumulate-and-flush pattern with retry queue. Flushes every 10 posts via bulk API.
- **Files:** `scripts/background.js`

### [DONE] Batch Hangs on Non-429 Errors (V8.3.0 - 10f7f1d)
- **Problem:** Non-429 errors in `tabs.onUpdated` catch block never incremented `currentIndex` or called `processNextBatchUrl()`. Batch stalled permanently.
- **Fix:** Added `currentIndex++`, lock release, and `processNextBatchUrl()` scheduling in non-429 error path.
- **Files:** `scripts/background.js`

### [DONE] SPA Navigation Cache Bug (V8.3.0 - 10f7f1d)
- **Problem:** `cachedPostData` never cleared on Instagram SPA navigation. Wrong post data returned.
- **Fix:** Added `cachedPostUrl` tracking, `history.pushState`/`replaceState` interception, `popstate` listener, and URL check in `extractPostData()`.
- **Files:** `scripts/inject-v7-final.js`

### [DONE] `isRateLimited` ReferenceError (V8.3.0 - 10f7f1d)
- **Problem:** `fetchChildComments()` referenced undeclared `isRateLimited` variable. ReferenceError on 429 silently aborted child comment fetching.
- **Fix:** Added `let isRateLimited = false;` in `fetchChildComments` scope.
- **Files:** `scripts/inject-v7-final.js`

### [DONE] `postMessage` Wildcard Origin (V8.3.0 - 10f7f1d)
- **Problem:** All 26 `window.postMessage(..., '*')` calls used wildcard origin. Any iframe could spoof/intercept.
- **Fix:** Changed all to `window.location.origin`. Added `event.origin` validation in content.js.
- **Files:** `scripts/inject-v7-final.js`, `scripts/profile-scraper.js`, `scripts/content.js`

### [DONE] Auth Persists Permanently (V8.3.0 - 10f7f1d)
- **Problem:** `isAuthenticated` in `chrome.storage.local` persisted forever across browser sessions.
- **Fix:** Moved to `chrome.storage.session` (clears on browser close). Password hash stays in local storage.
- **Files:** `popup.js`, `sidepanel.js`

### [DONE] `web_accessible_resources` Overly Broad (V8.3.0 - 10f7f1d)
- **Problem:** Viewer scripts exposed via `"matches": ["<all_urls>"]`.
- **Fix:** Changed to `["https://www.instagram.com/*"]`.
- **Files:** `manifest.json`

### [DONE] `onMessage` Listener Leaks Channels (V8.3.0 - 10f7f1d)
- **Problem:** Unconditional `return true` at end of first `onMessage` listener kept every channel open.
- **Fix:** Removed unconditional return. Only async-response handlers now return true.
- **Files:** `scripts/background.js`

### [DONE] `openSidePanel` Handler Missing (V8.3.0 - 10f7f1d)
- **Problem:** Popup sent `{ action: 'openSidePanel' }` but no handler existed. Side panel button always showed "Unavailable."
- **Fix:** Added handler using `chrome.sidePanel.open({ windowId })` with proper fallbacks.
- **Files:** `scripts/background.js`

### [DONE] Keepalive Battery Drain (V8.3.0 - 10f7f1d)
- **Problem:** `setInterval` keepalive fired every 25s forever, even when idle.
- **Fix:** `startKeepalive()`/`stopKeepalive()` helpers. Only active during batch processing (3 start + 3 stop call sites).
- **Files:** `scripts/background.js`

### [DONE] Debug Logging in Production (V8.3.0 - 10f7f1d)
- **Problem:** All debug flags (`ENABLE_CONSOLE_LOGS`, `ENABLE_VERBOSE_LOGS`, etc.) set to `true`.
- **Fix:** Set all 4 flags to `false`.
- **Files:** `config.js`

---

## REMAINING (Low Priority / Deferred)

### `batchNextUrl` Alarm Not Cleared on Stop
- **Severity:** Low
- `chrome.alarms.clear('batchNextUrl')` missing from stopBatch and batch completion paths.
- **File:** `scripts/background.js`

### `savedBatchState` Doesn't Persist `skipSources`
- **Severity:** Low
- `batchState.skipSources` not saved to storage. Resets to defaults on SW restart.
- **File:** `scripts/background.js` (saveBatchState function)

### `folderScanCache` Write is Fire-and-Forget
- **Severity:** Low
- `chrome.storage.local.set(...)` without `await` or `.catch()`. May not complete before SW sleep.
- **File:** `scripts/background.js`

### Partial Extractions Double-Counted
- **Severity:** Low
- Posts with suspicious metadata counted as both `successCount++` AND added to `failedUrls`.
- **File:** `scripts/background.js`

### `MAX_BATCH_SIZE` Never Enforced
- **Severity:** Low
- Config says max 100 URLs but `startBatch` handler never checks length.
- **File:** `scripts/background.js`

### `getDownloadedShortcodes` Should Cache in Memory
- **Severity:** Medium (Performance)
- Re-reads and reconstructs a `Set` from 10K items on every call. Should cache in-memory.
- **File:** `scripts/background.js`

### SheetsSync `refreshCache` Sequential HTTP Calls
- **Severity:** Low (Performance)
- 3 sequential HTTP calls should use `Promise.all()`.
- **File:** `scripts/sheets-sync.js`

### SheetsSync `updateProfileTotal` Re-fetches Full List
- **Severity:** Low (Performance)
- Re-fetches full profiles list after every single update.
- **File:** `scripts/sheets-sync.js`

### Profile Scraper `window.fetch` Patch is Permanent
- **Severity:** Low
- Monkey-patch installed on load, never removed even after collection stops.
- **File:** `scripts/profile-scraper.js`

### `offscreen.js` Promise Anti-Pattern
- **Severity:** Low
- `new Promise(async (resolve, reject) => ...)` may silently swallow errors.
- **File:** `offscreen.js`

### DOM Nodes Leaked on Screenshot Failure
- **Severity:** Low
- Container element not cleaned up in error path of `renderInstagramScreenshot`.
- **File:** `offscreen.js`

### ~240 Lines Dead Code
- **Severity:** Low
- `fetchCommentsViaAPI` function is never called (GraphQL path always used).
- **File:** `scripts/inject-v7-final.js`

### URL Detection Inconsistency
- **Severity:** Low
- Popup checks for `/reels/` (plural) but content.js regex doesn't include it.
- **Files:** `popup.js`, `scripts/content.js`

### Hardcoded Default Password
- **Severity:** Medium (Security)
- `'MM777*+'` in plain text in `popup.js`. Config comment says `'MM66^^'` (mismatch).
- Should force user to set password on first run instead.
- **Files:** `popup.js`, `config.js`

### Logger Perpetual Storage Writes
- **Severity:** Low (Performance)
- Logger's `setInterval` writes to storage every 10s even with empty buffer.
- **File:** `scripts/logger.js`
