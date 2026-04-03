/**
 * Google Apps Script - Instagram Download Tracker
 * ================================================
 *
 * SETUP INSTRUCTIONS:
 *
 * 1. Create a new Google Sheet (sheets and headers are auto-created on first use)
 * 2. Go to Extensions > Apps Script
 * 3. Delete any existing code and paste this entire file
 * 4. Update SPREADSHEET_ID below with your Google Sheet ID (from the URL)
 * 5. Click Deploy > New Deployment
 * 6. Select type: Web app
 * 7. Set Execute as: Me
 * 8. Set Who has access: Anyone
 * 9. Click Deploy and copy the Web App URL
 * 10. Paste that URL into the extension's Team Sync settings
 *
 * Your Sheet ID is in the URL: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
 */

// ============================================================
// CONFIGURATION - UPDATE THIS WITH YOUR SHEET ID
// ============================================================
const SPREADSHEET_ID = '1OfKy8Zux_Imv1YC6vCDcwsSFMqUyXnDhwkM2QIoTv6Y';  // <-- REPLACE THIS
const DOWNLOADS_SHEET = 'Downloads';
const PROFILES_SHEET = 'Profiles';
const NAMES_SHEET = 'Names';

// Canonical header definitions — used by auto-creation and validation
const DOWNLOADS_HEADERS = ['timestamp', 'shortcode', 'url', 'real_name', 'username', 'post_type', 'media_count', 'comment_count', 'caption', 'downloader', 'post_date', 'collaborators'];
const PROFILES_HEADERS = ['username', 'total_posts', 'downloaded_count', 'completion_pct', 'last_updated'];

// ============================================================
// SHEET CREATION & VALIDATION HELPERS
// ============================================================

/**
 * Get or create the Downloads sheet with correct headers.
 * Validates and repairs header row if it doesn't match the expected columns.
 */
function getOrCreateDownloadsSheet(ss) {
  let sheet = ss.getSheetByName(DOWNLOADS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DOWNLOADS_SHEET);
    sheet.appendRow(DOWNLOADS_HEADERS);
    sheet.getRange(1, 1, 1, DOWNLOADS_HEADERS.length).setFontWeight('bold');
  } else {
    // Validate header row matches expected columns
    const lastCol = sheet.getLastColumn();
    if (lastCol > 0) {
      const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      if (!headersMatch(currentHeaders, DOWNLOADS_HEADERS)) {
        // Overwrite header row with correct headers
        sheet.getRange(1, 1, 1, DOWNLOADS_HEADERS.length).setValues([DOWNLOADS_HEADERS]);
        sheet.getRange(1, 1, 1, DOWNLOADS_HEADERS.length).setFontWeight('bold');
      }
    } else {
      // Sheet exists but is empty — write headers
      sheet.appendRow(DOWNLOADS_HEADERS);
      sheet.getRange(1, 1, 1, DOWNLOADS_HEADERS.length).setFontWeight('bold');
    }
  }
  return sheet;
}

/**
 * Get or create the Profiles sheet with correct headers.
 */
function getOrCreateProfilesSheet(ss) {
  let sheet = ss.getSheetByName(PROFILES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PROFILES_SHEET);
    sheet.appendRow(PROFILES_HEADERS);
    sheet.getRange(1, 1, 1, PROFILES_HEADERS.length).setFontWeight('bold');
  } else {
    const lastCol = sheet.getLastColumn();
    if (lastCol > 0) {
      const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      if (!headersMatch(currentHeaders, PROFILES_HEADERS)) {
        sheet.getRange(1, 1, 1, PROFILES_HEADERS.length).setValues([PROFILES_HEADERS]);
        sheet.getRange(1, 1, 1, PROFILES_HEADERS.length).setFontWeight('bold');
      }
    } else {
      sheet.appendRow(PROFILES_HEADERS);
      sheet.getRange(1, 1, 1, PROFILES_HEADERS.length).setFontWeight('bold');
    }
  }
  return sheet;
}

/**
 * Read sheet data with bounded columns to avoid exceeding Apps Script size limits.
 * Use instead of sheet.getDataRange().getValues() for sheets with user-added columns or large captions.
 */
function getBoundedData(sheet, maxCols) {
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) return [];
  const cols = Math.min(maxCols || sheet.getLastColumn(), sheet.getLastColumn());
  if (cols === 0) return [];
  return sheet.getRange(1, 1, lastRow, cols).getValues();
}

/**
 * Check if the first N headers match the expected headers (case-insensitive, trimmed).
 */
function headersMatch(current, expected) {
  for (let i = 0; i < expected.length; i++) {
    if (String(current[i] || '').trim().toLowerCase() !== expected[i].toLowerCase()) {
      return false;
    }
  }
  return true;
}

// ============================================================
// GET HANDLER - Read data
// ============================================================
function doGet(e) {
  try {
    const action = e.parameter.action || 'getAll';
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    let result;

    switch(action) {
      case 'getAll':
        result = getAllDownloads(ss);
        break;
      case 'getProfiles':
        result = getProfileStats(ss);
        break;
      case 'checkDownloaded':
        const shortcodes = e.parameter.shortcodes ?
          e.parameter.shortcodes.split(',') : [];
        result = checkIfDownloaded(ss, shortcodes);
        break;
      case 'getNames':
        result = getAllNames(ss);
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================
// POST HANDLER - Write data (with locking for concurrency)
// ============================================================
function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    // Wait up to 30 seconds for lock (handles concurrent writes from 4 users)
    lock.waitLock(30000);

    const data = JSON.parse(e.postData.contents);
    const action = data.action || 'addDownload';
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    let result;

    switch(action) {
      case 'addDownload':
        result = addDownload(ss, data);
        break;
      case 'addBatch':
        result = addBatchDownloads(ss, data.downloads);
        break;
      case 'updateProfileTotal':
        result = updateProfileTotal(ss, data.username, data.totalPosts);
        break;
      case 'addName':
        result = addNameMapping(ss, data.username, data.realName);
        break;
      case 'updateName':
        result = updateNameMapping(ss, data.username, data.realName);
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// READ FUNCTIONS
// ============================================================

/**
 * Get all downloads from the sheet
 */
function getAllDownloads(ss) {
  const sheet = getOrCreateDownloadsSheet(ss);

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { downloads: [], count: 0 };
  }

  // Read only the columns the extension needs for caching: skip caption (col 9) which is large.
  // Columns: A=timestamp(1), B=shortcode(2), C=url(3), D=real_name(4), E=username(5),
  //          F=post_type(6), G=media_count(7), H=comment_count(8), J=downloader(10),
  //          K=post_date(11), L=collaborators(12)
  // Read cols 1-8 and 10-12 separately to skip col 9 (caption)
  const leftData = sheet.getRange(2, 1, lastRow - 1, 8).getValues();   // cols A-H
  const rightData = sheet.getRange(2, 10, lastRow - 1, 3).getValues(); // cols J-L

  const downloads = [];
  for (let i = 0; i < leftData.length; i++) {
    const left = leftData[i];
    const right = rightData[i];
    downloads.push({
      timestamp: left[0],
      shortcode: left[1],
      url: left[2],
      real_name: left[3],
      username: left[4],
      post_type: left[5],
      media_count: left[6],
      comment_count: left[7],
      caption: '',  // omitted for performance — not used by extension cache
      downloader: right[0],
      post_date: right[1],
      collaborators: right[2]
    });
  }

  return {
    downloads,
    count: downloads.length,
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Get profile statistics
 */
function getProfileStats(ss) {
  const sheet = getOrCreateProfilesSheet(ss);

  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    return { profiles: [] };
  }

  const headers = data[0];
  const profiles = data.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i];
    });
    return obj;
  });

  return { profiles };
}

/**
 * Check if specific shortcodes are already downloaded
 */
function checkIfDownloaded(ss, shortcodes) {
  const sheet = getOrCreateDownloadsSheet(ss);

  const data = getBoundedData(sheet, DOWNLOADS_HEADERS.length);

  const downloadedSet = new Set();
  const headers = data[0];
  const shortcodeCol = headers.indexOf('shortcode');

  if (shortcodeCol >= 0) {
    data.slice(1).forEach(row => {
      downloadedSet.add(row[shortcodeCol]);
    });
  }

  const results = {};
  shortcodes.forEach(sc => {
    results[sc] = downloadedSet.has(sc);
  });

  return { results };
}

// ============================================================
// WRITE FUNCTIONS
// ============================================================

/**
 * Add a single download record
 */
function addDownload(ss, data) {
  const sheet = getOrCreateDownloadsSheet(ss);

  // Check for duplicate — only read shortcode column (index 1) to avoid size limits
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const shortcodes = sheet.getRange(2, 2, lastRow - 1, 1).getValues(); // column B = shortcode
    for (let i = 0; i < shortcodes.length; i++) {
      if (shortcodes[i][0] === data.shortcode) {
        return { success: true, duplicate: true, message: 'Already tracked' };
      }
    }
  }

  // Append new row
  const row = [
    new Date().toISOString(),                           // timestamp
    data.shortcode || '',                               // shortcode
    data.url || `https://www.instagram.com/p/${data.shortcode}/`,  // url
    data.real_name || '',                               // real_name
    data.username || '',                                // username
    data.post_type || 'POST',                           // post_type
    data.media_count || 0,                              // media_count
    data.comment_count || 0,                            // comment_count
    data.caption || '',                                 // caption (full)
    data.downloader || '',                              // downloader
    data.post_date || '',                               // post_date
    data.collaborators || ''                            // collaborators (comma-separated)
  ];

  sheet.appendRow(row);

  // Update profile stats
  updateProfileStatsForUser(ss, data.username);

  return { success: true, added: true };
}

/**
 * Add multiple downloads (batch) - more efficient for bulk operations
 */
function addBatchDownloads(ss, downloads) {
  const sheet = getOrCreateDownloadsSheet(ss);

  let added = 0;
  let duplicates = 0;

  // Get existing shortcodes — only read column B to avoid size limits
  const existingShortcodes = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const shortcodes = sheet.getRange(2, 2, lastRow - 1, 1).getValues(); // column B = shortcode
    shortcodes.forEach(row => {
      existingShortcodes.add(row[0]);
    });
  }

  // Filter out duplicates and prepare rows
  const newRows = [];
  const usersToUpdate = new Set();

  downloads.forEach(data => {
    if (existingShortcodes.has(data.shortcode)) {
      duplicates++;
      return;
    }

    existingShortcodes.add(data.shortcode); // Prevent duplicates within batch
    usersToUpdate.add(data.username);

    newRows.push([
      new Date().toISOString(),
      data.shortcode || '',
      data.url || `https://www.instagram.com/p/${data.shortcode}/`,  // url
      data.real_name || '',                                          // real_name
      data.username || '',
      data.post_type || 'POST',
      data.media_count || 0,
      data.comment_count || 0,
      data.caption || '',                                            // caption (full)
      data.downloader || '',
      data.post_date || '',
      data.collaborators || ''                                       // collaborators (comma-separated)
    ]);
  });

  // Append all new rows at once (more efficient)
  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, newRows[0].length).setValues(newRows);
    added = newRows.length;
  }

  // Update profile stats for affected users
  usersToUpdate.forEach(username => {
    updateProfileStatsForUser(ss, username);
  });

  return { success: true, added, duplicates };
}

/**
 * Update total posts for a profile (manually set by user)
 */
function updateProfileTotal(ss, username, totalPosts) {
  const sheet = getOrCreateProfilesSheet(ss);

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const usernameCol = headers.indexOf('username');
  const totalPostsCol = headers.indexOf('total_posts');

  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][usernameCol] === username) {
      // Update existing row
      sheet.getRange(i + 1, totalPostsCol + 1).setValue(totalPosts);
      recalculateProfileRow(ss, sheet, i + 1, totalPosts);
      found = true;
      break;
    }
  }

  if (!found) {
    // Add new profile
    sheet.appendRow([username, totalPosts, 0, 0, new Date().toISOString()]);
    updateProfileStatsForUser(ss, username);
  }

  return { success: true };
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Update profile statistics for a specific username
 * Called automatically after each download
 */
function updateProfileStatsForUser(ss, username) {
  if (!username) return;

  const downloadsSheet = getOrCreateDownloadsSheet(ss);
  const profilesSheet = getOrCreateProfilesSheet(ss);

  // Count downloads for this user — only read username column (E = index 5) to avoid size limits
  let downloadedCount = 0;
  const dlLastRow = downloadsSheet.getLastRow();
  if (dlLastRow > 1) {
    const usernames = downloadsSheet.getRange(2, 5, dlLastRow - 1, 1).getValues(); // column E = username
    usernames.forEach(row => {
      if (row[0] === username) downloadedCount++;
    });
  }

  // Find or create profile row
  const profilesData = profilesSheet.getDataRange().getValues();
  const profilesHeaders = profilesData[0];
  const profileUsernameCol = profilesHeaders.indexOf('username');
  const totalPostsCol = profilesHeaders.indexOf('total_posts');
  const downloadedCountCol = profilesHeaders.indexOf('downloaded_count');
  const completionPctCol = profilesHeaders.indexOf('completion_pct');
  const lastUpdatedCol = profilesHeaders.indexOf('last_updated');

  let profileRow = -1;
  let totalPosts = 0;

  for (let i = 1; i < profilesData.length; i++) {
    if (profilesData[i][profileUsernameCol] === username) {
      profileRow = i + 1;
      totalPosts = profilesData[i][totalPostsCol] || 0;
      break;
    }
  }

  if (profileRow === -1) {
    // Add new profile
    profilesSheet.appendRow([
      username,
      0,                              // total_posts (to be set manually)
      downloadedCount,
      0,                              // completion_pct
      new Date().toISOString()
    ]);
  } else {
    // Update existing profile
    profilesSheet.getRange(profileRow, downloadedCountCol + 1).setValue(downloadedCount);
    const completionPct = totalPosts > 0 ? Math.round((downloadedCount / totalPosts) * 100) : 0;
    profilesSheet.getRange(profileRow, completionPctCol + 1).setValue(completionPct);
    profilesSheet.getRange(profileRow, lastUpdatedCol + 1).setValue(new Date().toISOString());
  }
}

/**
 * Recalculate a profile row after total posts change
 */
function recalculateProfileRow(ss, sheet, row, totalPosts) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const downloadedCountCol = headers.indexOf('downloaded_count');
  const completionPctCol = headers.indexOf('completion_pct');
  const lastUpdatedCol = headers.indexOf('last_updated');

  const downloadedCount = sheet.getRange(row, downloadedCountCol + 1).getValue() || 0;
  const completionPct = totalPosts > 0 ? Math.round((downloadedCount / totalPosts) * 100) : 0;

  sheet.getRange(row, completionPctCol + 1).setValue(completionPct);
  sheet.getRange(row, lastUpdatedCol + 1).setValue(new Date().toISOString());
}

// ============================================================
// NAME MAPPING FUNCTIONS
// ============================================================

/**
 * Get or create the Names sheet
 */
function getOrCreateNamesSheet(ss) {
  let sheet = ss.getSheetByName(NAMES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(NAMES_SHEET);
    sheet.appendRow(['real_name', 'username']);
    // Format header row
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  }
  return sheet;
}

/**
 * Get all name mappings from the Names sheet
 */
function getAllNames(ss) {
  const sheet = getOrCreateNamesSheet(ss);
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    return { names: [], count: 0 };
  }

  const headers = data[0];
  const realNameCol = headers.indexOf('real_name');
  const usernameCol = headers.indexOf('username');

  const names = data.slice(1).map(row => ({
    realName: row[realNameCol] || '',
    username: (row[usernameCol] || '').toLowerCase().trim()
  })).filter(n => n.username); // Filter out empty rows

  return {
    names,
    count: names.length,
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Add a new name mapping
 */
function addNameMapping(ss, username, realName) {
  if (!username || !realName) {
    return { success: false, error: 'Username and real name are required' };
  }

  const sheet = getOrCreateNamesSheet(ss);
  const normalizedUsername = username.toLowerCase().trim();

  // Check for duplicate
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const usernameCol = headers.indexOf('username');

  for (let i = 1; i < data.length; i++) {
    if ((data[i][usernameCol] || '').toLowerCase().trim() === normalizedUsername) {
      return { success: false, duplicate: true, error: 'Username already has a name mapping' };
    }
  }

  // Append new row
  sheet.appendRow([realName.trim(), normalizedUsername]);

  return {
    success: true,
    added: true,
    username: normalizedUsername,
    realName: realName.trim()
  };
}

/**
 * Update an existing name mapping
 */
function updateNameMapping(ss, username, realName) {
  if (!username || !realName) {
    return { success: false, error: 'Username and real name are required' };
  }

  const sheet = getOrCreateNamesSheet(ss);
  const normalizedUsername = username.toLowerCase().trim();

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const realNameCol = headers.indexOf('real_name');
  const usernameCol = headers.indexOf('username');

  for (let i = 1; i < data.length; i++) {
    if ((data[i][usernameCol] || '').toLowerCase().trim() === normalizedUsername) {
      // Update existing row
      sheet.getRange(i + 1, realNameCol + 1).setValue(realName.trim());
      return {
        success: true,
        updated: true,
        username: normalizedUsername,
        realName: realName.trim()
      };
    }
  }

  // Not found, add new
  sheet.appendRow([realName.trim(), normalizedUsername]);
  return {
    success: true,
    added: true,
    username: normalizedUsername,
    realName: realName.trim()
  };
}

// ============================================================
// ONE-TIME MIGRATION (run manually from Apps Script editor)
// ============================================================

/**
 * Repairs the Downloads sheet by:
 * 1. Detecting and fixing rows with an extra empty column B (from column-insert migration)
 * 2. Removing duplicate rows (keeps first occurrence by shortcode)
 * 3. Ensuring correct headers
 *
 * Run ONCE from the Apps Script editor: Run > repairDownloadsData
 */
function repairDownloadsData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(DOWNLOADS_SHEET);
  if (!sheet) {
    Logger.log('No Downloads sheet found');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log('No data rows to repair');
    return;
  }

  // Read and process in chunks to avoid exceeding Apps Script size limits
  // (large captions across thousands of rows can blow the limit)
  const READ_BATCH = 300;
  const readCols = DOWNLOADS_HEADERS.length + 1; // 13 cols: 12 expected + 1 for shifted data

  let fixedRows = 0;
  let duplicatesRemoved = 0;
  const seen = new Set();
  const cleanedRows = [];

  for (let startRow = 2; startRow <= lastRow; startRow += READ_BATCH) {
    const numRows = Math.min(READ_BATCH, lastRow - startRow + 1);
    const chunk = sheet.getRange(startRow, 1, numRows, readCols).getValues();

    for (let i = 0; i < chunk.length; i++) {
      const row = chunk[i];

      // Skip completely empty rows
      if (row.every(cell => String(cell || '').trim() === '')) continue;

      // Detect old-format rows: empty column B with shortcode-like value in column C
      let fixedRow;
      const colB = String(row[1] || '').trim();
      const colC = String(row[2] || '').trim();

      if (colB === '' && colC !== '' && !colC.startsWith('http')) {
        fixedRow = [row[0], ...row.slice(2)];
        fixedRows++;
      } else {
        fixedRow = row.slice();
      }

      // Pad/trim to 12 columns
      while (fixedRow.length < DOWNLOADS_HEADERS.length) fixedRow.push('');
      fixedRow = fixedRow.slice(0, DOWNLOADS_HEADERS.length);

      // Deduplicate by shortcode (index 1 after fix)
      const shortcode = String(fixedRow[1] || '').trim();
      if (shortcode && seen.has(shortcode)) {
        duplicatesRemoved++;
        continue;
      }
      if (shortcode) seen.add(shortcode);

      cleanedRows.push(fixedRow);
    }

    Logger.log('Processed rows ' + startRow + ' to ' + (startRow + numRows - 1));
  }

  // Clear only the columns we manage — preserve user columns to the right
  // Clear in chunks too
  for (let startRow = 1; startRow <= lastRow; startRow += READ_BATCH) {
    const numRows = Math.min(READ_BATCH, lastRow - startRow + 1);
    sheet.getRange(startRow, 1, numRows, readCols).clearContent();
  }

  // Write correct headers
  sheet.getRange(1, 1, 1, DOWNLOADS_HEADERS.length).setValues([DOWNLOADS_HEADERS]);
  sheet.getRange(1, 1, 1, DOWNLOADS_HEADERS.length).setFontWeight('bold');

  // Write cleaned data in batches
  const WRITE_BATCH = 300;
  for (let i = 0; i < cleanedRows.length; i += WRITE_BATCH) {
    const batch = cleanedRows.slice(i, i + WRITE_BATCH);
    sheet.getRange(i + 2, 1, batch.length, DOWNLOADS_HEADERS.length).setValues(batch);
  }

  const msg = `Repair complete. Fixed ${fixedRows} shifted rows, removed ${duplicatesRemoved} duplicates. ${cleanedRows.length} rows remaining.`;
  Logger.log(msg);
  return msg;
}

// ============================================================
// TEST FUNCTIONS (for debugging in Apps Script editor)
// ============================================================

/**
 * Test the getAllDownloads function
 */
function testGetAll() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const result = getAllDownloads(ss);
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * Test the getProfiles function
 */
function testGetProfiles() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const result = getProfileStats(ss);
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * Test adding a download
 */
function testAddDownload() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const result = addDownload(ss, {
    shortcode: 'TEST123456',
    real_name: 'Test User',
    username: 'testuser',
    post_type: 'POST',
    media_count: 1,
    comment_count: 5,
    caption: 'Test post caption',
    downloader: 'TestUser',
    post_date: new Date().toISOString()
  });
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * Test getting all name mappings
 */
function testGetNames() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const result = getAllNames(ss);
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * Test adding a name mapping
 */
function testAddName() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const result = addNameMapping(ss, 'testuser', 'Test User Name');
  Logger.log(JSON.stringify(result, null, 2));
}
