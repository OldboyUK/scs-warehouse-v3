/** SCS AUTH - Web app, bcrypt PIN verification, and hash generation for the SCS AUTH sheet. */
/** Deploy Auth.js + bcrypt.js as a separate Apps Script web app. Set AUTH_SCRIPT_URL in Netlify. */

const API_TOKEN = 'J4PAN88';
const SSID_AUTH = '1nB5_vSJUes7myggQLUBnBWpARbR31-5EMhdOY69MjfQ';const SHEET_SCS_AUTH = 'SCS AUTH';
const COL_USER_NAME = 3; // C
const COL_PIN_HASH = 4; // D
const COL_PIN = 6;      // F
const BCRYPT_ROUNDS = 12;

/**
 * Web app entry point for login and user list (called via Netlify Functions).
 */
function doPost(e) {
  try {
    var p = (e && e.parameter) ? e.parameter : {};
    var token = String(p.token || '').trim();

    if (token !== API_TOKEN) {
      return json({ result: 'error', message: 'Unauthorized' });
    }

    var action = String(p.action || '').trim().toLowerCase();
    if (action === 'auth_login') return handleAuthLogin(p);
    if (action === 'auth_get_users') return handleAuthGetUsers();

    return json({ result: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return json({ result: 'error', message: String(err) });
  }
}

/**
 * Adds the Authentication menu when the spreadsheet is opened.
 */function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Authentication')
    .addItem('Generate PIN Hashes', 'generatePinHashes')
    .addToUi();
}

/**
 * Reads plaintext PINs from column F, hashes them with bcrypt (cost 12),
 * and writes the hashes to column D. Skips blank PINs and rows that already
 * have a hash. Does not modify column F.
 */
function generatePinHashes() {
  ensureBcryptReady_();

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SCS_AUTH);
  if (!sheet) {
    SpreadsheetApp.getUi().alert(
      'Generate PIN Hashes',
      'Sheet not found: ' + SHEET_SCS_AUTH,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert(
      'Generate PIN Hashes',
      'Processed: 0\nSkipped: 0\nErrors: 0',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return;
  }

  var numRows = lastRow - 1;
  var pinValues = sheet.getRange(2, COL_PIN, numRows, 1).getDisplayValues();
  var hashValues = sheet.getRange(2, COL_PIN_HASH, numRows, 1).getDisplayValues();

  var processed = 0;
  var skipped = 0;
  var errors = 0;
  var errorMessages = [];

  for (var i = 0; i < numRows; i++) {
    var rowNum = i + 2;
    var pin = String(pinValues[i][0] || '').trim();
    var existingHash = String(hashValues[i][0] || '').trim();

    if (!pin) {
      skipped++;
      continue;
    }

    if (existingHash) {
      skipped++;
      continue;
    }

    try {
      var hash = Bcrypt.hashSync(pin, BCRYPT_ROUNDS);
      sheet.getRange(rowNum, COL_PIN_HASH).setValue(hash);
      processed++;
    } catch (err) {
      errors++;
      errorMessages.push('Row ' + rowNum + ': ' + err.message);
    }
  }

  var summary = 'Processed: ' + processed + '\nSkipped: ' + skipped + '\nErrors: ' + errors;
  if (errorMessages.length) {
    summary += '\n\n' + errorMessages.join('\n');
  }

  SpreadsheetApp.getUi().alert('Generate PIN Hashes', summary, SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Ensures the bcrypt library is loaded and the random fallback is configured.
 * @private
 */
function ensureBcryptReady_() {
  if (typeof Bcrypt === 'undefined' || !Bcrypt || typeof Bcrypt.hashSync !== 'function') {
    throw new Error('Bcrypt library not loaded. Add bcrypt.js to this Apps Script project.');
  }
  Bcrypt.setRandomFallback(secureRandomBytesForBcrypt);
}

/**
 * Returns usernames from column C (no PIN hashes).
 */
function handleAuthGetUsers() {
  var sheet = getAuthSheet_();
  if (!sheet) {
    return json({ result: 'error', users: [] });
  }

  var users = readAuthUsernames_(sheet);
  return json({ result: 'success', users: users });
}

/**
 * Validates username + PIN against the stored bcrypt hash in column D.
 * Returns only success or failure — never the hash.
 */
function handleAuthLogin(p) {
  ensureBcryptReady_();

  var username = String(p.username || '').trim();
  var pin = String(p.pin || '').trim();

  if (!username || !pin) {
    return json({ result: 'failure' });
  }

  var sheet = getAuthSheet_();
  if (!sheet) {
    return json({ result: 'failure' });
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return json({ result: 'failure' });
  }

  var userValues = sheet.getRange('C2:C' + lastRow).getDisplayValues();
  var hashValues = sheet.getRange('D2:D' + lastRow).getDisplayValues();
  var numRows = userValues.length;

  for (var i = 0; i < numRows; i++) {
    var name = String(userValues[i][0] || '').trim();
    if (name.toLowerCase() !== username.toLowerCase()) {
      continue;
    }

    var hash = String(hashValues[i][0] || '').trim();
    if (!hash) {
      return json({ result: 'failure' });
    }

    try {
      var match = Bcrypt.compareSync(pin, hash);
      return json({ result: match ? 'success' : 'failure' });
    } catch (err) {
      return json({ result: 'failure' });
    }
  }

  return json({ result: 'failure' });
}

/** @private */
function getAuthSheet_() {
  var ss = SpreadsheetApp.openById(SSID_AUTH);
  var sheet = ss.getSheetByName(SHEET_SCS_AUTH);
  if (!sheet) {
    sheet = ss.getSheetByName('SCS Auth');
  }
  return sheet;
}

/** @private */
function readAuthUsernames_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  var userValues = sheet.getRange('C2:C' + lastRow).getDisplayValues();
  var users = [];

  for (var i = 0; i < numRows; i++) {
    var name = String(userValues[i][0] || '').trim();
    if (name) {
      users.push(name);
    }
  }

  users.sort(function(a, b) {
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });

  return users;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}