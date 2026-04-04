/**
 * Google Apps Script - Instagram Download Tracker
 * ================================================
 *
 * SETUP INSTRUCTIONS:
 *
 * 1. Open your Google Sheet
 * 2. Go to Extensions > Apps Script (sheet is auto-detected, no ID needed)
 * 3. Delete any existing code and paste this entire file
 * 4. Click Deploy > New Deployment
 * 6. Select type: Web app
 * 7. Set Execute as: Me
 * 8. Set Who has access: Anyone
 * 9. Click Deploy and copy the Web App URL (must end in /exec)
 * 10. Paste that URL into the extension's Team Sync settings
 */

// ============================================================
// CONFIGURATION
// ============================================================
// Set this to your Google Sheet ID (the long string between /d/ and /edit in the sheet URL)
const SPREADSHEET_ID = '1xRFBUr5GIJ_lUyh4hX5XaouZuoFfzRWV2hASssStz9Y';
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
    const lastCol = sheet.getLastColumn();
    if (lastCol > 0) {
      const currentHeaders = sheet.getRange(1, 1, 1, Math.min(lastCol, DOWNLOADS_HEADERS.length)).getValues()[0];
      if (!headersMatch(currentHeaders, DOWNLOADS_HEADERS)) {
        sheet.getRange(1, 1, 1, DOWNLOADS_HEADERS.length).setValues([DOWNLOADS_HEADERS]);
        sheet.getRange(1, 1, 1, DOWNLOADS_HEADERS.length).setFontWeight('bold');
      }
    } else {
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
      const currentHeaders = sheet.getRange(1, 1, 1, Math.min(lastCol, PROFILES_HEADERS.length)).getValues()[0];
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

/**
 * Read a single column in chunks to avoid size limits on large sheets (13,000+ rows).
 * Returns a flat array of values.
 */
function readColumnChunked(sheet, col, startRow, lastRow) {
  const CHUNK = 2000;
  const values = [];
  for (let start = startRow; start <= lastRow; start += CHUNK) {
    const numRows = Math.min(CHUNK, lastRow - start + 1);
    const chunk = sheet.getRange(start, col, numRows, 1).getValues();
    for (let i = 0; i < chunk.length; i++) {
      values.push(chunk[i][0]);
    }
  }
  return values;
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

  // Sheet has 13,000+ rows — read cols B-J in one call per chunk (1 call vs 3)
  // B=shortcode(idx 0), E=username(idx 3), J=downloader(idx 8) within B:J range
  const CHUNK = 5000;
  const downloads = [];

  for (let start = 2; start <= lastRow; start += CHUNK) {
    const numRows = Math.min(CHUNK, lastRow - start + 1);
    const chunk = sheet.getRange(start, 2, numRows, 9).getValues(); // cols B through J
    for (let i = 0; i < numRows; i++) {
      const sc = chunk[i][0]; // B = index 0
      if (!sc) continue;
      downloads.push({
        shortcode: sc,
        username: chunk[i][3] || '',   // E = index 3
        downloader: chunk[i][8] || ''  // J = index 8
      });
    }
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

  // Use TextFinder for each shortcode — fast lookup without loading all data
  const results = {};
  const range = sheet.getRange('B:B');
  shortcodes.forEach(sc => {
    const finder = range.createTextFinder(sc).matchEntireCell(true);
    results[sc] = !!finder.findNext();
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

  // Check for duplicate using TextFinder — instant search, no data loading
  if (data.shortcode) {
    const finder = sheet.getRange('B:B').createTextFinder(data.shortcode).matchEntireCell(true);
    if (finder.findNext()) {
      return { success: true, duplicate: true, message: 'Already tracked' };
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

  // Build existing shortcodes set using TextFinder for each incoming shortcode
  // For batch, we still need the full set — read column B in one range per chunk
  const existingShortcodes = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const CHUNK = 5000;
    for (let start = 2; start <= lastRow; start += CHUNK) {
      const numRows = Math.min(CHUNK, lastRow - start + 1);
      const chunk = sheet.getRange(start, 2, numRows, 1).getValues();
      chunk.forEach(row => existingShortcodes.add(row[0]));
    }
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

  // Count downloads for this user using TextFinder — no data loading needed
  const downloadedCount = downloadsSheet.getRange('E:E')
    .createTextFinder(username).matchEntireCell(true).findAll().length;

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
// TEST FUNCTIONS (for debugging in Apps Script editor)
// ============================================================

// NOTE: compactSheet and repairDownloadsData removed —
// use the backup sheet directly instead of repairing damaged sheets.

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
