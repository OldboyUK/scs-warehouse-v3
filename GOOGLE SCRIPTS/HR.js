/** SCS HR - Overtime & Deductions web app (separate deployment from Warehouse). */
/** Deploy HR.js as its own Apps Script web app. Set HR_SCRIPT_URL in Netlify. */

const API_TOKEN = 'J4PAN88';
const SSID_HR = '1cA-BHIu3cOora4XfDZuRlwXyRc-x7troiI7arnmM04Q';
const SHEET_OVERTIME = 'Overtime & Deductions';
const SHEET_HOURLY = 'Hourly';

/**
 * Web app entry point for HR submissions (called via Netlify Functions).
 */
function doPost(e) {
  try {
    var p = (e && e.parameter) ? e.parameter : {};
    var token = String(p.token || '').trim();

    if (token !== API_TOKEN) {
      return json({ result: 'error', message: 'Unauthorized' });
    }

    var action = String(p.action || '').trim().toLowerCase();
    if (action === 'overtime_submit') return handleOvertimeSubmit(p);
    if (action === 'hourly_submit') return handleHourlySubmit(p);

    return json({ result: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return json({ result: 'error', message: String(err) });
  }
}

/**
 * Appends an overtime row to the Overtime & Deductions sheet.
 * Columns: A Username, B Date worked, C Hours, D Comments,
 * E Date recorded, F Browser/device model, G OS, H Browser, I Device type.
 */
function handleOvertimeSubmit(p) {
  var username = String(p.username || '').trim();
  var dateWorked = String(p.dateWorked || '').trim();
  var hoursWorked = String(p.hoursWorked || '').trim();
  var comments = String(p.comments || '').trim();
  var browserModel = String(p.browserModel || '').trim();
  var os = String(p.os || '').trim();
  var browser = String(p.browser || '').trim();
  var deviceType = String(p.deviceType || '').trim();

  if (!username) {
    return json({ result: 'error', message: 'Missing username' });
  }
  if (!dateWorked) {
    return json({ result: 'error', message: 'Missing date worked' });
  }
  if (!hoursWorked) {
    return json({ result: 'error', message: 'Missing hours worked' });
  }

  var ss = SpreadsheetApp.openById(SSID_HR);
  var sheet = ss.getSheetByName(SHEET_OVERTIME);
  if (!sheet) {
    return json({ result: 'error', message: 'Sheet not found: ' + SHEET_OVERTIME });
  }

  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var dateRecorded = Utilities.formatDate(now, tz, 'dd/MM/yyyy HH:mm:ss');

  var nextRow = findFirstBlankRowInColumnA(sheet, 2);
  if (!nextRow) {
    return json({ result: 'error', message: 'No available row in sheet' });
  }

  sheet.getRange(nextRow, 1, 1, 9).setValues([[
    username,
    dateWorked,
    hoursWorked,
    comments,
    dateRecorded,
    browserModel,
    os,
    browser,
    deviceType
  ]]);

  return json({ result: 'success' });
}

/**
 * Appends an hourly record to the Hourly sheet.
 * Columns: A Username, B Date worked, C Start Time, D Break (minutes),
 * E Finish Time, F Total Hours, G Comments, H Date recorded,
 * I Browser/device model, J OS, K Browser, L Device type.
 */
function handleHourlySubmit(p) {
  var username = String(p.username || '').trim();
  var dateWorked = String(p.dateWorked || '').trim();
  var startTime = String(p.startTime || '').trim();
  var breakMinutes = String(p.breakMinutes || '').trim();
  var finishTime = String(p.finishTime || '').trim();
  var totalHours = String(p.totalHours || '').trim();
  var comments = String(p.comments || '').trim();
  var browserModel = String(p.browserModel || '').trim();
  var os = String(p.os || '').trim();
  var browser = String(p.browser || '').trim();
  var deviceType = String(p.deviceType || '').trim();

  if (!username) {
    return json({ result: 'error', message: 'Missing username' });
  }
  if (!dateWorked) {
    return json({ result: 'error', message: 'Missing date worked' });
  }
  if (!startTime) {
    return json({ result: 'error', message: 'Missing start time' });
  }
  if (!finishTime) {
    return json({ result: 'error', message: 'Missing finish time' });
  }
  if (breakMinutes === '') {
    return json({ result: 'error', message: 'Missing break value' });
  }
  if (!totalHours) {
    return json({ result: 'error', message: 'Missing total hours' });
  }

  var ss = SpreadsheetApp.openById(SSID_HR);
  var sheet = ss.getSheetByName(SHEET_HOURLY);
  if (!sheet) {
    return json({ result: 'error', message: 'Sheet not found: ' + SHEET_HOURLY });
  }

  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var dateRecorded = Utilities.formatDate(now, tz, 'dd/MM/yyyy');

  var nextRow = findFirstBlankRowInColumnA(sheet, 2);
  if (!nextRow) {
    return json({ result: 'error', message: 'No available row in sheet' });
  }

  sheet.getRange(nextRow, 1, 1, 12).setValues([[
    username,
    dateWorked,
    startTime,
    Number(breakMinutes),
    finishTime,
    totalHours,
    comments,
    dateRecorded,
    browserModel,
    os,
    browser,
    deviceType
  ]]);

  return json({ result: 'success' });
}

function findFirstBlankRowInColumnA(sheet, startRow) {
  startRow = startRow || 2;
  var maxRows = sheet.getMaxRows();
  var numRows = maxRows - startRow + 1;
  if (numRows <= 0) return null;

  var displayValues = sheet.getRange(startRow, 1, numRows, 1).getDisplayValues();
  for (var i = 0; i < displayValues.length; i++) {
    if (String(displayValues[i][0] || '').trim() === '') {
      return startRow + i;
    }
  }
  return null;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
