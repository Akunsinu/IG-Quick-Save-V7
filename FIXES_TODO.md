# IG Quick Save V8 - Issue Tracker & Fix Log

Generated from comprehensive 4-agent code review on 2026-03-02.

---

## COMPLETED

### [DONE] Batch Sheets Sync Unreliable (V8.2.6 - d2ea905)
- **Problem:** Each batch post fired an individual HTTP POST to Google Apps Script. Failures were silently swallowed, losing downloads from Sheets permanently. `trackBatchDownloads()` existed but was never called.
- **Fix:** Accumulate-and-flush pattern. Pending queue flushes every 10 posts via bulk API. Retry queue + final flush at batch completion/stop/429-stop. Warns user if syncs still fail.
- **Files:** `scripts/background.js`

---

## IN PROGRESS

### 1. Batch Hangs on Non-429 Errors (CRITICAL)
- **Problem:** In `tabs.onUpdated` catch block, non-429 errors never increment `currentIndex` or call `processNextBatchUrl()`. Batch stalls permanently.
- **File:** `scripts/background.js` ~line 2960 (non-429 else branch)
- **Fix:** Increment `currentIndex`, schedule `processNextBatchUrl()` (same as navigation-error path).

### 2. SPA Navigation Cache Bug (CRITICAL)
- **Problem:** `cachedPostData` in `inject-v7-final.js` is never cleared on Instagram SPA navigation. Navigating between posts returns stale data from the previous post.
- **File:** `scripts/inject-v7-final.js` (cachedPostData), `scripts/content.js` (no URL change detection)
- **Fix:** Add URL change detection (monitor `popstate`/`pushState`) to invalidate `cachedPostData`. Add listener in content.js to re-trigger injection or clear cache on navigation.

### 3. `isRateLimited` ReferenceError in Child Comments (HIGH)
- **Problem:** `fetchChildComments()` references `isRateLimited` but it's declared only in `fetchCommentsViaAPI()` scope. In strict mode, this throws ReferenceError on 429, silently aborting child comment fetching.
- **File:** `scripts/inject-v7-final.js` ~line 522
- **Fix:** Declare `isRateLimited` in `fetchChildComments` scope, or pass it as parameter.

### 4. Auth Persists Permanently / Hardcoded Password (HIGH - Security)
- **Problem:** `isAuthenticated` stored in `chrome.storage.local` (persists forever). Default password `'MM777*+'` hardcoded in plain text in `popup.js`. Config comment says `'MM66^^'` (mismatch).
- **Files:** `popup.js:90,118`, `sidepanel.js:99`, `config.js:232-234`
- **Fix:** Move auth to `chrome.storage.session` (clears on browser close). Remove hardcoded default — force user to set password on first run.

### 5. `postMessage` Wildcard Origin (MEDIUM - Security)
- **Problem:** All `window.postMessage(..., '*')` calls broadcast to any frame. Any iframe on instagram.com could spoof or intercept messages.
- **Files:** `scripts/inject-v7-final.js`, `scripts/profile-scraper.js`, `scripts/content.js`
- **Fix:** Change `'*'` to `window.location.origin` on send. Validate `event.origin` on receive.

### 6. `web_accessible_resources` Overly Broad (MEDIUM - Security)
- **Problem:** Viewer scripts exposed via `"matches": ["<all_urls>"]`. Any website can load them.
- **File:** `manifest.json:47-56`
- **Fix:** Change to `["https://www.instagram.com/*"]` or specific extension URLs.

### 7. `onMessage` Listener Leaks Channels (MEDIUM)
- **Problem:** First `onMessage` listener unconditionally `return true` on line 544. Every message keeps its channel open until SW terminates.
- **File:** `scripts/background.js` ~line 544
- **Fix:** Move `return true` inside only the `if` blocks that send async responses.

### 8. Keepalive Battery Drain (MEDIUM - Performance)
- **Problem:** `setInterval` keepalive fires every 25s forever, even when idle. Prevents SW from sleeping. Logger also writes to storage every 10s perpetually.
- **Files:** `scripts/background.js:10-12`, `scripts/logger.js:73`
- **Fix:** Only activate keepalive during active batch/download. Clear interval when idle.

### 9. `openSidePanel` Handler Missing (MEDIUM)
- **Problem:** Popup sends `{ action: 'openSidePanel' }` but no handler exists in background.js. Side panel button always shows "Unavailable."
- **Files:** `popup.js`, `scripts/background.js`
- **Fix:** Add handler for `openSidePanel` in the `onMessage` listener.

### 10. Debug Logging Enabled in Production (LOW)
- **Problem:** `ENABLE_CONSOLE_LOGS: true` and `ENABLE_VERBOSE_LOGS: true` in config. 133+ console statements in inject script with DEBUG labels.
- **File:** `config.js:244-248`
- **Fix:** Set to `false` for production. Guard verbose logs behind config check.

---

## DEFERRED / LOW PRIORITY

- `batchNextUrl` alarm not cleared on batch stop/complete
- `savedBatchState` doesn't persist `skipSources`
- `folderScanCache` write is fire-and-forget (no await/error handling)
- Partial extractions counted as both success AND failure
- `MAX_BATCH_SIZE` config limit never enforced
- `getDownloadedShortcodes` re-reads 10K array from storage every call (should cache in memory)
- `SheetsSync.updateProfileTotal` re-fetches full profiles list after every update
- `SheetsSync.refreshCache` makes 3 sequential HTTP requests (should parallelize)
- Profile scraper `window.fetch` monkey-patch is permanent
- `offscreen.js` uses `new Promise(async ...)` anti-pattern
- DOM nodes leaked on screenshot render failure
- ~240 lines dead code (`fetchCommentsViaAPI`) never called
- Popup/content script URL detection inconsistency (`/reels/` plural)
