# Comment Update Feature - Implementation Plan

## Overview
Add ability to re-scrape comments on previously downloaded posts, detecting:
- **New comments** (added since last scrape)
- **Deleted comments** (present in original, missing now)
- **Updated comments** (same ID, different text - rare on IG but possible)

## Data Model Changes

### 1. Comment History Storage
Store comment snapshots indexed by shortcode in `chrome.storage.local`:

```javascript
// Key: 'commentHistory'
// Value: Object mapping shortcode -> comment snapshot
{
  "ABC123xyz": {
    shortcode: "ABC123xyz",
    username: "someuser",
    lastUpdated: "2026-01-20T10:30:00Z",
    commentCount: 45,
    comments: [
      {
        id: "17854263847126534",
        text: "Great post!",
        created_at: 1705123456,
        owner_username: "commenter1",
        like_count: 5,
        status: "active",  // "active" | "deleted" | "new"
        first_seen: "2026-01-13T...",
        last_seen: "2026-01-20T...",
        replies: [...]
      }
    ]
  }
}
```

### 2. Enhanced Comment Object
Add metadata fields to track comment lifecycle:

```javascript
{
  // Existing fields
  id: string,
  text: string,
  created_at: number,
  owner: { username, profile_pic_url },
  like_count: number,
  replies: [],

  // NEW tracking fields
  _status: "active" | "deleted" | "new",
  _first_seen: ISO timestamp,    // When we first scraped this comment
  _last_seen: ISO timestamp,     // Most recent scrape where it existed
  _deleted_at: ISO timestamp,    // When we detected deletion (if deleted)
  _text_history: [               // If text changed (rare)
    { text: "old text", seen_at: "..." }
  ]
}
```

## New Functions

### background.js Additions

```javascript
// Storage key for comment history
const COMMENT_HISTORY_KEY = 'commentHistory';

// Get stored comments for a post
async function getStoredComments(shortcode) {
  const result = await chrome.storage.local.get(COMMENT_HISTORY_KEY);
  const history = result[COMMENT_HISTORY_KEY] || {};
  return history[shortcode] || null;
}

// Save comment snapshot
async function saveCommentSnapshot(shortcode, commentsData, username) {
  const result = await chrome.storage.local.get(COMMENT_HISTORY_KEY);
  const history = result[COMMENT_HISTORY_KEY] || {};

  history[shortcode] = {
    shortcode,
    username,
    lastUpdated: new Date().toISOString(),
    commentCount: commentsData.comments.length,
    comments: commentsData.comments
  };

  await chrome.storage.local.set({ [COMMENT_HISTORY_KEY]: history });
}

// Compare and merge comments
function mergeComments(oldComments, newComments) {
  const now = new Date().toISOString();
  const oldMap = new Map(oldComments.map(c => [c.id, c]));
  const newMap = new Map(newComments.map(c => [c.id, c]));

  const merged = [];
  const stats = { new: 0, deleted: 0, updated: 0, unchanged: 0 };

  // Process new comments - check against old
  for (const [id, newComment] of newMap) {
    const oldComment = oldMap.get(id);

    if (!oldComment) {
      // NEW comment
      merged.push({
        ...newComment,
        _status: 'new',
        _first_seen: now,
        _last_seen: now
      });
      stats.new++;
    } else {
      // Existing comment - check for text changes
      const textChanged = oldComment.text !== newComment.text;
      merged.push({
        ...newComment,
        _status: 'active',
        _first_seen: oldComment._first_seen || now,
        _last_seen: now,
        _text_history: textChanged
          ? [...(oldComment._text_history || []), { text: oldComment.text, seen_at: oldComment._last_seen }]
          : oldComment._text_history
      });
      stats[textChanged ? 'updated' : 'unchanged']++;
    }
  }

  // Find deleted comments (in old but not in new)
  for (const [id, oldComment] of oldMap) {
    if (!newMap.has(id)) {
      merged.push({
        ...oldComment,
        _status: 'deleted',
        _deleted_at: now
      });
      stats.deleted++;
    }
  }

  // Sort: active first, then new, then deleted
  // Within each group, sort by created_at descending
  merged.sort((a, b) => {
    const statusOrder = { active: 0, new: 1, deleted: 2 };
    if (statusOrder[a._status] !== statusOrder[b._status]) {
      return statusOrder[a._status] - statusOrder[b._status];
    }
    return b.created_at - a.created_at;
  });

  return { merged, stats };
}
```

### Export Enhancements

#### JSON Export with Status
```javascript
// Enhanced JSON structure
{
  post_info: {...},
  scrape_info: {
    current_scrape: "2026-01-20T10:30:00Z",
    previous_scrape: "2026-01-13T08:00:00Z",
    is_update: true
  },
  stats: {
    total: 52,
    new: 7,
    deleted: 2,
    unchanged: 43
  },
  comments: [
    // Comments include _status, _first_seen, etc.
  ]
}
```

#### CSV Export with Status Column
```
Post Username, Post URL, ..., Comment ID, Comment Username, Comment Text, Comment Created At, Comment Likes, Is Reply, Status, First Seen, Deleted At
user123, https://..., ..., 178542..., commenter1, "Great!", 2026-01-15, 5, No, active, 2026-01-13,
user123, https://..., ..., 178543..., commenter2, "New comment", 2026-01-19, 2, No, new, 2026-01-20,
user123, https://..., ..., 178544..., commenter3, "Old comment", 2026-01-10, 8, No, deleted, 2026-01-13, 2026-01-20
```

#### HTML Export with Visual Markers
```css
/* New comment highlight */
.comment-new {
  border-left: 3px solid #4CAF50;  /* Green */
  background: rgba(76, 175, 80, 0.1);
}
.comment-new::before {
  content: "NEW";
  background: #4CAF50;
  color: white;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  margin-right: 8px;
}

/* Deleted comment styling */
.comment-deleted {
  border-left: 3px solid #f44336;  /* Red */
  background: rgba(244, 67, 54, 0.1);
  opacity: 0.7;
}
.comment-deleted::before {
  content: "DELETED";
  background: #f44336;
  color: white;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  margin-right: 8px;
}
.comment-deleted .comment-text {
  text-decoration: line-through;
}
```

## UI Changes

### popup.html / sidepanel.html

Add "Update Comments" button in the download section:

```html
<!-- After existing comment download buttons -->
<div class="update-section" id="updateCommentsSection" style="display: none;">
  <div class="update-info">
    <span class="update-badge">Previously Downloaded</span>
    <span id="lastScrapedDate">Last scraped: Jan 13, 2026</span>
  </div>
  <button id="updateCommentsBtn" class="action-btn update-btn">
    🔄 Update Comments
  </button>
  <div class="update-options">
    <label>
      <input type="checkbox" id="keepDeletedComments" checked>
      Keep deleted comments (strikethrough)
    </label>
    <label>
      <input type="checkbox" id="highlightNewComments" checked>
      Highlight new comments
    </label>
  </div>
</div>
```

### Batch Processing - Update Mode

Add option to batch update comments for multiple posts:

```html
<div class="batch-mode-selector">
  <label>
    <input type="radio" name="batchMode" value="download" checked>
    📥 Download (skip already downloaded)
  </label>
  <label>
    <input type="radio" name="batchMode" value="updateComments">
    🔄 Update Comments Only (re-scrape comments for downloaded posts)
  </label>
</div>
```

## Implementation Steps

### Phase 1: Core Infrastructure
1. Add `COMMENT_HISTORY_KEY` storage management functions
2. Implement `getStoredComments()` and `saveCommentSnapshot()`
3. Implement `mergeComments()` comparison logic
4. Update download handlers to save comment snapshots

### Phase 2: Single Post Update
5. Add "Update Comments" button to popup/sidepanel
6. Detect if post was previously downloaded (check history)
7. On update: fetch new comments, merge with stored, export with status
8. Update HTML/JSON/CSV exporters to handle status fields

### Phase 3: Batch Update Mode
9. Add batch mode selector (download vs update)
10. In update mode: only process posts with stored comments
11. Skip media download, only update comment files
12. Show stats summary (X new, Y deleted across all posts)

### Phase 4: Visual Enhancements
13. Add CSS for new/deleted comment highlighting
14. Add filter toggles in HTML viewer (show/hide deleted)
15. Add summary stats in HTML header
16. Add "changes since last scrape" section

## Storage Considerations

### Size Management
Comment history could get large. Implement limits:

```javascript
const COMMENT_HISTORY_CONFIG = {
  MAX_POSTS: 500,           // Keep history for last 500 posts
  MAX_AGE_DAYS: 90,         // Delete history older than 90 days
  PRUNE_ON_SAVE: true       // Auto-cleanup on each save
};

async function pruneCommentHistory() {
  const result = await chrome.storage.local.get(COMMENT_HISTORY_KEY);
  const history = result[COMMENT_HISTORY_KEY] || {};

  const cutoffDate = Date.now() - (COMMENT_HISTORY_CONFIG.MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

  // Remove old entries
  const entries = Object.entries(history);
  const filtered = entries
    .filter(([_, data]) => new Date(data.lastUpdated).getTime() > cutoffDate)
    .sort((a, b) => new Date(b[1].lastUpdated) - new Date(a[1].lastUpdated))
    .slice(0, COMMENT_HISTORY_CONFIG.MAX_POSTS);

  const pruned = Object.fromEntries(filtered);
  await chrome.storage.local.set({ [COMMENT_HISTORY_KEY]: pruned });
}
```

## File Naming for Updates

When exporting updated comments, use versioned filenames:

```
Original:  username_POST_20260113_ABC123_comments.json
Update 1:  username_POST_20260113_ABC123_comments_v2_20260120.json
Update 2:  username_POST_20260113_ABC123_comments_v3_20260127.json
```

Or use a single file with full history:
```
username_POST_20260113_ABC123_comments_history.json
```

## Summary Report

After batch update, show summary:

```
┌─────────────────────────────────────────┐
│  Comment Update Complete                │
├─────────────────────────────────────────┤
│  Posts updated:     15                  │
│  New comments:      +47                 │
│  Deleted comments:  -12                 │
│  Unchanged:         523                 │
├─────────────────────────────────────────┤
│  Posts with most new comments:          │
│  • post_ABC123 (+15 new)                │
│  • post_DEF456 (+12 new)                │
│  • post_GHI789 (+8 new)                 │
└─────────────────────────────────────────┘
```

## Questions for Implementation

1. **Storage location for history**:
   - Option A: `chrome.storage.local` (5MB limit, may hit for heavy users)
   - Option B: IndexedDB (unlimited, more complex)
   - Option C: Save history JSON files alongside exports

2. **Update trigger**:
   - Option A: Automatic detection when opening previously downloaded post
   - Option B: Manual "Update Comments" button only
   - Option C: Batch "Update All" for entire profile

3. **Deleted comment handling**:
   - Option A: Keep forever (strikethrough in exports)
   - Option B: Remove after X days
   - Option C: User preference toggle

4. **File versioning**:
   - Option A: Overwrite with merged data
   - Option B: Create new versioned file
   - Option C: Both (merged + version history)
