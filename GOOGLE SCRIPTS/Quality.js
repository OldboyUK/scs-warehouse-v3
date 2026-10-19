/**
 * SCS Quality — Raise NCR.
 *
 * Deploy this file as its own Apps Script web app (separate from Warehouse, Auth, HR and Health and Safety).
 * Execute as: Me. Who has access: Anyone.
 * The deploying account must be able to edit spreadsheet
 * 1qJK9f0BcaPMuPXk3CKfFX_D-PAQ5pFTHB7bpCNRjpHY
 * (worksheet "NCR Database", gid 0).
 *
 * After deploying a new version, set the web app /exec URL in Netlify as QUALITY_SCRIPT_URL.
 * Do not put that URL in the frontend.
 *
 * Section 1 writes columns A–M of one new row. Section 2 updates columns N–W of that same row.
 * Column A is chosen by its displayed text. A formula that displays nothing is an available row.
 * Cells are written one at a time. The header row, other columns, and other rows are left alone.
 */

var API_TOKEN = 'J4PAN88';
var SSID_NCR = '1qJK9f0BcaPMuPXk3CKfFX_D-PAQ5pFTHB7bpCNRjpHY';
var SHEET_NCR = 'NCR Database';
var GID_NCR = 0;
var PRIORITIES = ['Low', 'Medium', 'High'];
var PEOPLE = ['Zoe Ibbotson', 'Tom Ebdon', 'Angus Sales'];
var CATEGORIES = [
  'Finished Product',
  'Ingredients',
  'Packaging',
  'Pre-Packaged Liquid',
  'Internal Process or Procedure'
];
var NCR_NUMBER_RE = /^NCR(\d{2})-(\d{3})$/;
var MAX_TEXT = 8000;
var MAX_BATCHES = 30;
var MAX_BATCH_LENGTH = 80;
var SUBMISSION_INDEX_KEY = 'NCR_SUBMISSION_INDEX';

function doPost(e) {
  try {
    var p = readPostParams_(e);
    if (String(p.token || '').trim() !== API_TOKEN) {
      return json({ result: 'error', retryable: false, message: 'Unauthorized' });
    }
    var action = String(p.action || '').trim().toLowerCase();
    if (action === 'ncr_create') return handleCreate_(p);
    if (action === 'ncr_update') return handleUpdate_(p);
    if (action === 'ncr_get') return handleGet_(p);
    return json({ result: 'error', retryable: false, message: 'Unknown action.' });
  } catch (err) {
    return json({ result: 'error', retryable: true, message: publicMessage_(err) });
  }
}

function handleCreate_(p) {
  var validated = validateSection1_(p);
  if (!validated.ok) return json({ result: 'error', retryable: true, message: validated.message });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return json({
      result: 'error',
      retryable: true,
      message: 'Another NCR is being saved. Wait a moment and try again. Your answers are still here.'
    });
  }
  try {
    return createNcr_(validated.value);
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The NCR was not saved. ' + publicMessage_(err) + ' Your answers are still here.'
    });
  } finally {
    lock.releaseLock();
  }
}

function handleUpdate_(p) {
  var validated = validateSection2_(p);
  if (!validated.ok) return json({ result: 'error', retryable: true, message: validated.message });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return json({
      result: 'error',
      retryable: true,
      ncrNumber: validated.value.ncrNumber,
      message: 'Another NCR is being saved. Wait a moment and try again. Your answers are still here.'
    });
  }
  try {
    return updateNcr_(validated.value);
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      ncrNumber: validated.value.ncrNumber,
      message: 'The investigation was not saved. ' + publicMessage_(err) + ' Your answers are still here.'
    });
  } finally {
    lock.releaseLock();
  }
}

function handleGet_(p) {
  var ncrNumber = String(p.ncrNumber || '').trim().toUpperCase();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return json({ result: 'error', retryable: true, message: 'The NCR database is busy. Wait a moment and try again.' });
  }
  try {
    return getNcr_(ncrNumber);
  } catch (err) {
    return json({ result: 'error', retryable: true, message: 'The NCR could not be loaded. ' + publicMessage_(err) });
  } finally {
    lock.releaseLock();
  }
}

function londonNow_() {
  return new Date();
}

function londonParts_(date) {
  return {
    year: Utilities.formatDate(date, 'Europe/London', 'yyyy'),
    uk: Utilities.formatDate(date, 'Europe/London', 'dd/MM/yyyy')
  };
}

function pad3_(n) {
  var text = String(n);
  while (text.length < 3) text = '0' + text;
  return text;
}

function nextNcrNumber_(existingIds, date) {
  var parts = londonParts_(date);
  var yearSuffix = String(parts.year).slice(-2);
  var prefix = 'NCR' + yearSuffix;
  var max = 0;
  var seen = {};
  var ids = existingIds || [];
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i] == null ? '' : ids[i]).trim();
    if (!id) continue;
    seen[id] = true;
    var match = id.match(NCR_NUMBER_RE);
    if (!match || match[1] !== yearSuffix) continue;
    var n = parseInt(match[2], 10);
    if (n > max) max = n;
  }
  if (max >= 999) {
    return { ok: false, message: 'The NCR sequence for ' + parts.year + ' is full. Nothing was saved.' };
  }
  var next = max + 1;
  var candidate = prefix + '-' + pad3_(next);
  var guard = 0;
  while (seen[candidate]) {
    next++;
    guard++;
    if (next > 999 || guard > 1000) {
      return { ok: false, message: 'Could not allocate a unique NCR number. Nothing was saved.' };
    }
    candidate = prefix + '-' + pad3_(next);
  }
  return { ok: true, ncrNumber: candidate, submittedOn: parts.uk };
}

function createNcr_(value) {
  var fingerprint = fingerprint_(value);
  var existing = loadRecord_(value.submissionId);

  if (existing && existing.status === 'success') {
    if (existing.fingerprint !== fingerprint) {
      return json({
        result: 'error',
        retryable: false,
        ncrNumber: existing.ncrNumber,
        message: 'This report was already saved as ' + existing.ncrNumber + '. It was not changed and a new NCR was not created.'
      });
    }
    return json(existing.result);
  }

  if (existing && existing.status === 'partial') {
    return json(existing.result || {
      result: 'error',
      partial: true,
      retryable: false,
      ncrNumber: existing.ncrNumber || '',
      message: 'This report was not fully saved. Check ' + (existing.ncrNumber || 'the NCR') + ' before writing anything else.'
    });
  }

  if (existing && existing.status === 'pending' && existing.fingerprint !== fingerprint) {
    return json({
      result: 'error',
      retryable: false,
      ncrNumber: existing.ncrNumber || '',
      message: 'This submission is already in progress with different details. Nothing new was written.'
    });
  }

  var ss = SpreadsheetApp.openById(SSID_NCR);
  var sheet = requireSheet_(ss, SHEET_NCR, GID_NCR);
  var ncrNumber;
  var submittedOn;
  var row;

  if (existing && existing.status === 'pending') {
    ncrNumber = existing.ncrNumber;
    submittedOn = existing.submittedOn;
    row = existing.row;
  } else {
    var allocated = nextNcrNumber_(columnADisplays_(sheet).concat(rememberedNumbers_()), londonNow_());
    if (!allocated.ok) return json({ result: 'error', retryable: false, message: allocated.message });
    ncrNumber = allocated.ncrNumber;
    submittedOn = allocated.submittedOn;
    row = findCreateRow_(sheet);
    saveRecord_(value.submissionId, {
      status: 'pending',
      fingerprint: fingerprint,
      ncrNumber: ncrNumber,
      submittedOn: submittedOn,
      row: row
    });
  }

  var already = findNcrRows_(sheet, ncrNumber);
  if (already.length > 1) {
    return json({
      result: 'error',
      partial: true,
      retryable: false,
      ncrNumber: ncrNumber,
      message: ncrNumber + ' appears more than once. Nothing new was written.'
    });
  }
  if (already.length === 1) row = already[0];
  else if (!rowIsSafeForCreate_(sheet, row)) row = findCreateRow_(sheet);

  var cells = section1Cells_(ncrNumber, submittedOn, value);
  var written = [];
  try {
    saveRecord_(value.submissionId, {
      status: 'pending',
      fingerprint: fingerprint,
      ncrNumber: ncrNumber,
      submittedOn: submittedOn,
      row: row
    });
    alignSection1_(sheet, row, cells, written);
    SpreadsheetApp.flush();
    verifyTextCells_(sheet, row, cells);
    if (findNcrRows_(sheet, ncrNumber).length !== 1) {
      throw new Error('The NCR number could not be confirmed.');
    }
    var success = { result: 'success', ncrNumber: ncrNumber, submittedOn: submittedOn };
    saveRecord_(value.submissionId, {
      status: 'success',
      fingerprint: fingerprint,
      ncrNumber: ncrNumber,
      submittedOn: submittedOn,
      row: row,
      result: success
    });
    return json(success);
  } catch (err) {
    var failed = rollbackWritten_(written);
    var onSheet = findNcrRows_(sheet, ncrNumber);
    if (failed.length || err.conflict || onSheet.length) {
      var partialResult = {
        result: 'error',
        partial: true,
        retryable: false,
        ncrNumber: ncrNumber,
        message: err.conflict
          ? 'This report was already saved as ' + ncrNumber + ' with different details. It was not changed and a new NCR was not created.'
          : 'This report was not fully saved. Check ' + ncrNumber + ' before creating another one.'
      };
      saveRecord_(value.submissionId, {
        status: 'partial',
        fingerprint: fingerprint,
        ncrNumber: ncrNumber,
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
      message: 'The NCR was not saved. ' + publicMessage_(err) + ' Your answers are still here.'
    });
  }
}

function updateNcr_(value) {
  var ss = SpreadsheetApp.openById(SSID_NCR);
  var sheet = requireSheet_(ss, SHEET_NCR, GID_NCR);
  var rows = findNcrRows_(sheet, value.ncrNumber);
  if (!rows.length) {
    return json({
      result: 'error',
      retryable: false,
      message: value.ncrNumber + ' was not found. The investigation was not saved and a new NCR was not created.'
    });
  }
  if (rows.length > 1) {
    return json({
      result: 'error',
      retryable: false,
      message: value.ncrNumber + ' appears more than once. Nothing was written.'
    });
  }

  var row = rows[0];
  var before = rowSnapshot_(sheet, row, 1, 13);
  var cells = section2Cells_(value);
  var written = [];
  try {
    updateInvestigationCells_(sheet, row, cells, written);
    SpreadsheetApp.flush();
    if (rowSnapshot_(sheet, row, 1, 13) !== before) {
      throw new Error('The original report changed while the investigation was saving.');
    }
    verifyTextCells_(sheet, row, cells);
    if (columnADisplay_(sheet, row) !== value.ncrNumber) {
      throw new Error('The NCR number could not be confirmed after saving.');
    }
    if (findNcrRows_(sheet, value.ncrNumber).length !== 1) {
      throw new Error('The investigation could not be confirmed on a single row.');
    }
    return json({ result: 'success', ncrNumber: value.ncrNumber });
  } catch (err) {
    var failed = rollbackWritten_(written);
    if (failed.length || rowSnapshot_(sheet, row, 1, 13) !== before) {
      return json({
        result: 'error',
        partial: true,
        retryable: false,
        ncrNumber: value.ncrNumber,
        message: 'The investigation was not fully saved. Check ' + value.ncrNumber + '. A new NCR was not created.'
      });
    }
    return json({
      result: 'error',
      retryable: true,
      ncrNumber: value.ncrNumber,
      message: 'The investigation was not saved. ' + publicMessage_(err) + ' Your answers are still here.'
    });
  }
}

function getNcr_(ncrNumber) {
  if (!NCR_NUMBER_RE.test(ncrNumber)) {
    return json({ result: 'error', message: 'Enter a valid NCR number, such as NCR26-001.' });
  }
  var ss = SpreadsheetApp.openById(SSID_NCR);
  var sheet = requireSheet_(ss, SHEET_NCR, GID_NCR);
  var rows = findNcrRows_(sheet, ncrNumber);
  if (rows.length !== 1) {
    return json({
      result: 'error',
      message: rows.length ? ncrNumber + ' appears more than once.' : ncrNumber + ' was not found.'
    });
  }
  var row = rows[0];
  return json({
    result: 'success',
    ncrNumber: ncrNumber,
    submittedOn: normalizeStored_(sheet.getRange(row, 2).getValue()),
    priority: normalizeStored_(sheet.getRange(row, 3).getValue()),
    reporter: normalizeStored_(sheet.getRange(row, 4).getValue()),
    category: normalizeStored_(sheet.getRange(row, 5).getValue()),
    batchNumbers: normalizeStored_(sheet.getRange(row, 6).getValue()),
    description: normalizeStored_(sheet.getRange(row, 7).getValue()),
    involved: normalizeStored_(sheet.getRange(row, 8).getValue()),
    happened: normalizeStored_(sheet.getRange(row, 9).getValue()),
    whenOccurred: normalizeStored_(sheet.getRange(row, 10).getValue()),
    whereOccurred: normalizeStored_(sheet.getRange(row, 11).getValue()),
    why: normalizeStored_(sheet.getRange(row, 12).getValue()),
    remedial: normalizeStored_(sheet.getRange(row, 13).getValue()),
    findings: normalizeStored_(sheet.getRange(row, 14).getValue()),
    correctiveActions: normalizeStored_(sheet.getRange(row, 15).getValue()),
    correctiveDue: cellToIsoDate_(sheet, row, 16),
    correctiveComplete: cellToIsoDate_(sheet, row, 17),
    rootCause: normalizeStored_(sheet.getRange(row, 18).getValue()),
    preventativeActions: normalizeStored_(sheet.getRange(row, 19).getValue()),
    preventativeDue: cellToIsoDate_(sheet, row, 20),
    preventativeComplete: cellToIsoDate_(sheet, row, 21),
    ncrCompleted: cellToIsoDate_(sheet, row, 22),
    completedBy: normalizeStored_(sheet.getRange(row, 23).getValue())
  });
}

function section1Cells_(ncrNumber, submittedOn, value) {
  return [
    { col: 1, value: ncrNumber },
    { col: 2, value: submittedOn },
    { col: 3, value: value.priority },
    { col: 4, value: value.reporter },
    { col: 5, value: value.category },
    { col: 6, value: value.batchNumbers },
    { col: 7, value: value.description },
    { col: 8, value: value.involved },
    { col: 9, value: value.happened },
    { col: 10, value: value.whenOccurred },
    { col: 11, value: value.whereOccurred },
    { col: 12, value: value.why },
    { col: 13, value: value.remedial }
  ];
}

function section2Cells_(value) {
  return [
    { col: 14, value: value.findings },
    { col: 15, value: value.correctiveActions },
    { col: 16, value: value.correctiveDue },
    { col: 17, value: value.correctiveComplete },
    { col: 18, value: value.rootCause },
    { col: 19, value: value.preventativeActions },
    { col: 20, value: value.preventativeDue },
    { col: 21, value: value.preventativeComplete },
    { col: 22, value: value.ncrCompleted },
    { col: 23, value: value.completedBy }
  ];
}

function alignSection1_(sheet, row, cells, written) {
  if (row < 2) throw new Error('Refusing to write on the header row.');
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
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
        writeTextCell_(sheet, row, cell.col, expected, written);
        continue;
      }
      throw new Error('Column ' + columnLetter_(cell.col) + ' on row ' + row + ' contains a formula. It was not overwritten.');
    }
    if (currentText === expected) continue;
    if (currentText === '' && expected !== '') {
      writeTextCell_(sheet, row, cell.col, expected, written);
      continue;
    }
    if (currentText === '' && expected === '') continue;
    var err = new Error('Row ' + row + ' already has different data in column ' + columnLetter_(cell.col) + '. It was not overwritten.');
    err.conflict = true;
    throw err;
  }
}

function updateInvestigationCells_(sheet, row, cells, written) {
  if (row < 2) throw new Error('Refusing to write on the header row.');
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
    if (cell.col < 14 || cell.col > 23) {
      throw new Error('Refusing to change columns A to M while saving the investigation.');
    }
    var range = sheet.getRange(row, cell.col);
    var formula = String(range.getFormula() || '').trim();
    if (formula) {
      throw new Error('Column ' + columnLetter_(cell.col) + ' contains a formula. The investigation was not saved.');
    }
    var expected = cell.value == null ? '' : String(cell.value);
    var current = range.getValue();
    var currentText = dateColumnText_(current);
    if (currentText === expected) continue;
    writeTextCell_(sheet, row, cell.col, expected, written);
  }
}

function dateColumnText_(value) {
  if (value == null || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, 'Europe/London', 'dd/MM/yyyy');
  }
  return String(value).trim();
}

function isInvestigationDateCol_(col) {
  return col === 16 || col === 17 || col === 20 || col === 21 || col === 22;
}

function verifyTextCells_(sheet, row, cells) {
  for (var i = 0; i < cells.length; i++) {
    var expected = cells[i].value == null ? '' : String(cells[i].value);
    var range = sheet.getRange(row, cells[i].col);
    if (String(range.getFormula() || '').trim() !== '') {
      throw new Error('Saved cells on row ' + row + ' could not be confirmed.');
    }
    var actual = isInvestigationDateCol_(cells[i].col)
      ? dateColumnText_(range.getValue())
      : normalizeStored_(range.getValue());
    if (actual !== expected) throw new Error('Saved cells on row ' + row + ' could not be confirmed.');
  }
}

function writeTextCell_(sheet, row, col, value, written) {
  if (row < 2) throw new Error('Refusing to write on the header row.');
  if (col < 1 || col > 23) throw new Error('Refusing to write outside columns A to W.');
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

function columnADisplays_(sheet) {
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) return [];
  var values = sheet.getRange(2, 1, maxRows - 1, 1).getDisplayValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    out.push(String(values[i][0] == null ? '' : values[i][0]).trim());
  }
  return out;
}

function columnADisplay_(sheet, row) {
  if (row < 2) return '';
  return String(sheet.getRange(row, 1).getDisplayValue() || '').trim();
}

function findNcrRows_(sheet, ncrNumber) {
  var wanted = String(ncrNumber || '').trim();
  var displays = columnADisplays_(sheet);
  var rows = [];
  for (var i = 0; i < displays.length; i++) {
    if (displays[i] === wanted) rows.push(i + 2);
  }
  return rows;
}

function rowIsSafeForCreate_(sheet, row) {
  if (row < 2 || row > sheet.getMaxRows()) return false;
  if (columnADisplay_(sheet, row) !== '') return false;
  var aFormula = String(sheet.getRange(row, 1).getFormula() || '');
  if (aFormula.toUpperCase().replace(/\s/g, '').indexOf('ARRAYFORMULA(') !== -1) return false;
  for (var col = 2; col <= 13; col++) {
    var range = sheet.getRange(row, col);
    if (String(range.getFormula() || '').trim() !== '') return false;
    if (normalizeStored_(range.getValue()) !== '') return false;
  }
  return true;
}

function findCreateRow_(sheet) {
  var displays = columnADisplays_(sheet);
  for (var i = 0; i < displays.length; i++) {
    if (displays[i] !== '') continue;
    var row = i + 2;
    if (rowIsSafeForCreate_(sheet, row)) return row;
  }
  var next = sheet.getMaxRows() + 1;
  sheet.insertRowsAfter(sheet.getMaxRows(), 1);
  if (sheet.getMaxRows() < next || !rowIsSafeForCreate_(sheet, next)) {
    throw new Error('No safe row was available on NCR Database. Nothing was written.');
  }
  return next;
}

function rowSnapshot_(sheet, row, fromCol, toCol) {
  var parts = [];
  for (var col = fromCol; col <= toCol; col++) {
    var range = sheet.getRange(row, col);
    parts.push(String(range.getFormula() || '') + '|' + normalizeStored_(range.getValue()));
  }
  return parts.join('\n');
}

function normalizeStored_(value) {
  if (value == null) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, 'Europe/London', 'dd/MM/yyyy');
  }
  return String(value).trim();
}

function cellToIsoDate_(sheet, row, col) {
  var value = sheet.getRange(row, col).getValue();
  if (value == null || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, 'Europe/London', 'yyyy-MM-dd');
  }
  var text = String(value).trim();
  var uk = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (uk) return uk[3] + '-' + uk[2] + '-' + uk[1];
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return '';
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
  if (!sheet) throw new Error('Worksheet not found: ' + name + '. Nothing was written.');
  if (Number(sheet.getSheetId()) !== Number(gid)) {
    throw new Error('Worksheet "' + name + '" is not the expected tab. Nothing was written.');
  }
  return sheet;
}

function requireChoice_(value, options, message) {
  var text = String(value == null ? '' : value).trim();
  if (options.indexOf(text) === -1) return { ok: false, message: message };
  return { ok: true, value: text };
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

function combineBatches_(batches) {
  var list = batches;
  if (typeof list === 'string') {
    var trimmed = list.trim();
    if (!trimmed) list = [];
    else {
      try {
        var parsed = JSON.parse(trimmed);
        list = Array.isArray(parsed) ? parsed : [list];
      } catch (err) {
        list = [list];
      }
    }
  }
  if (!Array.isArray(list)) return { ok: false, message: 'Batch numbers could not be read.' };
  if (list.length > MAX_BATCHES) return { ok: false, message: 'Enter no more than ' + MAX_BATCHES + ' batch numbers.' };
  var cleaned = [];
  for (var i = 0; i < list.length; i++) {
    var item = String(list[i] == null ? '' : list[i]).trim();
    if (!item) continue;
    if (item.length > MAX_BATCH_LENGTH) return { ok: false, message: 'A batch number is too long.' };
    if (item.indexOf(',') !== -1) return { ok: false, message: 'Enter one batch number in each field, without commas.' };
    cleaned.push(item);
  }
  return { ok: true, value: cleaned.join(', ') };
}

function optionalIsoDate_(value, label) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return { ok: true, value: '' };
  var match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { ok: false, message: label + ' must be a valid date.' };
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  if (year < 2000 || year > 2100) return { ok: false, message: label + ' must be a valid date.' };
  var dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return { ok: false, message: label + ' must be a valid date.' };
  }
  var dd = day < 10 ? '0' + day : String(day);
  var mm = month < 10 ? '0' + month : String(month);
  return { ok: true, value: dd + '/' + mm + '/' + year };
}

function submissionIdOk_(id) {
  return /^[A-Za-z0-9-]{8,80}$/.test(String(id || '').trim());
}

function validateSection1_(data) {
  data = data || {};
  var submissionId = String(data.submissionId || '').trim();
  if (!submissionIdOk_(submissionId)) {
    return { ok: false, message: 'The report could not be identified. Reload the page and try again. Nothing was saved.' };
  }
  var priority = requireChoice_(data.priority, PRIORITIES, 'Select a priority.');
  if (!priority.ok) return priority;
  var reporter = requireChoice_(data.reporter, PEOPLE, 'Select the reporter.');
  if (!reporter.ok) return reporter;
  var category = requireChoice_(data.category, CATEGORIES, 'Select an issue category.');
  if (!category.ok) return category;
  var batches = combineBatches_(data.batches);
  if (!batches.ok) return batches;
  var description = requireText_(data.description, 'Describe the issue.', 'Description of Issue');
  if (!description.ok) return description;
  var involved = optionalText_(data.involved, 'Who was involved');
  if (!involved.ok) return involved;
  var happened = optionalText_(data.happened, 'What happened');
  if (!happened.ok) return happened;
  var whenOccurred = optionalText_(data.whenOccurred, 'When did it take place');
  if (!whenOccurred.ok) return whenOccurred;
  var whereOccurred = optionalText_(data.whereOccurred, 'Where did it take place');
  if (!whereOccurred.ok) return whereOccurred;
  var why = optionalText_(data.why, 'Why did it happen');
  if (!why.ok) return why;
  var remedial = optionalText_(data.remedial, 'Suggested Remedial Actions');
  if (!remedial.ok) return remedial;
  return {
    ok: true,
    value: {
      submissionId: submissionId,
      priority: priority.value,
      reporter: reporter.value,
      category: category.value,
      batchNumbers: batches.value,
      description: description.value,
      involved: involved.value,
      happened: happened.value,
      whenOccurred: whenOccurred.value,
      whereOccurred: whereOccurred.value,
      why: why.value,
      remedial: remedial.value
    }
  };
}

function validateSection2_(data) {
  data = data || {};
  var ncrNumber = String(data.ncrNumber || '').trim().toUpperCase();
  if (!NCR_NUMBER_RE.test(ncrNumber)) {
    return { ok: false, message: 'Enter a valid NCR number, such as NCR26-001.' };
  }
  var findings = optionalText_(data.findings, 'Findings of Investigation');
  if (!findings.ok) return findings;
  var correctiveActions = optionalText_(data.correctiveActions, 'Corrective Actions');
  if (!correctiveActions.ok) return correctiveActions;
  var correctiveDue = optionalIsoDate_(data.correctiveDue, 'Corrective action due date');
  if (!correctiveDue.ok) return correctiveDue;
  var correctiveComplete = optionalIsoDate_(data.correctiveComplete, 'Corrective action completed date');
  if (!correctiveComplete.ok) return correctiveComplete;
  var rootCause = optionalText_(data.rootCause, 'Root Cause');
  if (!rootCause.ok) return rootCause;
  var preventativeActions = optionalText_(data.preventativeActions, 'Preventative Actions');
  if (!preventativeActions.ok) return preventativeActions;
  var preventativeDue = optionalIsoDate_(data.preventativeDue, 'Preventative action due date');
  if (!preventativeDue.ok) return preventativeDue;
  var preventativeComplete = optionalIsoDate_(data.preventativeComplete, 'Preventative action completed date');
  if (!preventativeComplete.ok) return preventativeComplete;
  var ncrCompleted = optionalIsoDate_(data.ncrCompleted, 'NCR completed date');
  if (!ncrCompleted.ok) return ncrCompleted;
  var completedBy = String(data.completedBy == null ? '' : data.completedBy).trim();
  if (completedBy && PEOPLE.indexOf(completedBy) === -1) {
    return { ok: false, message: 'Select the manager who completed the NCR.' };
  }
  return {
    ok: true,
    value: {
      ncrNumber: ncrNumber,
      findings: findings.value,
      correctiveActions: correctiveActions.value,
      correctiveDue: correctiveDue.value,
      correctiveComplete: correctiveComplete.value,
      rootCause: rootCause.value,
      preventativeActions: preventativeActions.value,
      preventativeDue: preventativeDue.value,
      preventativeComplete: preventativeComplete.value,
      ncrCompleted: ncrCompleted.value,
      completedBy: completedBy
    }
  };
}

function fingerprint_(value) {
  var canonical = JSON.stringify({
    submissionId: value.submissionId,
    priority: value.priority,
    reporter: value.reporter,
    category: value.category,
    batchNumbers: value.batchNumbers,
    description: value.description,
    involved: value.involved,
    happened: value.happened,
    whenOccurred: value.whenOccurred,
    whereOccurred: value.whereOccurred,
    why: value.why,
    remedial: value.remedial
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
  var raw = props_().getProperty('NCR_SUB_' + submissionId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

function saveRecord_(submissionId, record) {
  record.at = Date.now();
  var props = props_();
  props.setProperty('NCR_SUB_' + submissionId, JSON.stringify(record));
  var index = [];
  try { index = JSON.parse(props.getProperty(SUBMISSION_INDEX_KEY) || '[]'); } catch (err) { index = []; }
  if (!Array.isArray(index)) index = [];
  index = index.filter(function (item) { return item !== submissionId; });
  index.push(submissionId);
  while (index.length > 100) {
    var oldId = index.shift();
    props.deleteProperty('NCR_SUB_' + oldId);
  }
  props.setProperty(SUBMISSION_INDEX_KEY, JSON.stringify(index));
}

function deleteRecord_(submissionId) {
  var props = props_();
  props.deleteProperty('NCR_SUB_' + submissionId);
  var index = [];
  try { index = JSON.parse(props.getProperty(SUBMISSION_INDEX_KEY) || '[]'); } catch (err) { index = []; }
  if (!Array.isArray(index)) index = [];
  props.setProperty(SUBMISSION_INDEX_KEY, JSON.stringify(index.filter(function (item) {
    return item !== submissionId;
  })));
}

function rememberedNumbers_() {
  var numbers = [];
  var index = [];
  try { index = JSON.parse(props_().getProperty(SUBMISSION_INDEX_KEY) || '[]'); } catch (err) { index = []; }
  if (!Array.isArray(index)) return numbers;
  for (var i = 0; i < index.length; i++) {
    var record = loadRecord_(index[i]);
    if (!record || !record.ncrNumber) continue;
    if (record.status === 'pending' || record.status === 'success' || record.status === 'partial') {
      numbers.push(String(record.ncrNumber));
    }
  }
  return numbers;
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
  if (typeof p.batches === 'string') {
    try {
      var batches = JSON.parse(p.batches);
      if (Array.isArray(batches)) p.batches = batches;
    } catch (err2) {}
  }
  return p;
}

function publicMessage_(err) {
  var text = String(err && err.message ? err.message : err || '');
  text = text.replace(/^Exception:\s*/, '');
  return text || 'The NCR could not be saved.';
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
