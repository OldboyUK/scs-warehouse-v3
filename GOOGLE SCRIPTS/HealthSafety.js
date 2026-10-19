/**
 * SCS Health and Safety — Create Risk Assessment.
 *
 * Deploy this file as its own Apps Script web app (separate from Warehouse, Auth and HR).
 * Execute as: Me. Who has access: Anyone.
 * The deploying account must be able to edit spreadsheet
 * 1m736CzXXQaOSSz23NswiOdDQ5iX4Jpjm3ROkllomgtU
 * and must allow UrlFetchApp (scope https://www.googleapis.com/auth/script.external_request
 * plus https://www.googleapis.com/auth/spreadsheets).
 *
 * After deploying a new version, set the web app /exec URL in Netlify as HS_SCRIPT_URL.
 * Do not put that URL in the frontend.
 *
 * Writes one Hazards row and one Actions row per control measure.
 * Only the listed columns are written, one cell at a time.
 * Column A is formula-owned on both sheets and is never written.
 * Hazards gid 1159021811: B name, C activity code, D hazard code, F, G, H, I, J
 * Actions gid 1408515271: B activity code, C hazard code, D action code, F, G, H
 */

var API_TOKEN = 'J4PAN88';
var SSID_HS = '1m736CzXXQaOSSz23NswiOdDQ5iX4Jpjm3ROkllomgtU';
var SHEET_HAZARDS = 'Hazards';
var GID_HAZARDS = 1159021811;
var SHEET_ACTIONS = 'Actions';
var GID_ACTIONS = 1408515271;
var ACTIVITIES_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRw_L0N6VopQF5xsJ_S2ykuzmdKWF20x93z3wKmbFBn5_1sG-Hj5FwQf54QmtMaEjjSE7rxSoSXLJ0Q/pub?gid=369796982&single=true&output=csv';

var RISK_OWNERS = [
  'Quality Manager',
  'Warehouse Manager',
  'CEO',
  'Engineer',
  'CEO & Warehouse Manager',
  'Quality Manager & Warehouse Manager',
  'Other',
  'N/A'
];

var HAZARD_WRITE_COLUMNS = [2, 3, 4, 6, 7, 8, 9, 10];
var ACTION_WRITE_COLUMNS = [2, 3, 4, 6, 7, 8];
var MAX_TEXT = 8000;
var MAX_ACTIONS = 50;
var SUBMISSION_INDEX_KEY = 'HS_RISK_SUBMISSION_INDEX';

function doPost(e) {
  try {
    var p = readPostParams_(e);
    var token = String(p.token || '').trim();
    if (token !== API_TOKEN) {
      return json({ result: 'error', retryable: false, message: 'Unauthorized' });
    }

    var action = String(p.action || '').trim().toLowerCase();
    if (action === 'risk_assessment_submit') return handleRiskAssessmentSubmit_(p);
    return json({ result: 'error', retryable: false, message: 'Unknown action: ' + action });
  } catch (err) {
    return json({ result: 'error', retryable: true, message: publicMessage_(err) });
  }
}

function handleRiskAssessmentSubmit_(p) {
  var activities;
  try {
    activities = loadActivities_();
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'Activities could not be loaded, so the assessment was not saved. ' + publicMessage_(err)
    });
  }

  var validated = validateSubmission_(p, activities);
  if (!validated.ok) {
    return json({ result: 'error', retryable: true, message: validated.message });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return json({
      result: 'error',
      retryable: true,
      message: 'Another risk assessment is being saved. Please wait a moment and try again.'
    });
  }

  try {
    return saveAssessment_(validated.value);
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The risk assessment was not saved. ' + publicMessage_(err)
    });
  } finally {
    lock.releaseLock();
  }
}

function saveAssessment_(value) {
  var fingerprint = fingerprint_(value);
  var existing = loadRecord_(value.submissionId);

  if (existing && existing.status === 'success') {
    if (existing.fingerprint !== fingerprint) {
      return json({
        result: 'error',
        retryable: false,
        partial: true,
        hazardId: existing.hazardId,
        actionIds: existing.actionIds || [],
        message: 'This submission was already saved as ' + existing.hazardId + '. It was not changed and was not saved again.'
      });
    }
    return json(existing.result);
  }

  if (existing && existing.status === 'partial') {
    return json(existing.result || {
      result: 'error',
      partial: true,
      retryable: false,
      hazardId: existing.hazardId,
      actionIds: existing.actionIds || [],
      message: 'This submission was not fully saved. Hazard ' + existing.hazardId + ' needs to be checked before anything else is written.'
    });
  }

  if (existing && existing.status === 'pending' && existing.fingerprint !== fingerprint) {
    return json({
      result: 'error',
      retryable: false,
      hazardId: existing.hazardId,
      message: 'This submission is already in progress with different details. Reload the page to start a new assessment. Nothing new was written.'
    });
  }

  if (!value.activityCode) {
    return json({
      result: 'error',
      retryable: false,
      message: 'The selected activity does not start with a 6-character activity code. Nothing was written.'
    });
  }

  var ss = SpreadsheetApp.openById(SSID_HS);
  var hazards = requireSheet_(ss, SHEET_HAZARDS, GID_HAZARDS);
  var actionsSheet = requireSheet_(ss, SHEET_ACTIONS, GID_ACTIONS);
  assertNoArrayFormula_(hazards, HAZARD_WRITE_COLUMNS, 'Hazards');
  assertNoArrayFormula_(actionsSheet, ACTION_WRITE_COLUMNS, 'Actions');

  var activityCode = value.activityCode;
  var hazardId;
  var actionIds;
  if (existing && existing.status === 'pending') {
    hazardId = existing.hazardId;
    actionIds = existing.actionIds || [];
    if (!hazardId || actionIds.length !== value.actions.length) {
      return json({
        result: 'error',
        partial: true,
        retryable: false,
        hazardId: hazardId || '',
        message: 'This submission was interrupted and cannot be continued safely. Hazard ' + (hazardId || '(unknown)') + ' needs to be checked. Nothing new was written.'
      });
    }
  } else {
    hazardId = nextHazardId_(activityCode, hazardIdentityIds_(hazards));
    actionIds = nextActionIds_(hazardId, value.actions.length, actionIdentityIds_(actionsSheet));
    saveRecord_(value.submissionId, {
      status: 'pending',
      fingerprint: fingerprint,
      hazardId: hazardId,
      actionIds: actionIds
    });
  }

  var hazardCode = hazardCodeFromId_(hazardId);
  var written = [];
  var hazardRow = 0;
  var actionRows = [];
  try {
    if (!hazardCode) throw new Error('Could not determine the hazard code.');
    hazardRow = findHazardRow_(hazards, hazardId, activityCode, hazardCode);
    if (!hazardRow) hazardRow = findSafeRows_(hazards, 1)[0];
    alignRow_(hazards, hazardRow, hazardCells_(activityCode, hazardCode, value), written);

    var missing = [];
    for (var j = 0; j < actionIds.length; j++) {
      var existingActionRow = findActionRow_(actionsSheet, actionIds[j], activityCode, hazardCode, actionCodeFromId_(actionIds[j]));
      if (existingActionRow) actionRows[j] = existingActionRow;
      else missing.push(j);
    }
    if (missing.length) {
      var freeRows = findSafeRows_(actionsSheet, missing.length);
      for (var m = 0; m < missing.length; m++) {
        var index = missing[m];
        actionRows[index] = freeRows[m];
        alignRow_(actionsSheet, freeRows[m], actionCells_(activityCode, hazardCode, actionCodeFromId_(actionIds[index]), value.actions[index]), written);
      }
    }

    SpreadsheetApp.flush();
    verifyRow_(hazards, hazardRow, hazardCells_(activityCode, hazardCode, value));
    for (var k = 0; k < actionIds.length; k++) {
      if (!actionRows[k]) throw new Error('Action ' + actionIds[k] + ' could not be confirmed.');
      verifyRow_(actionsSheet, actionRows[k], actionCells_(activityCode, hazardCode, actionCodeFromId_(actionIds[k]), value.actions[k]));
    }

    var success = {
      result: 'success',
      hazardId: hazardId,
      actionIds: actionIds
    };
    saveRecord_(value.submissionId, {
      status: 'success',
      fingerprint: fingerprint,
      hazardId: hazardId,
      actionIds: actionIds,
      result: success
    });
    return json(success);
  } catch (err) {
    var failedRollback = rollbackWritten_(written);
    if (err && err.conflict) {
      var conflictResult = {
        result: 'error',
        partial: true,
        retryable: false,
        hazardId: hazardId,
        actionIds: actionIds,
        message: 'The assessment was not saved. ' + publicMessage_(err) + ' Hazard ' + hazardId + ' was left unchanged where it already existed.'
      };
      saveRecord_(value.submissionId, {
        status: 'partial',
        fingerprint: fingerprint,
        hazardId: hazardId,
        actionIds: actionIds,
        result: conflictResult
      });
      return json(conflictResult);
    }

    if (failedRollback.length) {
      var partialResult = {
        result: 'error',
        partial: true,
        retryable: false,
        hazardId: hazardId,
        actionIds: actionIds,
        message: 'The assessment was not fully saved. Hazard ' + hazardId + ' needs to be checked on the Hazards and Actions sheets. Do not submit this same assessment again. ' + publicMessage_(err)
      };
      saveRecord_(value.submissionId, {
        status: 'partial',
        fingerprint: fingerprint,
        hazardId: hazardId,
        actionIds: actionIds,
        result: partialResult
      });
      return json(partialResult);
    }

    var stillThere = findHazardRow_(hazards, hazardId, activityCode, hazardCode) > 0;
    if (!stillThere) {
      for (var r = 0; r < actionIds.length; r++) {
        if (findActionRow_(actionsSheet, actionIds[r], activityCode, hazardCode, actionCodeFromId_(actionIds[r]))) stillThere = true;
      }
    }

    if (stillThere) {
      saveRecord_(value.submissionId, {
        status: 'pending',
        fingerprint: fingerprint,
        hazardId: hazardId,
        actionIds: actionIds
      });
      return json({
        result: 'error',
        retryable: true,
        hazardId: hazardId,
        actionIds: actionIds,
        message: 'The assessment was not fully saved. Hazard ' + hazardId + ' is already reserved. Submit again to finish the missing records. A duplicate hazard will not be created. ' + publicMessage_(err)
      });
    }

    deleteRecord_(value.submissionId);
    return json({
      result: 'error',
      retryable: true,
      message: 'The risk assessment was not saved. ' + publicMessage_(err)
    });
  }
}

function hazardCells_(activityCode, hazardCode, value) {
  return [
    { col: 2, value: value.hazardName, type: 'text' },
    { col: 3, value: activityCode, type: 'text' },
    { col: 4, value: hazardCode, type: 'text' },
    { col: 6, value: value.hazardDescription, type: 'text' },
    { col: 7, value: value.whoMightBeHarmed, type: 'text' },
    { col: 8, value: value.currentControls, type: 'text' },
    { col: 9, value: value.likelihood, type: 'number' },
    { col: 10, value: value.severity, type: 'number' }
  ];
}

function actionCells_(activityCode, hazardCode, actionCode, action) {
  return [
    { col: 2, value: activityCode, type: 'text' },
    { col: 3, value: hazardCode, type: 'text' },
    { col: 4, value: actionCode, type: 'text' },
    { col: 6, value: action.description, type: 'text' },
    { col: 7, value: action.owner, type: 'text' },
    { col: 8, value: action.dueDate, type: 'text' }
  ];
}

function alignRow_(sheet, row, cells, written) {
  if (row < 2) throw new Error('Refusing to write on the header row.');
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
    var range = sheet.getRange(row, cell.col);
    var formula = range.getFormula();
    var current = range.getValue();
    if (cellIsEmpty_(current, formula)) {
      writeCell_(sheet, row, cell.col, cell.value, cell.type, written);
      continue;
    }
    if (!valuesMatch_(current, formula, cell.value, cell.type)) {
      var err = new Error('Row ' + row + ' on ' + sheet.getName() + ' already has different data in column ' + columnLetter_(cell.col) + '. It was not overwritten.');
      err.conflict = true;
      throw err;
    }
  }
}

function verifyRow_(sheet, row, cells) {
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
    var range = sheet.getRange(row, cell.col);
    var formula = range.getFormula();
    var current = range.getValue();
    if (!valuesMatch_(current, formula, cell.value, cell.type)) {
      throw new Error('Saved cells on ' + sheet.getName() + ' row ' + row + ' could not be confirmed.');
    }
  }
}

function writeCell_(sheet, row, col, value, type, written) {
  if (col === 1) throw new Error('Refusing to write column A on ' + sheet.getName() + '.');
  if (row < 2) throw new Error('Refusing to write on the header row.');
  var range = sheet.getRange(row, col);
  var formula = range.getFormula();
  var current = range.getValue();
  if (!cellIsEmpty_(current, formula)) {
    throw new Error('Refusing to overwrite ' + sheet.getName() + ' row ' + row + ' column ' + columnLetter_(col) + '.');
  }
  var previousFormat = range.getNumberFormat();
  if (type === 'number') {
    range.setValue(Number(value));
  } else {
    range.setNumberFormat('@');
    range.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(String(value)).build());
  }
  written.push({ sheet: sheet, row: row, col: col, format: previousFormat });
}

function rollbackWritten_(entries) {
  var failed = [];
  for (var i = entries.length - 1; i >= 0; i--) {
    var entry = entries[i];
    try {
      var range = entry.sheet.getRange(entry.row, entry.col);
      range.clearContent();
      if (entry.format != null && entry.format !== '') {
        range.setNumberFormat(entry.format);
      }
      if (!cellIsEmpty_(range.getValue(), range.getFormula())) failed.push(entry);
    } catch (err) {
      failed.push(entry);
    }
  }
  return failed;
}

function valuesMatch_(current, formula, expected, type) {
  if (formula != null && String(formula).trim() !== '') return false;
  if (type === 'number') return Number(current) === Number(expected);
  return String(current) === String(expected);
}

function cellIsEmpty_(value, formula) {
  if (formula != null && String(formula).trim() !== '') return false;
  if (value == null) return true;
  if (Object.prototype.toString.call(value) === '[object Date]') return false;
  if (typeof value === 'number') return false;
  if (typeof value === 'boolean') return false;
  return String(value).trim() === '';
}

function findSafeRows_(sheet, count) {
  var found = [];
  var maxRows = sheet.getMaxRows();
  var displays = [];
  if (maxRows >= 2) {
    displays = sheet.getRange(2, 1, maxRows - 1, 1).getDisplayValues();
  }
  for (var i = 0; i < displays.length && found.length < count; i++) {
    if (String(displays[i][0] == null ? '' : displays[i][0]).trim() === '') found.push(i + 2);
  }
  var guard = 0;
  while (found.length < count) {
    guard++;
    if (guard > 10000) throw new Error('No safe row was available on ' + sheet.getName() + '. Nothing was overwritten.');
    var next = sheet.getMaxRows() + 1;
    sheet.insertRowsAfter(sheet.getMaxRows(), 1);
    if (next > sheet.getMaxRows()) {
      throw new Error('No safe row was available on ' + sheet.getName() + '. Nothing was overwritten.');
    }
    found.push(next);
  }
  return found;
}

function assertNoArrayFormula_(sheet, columns, label) {
  var lastRow = Math.max(sheet.getLastRow(), 1);
  for (var c = 0; c < columns.length; c++) {
    var formulas = sheet.getRange(1, columns[c], lastRow, 1).getFormulas();
    for (var r = 0; r < formulas.length; r++) {
      var formula = String(formulas[r][0] || '').toUpperCase().replace(/\s/g, '');
      if (formula.indexOf('ARRAYFORMULA(') !== -1) {
        throw new Error(label + ' column ' + columnLetter_(columns[c]) + ' contains an array formula. The assessment was not saved, so those formulas were not overwritten.');
      }
    }
  }
}

function readColumnDisplays_(sheet) {
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) return [];
  var values = sheet.getRange(2, 1, maxRows - 1, 1).getDisplayValues();
  var ids = [];
  for (var i = 0; i < values.length; i++) {
    var text = String(values[i][0] == null ? '' : values[i][0]).trim();
    if (text) ids.push(text);
  }
  return ids;
}

function hazardIdentityIds_(sheet) {
  var ids = readColumnDisplays_(sheet);
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) return ids;
  var num = maxRows - 1;
  var activityValues = sheet.getRange(2, 3, num, 1).getValues();
  var hazardValues = sheet.getRange(2, 4, num, 1).getValues();
  for (var i = 0; i < num; i++) {
    var activity = String(activityValues[i][0] == null ? '' : activityValues[i][0]).trim();
    var hazard = String(hazardValues[i][0] == null ? '' : hazardValues[i][0]).trim();
    if (/^[A-Za-z0-9]{6}$/.test(activity) && /^HZ\d+$/.test(hazard)) {
      ids.push(activity + '-' + hazard);
    }
  }
  return ids;
}

function actionIdentityIds_(sheet) {
  var ids = readColumnDisplays_(sheet);
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) return ids;
  var num = maxRows - 1;
  var activityValues = sheet.getRange(2, 2, num, 1).getValues();
  var hazardValues = sheet.getRange(2, 3, num, 1).getValues();
  var actionValues = sheet.getRange(2, 4, num, 1).getValues();
  for (var i = 0; i < num; i++) {
    var activity = String(activityValues[i][0] == null ? '' : activityValues[i][0]).trim();
    var hazard = String(hazardValues[i][0] == null ? '' : hazardValues[i][0]).trim();
    var action = String(actionValues[i][0] == null ? '' : actionValues[i][0]).trim();
    if (/^[A-Za-z0-9]{6}$/.test(activity) && /^HZ\d+$/.test(hazard) && /^AC\d+$/.test(action)) {
      ids.push(activity + '-' + hazard + '-' + action);
    }
  }
  return ids;
}

function findIdRow_(sheet, id) {
  var wanted = String(id || '').trim();
  if (!wanted) return 0;
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) return 0;
  var values = sheet.getRange(2, 1, maxRows - 1, 1).getDisplayValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] == null ? '' : values[i][0]).trim() === wanted) return i + 2;
  }
  return 0;
}

function findHazardRow_(sheet, fullId, activityCode, hazardCode) {
  var byDisplay = findIdRow_(sheet, fullId);
  if (byDisplay) return byDisplay;
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) return 0;
  var num = maxRows - 1;
  var displays = sheet.getRange(2, 1, num, 1).getDisplayValues();
  var activityValues = sheet.getRange(2, 3, num, 1).getValues();
  var hazardValues = sheet.getRange(2, 4, num, 1).getValues();
  for (var i = 0; i < num; i++) {
    var shown = String(displays[i][0] == null ? '' : displays[i][0]).trim();
    if (shown) continue;
    if (String(activityValues[i][0] == null ? '' : activityValues[i][0]).trim() === activityCode &&
        String(hazardValues[i][0] == null ? '' : hazardValues[i][0]).trim() === hazardCode) {
      return i + 2;
    }
  }
  return 0;
}

function findActionRow_(sheet, fullId, activityCode, hazardCode, actionCode) {
  var byDisplay = findIdRow_(sheet, fullId);
  if (byDisplay) return byDisplay;
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) return 0;
  var num = maxRows - 1;
  var displays = sheet.getRange(2, 1, num, 1).getDisplayValues();
  var activityValues = sheet.getRange(2, 2, num, 1).getValues();
  var hazardValues = sheet.getRange(2, 3, num, 1).getValues();
  var actionValues = sheet.getRange(2, 4, num, 1).getValues();
  for (var i = 0; i < num; i++) {
    var shown = String(displays[i][0] == null ? '' : displays[i][0]).trim();
    if (shown) continue;
    if (String(activityValues[i][0] == null ? '' : activityValues[i][0]).trim() === activityCode &&
        String(hazardValues[i][0] == null ? '' : hazardValues[i][0]).trim() === hazardCode &&
        String(actionValues[i][0] == null ? '' : actionValues[i][0]).trim() === actionCode) {
      return i + 2;
    }
  }
  return 0;
}

function hazardCodeFromId_(hazardId) {
  var match = String(hazardId || '').match(/-(HZ\d+)$/);
  return match ? match[1] : '';
}

function actionCodeFromId_(actionId) {
  var match = String(actionId || '').match(/-(AC\d+)$/);
  return match ? match[1] : '';
}

function nextHazardId_(activity, ids) {
  var re = new RegExp('^' + escapeRegExp_(activity) + '-HZ(\\d+)$');
  var max = 0;
  var existing = {};
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i] || '').trim();
    if (!id) continue;
    existing[id] = true;
    var match = id.match(re);
    if (!match) continue;
    var n = parseInt(match[1], 10);
    if (n > max) max = n;
  }

  var next = max + 1;
  var guard = 0;
  var candidate = formatHazardId_(activity, next);
  while (existing[candidate]) {
    next++;
    guard++;
    if (guard > 10000) throw new Error('Could not allocate a unique hazard ID.');
    candidate = formatHazardId_(activity, next);
  }
  return candidate;
}

function formatHazardId_(activity, n) {
  var suffix = n < 1000 ? pad3_(n) : String(n);
  return activity + '-HZ' + suffix;
}

function nextActionIds_(hazardId, count, existingIds) {
  var re = new RegExp('^' + escapeRegExp_(hazardId) + '-AC(\\d+)$');
  var max = 0;
  var existing = {};
  for (var i = 0; i < existingIds.length; i++) {
    var id = String(existingIds[i] || '').trim();
    if (!id) continue;
    existing[id] = true;
    var match = id.match(re);
    if (!match) continue;
    var n = parseInt(match[1], 10);
    if (n > max) max = n;
  }

  var ids = [];
  var next = max + 1;
  var guard = 0;
  while (ids.length < count) {
    var candidate = hazardId + '-AC' + String(next);
    if (!existing[candidate]) {
      ids.push(candidate);
      existing[candidate] = true;
    }
    next++;
    guard++;
    if (guard > 10000) throw new Error('Could not allocate unique action IDs.');
  }
  return ids;
}

function pad3_(n) {
  var text = String(n);
  while (text.length < 3) text = '0' + text;
  return text;
}

function escapeRegExp_(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function columnLetter_(col) {
  var letters = '';
  var n = col;
  while (n > 0) {
    var rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function requireSheet_(ss, name, gid) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Worksheet not found: ' + name + '.');
  if (Number(sheet.getSheetId()) !== Number(gid)) {
    throw new Error('Worksheet "' + name + '" is not the expected tab. No data was written.');
  }
  return sheet;
}

function loadActivities_() {
  var response = UrlFetchApp.fetch(ACTIVITIES_CSV_URL, { muteHttpExceptions: true });
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code !== 200 || !text || String(text).trim().charAt(0) === '<') {
    throw new Error('Activity list request failed (' + code + ').');
  }
  var activities = activitiesFromCsv_(text);
  if (!activities.length) throw new Error('The activity list was empty.');
  return activities;
}

function parseCsv_(text) {
  var input = String(text || '').replace(/^\uFEFF/, '');
  var rows = [];
  var row = [];
  var cur = '';
  var inQuotes = false;

  for (var i = 0; i < input.length; i++) {
    var ch = input.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (input.charAt(i + 1) === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (ch !== '\r') {
      cur += ch;
    }
  }

  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function activitiesFromCsv_(text) {
  var rows = parseCsv_(text);
  var list = [];
  var seen = {};
  for (var i = 1; i < rows.length; i++) {
    var value = String(rows[i] && rows[i][2] != null ? rows[i][2] : '').trim();
    if (!value || seen[value]) continue;
    seen[value] = true;
    list.push(value);
  }
  return list;
}

function activityCodeFromSelection_(activity) {
  var value = String(activity || '');
  if (value.length < 6) return '';
  var code = value.substring(0, 6);
  if (!/^[A-Za-z0-9]{6}$/.test(code)) return '';
  if (value.length > 6 && /[A-Za-z0-9]/.test(value.charAt(6))) return '';
  return code;
}

function parseScore_(value) {
  if (typeof value === 'number' && value >= 1 && value <= 5 && Math.floor(value) === value) return value;
  if (typeof value === 'string' && /^[1-5]$/.test(value.trim())) return parseInt(value.trim(), 10);
  return null;
}

function parseDueDate_(input) {
  var raw = String(input == null ? '' : input).trim();
  if (!raw) return null;
  var iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  var uk = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  var year;
  var month;
  var day;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (uk) {
    day = Number(uk[1]);
    month = Number(uk[2]);
    year = Number(uk[3]);
  } else {
    return null;
  }
  if (year < 1900 || year > 2200) return null;
  var dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() + 1 !== month || dt.getUTCDate() !== day) return null;
  return pad3_(day).slice(-2) + '/' + pad3_(month).slice(-2) + '/' + String(year);
}

function requireText_(value, label) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return { ok: false, message: label };
  if (text.length > MAX_TEXT) return { ok: false, message: label + ' is too long.' };
  return { ok: true, value: text };
}

function validateSubmission_(payload, activities) {
  var data = payload || {};
  var submissionId = String(data.submissionId || '').trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(submissionId)) {
    return { ok: false, message: 'The submission could not be identified. Reload the page and try again.' };
  }

  var activity = String(data.activity == null ? '' : data.activity).trim();
  if (!activity || !activities || activities.indexOf(activity) === -1) {
    return { ok: false, message: 'Select an activity from the list.' };
  }
  if (/[\u0000-\u001F]/.test(activity) || activity.length > 300) {
    return {
      ok: false,
      message: 'This activity cannot be used as a hazard ID prefix because it contains a line break or is too long. The activity name has not been changed.'
    };
  }
  var activityCode = activityCodeFromSelection_(activity);
  if (!activityCode) {
    return { ok: false, message: 'The selected activity does not start with a 6-character activity code.' };
  }

  var hazardName = requireText_(data.hazardName, 'Enter a name for the hazard.');
  if (!hazardName.ok) return hazardName;
  var hazardDescription = requireText_(data.hazardDescription, 'Enter a description of the hazard.');
  if (!hazardDescription.ok) return hazardDescription;
  var whoMightBeHarmed = requireText_(data.whoMightBeHarmed, 'Enter who might be harmed and how.');
  if (!whoMightBeHarmed.ok) return whoMightBeHarmed;
  var currentControls = requireText_(data.currentControls, 'Enter the current control measures.');
  if (!currentControls.ok) return currentControls;

  var likelihood = parseScore_(data.likelihood);
  if (likelihood == null) return { ok: false, message: 'Select a likelihood from 1 to 5.' };
  var severity = parseScore_(data.severity);
  if (severity == null) return { ok: false, message: 'Select a severity from 1 to 5.' };

  if (!Array.isArray(data.actions) || data.actions.length < 1) {
    return { ok: false, message: 'Add at least one control measure.' };
  }
  if (data.actions.length > MAX_ACTIONS) {
    return { ok: false, message: 'A risk assessment can include up to ' + MAX_ACTIONS + ' control measures.' };
  }

  var actions = [];
  for (var i = 0; i < data.actions.length; i++) {
    var source = data.actions[i] || {};
    var labelNo = i + 1;
    var description = requireText_(source.description, 'Enter the further action for control measure ' + labelNo + '.');
    if (!description.ok) return description;
    var owner = String(source.owner == null ? '' : source.owner).trim();
    if (RISK_OWNERS.indexOf(owner) === -1) {
      return { ok: false, message: 'Select an owner for control measure ' + labelNo + '.' };
    }
    var dueDate = parseDueDate_(source.dueDate);
    if (!dueDate) return { ok: false, message: 'Enter a valid due date for control measure ' + labelNo + '.' };
    actions.push({ description: description.value, owner: owner, dueDate: dueDate });
  }

  return {
    ok: true,
    value: {
      submissionId: submissionId,
      activity: activity,
      activityCode: activityCode,
      hazardName: hazardName.value,
      hazardDescription: hazardDescription.value,
      whoMightBeHarmed: whoMightBeHarmed.value,
      currentControls: currentControls.value,
      likelihood: likelihood,
      severity: severity,
      actions: actions
    }
  };
}

function fingerprint_(value) {
  var canonical = JSON.stringify({
    submissionId: value.submissionId,
    activity: value.activity,
    hazardName: value.hazardName,
    hazardDescription: value.hazardDescription,
    whoMightBeHarmed: value.whoMightBeHarmed,
    currentControls: value.currentControls,
    likelihood: value.likelihood,
    severity: value.severity,
    actions: value.actions.map(function (action) {
      return {
        description: action.description,
        owner: action.owner,
        dueDate: action.dueDate
      };
    })
  });
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < digest.length; i++) {
    var b = digest[i] < 0 ? digest[i] + 256 : digest[i];
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function props_() {
  return PropertiesService.getScriptProperties();
}

function loadRecord_(submissionId) {
  var raw = props_().getProperty('HS_SUB_' + submissionId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

function saveRecord_(submissionId, record) {
  record.at = Date.now();
  var props = props_();
  props.setProperty('HS_SUB_' + submissionId, JSON.stringify(record));
  var index = [];
  try { index = JSON.parse(props.getProperty(SUBMISSION_INDEX_KEY) || '[]'); } catch (err) { index = []; }
  if (!Array.isArray(index)) index = [];
  index = index.filter(function (item) { return item !== submissionId; });
  index.push(submissionId);
  while (index.length > 50) {
    var oldId = index.shift();
    props.deleteProperty('HS_SUB_' + oldId);
  }
  props.setProperty(SUBMISSION_INDEX_KEY, JSON.stringify(index));
}

function deleteRecord_(submissionId) {
  var props = props_();
  props.deleteProperty('HS_SUB_' + submissionId);
  var index = [];
  try { index = JSON.parse(props.getProperty(SUBMISSION_INDEX_KEY) || '[]'); } catch (err) { index = []; }
  if (!Array.isArray(index)) index = [];
  props.setProperty(SUBMISSION_INDEX_KEY, JSON.stringify(index.filter(function (item) {
    return item !== submissionId;
  })));
}

function loadActivitiesFromText_(text) {
  return activitiesFromCsv_(text);
}

function readPostParams_(e) {
  var p = {};
  var source = (e && e.parameter) ? e.parameter : {};
  for (var key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) p[key] = source[key];
  }
  var contents = e && e.postData && e.postData.contents ? String(e.postData.contents) : '';
  var type = e && e.postData && e.postData.type ? String(e.postData.type) : '';
  if (contents && (type.indexOf('application/json') !== -1 || contents.trim().charAt(0) === '{')) {
    try {
      var parsed = JSON.parse(contents);
      for (var key2 in parsed) {
        if (Object.prototype.hasOwnProperty.call(parsed, key2)) p[key2] = parsed[key2];
      }
    } catch (err) {}
  }
  if (typeof p.actions === 'string') {
    try { p.actions = JSON.parse(p.actions); } catch (err2) {}
  }
  return p;
}

function publicMessage_(err) {
  var text = String(err && err.message ? err.message : err || '');
  text = text.replace(/^Exception:\s*/, '');
  return text || 'The risk assessment could not be saved.';
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
