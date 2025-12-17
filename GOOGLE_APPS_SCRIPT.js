/**
 * Google Apps Script - Instagram Download Tracker
 * ================================================
 *
 * SETUP INSTRUCTIONS:
 *
 * 1. Create a new Google Sheet
 * 2. Add three sheets (tabs):
 *    - "Downloads" with headers: timestamp, shortcode, url, username, post_type, media_count, comment_count, caption, downloader, post_date
 *    - "Profiles" with headers: username, total_posts, downloaded_count, completion_pct, last_updated
 *    - "Names" with headers: real_name, username (maps Instagram usernames to real names for file naming)
 * 3. Go to Extensions > Apps Script
 * 4. Delete any existing code and paste this entire file
 * 5. Update SPREADSHEET_ID below with your Google Sheet ID (from the URL)
 * 6. Click Deploy > New Deployment
 * 7. Select type: Web app
 * 8. Set Execute as: Me
 * 9. Set Who has access: Anyone
 * 10. Click Deploy and copy the Web App URL
 * 11. Paste that URL into the extension's Team Sync settings
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
  const sheet = ss.getSheetByName(DOWNLOADS_SHEET);
  if (!sheet) {
    return { downloads: [], count: 0, error: 'Downloads sheet not found' };
  }

  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    return { downloads: [], count: 0 };
  }

  const headers = data[0];
  const downloads = data.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i];
    });
    return obj;
  });

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
  const sheet = ss.getSheetByName(PROFILES_SHEET);
  if (!sheet) {
    return { profiles: [], error: 'Profiles sheet not found' };
  }

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
  const sheet = ss.getSheetByName(DOWNLOADS_SHEET);
  if (!sheet) {
    return { results: {}, error: 'Downloads sheet not found' };
  }

  const data = sheet.getDataRange().getValues();

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
  const sheet = ss.getSheetByName(DOWNLOADS_SHEET);
  if (!sheet) {
    return { success: false, error: 'Downloads sheet not found' };
  }

  // Check for duplicate
  const existingData = sheet.getDataRange().getValues();
  const headers = existingData[0];
  const shortcodeCol = headers.indexOf('shortcode');

  if (shortcodeCol >= 0) {
    for (let i = 1; i < existingData.length; i++) {
      if (existingData[i][shortcodeCol] === data.shortcode) {
        return { success: true, duplicate: true, message: 'Already tracked' };
      }
    }
  }

  // Append new row
  const row = [
    new Date().toISOString(),                           // timestamp
    data.shortcode || '',                               // shortcode
    data.url || `https://www.instagram.com/p/${data.shortcode}/`,  // url
    data.username || '',                                // username
    data.post_type || 'POST',                           // post_type
    data.media_count || 0,                              // media_count
    data.comment_count || 0,                            // comment_count
    data.caption || '',                                 // caption (full)
    data.downloader || '',                              // downloader
    data.post_date || ''                                // post_date
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
  const sheet = ss.getSheetByName(DOWNLOADS_SHEET);
  if (!sheet) {
    return { success: false, error: 'Downloads sheet not found' };
  }

  let added = 0;
  let duplicates = 0;

  // Get existing shortcodes
  const existingData = sheet.getDataRange().getValues();
  const headers = existingData[0];
  const shortcodeCol = headers.indexOf('shortcode');
  const existingShortcodes = new Set();

  if (shortcodeCol >= 0) {
    existingData.slice(1).forEach(row => {
      existingShortcodes.add(row[shortcodeCol]);
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
      data.username || '',
      data.post_type || 'POST',
      data.media_count || 0,
      data.comment_count || 0,
      data.caption || '',                                            // caption (full)
      data.downloader || '',
      data.post_date || ''
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
  const sheet = ss.getSheetByName(PROFILES_SHEET);
  if (!sheet) {
    return { success: false, error: 'Profiles sheet not found' };
  }

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

  const downloadsSheet = ss.getSheetByName(DOWNLOADS_SHEET);
  const profilesSheet = ss.getSheetByName(PROFILES_SHEET);

  if (!downloadsSheet || !profilesSheet) return;

  // Count downloads for this user
  const downloadsData = downloadsSheet.getDataRange().getValues();
  const downloadsHeaders = downloadsData[0];
  const usernameCol = downloadsHeaders.indexOf('username');

  let downloadedCount = 0;
  if (usernameCol >= 0) {
    downloadsData.slice(1).forEach(row => {
      if (row[usernameCol] === username) {
        downloadedCount++;
      }
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
