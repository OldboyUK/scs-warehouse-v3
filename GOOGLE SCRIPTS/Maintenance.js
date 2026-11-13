/**
 * SCS Maintenance — Report Fault.
 *
 * Deploy this file as its own Apps Script web app (separate from Warehouse, Auth, HR,
 * Health and Safety, and Quality).
 * Execute as: Me. Who has access: Anyone, even anonymous.
 * In the newer menu, Anyone is the anonymous choice. Anyone with a Google
 * account asks for a sign-in. Netlify is not signed in, so that choice
 * comes back as a web page and the report is not saved.
 * The deploying account must be able to edit spreadsheet
 * 1k0y2ieC4Sg5gYNOFLgcCxLNMUjImCdZNOJTBPg-V-KE
 * worksheet "Submission Log".
 *
 * The tab id of Submission Log could not be confirmed: the workbook is private and only
 * the Drop Downs tab is published. This script selects the worksheet by the exact name
 * "Submission Log" and does not write to "Drop Downs".
 *
 * After deploying a new version, set the web app /exec URL in Netlify as MAINTENANCE_SCRIPT_URL.
 * Do not put that URL in the frontend.
 *
 * One new Submission Log row is written, one cell at a time:
 * A maintenance ID, B submission date, C line/area, D machine/equipment,
 * E priority category, F description, G parts, H Yes or No.
 * The reporting operator is written only to an existing column after H whose header
 * already names that person (Operator, Reported By, and the other accepted headers).
 * Columns A–H are never used for the operator. No column or header is added.
 * A formula in column A that displays nothing is an available ID cell.
 * Other formulas, the header row, and unrelated cells are left alone.
 */

var API_TOKEN = 'J4PAN88';
var SSID_MAINTENANCE = '1k0y2ieC4Sg5gYNOFLgcCxLNMUjImCdZNOJTBPg-V-KE';
var SHEET_SUBMISSIONS = 'Submission Log';
var DROPDOWNS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT9wb05WXLcP4IN6Dce9zaRWtPKpGgHKWsqo4ICB97Mpr3RTx8MMFidwWgSf6ulh_sJNgE_2XxX3N2D/pub?gid=1056635412&single=true&output=csv';
var OTHER = 'Other';
var PRIORITY_OPTIONS = [
  { value: 'High Priority', label: 'High Priority - Urgent Risk to Safety of People or Food' },
  { value: 'Medium Priority', label: 'Medium Priority - A condition which must be addressed as it is likely to worsen, but does not pose an immediate risk' },
  { value: 'Low Priority', label: 'Low Priority - A condition which must be improved, but is not urgent' },
  { value: 'Stock Request', label: 'Stock Request - Used for requesting spare parts' },
  { value: 'Unsure', label: 'Unsure - Please Allocate the Priority for Me' }
];
var OPERATOR_HEADERS = [
  'operator',
  'operators',
  'reporting operator',
  'reported by',
  'reporter',
  'raised by',
  'requested by',
  'requester',
  'requestor',
  'who is reporting',
  'reporting person',
  'person reporting',
  'operator name',
  'operator id',
  'operator name/id',
  'reported by operator'
];
var NO_OPERATOR_MESSAGE = 'Submission Log has no column for the person reporting the fault. Columns A to H are already used by the maintenance record, and no later column has a header such as Operator or Reported By. Nothing was written and the sheet was not changed. Your answers are still here.';
var MAINTENANCE_ID_RE = /^MA(\d{4})$/;
var MAX_TEXT = 8000;
var MAX_NAME = 200;
var SUBMISSION_INDEX_KEY = 'FAULT_SUBMISSION_INDEX';

function doGet() {
  return json({ result: 'ok', service: 'maintenance' });
}

function doPost(e) {
  try {
    var p = readPostParams_(e);
    if (String(p.token || '').trim() !== API_TOKEN) {
      return json({ result: 'error', retryable: false, message: 'Unauthorized' });
    }
    var action = String(p.action || '').trim().toLowerCase();
    if (action === 'fault_create') return handleCreate_(p);
    return json({ result: 'error', retryable: false, message: 'Unknown action.' });
  } catch (err) {
    return json({ result: 'error', retryable: true, message: publicMessage_(err) });
  }
}

function handleCreate_(p) {
  var lists;
  try {
    lists = loadLists_();
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The line and equipment lists could not be loaded, so the report was not saved. ' + publicMessage_(err)
    });
  }
  var validated = validateFault_(p, lists);
  if (!validated.ok) return json({ result: 'error', retryable: true, message: validated.message });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return json({
      result: 'error',
      retryable: true,
      message: 'Another fault report is being saved. Wait a moment and try again. Your answers are still here.'
    });
  }
  try {
    return createFault_(validated.value);
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The fault report was not saved. ' + publicMessage_(err) + ' Your answers are still here.'
    });
  } finally {
    lock.releaseLock();
  }
}

function createFault_(value) {
  var fingerprint = fingerprint_(value);
  var existing = loadRecord_(value.submissionId);

  if (existing && existing.status === 'success') {
    if (existing.fingerprint !== fingerprint) {
      return json({
        result: 'error',
        retryable: false,
        maintenanceId: existing.maintenanceId,
        message: 'This report was already saved as ' + existing.maintenanceId + '. It was not changed and a new maintenance ID was not created.'
      });
    }
    return json(existing.result);
  }

  if (existing && existing.status === 'partial') {
    return json(existing.result || {
      result: 'error',
      partial: true,
      retryable: false,
      maintenanceId: existing.maintenanceId || '',
      message: 'This report was not fully saved. Check ' + (existing.maintenanceId || 'the maintenance record') + ' before writing anything else.'
    });
  }

  if (existing && existing.status === 'pending' && existing.fingerprint !== fingerprint) {
    return json({
      result: 'error',
      retryable: false,
      maintenanceId: existing.maintenanceId || '',
      message: 'This submission is already in progress with different details. Nothing new was written.'
    });
  }

  var ss = SpreadsheetApp.openById(SSID_MAINTENANCE);
  var sheet = requireSheet_(ss);
  var operatorCol = findOperatorColumn_(sheet);
  if (!operatorCol.ok) return json({ result: 'error', retryable: false, message: operatorCol.message });

  var maintenanceId;
  var submittedOn;
  var row;
  if (existing && existing.status === 'pending') {
    maintenanceId = existing.maintenanceId;
    submittedOn = existing.submittedOn;
    row = existing.row;
  } else {
    var allocated = nextMaintenanceId_(columnADisplays_(sheet).concat(rememberedIds_()));
    if (!allocated.ok) return json({ result: 'error', retryable: false, message: allocated.message });
    maintenanceId = allocated.maintenanceId;
    submittedOn = londonParts_(londonNow_()).uk;
    row = findCreateRow_(sheet, operatorCol.col);
    saveRecord_(value.submissionId, {
      status: 'pending',
      fingerprint: fingerprint,
      maintenanceId: maintenanceId,
      submittedOn: submittedOn,
      row: row
    });
  }

  var already = findIdRows_(sheet, maintenanceId);
  if (already.length > 1) {
    return json({
      result: 'error',
      partial: true,
      retryable: false,
      maintenanceId: maintenanceId,
      message: maintenanceId + ' appears more than once. Nothing new was written.'
    });
  }
  if (already.length === 1) row = already[0];
  else if (!rowIsSafeForCreate_(sheet, row, operatorCol.col)) row = findCreateRow_(sheet, operatorCol.col);

  var cells = faultCells_(maintenanceId, submittedOn, value, operatorCol.col);
  var written = [];
  try {
    saveRecord_(value.submissionId, {
      status: 'pending',
      fingerprint: fingerprint,
      maintenanceId: maintenanceId,
      submittedOn: submittedOn,
      row: row
    });
    alignFault_(sheet, row, cells, written, operatorCol.col);
    SpreadsheetApp.flush();
    verifyTextCells_(sheet, row, cells);
    if (findIdRows_(sheet, maintenanceId).length !== 1) {
      throw new Error('The maintenance ID could not be confirmed.');
    }
    var success = {
      result: 'success',
      maintenanceId: maintenanceId,
      submittedOn: submittedOn,
      operatorColumn: columnLetter_(operatorCol.col)
    };
    saveRecord_(value.submissionId, {
      status: 'success',
      fingerprint: fingerprint,
      maintenanceId: maintenanceId,
      submittedOn: submittedOn,
      row: row,
      result: success
    });
    return json(success);
  } catch (err) {
    var failed = rollbackWritten_(written);
    var onSheet = findIdRows_(sheet, maintenanceId);
    if (failed.length || err.conflict || onSheet.length) {
      var partialResult = {
        result: 'error',
        partial: true,
        retryable: false,
        maintenanceId: maintenanceId,
        message: err.conflict
          ? 'This report was already saved as ' + maintenanceId + ' with different details. It was not changed and a new maintenance ID was not created.'
          : 'This report was not fully saved. Check ' + maintenanceId + ' before creating another one.'
      };
      saveRecord_(value.submissionId, {
        status: 'partial',
        fingerprint: fingerprint,
        maintenanceId: maintenanceId,
        submittedOn: submittedOn,
        row: row,
        result: partialResult
      });
      return json(partialResult);
    }
    deleteRecord_(value.submissionId);
    return json({
      result: 'error',
      retryable: true,
      message: 'The fault report was not saved. ' + publicMessage_(err) + ' Your answers are still here.'
    });
  }
}

function faultCells_(maintenanceId, submittedOn, value, operatorCol) {
  return [
    { col: 1, value: maintenanceId },
    { col: 2, value: submittedOn },
    { col: 3, value: value.lineArea },
    { col: 4, value: value.equipment },
    { col: 5, value: value.priority },
    { col: 6, value: value.description },
    { col: 7, value: value.parts },
    { col: 8, value: value.maintenanceRequest },
    { col: operatorCol, value: value.operator }
  ];
}

function alignFault_(sheet, row, cells, written, operatorCol) {
  if (row < 2) throw new Error('Refusing to write on the header row.');
  if (operatorCol < 9) throw new Error('Refusing to store the operator in columns A to H.');
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
    if (!((cell.col >= 1 && cell.col <= 8) || cell.col === operatorCol)) {
      throw new Error('Refusing to write outside the maintenance record.');
    }
    var range = sheet.getRange(row, cell.col);
    var formula = String(range.getFormula() || '');
    var expected = cell.value == null ? '' : String(cell.value);
    var currentText = normalizeStored_(range.getValue());
    if (formula.trim() !== '') {
      var compact = formula.toUpperCase().replace(/\s/g, '');
      if (compact.indexOf('ARRAYFORMULA(') !== -1) {
        throw new Error('Column ' + columnLetter_(cell.col) + ' contains an array formula. Nothing was overwritten.');
      }
      if (cell.col === 1 && String(range.getDisplayValue() || '').trim() === '' && expected !== '') {
        writeTextCell_(sheet, row, cell.col, expected, written, operatorCol);
        continue;
      }
      throw new Error('Column ' + columnLetter_(cell.col) + ' on row ' + row + ' contains a formula. It was not overwritten.');
    }
    if (currentText === expected) continue;
    if (currentText === '' && expected !== '') {
      writeTextCell_(sheet, row, cell.col, expected, written, operatorCol);
      continue;
    }
    if (currentText === '' && expected === '') continue;
    var err = new Error('Row ' + row + ' already has different data in column ' + columnLetter_(cell.col) + '. It was not overwritten.');
    err.conflict = true;
    throw err;
  }
}

function verifyTextCells_(sheet, row, cells) {
  for (var i = 0; i < cells.length; i++) {
    var expected = cells[i].value == null ? '' : String(cells[i].value);
    var range = sheet.getRange(row, cells[i].col);
    if (String(range.getFormula() || '').trim() !== '') {
      throw new Error('Saved cells on row ' + row + ' could not be confirmed.');
    }
    if (normalizeStored_(range.getValue()) !== expected) {
      throw new Error('Saved cells on row ' + row + ' could not be confirmed.');
    }
  }
}

function writeTextCell_(sheet, row, col, value, written, operatorCol) {
  if (row < 2) throw new Error('Refusing to write on the header row.');
  if (operatorCol < 9) throw new Error('Refusing to store the operator in columns A to H.');
  if (!((col >= 1 && col <= 8) || col === operatorCol)) {
    throw new Error('Refusing to write outside the maintenance record.');
  }
  var range = sheet.getRange(row, col);
  var formula = String(range.getFormula() || '');
  if (formula.toUpperCase().replace(/\s/g, '').indexOf('ARRAYFORMULA(') !== -1) {
    throw new Error('Column ' + columnLetter_(col) + ' contains an array formula. Nothing was overwritten.');
  }
  written.push({
    sheet: sheet,
    row: row,
    col: col,
    formula: formula,
    value: range.getValue(),
    format: range.getNumberFormat()
  });
  if (value === '') {
    range.clearContent();
    return;
  }
  range.setNumberFormat('@');
  range.setValue(String(value));
}

function rollbackWritten_(entries) {
  var failed = [];
  for (var i = entries.length - 1; i >= 0; i--) {
    var entry = entries[i];
    try {
      var range = entry.sheet.getRange(entry.row, entry.col);
      if (entry.formula) range.setFormula(entry.formula);
      else if (entry.value == null || entry.value === '') range.clearContent();
      else range.setValue(entry.value);
      if (entry.format != null && entry.format !== '') range.setNumberFormat(entry.format);
    } catch (err) {
      failed.push(entry);
    }
  }
  return failed;
}

function columnLetter_(n) {
  var letters = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function columnADisplays_(sheet) {
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) return [];
  var values = sheet.getRange(2, 1, maxRows - 1, 1).getDisplayValues();
  var out = [];
  for (var i = 0; i < values.length; i++) out.push(String(values[i][0] == null ? '' : values[i][0]).trim());
  return out;
}

function findIdRows_(sheet, maintenanceId) {
  var wanted = String(maintenanceId || '').trim().toUpperCase();
  var displays = columnADisplays_(sheet);
  var rows = [];
  for (var i = 0; i < displays.length; i++) {
    if (displays[i].toUpperCase() === wanted) rows.push(i + 2);
  }
  return rows;
}

function rowIsSafeForCreate_(sheet, row, operatorCol) {
  if (row < 2 || row > sheet.getMaxRows()) return false;
  if (columnADisplay_(sheet, row) !== '') return false;
  var aFormula = String(sheet.getRange(row, 1).getFormula() || '');
  if (aFormula.toUpperCase().replace(/\s/g, '').indexOf('ARRAYFORMULA(') !== -1) return false;
  var cols = [2, 3, 4, 5, 6, 7, 8, operatorCol];
  for (var i = 0; i < cols.length; i++) {
    var range = sheet.getRange(row, cols[i]);
    if (String(range.getFormula() || '').trim() !== '') return false;
    if (normalizeStored_(range.getValue()) !== '') return false;
  }
  return true;
}

function columnADisplay_(sheet, row) {
  if (row < 2) return '';
  return String(sheet.getRange(row, 1).getDisplayValue() || '').trim();
}

function findCreateRow_(sheet, operatorCol) {
  var displays = columnADisplays_(sheet);
  for (var i = 0; i < displays.length; i++) {
    if (displays[i] !== '') continue;
    var row = i + 2;
    if (rowIsSafeForCreate_(sheet, row, operatorCol)) return row;
  }
  var next = sheet.getMaxRows() + 1;
  sheet.insertRowsAfter(sheet.getMaxRows(), 1);
  if (sheet.getMaxRows() < next || !rowIsSafeForCreate_(sheet, next, operatorCol)) {
    throw new Error('No safe row was available on Submission Log. Nothing was written.');
  }
  return next;
}

function findOperatorColumn_(sheet) {
  var maxColumns = sheet.getMaxColumns();
  var last = sheet.getLastColumn();
  var width = Math.max(last || 0, 20);
  if (width > maxColumns) width = maxColumns;
  if (width < 9) return { ok: false, message: NO_OPERATOR_MESSAGE };
  var headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  var found = 0;
  for (var i = 8; i < headers.length; i++) {
    var key = headerKey_(headers[i]);
    if (!key || OPERATOR_HEADERS.indexOf(key) === -1) continue;
    if (found) {
      return {
        ok: false,
        message: 'Submission Log has more than one column that could store the reporting operator. Nothing was written and the sheet was not changed.'
      };
    }
    found = i + 1;
  }
  if (!found || found < 9) return { ok: false, message: NO_OPERATOR_MESSAGE };
  return { ok: true, col: found };
}

function headerKey_(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeStored_(value) {
  if (value == null) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, 'Europe/London', 'dd/MM/yyyy');
  }
  return String(value).trim();
}

function londonNow_() {
  return new Date();
}

function londonParts_(date) {
  return { uk: Utilities.formatDate(date, 'Europe/London', 'dd/MM/yyyy') };
}

function pad4_(n) {
  var text = String(n);
  while (text.length < 4) text = '0' + text;
  return text;
}

function nextMaintenanceId_(existingIds) {
  var max = 0;
  var seen = {};
  var ids = existingIds || [];
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i] == null ? '' : ids[i]).trim().toUpperCase();
    if (!id) continue;
    seen[id] = true;
    var match = id.match(MAINTENANCE_ID_RE);
    if (!match) continue;
    var n = parseInt(match[1], 10);
    if (n > max) max = n;
  }
  if (max >= 9999) return { ok: false, message: 'The maintenance ID sequence is full. Nothing was saved.' };
  var next = max + 1;
  var candidate = 'MA' + pad4_(next);
  var guard = 0;
  while (seen[candidate]) {
    next++;
    guard++;
    if (next > 9999 || guard > 10000) {
      return { ok: false, message: 'Could not allocate a unique maintenance ID. Nothing was saved.' };
    }
    candidate = 'MA' + pad4_(next);
  }
  return { ok: true, maintenanceId: candidate };
}

function requireSheet_(ss) {
  var sheet = ss.getSheetByName(SHEET_SUBMISSIONS);
  if (!sheet || sheet.getName() !== SHEET_SUBMISSIONS) {
    throw new Error('Worksheet not found: ' + SHEET_SUBMISSIONS + '. Nothing was written.');
  }
  return sheet;
}

function loadLists_() {
  var response = UrlFetchApp.fetch(DROPDOWNS_CSV_URL, { muteHttpExceptions: true });
  var code = Number(response.getResponseCode());
  var text = String(response.getContentText() || '');
  if (code < 200 || code >= 300) throw new Error('Dropdown list request failed (' + code + ').');
  if (!text || text.replace(/^\uFEFF/, '').trim().charAt(0) === '<') {
    throw new Error('Dropdown list did not return spreadsheet data.');
  }
  var lists = listsFromCsv_(text);
  if (!lists.operators.length || !lists.areas.length) throw new Error('The dropdown list was empty.');
  return lists;
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

function listsFromCsv_(text) {
  var rows = parseCsv_(text);
  var operators = [];
  var areas = [];
  var equipmentByArea = {};
  var seenOperators = {};
  var seenAreas = {};
  var seenEquipment = {};
  for (var i = 1; i < rows.length; i++) {
    var record = rows[i] || [];
    var operator = String(record[0] == null ? '' : record[0]).trim();
    var area = String(record[1] == null ? '' : record[1]).trim();
    var equipment = String(record[2] == null ? '' : record[2]).trim();
    if (operator && !seenOperators[operator]) {
      seenOperators[operator] = true;
      operators.push(operator);
    }
    if (area && !seenAreas[area]) {
      seenAreas[area] = true;
      areas.push(area);
    }
    if (area && equipment) {
      var key = area + '\n' + equipment;
      if (!seenEquipment[key]) {
        seenEquipment[key] = true;
        if (!equipmentByArea[area]) equipmentByArea[area] = [];
        equipmentByArea[area].push(equipment);
      }
    }
  }
  return { operators: operators, areas: areas, equipmentByArea: equipmentByArea };
}

function submissionIdOk_(id) {
  return /^[A-Za-z0-9-]{8,80}$/.test(String(id || '').trim());
}

function canonicalPriority_(value) {
  var text = String(value == null ? '' : value).trim();
  for (var i = 0; i < PRIORITY_OPTIONS.length; i++) {
    if (text === PRIORITY_OPTIONS[i].value || text === PRIORITY_OPTIONS[i].label) return PRIORITY_OPTIONS[i].value;
  }
  return '';
}

function requireText_(value, emptyMessage, label) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return { ok: false, message: emptyMessage };
  if (text.length > MAX_TEXT) return { ok: false, message: label + ' is too long.' };
  return { ok: true, value: text };
}

function optionalText_(value, label) {
  var text = String(value == null ? '' : value).trim();
  if (text.length > MAX_TEXT) return { ok: false, message: label + ' is too long.' };
  return { ok: true, value: text };
}

function namedText_(value, emptyMessage, label) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return { ok: false, message: emptyMessage };
  if (text.length > MAX_NAME) return { ok: false, message: label + ' is too long.' };
  return { ok: true, value: text };
}

function validateFault_(data, lists) {
  data = data || {};
  lists = lists || { operators: [], areas: [], equipmentByArea: {} };
  var submissionId = String(data.submissionId || '').trim();
  if (!submissionIdOk_(submissionId)) {
    return { ok: false, message: 'The report could not be identified. Reload the page and try again. Nothing was saved.' };
  }
  var mode = String(data.reporterMode || '').trim().toLowerCase();
  if (mode !== 'self' && mode !== 'other') return { ok: false, message: 'Choose Self or Another Operator.' };
  var operator = namedText_(data.operator, 'The reporting operator is missing. Nothing was saved.', 'The operator name');
  if (!operator.ok) return operator;
  if (mode === 'other' && lists.operators.indexOf(operator.value) === -1) {
    return { ok: false, message: 'Select an operator from the list.' };
  }

  var areaChoice = String(data.area || '').trim();
  var lineArea;
  if (!areaChoice) return { ok: false, message: 'Select the operating line or area.' };
  if (areaChoice === OTHER) {
    var areaOther = namedText_(data.areaOther, 'Enter the operating line or area.', 'The operating line or area');
    if (!areaOther.ok) return areaOther;
    lineArea = areaOther.value;
  } else if (lists.areas.indexOf(areaChoice) === -1) {
    return { ok: false, message: 'Select an operating line or area from the list.' };
  } else {
    lineArea = areaChoice;
  }

  var equipmentChoice = String(data.equipment || '').trim();
  var equipment;
  if (!equipmentChoice) return { ok: false, message: 'Select the machine or equipment.' };
  if (equipmentChoice === OTHER) {
    var equipmentOther = namedText_(data.equipmentOther, 'Enter the machine or equipment.', 'The machine or equipment');
    if (!equipmentOther.ok) return equipmentOther;
    equipment = equipmentOther.value;
  } else if (areaChoice === OTHER) {
    return { ok: false, message: 'Choose Other and describe the machine or equipment.' };
  } else {
    var machines = lists.equipmentByArea[areaChoice] || [];
    if (machines.indexOf(equipmentChoice) === -1) {
      return { ok: false, message: 'Select a machine or piece of equipment for that line or area.' };
    }
    equipment = equipmentChoice;
  }

  var priority = canonicalPriority_(data.priority);
  if (!priority) return { ok: false, message: 'Select a priority.' };
  var description = requireText_(data.description, 'Describe the fault or unsafe condition.', 'Description of the fault');
  if (!description.ok) return description;
  var parts = optionalText_(data.parts, 'Parts requested');
  if (!parts.ok) return parts;
  var maintenanceRequest = String(data.maintenanceRequest || '').trim();
  if (maintenanceRequest !== 'Yes' && maintenanceRequest !== 'No') {
    return { ok: false, message: 'Choose whether to raise a maintenance request.' };
  }

  return {
    ok: true,
    value: {
      submissionId: submissionId,
      reporterMode: mode,
      operator: operator.value,
      lineArea: lineArea,
      equipment: equipment,
      priority: priority,
      description: description.value,
      parts: parts.value,
      maintenanceRequest: maintenanceRequest
    }
  };
}

function fingerprint_(value) {
  var canonical = JSON.stringify({
    submissionId: value.submissionId,
    operator: value.operator,
    lineArea: value.lineArea,
    equipment: value.equipment,
    priority: value.priority,
    description: value.description,
    parts: value.parts,
    maintenanceRequest: value.maintenanceRequest
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
  var raw = props_().getProperty('FAULT_SUB_' + submissionId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

function saveRecord_(submissionId, record) {
  record.at = Date.now();
  var props = props_();
  props.setProperty('FAULT_SUB_' + submissionId, JSON.stringify(record));
  var index = [];
  try { index = JSON.parse(props.getProperty(SUBMISSION_INDEX_KEY) || '[]'); } catch (err) { index = []; }
  if (!Array.isArray(index)) index = [];
  index = index.filter(function (item) { return item !== submissionId; });
  index.push(submissionId);
  while (index.length > 100) {
    var oldId = index.shift();
    props.deleteProperty('FAULT_SUB_' + oldId);
  }
  props.setProperty(SUBMISSION_INDEX_KEY, JSON.stringify(index));
}

function deleteRecord_(submissionId) {
  var props = props_();
  props.deleteProperty('FAULT_SUB_' + submissionId);
  var index = [];
  try { index = JSON.parse(props.getProperty(SUBMISSION_INDEX_KEY) || '[]'); } catch (err) { index = []; }
  if (!Array.isArray(index)) index = [];
  props.setProperty(SUBMISSION_INDEX_KEY, JSON.stringify(index.filter(function (item) {
    return item !== submissionId;
  })));
}

function rememberedIds_() {
  var ids = [];
  var index = [];
  try { index = JSON.parse(props_().getProperty(SUBMISSION_INDEX_KEY) || '[]'); } catch (err) { index = []; }
  if (!Array.isArray(index)) return ids;
  for (var i = 0; i < index.length; i++) {
    var record = loadRecord_(index[i]);
    if (!record || !record.maintenanceId) continue;
    if (record.status === 'pending' || record.status === 'success' || record.status === 'partial') {
      ids.push(String(record.maintenanceId));
    }
  }
  return ids;
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
  return p;
}

function publicMessage_(err) {
  var text = String(err && err.message ? err.message : err || '');
  text = text.replace(/^Exception:\s*/, '');
  return text || 'The fault report could not be saved.';
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
