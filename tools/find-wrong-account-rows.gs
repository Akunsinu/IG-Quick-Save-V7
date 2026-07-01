/**
 * find-wrong-account-rows.gs
 * ---------------------------------------------------------------------------
 * Spot-check helper for the V8.3.7 "wrong account" attribution bug.
 *
 * Symptom: a batch row's real_name/username/posted-time were copied wholesale
 * from an ADJACENT post in the same batch (stale post cache), but the row's
 * shortcode/url is correct. Two genuinely distinct Instagram posts virtually
 * never share the same posted-time to the second, so a posted-time value that
 * appears on more than one row (with different shortcodes) is a near-certain
 * stale clone.
 *
 * This scans ONLY the shortcode + posted-time columns (bounded by the last data
 * row) so it does NOT trip the getAllDownloads "data exceeds maximum size"
 * problem. It writes a small report to a "Wrong Account Audit" tab.
 *
 * SETUP: adjust the three CONFIG constants to match your Post Downloads Tracker,
 * then run auditWrongAccountRows() from the Apps Script editor.
 * ---------------------------------------------------------------------------
 */

var AUDIT_CONFIG = {
  SHEET_NAME: 'Post Downloads Tracker', // tab that holds the download rows
  SHORTCODE_COL: 2,                     // column B = shortcode
  POSTED_TIME_COL: 6,                   // column F = posted-time (the X:XX:XX.000Z column)
  HEADER_ROWS: 1                        // number of header rows to skip
};

function auditWrongAccountRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(AUDIT_CONFIG.SHEET_NAME);
  if (!sheet) {
    throw new Error('Sheet not found: ' + AUDIT_CONFIG.SHEET_NAME);
  }

  var lastRow = sheet.getLastRow();
  var firstRow = AUDIT_CONFIG.HEADER_ROWS + 1;
  if (lastRow < firstRow) {
    Logger.log('No data rows to scan.');
    return;
  }
  var n = lastRow - firstRow + 1;

  // Read ONLY the two columns we need — never the whole sheet (size-limit safe).
  var shortcodes = sheet.getRange(firstRow, AUDIT_CONFIG.SHORTCODE_COL, n, 1).getValues();
  // Read display strings so time-only formatting is compared consistently.
  var postedTimes = sheet.getRange(firstRow, AUDIT_CONFIG.POSTED_TIME_COL, n, 1).getDisplayValues();

  // Group rows by posted-time value.
  var byTime = {}; // timeValue -> [{row, shortcode}]
  for (var i = 0; i < n; i++) {
    var t = String(postedTimes[i][0]).trim();
    var sc = String(shortcodes[i][0]).trim();
    if (!t || !sc) continue; // blank posted-time or shortcode -> skip
    if (!byTime[t]) byTime[t] = [];
    byTime[t].push({ row: firstRow + i, shortcode: sc });
  }

  // A collision = same posted-time on 2+ rows with DIFFERENT shortcodes.
  var report = [['posted_time', 'row', 'shortcode', 'note']];
  var flagged = 0;
  Object.keys(byTime).forEach(function (t) {
    var group = byTime[t];
    var distinctCodes = {};
    group.forEach(function (g) { distinctCodes[g.shortcode] = true; });
    if (Object.keys(distinctCodes).length < 2) return; // same shortcode dup = not this bug
    group.forEach(function (g, idx) {
      report.push([
        t,
        g.row,
        g.shortcode,
        idx === 0 ? 'likely the ORIGINAL (verify owner)' : 'likely STALE CLONE — verify & correct'
      ]);
      flagged++;
    });
  });

  // Write results to a dedicated audit tab.
  var out = ss.getSheetByName('Wrong Account Audit') || ss.insertSheet('Wrong Account Audit');
  out.clearContents();
  out.getRange(1, 1, report.length, report[0].length).setValues(report);
  out.getRange(1, 1, 1, report[0].length).setFontWeight('bold');
  out.autoResizeColumns(1, report[0].length);

  Logger.log('Audit complete. Scanned ' + n + ' rows, flagged ' + flagged +
    ' rows across posted-time collisions. See "Wrong Account Audit" tab.');
}
