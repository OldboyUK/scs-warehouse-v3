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
 * A maintenance ID
 * B maintenance ID, a space, a bar, a space, then the descriptive title
 * C submission date
 * D signed-in user
 * E selected reporter
 * F line/area
 * G machine/equipment
 * H priority category
 * I descriptive title
 * J description
 * K parts
 * L Yes when a maintenance request is raised, No when the job is marked completed
 * M hyperlink to the Drive folder named with the maintenance ID
 * A review of an existing request writes only:
 * N signed-in user
 * O assigned owner
 * P department
 * Q due date
 * R permit to work, Yes or No
 * S food safety / health and safety assessment
 * Column T is never written. Columns A:M are not changed by a review.
 * Parts for an existing job are written on worksheet "Parts Requested":
 * A part ID, B part name, D purchaser, E supplier, F date ordered.
 * Column C is a formula and is never overwritten. A formula that displays
 * nothing does not make the row occupied. Receipt updates write only
 * F date ordered, G date arrived, H received by, I checked by, and J status.
 * That folder contains one subfolder named "[Maintenance ID] | Requests".
 * Photographs of the fault are uploaded there.
 * Completing an existing job writes only:
 * V permit to work number
 * W work undertaken
 * X work outstanding
 * Y Yes or No
 * Z Close Job, or the typed explanation when Other is chosen
 * AA hyperlink to the Drive subfolder "[Maintenance ID] | Work Undertaken"
 * Columns A:U are not changed. The primary job folder is not created again.
 * Photographs of the work are uploaded into that subfolder.
 * Check Job Status only reads the Submission Log. It shows column B and column AB
 * in the list, then the saved fault, review, parts summary and completion fields
 * for one row. Column AB is never written. Photographs are read from the
 * existing Requests and Work Undertaken folders and are not changed.
 * No column or header is added. A formula in column A that displays nothing
 * is an available ID cell.
 * Other formulas, the header row, and unrelated cells are left alone.
 *
 * This project must use GOOGLE SCRIPTS/maintenance-appsscript.json, not the
 * Warehouse manifest. The web app runs as the deploying account
 * (executeAs USER_DEPLOYING). That account must be an editor of the parent
 * Drive folder. oauthScopes must include https://www.googleapis.com/auth/drive.
 * drive.readonly can open a folder but cannot create job folders or upload
 * photographs. UrlFetchApp does not add that scope on its own.
 *
 * After pasting this file and the manifest, run authorizeMaintenanceDrive once
 * from the editor, allow the Drive prompt, then deploy a new web app version
 * (Execute as: Me, Who has access: Anyone). Anonymous web apps upload through
 * the Drive API with that account's token.
 */

var MAINTENANCE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/script.external_request'
];

var API_TOKEN = 'J4PAN88';
var SSID_MAINTENANCE = '1k0y2ieC4Sg5gYNOFLgcCxLNMUjImCdZNOJTBPg-V-KE';
var SHEET_SUBMISSIONS = 'Submission Log';
var SHEET_PARTS = 'Parts Requested';
var REVIEW_START_ROW = 3;
var REVIEW_FIRST_COL = 14;
var REVIEW_LAST_COL = 19;
var REVIEW_INDEX_KEY = 'REVIEW_SUBMISSION_INDEX';
var DEPARTMENTS = ['Quality', 'Engineering', 'Logistics', 'Management'];
var RECEIPT_STATUSES = ['As Described', 'Purchased Wrong Item', 'Received Wrong Item', 'Arrived Broken'];
var PARTS_INDEX_KEY = 'PARTS_SUBMISSION_INDEX';
var RECEIPT_INDEX_KEY = 'RECEIPT_SUBMISSION_INDEX';
var COMPLETE_INDEX_KEY = 'COMPLETE_SUBMISSION_INDEX';
var COMPLETE_FIRST_COL = 22;
var COMPLETE_LAST_COL = 26;
var COMPLETE_LINK_COL = 27;
var CLOSE_JOB = 'Close Job';
var STATUS_COL = 28;
var MAX_PARTS = 20;
var DROPDOWNS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT9wb05WXLcP4IN6Dce9zaRWtPKpGgHKWsqo4ICB97Mpr3RTx8MMFidwWgSf6ulh_sJNgE_2XxX3N2D/pub?gid=1056635412&single=true&output=csv';
var OTHER = 'Other';
var PRIORITY_OPTIONS = [
  { value: 'High Priority', label: 'High Priority - Urgent Risk to Safety of People or Food' },
  { value: 'Medium Priority', label: 'Medium Priority - A condition which must be addressed as it is likely to worsen, but does not pose an immediate risk' },
  { value: 'Low Priority', label: 'Low Priority - A condition which must be improved, but is not urgent' },
  { value: 'Stock Request', label: 'Stock Request - Used for requesting spare parts' },
  { value: 'Unsure', label: 'Unsure - Please Allocate the Priority for Me' }
];
var DRIVE_FAULT_PARENT = '1AMvZj3XOytmfdiWSIT-EQ7mH8FVQsBxs';
var LAST_DATA_COL = 13;
var MAX_PHOTOS = 10;
var MAX_PHOTO_CHARS = 5500000;
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
    if (action === 'fault_create' || action === 'fault_commit') return handleCreate_(p);
    if (action === 'fault_photo') return handlePhoto_(p);
    if (action === 'review_lists') return handleReviewLists_();
    if (action === 'review_save') return handleReviewSave_(p);
    if (action === 'parts_jobs') return handlePartsJobs_();
    if (action === 'parts_orders') return handlePartsOrders_(p);
    if (action === 'parts_add') return handlePartsAdd_(p);
    if (action === 'parts_receipt') return handlePartsReceipt_(p);
    if (action === 'complete_jobs') return handleCompleteJobs_();
    if (action === 'complete_detail') return handleCompleteDetail_(p);
    if (action === 'complete_prepare') return handleCompletePrepare_(p);
    if (action === 'complete_photo') return handleCompletePhoto_(p);
    if (action === 'complete_commit') return handleCompleteCommit_(p);
    if (action === 'status_jobs') return handleStatusJobs_();
    if (action === 'status_detail') return handleStatusDetail_(p);
    if (action === 'status_photo') return handleStatusPhoto_(p);
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
  var phase = value.photoNames.length && value.action !== 'fault_commit' ? 'prepare' : 'save';

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

  if (existing && existing.status === 'pending' && existing.rowWritten && existing.fingerprint !== fingerprint) {
    return json({
      result: 'error',
      retryable: false,
      maintenanceId: existing.maintenanceId || '',
      message: 'This submission is already in progress with different details. Nothing new was written.'
    });
  }

  var ss = SpreadsheetApp.openById(SSID_MAINTENANCE);
  var sheet = requireSheet_(ss);
  var maintenanceId;
  var submittedOn;
  var row;
  var photosUploaded;
  if (existing && existing.status === 'pending') {
    maintenanceId = existing.maintenanceId;
    submittedOn = existing.submittedOn;
    row = existing.row;
    photosUploaded = existing.photosUploaded || [];
    if (existing.fingerprint !== fingerprint && !existing.rowWritten) {
      photosUploaded = photosUploaded.filter(function (name) {
        return value.photoNames.indexOf(name) !== -1;
      });
    }
  } else {
    if (value.action === 'fault_commit') {
      return json({
        result: 'error',
        retryable: true,
        message: 'The photographs were not attached to this report. Submit the form again. Your answers are still here.'
      });
    }
    var allocated = nextMaintenanceId_(columnADisplays_(sheet).concat(rememberedIds_()));
    if (!allocated.ok) return json({ result: 'error', retryable: false, message: allocated.message });
    maintenanceId = allocated.maintenanceId;
    submittedOn = londonParts_(londonNow_()).uk;
    row = findCreateRow_(sheet);
    photosUploaded = [];
  }

  if (phase === 'save') {
    var missingPhoto = false;
    for (var p = 0; p < value.photoNames.length; p++) {
      if (photosUploaded.indexOf(value.photoNames[p]) === -1) missingPhoto = true;
    }
    if (missingPhoto) {
      saveRecord_(value.submissionId, pendingRecord_(value, fingerprint, maintenanceId, submittedOn, row, photosUploaded, false));
      return json({
        result: 'error',
        retryable: true,
        maintenanceId: maintenanceId,
        message: 'Not every photograph was uploaded, so the report was not saved. Your answers are still here.'
      });
    }
  }

  var folders;
  try {
    folders = ensureJobFolders_(maintenanceId);
  } catch (err) {
    saveRecord_(value.submissionId, pendingRecord_(value, fingerprint, maintenanceId, submittedOn, row, photosUploaded, false));
    return json({
      result: 'error',
      retryable: true,
      maintenanceId: maintenanceId,
      message: 'The job folder was not created, so the report was not saved. ' + publicMessage_(err) + ' Your answers are still here.'
    });
  }

  saveRecord_(value.submissionId, pendingRecord_(value, fingerprint, maintenanceId, submittedOn, row, photosUploaded, false));
  if (phase === 'prepare') {
    return json({
      result: 'pending',
      retryable: true,
      maintenanceId: maintenanceId,
      submittedOn: submittedOn,
      folderUrl: folders.jobUrl
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
  else if (!rowIsSafeForCreate_(sheet, row)) row = findCreateRow_(sheet);

  var cells = faultCells_(maintenanceId, submittedOn, value, folders.jobUrl);
  var written = [];
  try {
    alignFault_(sheet, row, cells, written);
    SpreadsheetApp.flush();
    verifyTextCells_(sheet, row, cells);
    if (findIdRows_(sheet, maintenanceId).length !== 1) {
      throw new Error('The maintenance ID could not be confirmed.');
    }
    var success = {
      result: 'success',
      maintenanceId: maintenanceId,
      submittedOn: submittedOn,
      folderUrl: folders.jobUrl
    };
    saveRecord_(value.submissionId, {
      status: 'success',
      fingerprint: fingerprint,
      maintenanceId: maintenanceId,
      submittedOn: submittedOn,
      row: row,
      rowWritten: true,
      photosExpected: value.photoNames,
      photosUploaded: photosUploaded,
      folderUrl: folders.jobUrl,
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
        rowWritten: onSheet.length > 0,
        photosExpected: value.photoNames,
        photosUploaded: photosUploaded,
        folderUrl: folders.jobUrl,
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

function pendingRecord_(value, fingerprint, maintenanceId, submittedOn, row, photosUploaded, rowWritten) {
  return {
    status: 'pending',
    fingerprint: fingerprint,
    maintenanceId: maintenanceId,
    submittedOn: submittedOn,
    row: row,
    rowWritten: rowWritten,
    photosExpected: value.photoNames,
    photosUploaded: photosUploaded || []
  };
}

function handlePhoto_(p) {
  var submissionId = String(p.submissionId || '').trim();
  if (!submissionIdOk_(submissionId)) {
    return json({ result: 'error', retryable: true, message: 'The report could not be identified. Reload the page and try again. Nothing was saved.' });
  }
  var fileName = String(p.fileName || '').trim().toLowerCase();
  if (!/^fault-\d{2}\.(jpg|jpeg|png|webp)$/.test(fileName)) {
    return json({ result: 'error', retryable: true, message: 'That photograph could not be accepted. Your answers are still here.' });
  }
  var image = cleanPhoto_(p.imageBase64);
  if (!image.ok) return json({ result: 'error', retryable: true, message: image.message });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return json({
      result: 'error',
      retryable: true,
      message: 'Another fault report is being saved. Wait a moment and try again. Your answers are still here.'
    });
  }
  try {
    var record = loadRecord_(submissionId);
    if (!record || (record.status !== 'pending' && record.status !== 'success')) {
      return json({ result: 'error', retryable: true, message: 'Submit the fault report before uploading photographs. Your answers are still here.' });
    }
    if (record.status === 'success') {
      if ((record.photosUploaded || []).indexOf(fileName) !== -1) return json({ result: 'ok', fileName: fileName, maintenanceId: record.maintenanceId });
      return json({ result: 'error', retryable: false, maintenanceId: record.maintenanceId, message: 'This report was already saved as ' + record.maintenanceId + '. The photograph was not added.' });
    }
    if ((record.photosExpected || []).indexOf(fileName) === -1) {
      return json({ result: 'error', retryable: true, message: 'That photograph is not part of this report. Your answers are still here.' });
    }
    var folders = ensureJobFolders_(record.maintenanceId);
    uploadFaultPhoto_(folders.requestsId, fileName, image.value, p.mimeType);
    var uploaded = record.photosUploaded || [];
    if (uploaded.indexOf(fileName) === -1) uploaded.push(fileName);
    record.photosUploaded = uploaded;
    record.folderUrl = folders.jobUrl;
    saveRecord_(submissionId, record);
    return json({ result: 'ok', fileName: fileName, maintenanceId: record.maintenanceId });
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The photograph was not uploaded. ' + publicMessage_(err) + ' Your answers are still here.'
    });
  } finally {
    lock.releaseLock();
  }
}

function faultCells_(maintenanceId, submittedOn, value, folderUrl) {
  var link = '=HYPERLINK("' + folderUrl + '","' + maintenanceId + '")';
  return [
    { col: 1, value: maintenanceId },
    { col: 2, value: maintenanceId + ' | ' + value.title },
    { col: 3, value: submittedOn },
    { col: 4, value: value.user },
    { col: 5, value: value.reporter },
    { col: 6, value: value.lineArea },
    { col: 7, value: value.equipment },
    { col: 8, value: value.priority },
    { col: 9, value: value.title },
    { col: 10, value: value.description },
    { col: 11, value: value.parts },
    { col: 12, value: value.maintenanceRequest },
    { col: 13, value: maintenanceId, formula: link }
  ];
}

function isRecordCol_(col) {
  return col >= 1 && col <= LAST_DATA_COL;
}

function isReviewCol_(col) {
  return col >= REVIEW_FIRST_COL && col <= REVIEW_LAST_COL;
}

function alignFault_(sheet, row, cells, written) {
  if (row < 2) throw new Error('Refusing to write on the header row.');
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
    if (!isRecordCol_(cell.col)) {
      throw new Error('Refusing to write outside the maintenance record.');
    }
    var range = sheet.getRange(row, cell.col);
    var formula = String(range.getFormula() || '');
    var expected = cell.value == null ? '' : String(cell.value);
    var currentText = normalizeStored_(range.getValue());
    if (cell.formula) {
      if (formula === cell.formula) continue;
      if (formula.trim() !== '' || currentText !== '') {
        var linkErr = new Error('Row ' + row + ' already has different data in column ' + columnLetter_(cell.col) + '. It was not overwritten.');
        linkErr.conflict = true;
        throw linkErr;
      }
      writeFormulaCell_(sheet, row, cell.col, cell.formula, written);
      continue;
    }
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

function verifyTextCells_(sheet, row, cells) {
  for (var i = 0; i < cells.length; i++) {
    var range = sheet.getRange(row, cells[i].col);
    if (cells[i].formula) {
      if (String(range.getFormula() || '') !== cells[i].formula) {
        throw new Error('Saved cells on row ' + row + ' could not be confirmed.');
      }
      continue;
    }
    var expected = cells[i].value == null ? '' : String(cells[i].value);
    if (String(range.getFormula() || '').trim() !== '') {
      throw new Error('Saved cells on row ' + row + ' could not be confirmed.');
    }
    if (normalizeStored_(range.getValue()) !== expected) {
      throw new Error('Saved cells on row ' + row + ' could not be confirmed.');
    }
  }
}

function writeFormulaCell_(sheet, row, col, formula, written) {
  if (row < 2) throw new Error('Refusing to write on the header row.');
  if (!isRecordCol_(col)) throw new Error('Refusing to write outside the maintenance record.');
  var range = sheet.getRange(row, col);
  written.push({
    sheet: sheet,
    row: row,
    col: col,
    formula: String(range.getFormula() || ''),
    value: range.getValue(),
    format: range.getNumberFormat()
  });
  range.setFormula(formula);
}

function writeTextCell_(sheet, row, col, value, written) {
  if (row < 2) throw new Error('Refusing to write on the header row.');
  if (!isRecordCol_(col) && !isReviewCol_(col)) {
    throw new Error('Refusing to write outside the maintenance record.');
  }
  if (isReviewCol_(col) && row < REVIEW_START_ROW) {
    throw new Error('Refusing to write above the maintenance requests.');
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

function rowIsSafeForCreate_(sheet, row) {
  if (row < 2 || row > sheet.getMaxRows()) return false;
  if (columnADisplay_(sheet, row) !== '') return false;
  var aFormula = String(sheet.getRange(row, 1).getFormula() || '');
  if (aFormula.toUpperCase().replace(/\s/g, '').indexOf('ARRAYFORMULA(') !== -1) return false;
  for (var col = 2; col <= LAST_DATA_COL; col++) {
    var range = sheet.getRange(row, col);
    if (String(range.getFormula() || '').trim() !== '') return false;
    if (normalizeStored_(range.getValue()) !== '') return false;
  }
  return true;
}

function columnADisplay_(sheet, row) {
  if (row < 2) return '';
  return String(sheet.getRange(row, 1).getDisplayValue() || '').trim();
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
    throw new Error('No safe row was available on Submission Log. Nothing was written.');
  }
  return next;
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

function photoNames_(data) {
  var raw = data.photoNames;
  if (typeof raw === 'string') {
    if (!String(raw).trim()) raw = [];
    else {
      try { raw = JSON.parse(raw); } catch (err) { raw = null; }
    }
  }
  if (!raw) raw = [];
  if (Object.prototype.toString.call(raw) !== '[object Array]') {
    return { ok: false, message: 'The photographs could not be read. Nothing was saved.' };
  }
  if (raw.length > MAX_PHOTOS) return { ok: false, message: 'You can attach up to 10 photographs.' };
  var names = [];
  var seen = {};
  for (var i = 0; i < raw.length; i++) {
    var name = String(raw[i] || '').trim().toLowerCase();
    if (!/^fault-\d{2}\.(jpg|jpeg|png|webp)$/.test(name)) {
      return { ok: false, message: 'One of the photographs could not be accepted. Nothing was saved.' };
    }
    if (seen[name]) return { ok: false, message: 'Photograph names must be unique. Nothing was saved.' };
    seen[name] = true;
    names.push(name);
  }
  return { ok: true, value: names };
}

function cleanPhoto_(imageBase64) {
  var text = imageBase64 == null ? '' : String(imageBase64);
  var prefix = text.indexOf('base64,');
  if (prefix !== -1) text = text.substring(prefix + 7);
  text = text.replace(/\s/g, '');
  if (!text) return { ok: false, message: 'The photograph was empty. Your answers are still here.' };
  if (text.length > MAX_PHOTO_CHARS) {
    return { ok: false, message: 'A photograph is too large. Remove it and take it again. Your answers are still here.' };
  }
  return { ok: true, value: text };
}

function reportPeople_(data, lists) {
  var mode = String(data.reporterMode || '').trim().toLowerCase();
  if (mode !== 'self' && mode !== 'other') return { ok: false, message: 'Choose Self or Another Operator.' };
  var user = namedText_(data.user, 'The signed-in user is missing. Nothing was saved.', 'The user name');
  if (!user.ok) return user;
  var reporter = user.value;
  if (mode === 'other') {
    var chosen = namedText_(data.reporter, 'Select an operator from the list.', 'The reporter name');
    if (!chosen.ok) return chosen;
    if (lists.operators.indexOf(chosen.value) === -1) {
      return { ok: false, message: 'Select an operator from the list.' };
    }
    reporter = chosen.value;
  }
  return { ok: true, reporterMode: mode, user: user.value, reporter: reporter };
}

function validateFault_(data, lists) {
  data = data || {};
  lists = lists || { operators: [], areas: [], equipmentByArea: {} };
  var submissionId = String(data.submissionId || '').trim();
  if (!submissionIdOk_(submissionId)) {
    return { ok: false, message: 'The report could not be identified. Reload the page and try again. Nothing was saved.' };
  }
  var people = reportPeople_(data, lists);
  if (!people.ok) return people;
  var title = namedText_(data.title, 'Enter a short title for the fault or unsafe condition.', 'The title');
  if (!title.ok) return title;
  var photos = photoNames_(data);
  if (!photos.ok) return photos;

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
    return { ok: false, message: 'Choose whether to mark the job as completed or raise a maintenance request.' };
  }

  return {
    ok: true,
    value: {
      submissionId: submissionId,
      action: String(data.action || 'fault_create').trim().toLowerCase(),
      reporterMode: people.reporterMode,
      user: people.user,
      reporter: people.reporter,
      title: title.value,
      photoNames: photos.value,
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
    user: value.user,
    reporter: value.reporter,
    title: value.title,
    photoNames: value.photoNames,
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

function authorizeMaintenanceDrive() {
  if (ScriptApp.requireScopes) {
    ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, MAINTENANCE_SCOPES);
  }
  var parent = DriveApp.getFolderById(DRIVE_FAULT_PARENT);
  var probeName = '_maintenance_auth_probe_' + new Date().getTime();
  var probe = parent.createFolder(probeName);
  try {
    var listed = driveFoldersNamed_(DRIVE_FAULT_PARENT, probeName);
    if (!listed.length) {
      throw new Error('The Drive API could not see the test folder just created in the Maintenance parent.');
    }
  } catch (err) {
    throw new Error(
      'Drive authorisation is incomplete. Paste maintenance-appsscript.json so this project requests https://www.googleapis.com/auth/drive, then run this function again as the account that edits the parent folder. ' +
      publicMessage_(err)
    );
  } finally {
    probe.setTrashed(true);
  }
  Logger.log('Maintenance Drive OK. Parent: ' + parent.getName() + '. This account can create folders there. Deploy a new web app version before testing a report.');
}

function ensureJobFolders_(maintenanceId) {
  DriveApp.getFolderById(DRIVE_FAULT_PARENT);
  var job = driveEnsureFolder_(DRIVE_FAULT_PARENT, maintenanceId);
  var requests = driveEnsureFolder_(job.id, maintenanceId + ' | Requests');
  return {
    jobId: job.id,
    requestsId: requests.id,
    jobUrl: 'https://drive.google.com/drive/folders/' + job.id
  };
}

function driveEnsureFolder_(parentId, name) {
  var found = driveFoldersNamed_(parentId, name);
  if (found.length > 1) throw new Error('More than one Drive folder is named ' + name + '.');
  if (found.length === 1) return found[0];
  return driveFetch_('post', 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name', {
    name: name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId]
  });
}

function driveFoldersNamed_(parentId, name) {
  var data = driveFetch_('get', driveListUrl_(parentId, name));
  var files = data.files || [];
  var folders = [];
  for (var i = 0; i < files.length; i++) {
    if (files[i].mimeType === 'application/vnd.google-apps.folder' && files[i].name === name) folders.push(files[i]);
  }
  return folders;
}

function driveFilesNamed_(parentId, name) {
  var data = driveFetch_('get', driveListUrl_(parentId, name));
  var files = data.files || [];
  var found = [];
  for (var i = 0; i < files.length; i++) {
    if (files[i].mimeType !== 'application/vnd.google-apps.folder' && files[i].name === name) found.push(files[i]);
  }
  return found;
}

function driveListUrl_(parentId, name) {
  var q = "trashed = false and name = '" + String(name).replace(/'/g, "\\'") + "' and '" + parentId + "' in parents";
  return 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType)&pageSize=10&q=' + encodeURIComponent(q);
}

function driveFetch_(method, url, payload) {
  var options = {
    method: method,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (payload != null) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  var resp = UrlFetchApp.fetch(url, options);
  var code = resp.getResponseCode();
  var text = resp.getContentText() || '';
  if (code < 200 || code >= 300) {
    throw new Error('Google Drive did not accept the request (' + code + ').');
  }
  if (!text) return {};
  return JSON.parse(text);
}

function uploadFaultPhoto_(folderId, fileName, base64, mimeType) {
  var existing = driveFilesNamed_(folderId, fileName);
  if (existing.length > 1) throw new Error('More than one file is named ' + fileName + '.');
  if (existing.length === 1) return existing[0];
  var mime = mimeType && String(mimeType).indexOf('image/') === 0 ? String(mimeType) : 'image/jpeg';
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, fileName);
  return createDriveFileInFolder_(folderId, blob, fileName);
}

function createDriveFileInFolder_(folderId, blob, fileName) {
  var boundary = 'xxxxxxx314159xxxx';
  var mimeType = blob.getContentType() || 'application/octet-stream';
  var metadata = { name: fileName, parents: [folderId] };
  var body =
    '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: ' + mimeType + '\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    Utilities.base64Encode(blob.getBytes()) + '\r\n' +
    '--' + boundary + '--';
  var resp = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name',
    {
      method: 'post',
      contentType: 'multipart/related; boundary=' + boundary,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: body,
      muteHttpExceptions: true
    }
  );
  var code = resp.getResponseCode();
  var text = resp.getContentText() || '';
  if (code < 200 || code >= 300) throw new Error('The photograph was not saved to Drive (' + code + ').');
  return JSON.parse(text);
}

function handleReviewLists_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return json({ result: 'error', retryable: true, message: 'The maintenance list is busy. Wait a moment and try again.' });
  }
  try {
    return json({ result: 'ok', requests: reviewRequests_(), owners: dropdownOwners_() });
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The maintenance requests could not be loaded. ' + publicMessage_(err)
    });
  } finally {
    lock.releaseLock();
  }
}

function handleReviewSave_(p) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return json({
      result: 'error',
      retryable: true,
      message: 'Another maintenance update is being saved. Wait a moment and try again. Your answers are still here.'
    });
  }
  try {
    var owners = dropdownOwners_();
    var validated = validateReview_(p, owners);
    if (!validated.ok) return json({ result: 'error', retryable: true, message: validated.message });
    return saveReview_(validated.value);
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The review was not saved. ' + publicMessage_(err) + ' Your answers are still here.'
    });
  } finally {
    lock.releaseLock();
  }
}

function reviewRequests_() {
  var sheet = requireSheet_(SpreadsheetApp.openById(SSID_MAINTENANCE));
  var maxRows = sheet.getMaxRows();
  if (maxRows < REVIEW_START_ROW) return [];
  var height = maxRows - REVIEW_START_ROW + 1;
  var ids = sheet.getRange(REVIEW_START_ROW, 1, height, 1).getDisplayValues();
  var labels = sheet.getRange(REVIEW_START_ROW, 2, height, 1).getDisplayValues();
  var grouped = {};
  var order = [];
  for (var i = 0; i < labels.length; i++) {
    var label = String(labels[i][0] == null ? '' : labels[i][0]).trim();
    if (!label) continue;
    var id = String(ids[i][0] == null ? '' : ids[i][0]).trim().toUpperCase();
    if (!grouped[label]) {
      grouped[label] = { label: label, maintenanceId: id, row: i + REVIEW_START_ROW, count: 0, mismatch: false };
      order.push(label);
    }
    grouped[label].count++;
    if (grouped[label].maintenanceId !== id) grouped[label].mismatch = true;
  }
  var requests = [];
  for (var n = 0; n < order.length; n++) {
    var item = grouped[order[n]];
    requests.push({
      label: item.label,
      maintenanceId: item.maintenanceId,
      row: item.count === 1 && !item.mismatch ? item.row : 0,
      duplicate: item.count > 1 || item.mismatch
    });
  }
  return requests;
}

function dropdownOwners_() {
  return loadLists_().operators;
}

function reviewDepartment_(data) {
  var choice = String(data.department || '').trim();
  if (choice === OTHER) {
    return namedText_(data.departmentOther, 'Enter the department.', 'The department');
  }
  if (DEPARTMENTS.indexOf(choice) === -1) {
    return { ok: false, message: 'Select a department. Nothing was saved.' };
  }
  return { ok: true, value: choice };
}

function labelId_(label) {
  var text = String(label || '').trim();
  var cut = text.indexOf(' | ');
  if (cut < 0) return '';
  var id = text.slice(0, cut).trim().toUpperCase();
  if (!MAINTENANCE_ID_RE.test(id)) return '';
  if (!text.slice(cut + 3).trim()) return '';
  return id;
}

function reviewDueDate_(value) {
  var text = String(value || '').trim();
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  if (year < 2000 || year > 2100) return null;
  var probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function preserveText_(value, emptyMessage, label) {
  var text = String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!String(text).trim()) return { ok: false, message: emptyMessage };
  if (text.length > MAX_TEXT) return { ok: false, message: label + ' is too long.' };
  return { ok: true, value: text };
}

function validateReview_(data, owners) {
  data = data || {};
  owners = owners || [];
  var submissionId = String(data.submissionId || '').trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(submissionId)) {
    return { ok: false, message: 'The review could not be identified. Reload the page and try again. Nothing was saved.' };
  }
  var user = namedText_(data.user, 'The signed-in user is missing. Nothing was saved.', 'The user name');
  if (!user.ok) return user;
  var label = String(data.label == null ? '' : data.label).trim();
  var maintenanceId = String(data.maintenanceId || '').trim().toUpperCase();
  var prefix = labelId_(label);
  if (!prefix || prefix !== maintenanceId) {
    return { ok: false, message: 'Select a maintenance request. Nothing was saved.' };
  }
  var owner = namedText_(data.owner, 'Select an owner for this job.', 'The owner');
  if (!owner.ok) return owner;
  if (owners.indexOf(owner.value) === -1) {
    return { ok: false, message: 'Select an owner from the list. Nothing was saved.' };
  }
  var department = reviewDepartment_(data);
  if (!department.ok) return department;
  var due = reviewDueDate_(data.dueDate);
  if (!due) return { ok: false, message: 'Enter a valid due date. Nothing was saved.' };
  var permit = String(data.permit || '').trim();
  if (permit !== 'Yes' && permit !== 'No') {
    return { ok: false, message: 'Choose whether a permit to work is required. Nothing was saved.' };
  }
  var assessment = preserveText_(data.assessment, 'Assess the impact to Food Safety or Health and Safety.', 'The assessment');
  if (!assessment.ok) return assessment;
  return {
    ok: true,
    value: {
      submissionId: submissionId,
      user: user.value,
      label: label,
      maintenanceId: maintenanceId,
      owner: owner.value,
      department: department.value,
      dueDate: String(data.dueDate).trim(),
      permit: permit,
      assessment: assessment.value
    }
  };
}

function findReviewRow_(sheet, maintenanceId, label) {
  var maxRows = sheet.getMaxRows();
  if (maxRows < REVIEW_START_ROW) {
    return { ok: false, message: 'That maintenance request is no longer on the Submission Log. Select it again. Nothing was written.' };
  }
  var height = maxRows - REVIEW_START_ROW + 1;
  var ids = sheet.getRange(REVIEW_START_ROW, 1, height, 1).getDisplayValues();
  var labels = sheet.getRange(REVIEW_START_ROW, 2, height, 1).getDisplayValues();
  var matches = [];
  for (var i = 0; i < labels.length; i++) {
    var cellLabel = String(labels[i][0] == null ? '' : labels[i][0]).trim();
    if (cellLabel !== label) continue;
    matches.push({
      row: i + REVIEW_START_ROW,
      id: String(ids[i][0] == null ? '' : ids[i][0]).trim().toUpperCase()
    });
  }
  if (!matches.length) {
    return { ok: false, message: 'That maintenance request is no longer on the Submission Log. Select it again. Nothing was written.' };
  }
  if (matches.length > 1) {
    return { ok: false, message: 'That maintenance request appears more than once. Nothing was written.' };
  }
  if (matches[0].id !== maintenanceId) {
    return { ok: false, message: 'The selected request no longer matches ' + maintenanceId + '. Nothing was written.' };
  }
  return { ok: true, row: matches[0].row };
}

function reviewFingerprint_(value) {
  var canonical = JSON.stringify({
    submissionId: value.submissionId,
    user: value.user,
    label: value.label,
    maintenanceId: value.maintenanceId,
    owner: value.owner,
    department: value.department,
    dueDate: value.dueDate,
    permit: value.permit,
    assessment: value.assessment
  });
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < digest.length; i++) {
    var b = digest[i] < 0 ? digest[i] + 256 : digest[i];
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function loadReview_(submissionId) {
  var raw = props_().getProperty('REVIEW_SUB_' + submissionId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

function saveReviewRecord_(submissionId, record) {
  record.at = Date.now();
  var props = props_();
  props.setProperty('REVIEW_SUB_' + submissionId, JSON.stringify(record));
  var index = [];
  try { index = JSON.parse(props.getProperty(REVIEW_INDEX_KEY) || '[]'); } catch (err) { index = []; }
  if (!Array.isArray(index)) index = [];
  index = index.filter(function (item) { return item !== submissionId; });
  index.push(submissionId);
  while (index.length > 100) {
    var oldId = index.shift();
    props.deleteProperty('REVIEW_SUB_' + oldId);
  }
  props.setProperty(REVIEW_INDEX_KEY, JSON.stringify(index));
}

function cellToken_(value) {
  if (value == null) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return 'd:' + value.getTime();
  }
  return 'v:' + String(value);
}

function snapshotCols_(sheet, row, cols) {
  var out = [];
  for (var i = 0; i < cols.length; i++) {
    var range = sheet.getRange(row, cols[i]);
    out.push({
      col: cols[i],
      formula: String(range.getFormula() || ''),
      token: cellToken_(range.getValue())
    });
  }
  return out;
}

function sameSnapshot_(sheet, row, snap) {
  for (var i = 0; i < snap.length; i++) {
    var range = sheet.getRange(row, snap[i].col);
    if (String(range.getFormula() || '') !== snap[i].formula) return false;
    if (cellToken_(range.getValue()) !== snap[i].token) return false;
  }
  return true;
}

function protectedReviewCols_() {
  var cols = [];
  var col;
  for (col = 1; col <= LAST_DATA_COL; col++) cols.push(col);
  cols.push(20);
  return cols;
}

function applyReviewCells_(sheet, row, cells, written) {
  if (row < REVIEW_START_ROW) throw new Error('Refusing to write above the maintenance requests.');
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
    if (!isReviewCol_(cell.col)) throw new Error('Refusing to write outside columns N to S.');
    var range = sheet.getRange(row, cell.col);
    var formula = String(range.getFormula() || '');
    if (formula.trim() !== '') {
      throw new Error('Column ' + columnLetter_(cell.col) + ' contains a formula. It was not overwritten.');
    }
    if (cell.date) {
      var currentUk = '';
      var current = range.getValue();
      if (Object.prototype.toString.call(current) === '[object Date]' && !isNaN(current.getTime())) {
        currentUk = Utilities.formatDate(current, 'Europe/London', 'dd/MM/yyyy');
      }
      if (currentUk === cell.uk) continue;
      writeDateCell_(sheet, row, cell.col, cell.date, written);
      continue;
    }
    var expected = String(cell.value);
    var currentText = range.getValue();
    if (currentText == null) currentText = '';
    if (String(currentText) === expected) continue;
    writeTextCell_(sheet, row, cell.col, expected, written);
  }
}

function verifyReviewCells_(sheet, row, cells) {
  for (var i = 0; i < cells.length; i++) {
    var range = sheet.getRange(row, cells[i].col);
    if (String(range.getFormula() || '').trim() !== '') {
      throw new Error('Saved review cells on row ' + row + ' could not be confirmed.');
    }
    if (cells[i].date) {
      var current = range.getValue();
      if (Object.prototype.toString.call(current) !== '[object Date]' || isNaN(current.getTime())) {
        throw new Error('The due date on row ' + row + ' could not be confirmed.');
      }
      if (Utilities.formatDate(current, 'Europe/London', 'dd/MM/yyyy') !== cells[i].uk) {
        throw new Error('The due date on row ' + row + ' could not be confirmed.');
      }
      continue;
    }
    if (String(range.getValue() == null ? '' : range.getValue()) !== String(cells[i].value)) {
      throw new Error('Saved review cells on row ' + row + ' could not be confirmed.');
    }
  }
}

function writeDateCell_(sheet, row, col, date, written) {
  if (row < REVIEW_START_ROW) throw new Error('Refusing to write above the maintenance requests.');
  if (col !== 17) throw new Error('Refusing to write outside the review.');
  var range = sheet.getRange(row, col);
  var formula = String(range.getFormula() || '');
  if (formula.toUpperCase().replace(/\s/g, '').indexOf('ARRAYFORMULA(') !== -1) {
    throw new Error('Column Q contains an array formula. Nothing was overwritten.');
  }
  written.push({
    sheet: sheet,
    row: row,
    col: col,
    formula: formula,
    value: range.getValue(),
    format: range.getNumberFormat()
  });
  range.setNumberFormat('dd/MM/yyyy');
  range.setValue(date);
}

function saveReview_(value) {
  var fingerprint = reviewFingerprint_(value);
  var existing = loadReview_(value.submissionId);
  if (existing && existing.status === 'success') {
    if (existing.fingerprint !== fingerprint) {
      return json({
        result: 'error',
        retryable: false,
        maintenanceId: existing.maintenanceId,
        message: 'This review was already saved for ' + existing.maintenanceId + '. It was not changed.'
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
      message: 'This review was not fully saved. Check the maintenance record before writing anything else.'
    });
  }
  if (dropdownOwners_().indexOf(value.owner) === -1) {
    return json({ result: 'error', retryable: true, message: 'Select an owner from the list. Nothing was saved.' });
  }
  var sheet = requireSheet_(SpreadsheetApp.openById(SSID_MAINTENANCE));
  var found = findReviewRow_(sheet, value.maintenanceId, value.label);
  if (!found.ok) return json({ result: 'error', retryable: true, message: found.message });
  var before = snapshotCols_(sheet, found.row, protectedReviewCols_());
  var due = reviewDueDate_(value.dueDate);
  if (!due) return json({ result: 'error', retryable: true, message: 'Enter a valid due date. Nothing was saved.' });
  var uk = Utilities.formatDate(due, 'Europe/London', 'dd/MM/yyyy');
  var cells = [
    { col: 14, value: value.user },
    { col: 15, value: value.owner },
    { col: 16, value: value.department },
    { col: 17, date: due, uk: uk },
    { col: 18, value: value.permit },
    { col: 19, value: value.assessment }
  ];
  var written = [];
  try {
    applyReviewCells_(sheet, found.row, cells, written);
    verifyReviewCells_(sheet, found.row, cells);
    if (!sameSnapshot_(sheet, found.row, before)) {
      throw new Error('Columns outside the review changed. The review was not kept.');
    }
  } catch (err) {
    var failed = rollbackWritten_(written);
    if (failed.length || !sameSnapshot_(sheet, found.row, before)) {
      saveReviewRecord_(value.submissionId, {
        status: 'partial',
        fingerprint: fingerprint,
        maintenanceId: value.maintenanceId,
        result: {
          result: 'error',
          partial: true,
          retryable: false,
          maintenanceId: value.maintenanceId,
          message: 'The review may be incomplete on row ' + found.row + '. Check that record before trying again.'
        }
      });
      return json({
        result: 'error',
        partial: true,
        retryable: false,
        maintenanceId: value.maintenanceId,
        message: 'The review may be incomplete. Check ' + value.maintenanceId + ' before trying again.'
      });
    }
    return json({
      result: 'error',
      retryable: true,
      message: publicMessage_(err) + ' Your answers are still here.'
    });
  }
  var result = {
    result: 'success',
    maintenanceId: value.maintenanceId,
    label: value.label,
    row: found.row,
    dueOn: uk
  };
  saveReviewRecord_(value.submissionId, {
    status: 'success',
    fingerprint: fingerprint,
    maintenanceId: value.maintenanceId,
    result: result
  });
  return json(result);
}

function handlePartsJobs_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return json({ result: 'error', retryable: true, message: 'The maintenance list is busy. Wait a moment and try again.' });
  }
  try {
    return json({ result: 'ok', requests: reviewRequests_(), people: dropdownOwners_() });
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The maintenance jobs could not be loaded. ' + publicMessage_(err)
    });
  } finally {
    lock.releaseLock();
  }
}

function handlePartsOrders_(p) {
  var maintenanceId = String(p.maintenanceId || '').trim().toUpperCase();
  if (!MAINTENANCE_ID_RE.test(maintenanceId)) {
    return json({ result: 'error', retryable: true, message: 'Select a maintenance job.' });
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return json({ result: 'error', retryable: true, message: 'The parts list is busy. Wait a moment and try again.' });
  }
  try {
    if (!jobExists_(maintenanceId)) {
      return json({ result: 'error', retryable: true, message: 'That maintenance job is not on the Submission Log.' });
    }
    return json({ result: 'ok', maintenanceId: maintenanceId, orders: partsForJob_(maintenanceId) });
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The current orders could not be loaded. ' + publicMessage_(err)
    });
  } finally {
    lock.releaseLock();
  }
}

function handlePartsAdd_(p) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return json({
      result: 'error',
      retryable: true,
      message: 'Another parts order is being saved. Wait a moment and try again. Your answers are still here.'
    });
  }
  try {
    var people = dropdownOwners_();
    var validated = validatePartsAdd_(p, people);
    if (!validated.ok) return json({ result: 'error', retryable: true, message: validated.message });
    return saveParts_(validated.value);
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The parts were not saved. ' + publicMessage_(err) + ' Your answers are still here.'
    });
  } finally {
    lock.releaseLock();
  }
}

function handlePartsReceipt_(p) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return json({
      result: 'error',
      retryable: true,
      message: 'Another parts update is being saved. Wait a moment and try again. Your answers are still here.'
    });
  }
  try {
    var validated = validatePartsReceipt_(p);
    if (!validated.ok) return json({ result: 'error', retryable: true, message: validated.message });
    var people = dropdownOwners_();
    return saveReceipt_(validated.value, people);
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The receipt was not saved. ' + publicMessage_(err) + ' Your answers are still here.'
    });
  } finally {
    lock.releaseLock();
  }
}

function requirePartsSheet_(ss) {
  var sheet = ss.getSheetByName(SHEET_PARTS);
  if (!sheet || sheet.getName() !== SHEET_PARTS) {
    throw new Error('Worksheet not found: ' + SHEET_PARTS + '. Nothing was written.');
  }
  return sheet;
}

function jobExists_(maintenanceId) {
  var sheet = requireSheet_(SpreadsheetApp.openById(SSID_MAINTENANCE));
  var maxRows = sheet.getMaxRows();
  if (maxRows < REVIEW_START_ROW) return false;
  var height = maxRows - REVIEW_START_ROW + 1;
  var ids = sheet.getRange(REVIEW_START_ROW, 1, height, 1).getDisplayValues();
  var wanted = String(maintenanceId || '').trim().toUpperCase();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] == null ? '' : ids[i][0]).trim().toUpperCase() === wanted) return true;
  }
  return false;
}

function cellBlank_(value) {
  if (value == null) return true;
  if (Object.prototype.toString.call(value) === '[object Date]') return isNaN(value.getTime());
  return String(value).trim() === '';
}

function partsValues_(sheet) {
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) return [];
  return sheet.getRange(2, 1, maxRows - 1, 10).getValues();
}

function nextPartIds_(existingIds, maintenanceId, count) {
  var id = String(maintenanceId || '').trim().toUpperCase();
  var re = new RegExp('^' + id + '-P(\\d+)$', 'i');
  var max = 0;
  var seen = {};
  for (var i = 0; i < existingIds.length; i++) {
    var match = re.exec(String(existingIds[i] == null ? '' : existingIds[i]).trim());
    if (!match) continue;
    var n = parseInt(match[1], 10);
    if (!n || n < 1) continue;
    seen[n] = true;
    if (n > max) max = n;
  }
  var ids = [];
  var next = max;
  for (var c = 0; c < count; c++) {
    next++;
    var guard = 0;
    while (seen[next]) {
      next++;
      guard++;
      if (guard > 1000) break;
    }
    if (next > 999) return { ok: false, message: 'The part number sequence is full for ' + id + '. Nothing was saved.' };
    seen[next] = true;
    ids.push(id + '-P' + (next < 10 ? '0' : '') + next);
  }
  return { ok: true, ids: ids };
}

function partsItems_(data) {
  var raw = data.items;
  if (typeof raw === 'string') {
    if (!String(raw).trim()) raw = [];
    else {
      try { raw = JSON.parse(raw); } catch (err) { raw = null; }
    }
  }
  if (!raw || Object.prototype.toString.call(raw) !== '[object Array]' || !raw.length) {
    return { ok: false, message: 'Add at least one part. Nothing was saved.' };
  }
  if (raw.length > MAX_PARTS) return { ok: false, message: 'You can add up to 20 parts at a time. Nothing was saved.' };
  var items = [];
  for (var i = 0; i < raw.length; i++) {
    var item = raw[i] || {};
    var purchaser = namedText_(item.purchaser, 'Enter the purchaser for each part. Nothing was saved.', 'The purchaser');
    if (!purchaser.ok) return purchaser;
    var name = namedText_(item.name, 'Enter the name of each part. Nothing was saved.', 'The part name');
    if (!name.ok) return name;
    var supplier = namedText_(item.supplier, 'Enter the supplier for each part. Nothing was saved.', 'The supplier');
    if (!supplier.ok) return supplier;
    var ordered = String(item.dateOrdered || '').trim();
    if (ordered && !reviewDueDate_(ordered)) {
      return { ok: false, message: 'Enter a valid date ordered, or leave it blank. Nothing was saved.' };
    }
    items.push({ purchaser: purchaser.value, name: name.value, supplier: supplier.value, dateOrdered: ordered });
  }
  return { ok: true, value: items };
}

function validatePartsAdd_(data, people) {
  data = data || {};
  var submissionId = String(data.submissionId || '').trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(submissionId)) {
    return { ok: false, message: 'The parts order could not be identified. Reload the page and try again. Nothing was saved.' };
  }
  var label = String(data.label == null ? '' : data.label).trim();
  var maintenanceId = String(data.maintenanceId || '').trim().toUpperCase();
  var prefix = labelId_(label);
  if (!prefix || prefix !== maintenanceId) {
    return { ok: false, message: 'Select a maintenance job. Nothing was saved.' };
  }
  var items = partsItems_(data);
  if (!items.ok) return items;
  people = people || [];
  for (var n = 0; n < items.value.length; n++) {
    if (people.indexOf(items.value[n].purchaser) === -1) {
      return { ok: false, message: 'Select a purchaser from the list. Nothing was saved.' };
    }
  }
  return {
    ok: true,
    value: {
      submissionId: submissionId,
      label: label,
      maintenanceId: maintenanceId,
      items: items.value
    }
  };
}

function validatePartsReceipt_(data) {
  data = data || {};
  var submissionId = String(data.submissionId || '').trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(submissionId)) {
    return { ok: false, message: 'The receipt could not be identified. Reload the page and try again. Nothing was saved.' };
  }
  var maintenanceId = String(data.maintenanceId || '').trim().toUpperCase();
  if (!MAINTENANCE_ID_RE.test(maintenanceId)) {
    return { ok: false, message: 'Select a maintenance job. Nothing was saved.' };
  }
  var partId = String(data.partId || '').trim().toUpperCase();
  if (!/^MA\d{4}-P\d{2,}$/.test(partId) || partId.indexOf(maintenanceId + '-P') !== 0) {
    return { ok: false, message: 'That part could not be identified. Nothing was saved.' };
  }
  var ordered = String(data.dateOrdered || '').trim();
  if (ordered && !reviewDueDate_(ordered)) {
    return { ok: false, message: 'Enter a valid date ordered, or leave it blank. Nothing was saved.' };
  }
  var arrived = String(data.dateArrived || '').trim();
  if (arrived && !reviewDueDate_(arrived)) {
    return { ok: false, message: 'Enter a valid date arrived, or leave it blank. Nothing was saved.' };
  }
  var receivedBy = String(data.receivedBy || '').trim();
  if (receivedBy.length > MAX_NAME) return { ok: false, message: 'Received by is too long.' };
  var checkedBy = String(data.checkedBy || '').trim();
  if (checkedBy.length > MAX_NAME) return { ok: false, message: 'Checked by is too long.' };
  var status = String(data.status || '').trim();
  if (status && RECEIPT_STATUSES.indexOf(status) === -1) {
    return { ok: false, message: 'Select a receipt status. Nothing was saved.' };
  }
  return {
    ok: true,
    value: {
      submissionId: submissionId,
      maintenanceId: maintenanceId,
      partId: partId,
      dateOrdered: ordered,
      dateArrived: arrived,
      receivedBy: receivedBy,
      checkedBy: checkedBy,
      status: status
    }
  };
}

function storedDate_(value) {
  if (cellBlank_(value)) return { iso: '', uk: '' };
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return {
      iso: Utilities.formatDate(value, 'Europe/London', 'yyyy-MM-dd'),
      uk: Utilities.formatDate(value, 'Europe/London', 'dd/MM/yyyy')
    };
  }
  var text = String(value).trim();
  var uk = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (uk && reviewDueDate_(uk[3] + '-' + uk[2] + '-' + uk[1])) {
    return { iso: uk[3] + '-' + uk[2] + '-' + uk[1], uk: text };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) && reviewDueDate_(text)) {
    return { iso: text, uk: text.slice(8) + '/' + text.slice(5, 7) + '/' + text.slice(0, 4) };
  }
  return { iso: '', uk: text };
}

function partIdentity_(maintenanceId, partId, combined) {
  var prefix = String(maintenanceId || '').toUpperCase() + '-P';
  var id = String(partId == null ? '' : partId).trim().toUpperCase();
  if (id.indexOf(prefix) === 0 && /^\d{2,}$/.test(id.slice(prefix.length))) return id;
  if (!cellBlank_(partId)) return '';
  var text = String(combined == null ? '' : combined).trim().toUpperCase();
  var match = new RegExp('^(' + prefix + '\\d{2,})\\s\\|').exec(text);
  return match ? match[1] : '';
}

function partsForJob_(maintenanceId) {
  var sheet = requirePartsSheet_(SpreadsheetApp.openById(SSID_MAINTENANCE));
  var values = partsValues_(sheet);
  var orders = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var partId = partIdentity_(maintenanceId, row[0], row[2]);
    if (!partId) continue;
    var ordered = storedDate_(row[5]);
    var arrived = storedDate_(row[6]);
    orders.push({
      row: i + 2,
      partId: partId,
      name: String(row[1] == null ? '' : row[1]).trim(),
      purchaser: String(row[3] == null ? '' : row[3]).trim(),
      supplier: String(row[4] == null ? '' : row[4]).trim(),
      dateOrdered: ordered.iso,
      dateOrderedUk: ordered.uk,
      dateArrived: arrived.iso,
      dateArrivedUk: arrived.uk,
      receivedBy: String(row[7] == null ? '' : row[7]).trim(),
      checkedBy: String(row[8] == null ? '' : row[8]).trim(),
      status: String(row[9] == null ? '' : row[9]).trim()
    });
  }
  orders.sort(function (a, b) {
    return a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0;
  });
  return orders;
}

function findPartRow_(sheet, partId) {
  var values = partsValues_(sheet);
  var wanted = String(partId || '').trim().toUpperCase();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] == null ? '' : values[i][0]).trim().toUpperCase() === wanted) rows.push(i + 2);
  }
  if (rows.length !== 1) return 0;
  return rows[0];
}

function emptyPartRows_(sheet, count) {
  var values = partsValues_(sheet);
  var rows = [];
  for (var i = 0; i < values.length && rows.length < count; i++) {
    if (cellBlank_(values[i][0]) && cellBlank_(values[i][1]) && cellBlank_(values[i][2])) rows.push(i + 2);
  }
  while (rows.length < count) {
    sheet.insertRowsAfter(sheet.getMaxRows(), 1);
    rows.push(sheet.getMaxRows());
  }
  return rows;
}

function columnCFormulaFor_(sheet, targetRow) {
  var current = String(sheet.getRange(targetRow, 3).getFormula() || '').trim();
  if (current) return '';
  var maxRows = sheet.getMaxRows();
  var limit = Math.min(maxRows, targetRow + 40);
  for (var row = 2; row <= limit; row++) {
    if (row === targetRow) continue;
    var formula = String(sheet.getRange(row, 3).getFormula() || '').trim();
    if (!formula) continue;
    if (formula.toUpperCase().replace(/\s/g, '').indexOf('ARRAYFORMULA(') !== -1) return '';
    return formula.replace(new RegExp('([A-Za-z]+)' + row + '\\b', 'g'), function (match, col) {
      return col + String(targetRow);
    });
  }
  return '';
}

function writePartsText_(sheet, row, col, value, written) {
  if (row < 2) throw new Error('Refusing to write on the header row.');
  if (col === 3 || [1, 2, 4, 5, 8, 9, 10].indexOf(col) === -1) {
    throw new Error('Refusing to write outside the parts record.');
  }
  var range = sheet.getRange(row, col);
  var formula = String(range.getFormula() || '');
  if (formula.toUpperCase().replace(/\s/g, '').indexOf('ARRAYFORMULA(') !== -1) {
    throw new Error('Column ' + columnLetter_(col) + ' contains an array formula. Nothing was overwritten.');
  }
  if (formula.trim() !== '' && col >= 8) {
    throw new Error('Column ' + columnLetter_(col) + ' contains a formula. It was not overwritten.');
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

function writePartsDate_(sheet, row, col, date, written) {
  if (row < 2) throw new Error('Refusing to write on the header row.');
  if (col !== 6 && col !== 7) throw new Error('Refusing to write outside the parts dates.');
  var range = sheet.getRange(row, col);
  var formula = String(range.getFormula() || '');
  if (formula.trim() !== '') throw new Error('Column ' + columnLetter_(col) + ' contains a formula. It was not overwritten.');
  written.push({
    sheet: sheet,
    row: row,
    col: col,
    formula: formula,
    value: range.getValue(),
    format: range.getNumberFormat()
  });
  range.setNumberFormat('dd/MM/yyyy');
  range.setValue(date);
}

function clearPartsDate_(sheet, row, col, written) {
  if (col !== 6 && col !== 7) throw new Error('Refusing to clear outside the parts dates.');
  var range = sheet.getRange(row, col);
  var formula = String(range.getFormula() || '');
  if (formula.trim() !== '') throw new Error('Column ' + columnLetter_(col) + ' contains a formula. It was not overwritten.');
  written.push({
    sheet: sheet,
    row: row,
    col: col,
    formula: formula,
    value: range.getValue(),
    format: range.getNumberFormat()
  });
  range.clearContent();
}

function checkedPerson_(submitted, current, people, label) {
  var text = String(submitted || '').trim();
  var existing = String(current || '').trim();
  if (text === existing) return { ok: true, value: text };
  if (!text) return { ok: true, value: '' };
  var named = namedText_(text, 'Select ' + label + ' from the list. Nothing was saved.', label);
  if (!named.ok) return named;
  if (people.indexOf(named.value) === -1) {
    return { ok: false, message: 'Select ' + label + ' from the list. Nothing was saved.' };
  }
  return { ok: true, value: named.value };
}

function checkedStatus_(submitted, current) {
  var text = String(submitted || '').trim();
  var existing = String(current || '').trim();
  if (text === existing) return { ok: true, value: text };
  if (!text) return { ok: true, value: '' };
  if (RECEIPT_STATUSES.indexOf(text) === -1) {
    return { ok: false, message: 'Select a receipt status. Nothing was saved.' };
  }
  return { ok: true, value: text };
}

function applyPartsDate_(sheet, row, col, iso, written) {
  var current = storedDate_(sheet.getRange(row, col).getValue());
  var wanted = String(iso || '').trim();
  if (wanted === current.iso) return;
  if (!wanted) {
    if (!current.iso && current.uk) return;
    clearPartsDate_(sheet, row, col, written);
    return;
  }
  var date = reviewDueDate_(wanted);
  if (!date) throw new Error('Enter a valid date. Nothing was saved.');
  writePartsDate_(sheet, row, col, date, written);
}

function applyPartsText_(sheet, row, col, value, written) {
  var current = String(sheet.getRange(row, col).getValue() == null ? '' : sheet.getRange(row, col).getValue()).trim();
  var wanted = String(value || '').trim();
  if (current === wanted) return;
  writePartsText_(sheet, row, col, wanted, written);
}

function rememberRecord_(prefix, indexKey, submissionId, record) {
  record.at = Date.now();
  var props = props_();
  props.setProperty(prefix + submissionId, JSON.stringify(record));
  var index = [];
  try { index = JSON.parse(props.getProperty(indexKey) || '[]'); } catch (err) { index = []; }
  if (!Array.isArray(index)) index = [];
  index = index.filter(function (item) { return item !== submissionId; });
  index.push(submissionId);
  while (index.length > 100) {
    var oldId = index.shift();
    props.deleteProperty(prefix + oldId);
  }
  props.setProperty(indexKey, JSON.stringify(index));
}

function loadRecordKey_(prefix, submissionId) {
  var raw = props_().getProperty(prefix + submissionId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

function digest_(text) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < digest.length; i++) {
    var b = digest[i] < 0 ? digest[i] + 256 : digest[i];
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function partsFingerprint_(value) {
  return digest_(JSON.stringify({
    submissionId: value.submissionId,
    label: value.label,
    maintenanceId: value.maintenanceId,
    items: value.items
  }));
}

function receiptFingerprint_(value) {
  return digest_(JSON.stringify({
    submissionId: value.submissionId,
    maintenanceId: value.maintenanceId,
    partId: value.partId,
    dateOrdered: value.dateOrdered,
    dateArrived: value.dateArrived,
    receivedBy: value.receivedBy,
    checkedBy: value.checkedBy,
    status: value.status
  }));
}

function saveParts_(value) {
  var fingerprint = partsFingerprint_(value);
  var existing = loadRecordKey_('PARTS_SUB_', value.submissionId);
  if (existing && existing.status === 'success') {
    if (existing.fingerprint !== fingerprint) {
      return json({
        result: 'error',
        retryable: false,
        maintenanceId: existing.maintenanceId,
        message: 'This parts order was already saved for ' + existing.maintenanceId + '. It was not changed.'
      });
    }
    return json(existing.result);
  }
  if (existing && existing.status === 'partial') {
    return json(existing.result || {
      result: 'error',
      partial: true,
      retryable: false,
      message: 'This parts order was not fully saved. Check the parts record before writing anything else.'
    });
  }
  var log = requireSheet_(SpreadsheetApp.openById(SSID_MAINTENANCE));
  var found = findReviewRow_(log, value.maintenanceId, value.label);
  if (!found.ok) return json({ result: 'error', retryable: true, message: found.message });
  var sheet = requirePartsSheet_(SpreadsheetApp.openById(SSID_MAINTENANCE));
  var values = partsValues_(sheet);
  var existingIds = [];
  for (var i = 0; i < values.length; i++) existingIds.push(values[i][0]);
  var allocated = nextPartIds_(existingIds, value.maintenanceId, value.items.length);
  if (!allocated.ok) return json({ result: 'error', retryable: true, message: allocated.message });
  var rows = emptyPartRows_(sheet, value.items.length);
  var formulas = [];
  for (var f = 0; f < rows.length; f++) formulas.push(String(sheet.getRange(rows[f], 3).getFormula() || ''));
  var written = [];
  var saved = [];
  try {
    for (var n = 0; n < value.items.length; n++) {
      var item = value.items[n];
      var row = rows[n];
      var before = formulas[n];
      var generated = columnCFormulaFor_(sheet, row);
      if (generated) {
        var range = sheet.getRange(row, 3);
        written.push({
          sheet: sheet,
          row: row,
          col: 3,
          formula: String(range.getFormula() || ''),
          value: range.getValue(),
          format: range.getNumberFormat()
        });
        range.setFormula(generated);
      }
      writePartsText_(sheet, row, 1, allocated.ids[n], written);
      writePartsText_(sheet, row, 2, item.name, written);
      writePartsText_(sheet, row, 4, item.purchaser, written);
      writePartsText_(sheet, row, 5, item.supplier, written);
      if (item.dateOrdered) writePartsDate_(sheet, row, 6, reviewDueDate_(item.dateOrdered), written);
      var after = String(sheet.getRange(row, 3).getFormula() || '');
      if (before && after !== before) throw new Error('The part formula in column C was changed. Nothing was kept.');
      saved.push({ partId: allocated.ids[n], row: row, name: item.name });
    }
  } catch (err) {
    var failed = rollbackWritten_(written);
    if (failed.length) {
      rememberRecord_('PARTS_SUB_', PARTS_INDEX_KEY, value.submissionId, {
        status: 'partial',
        fingerprint: fingerprint,
        maintenanceId: value.maintenanceId,
        result: {
          result: 'error',
          partial: true,
          retryable: false,
          maintenanceId: value.maintenanceId,
          message: 'The parts order may be incomplete. Check ' + value.maintenanceId + ' before trying again.'
        }
      });
      return json({
        result: 'error',
        partial: true,
        retryable: false,
        maintenanceId: value.maintenanceId,
        message: 'The parts order may be incomplete. Check ' + value.maintenanceId + ' before trying again.'
      });
    }
    return json({ result: 'error', retryable: true, message: publicMessage_(err) + ' Your answers are still here.' });
  }
  var result = { result: 'success', maintenanceId: value.maintenanceId, label: value.label, parts: saved };
  rememberRecord_('PARTS_SUB_', PARTS_INDEX_KEY, value.submissionId, {
    status: 'success',
    fingerprint: fingerprint,
    maintenanceId: value.maintenanceId,
    result: result
  });
  return json(result);
}

function saveReceipt_(value, people) {
  var fingerprint = receiptFingerprint_(value);
  var existing = loadRecordKey_('RECEIPT_SUB_', value.submissionId);
  if (existing && existing.status === 'success') {
    if (existing.fingerprint !== fingerprint) {
      return json({
        result: 'error',
        retryable: false,
        partId: value.partId,
        message: 'This receipt was already saved for ' + value.partId + '. It was not changed.'
      });
    }
    return json(existing.result);
  }
  var sheet = requirePartsSheet_(SpreadsheetApp.openById(SSID_MAINTENANCE));
  var row = findPartRow_(sheet, value.partId);
  if (!row) {
    return json({ result: 'error', retryable: true, message: 'That part is no longer on Parts Requested. Nothing was saved.' });
  }
  var current = sheet.getRange(row, 1, 1, 10).getValues()[0];
  if (String(current[0] == null ? '' : current[0]).trim().toUpperCase() !== value.partId) {
    return json({ result: 'error', retryable: true, message: 'That part is no longer on Parts Requested. Nothing was saved.' });
  }
  var received = checkedPerson_(value.receivedBy, current[7], people, 'Received by');
  if (!received.ok) return json({ result: 'error', retryable: true, message: received.message });
  var checked = checkedPerson_(value.checkedBy, current[8], people, 'Checked by');
  if (!checked.ok) return json({ result: 'error', retryable: true, message: checked.message });
  var status = checkedStatus_(value.status, current[9]);
  if (!status.ok) return json({ result: 'error', retryable: true, message: status.message });
  var protectedCols = [1, 2, 3, 4, 5];
  var before = snapshotCols_(sheet, row, protectedCols);
  var written = [];
  try {
    applyPartsDate_(sheet, row, 6, value.dateOrdered, written);
    applyPartsDate_(sheet, row, 7, value.dateArrived, written);
    applyPartsText_(sheet, row, 8, received.value, written);
    applyPartsText_(sheet, row, 9, checked.value, written);
    applyPartsText_(sheet, row, 10, status.value, written);
    if (!sameSnapshot_(sheet, row, before)) throw new Error('Columns A to E changed. The receipt was not kept.');
  } catch (err) {
    var failed = rollbackWritten_(written);
    if (failed.length || !sameSnapshot_(sheet, row, before)) {
      rememberRecord_('RECEIPT_SUB_', RECEIPT_INDEX_KEY, value.submissionId, {
        status: 'partial',
        fingerprint: fingerprint,
        result: {
          result: 'error',
          partial: true,
          retryable: false,
          partId: value.partId,
          message: 'The receipt may be incomplete for ' + value.partId + '. Check that part before trying again.'
        }
      });
      return json({
        result: 'error',
        partial: true,
        retryable: false,
        partId: value.partId,
        message: 'The receipt may be incomplete for ' + value.partId + '. Check that part before trying again.'
      });
    }
    return json({ result: 'error', retryable: true, message: publicMessage_(err) + ' Your answers are still here.' });
  }
  var orders = partsForJob_(value.maintenanceId);
  var updated = null;
  for (var i = 0; i < orders.length; i++) {
    if (orders[i].partId === value.partId) updated = orders[i];
  }
  var result = { result: 'success', maintenanceId: value.maintenanceId, partId: value.partId, order: updated };
  rememberRecord_('RECEIPT_SUB_', RECEIPT_INDEX_KEY, value.submissionId, {
    status: 'success',
    fingerprint: fingerprint,
    result: result
  });
  return json(result);
}

function handleCompleteJobs_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return json({ result: 'error', retryable: true, message: 'The maintenance list is busy. Wait a moment and try again.' });
  }
  try {
    return json({ result: 'ok', requests: reviewRequests_() });
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The maintenance jobs could not be loaded. ' + publicMessage_(err)
    });
  } finally {
    lock.releaseLock();
  }
}

function handleCompleteDetail_(p) {
  var label = String(p.label == null ? '' : p.label).trim();
  var maintenanceId = String(p.maintenanceId || '').trim().toUpperCase();
  var prefix = labelId_(label);
  if (!prefix || prefix !== maintenanceId) {
    return json({ result: 'error', retryable: true, message: 'Select a maintenance job.' });
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return json({ result: 'error', retryable: true, message: 'The job is busy. Wait a moment and try again.' });
  }
  try {
    var sheet = requireSheet_(SpreadsheetApp.openById(SSID_MAINTENANCE));
    var found = findReviewRow_(sheet, maintenanceId, label);
    if (!found.ok) return json({ result: 'error', retryable: true, message: found.message });
    return json({
      result: 'ok',
      maintenanceId: maintenanceId,
      label: label,
      orders: partsForJob_(maintenanceId),
      completion: completionFromRow_(sheet, found.row)
    });
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The job could not be loaded. ' + publicMessage_(err)
    });
  } finally {
    lock.releaseLock();
  }
}

function withCompleteLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return json({
      result: 'error',
      retryable: true,
      message: 'Another job update is being saved. Wait a moment and try again. Your answers are still here.'
    });
  }
  try {
    return fn();
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The job was not saved. ' + publicMessage_(err) + ' Your answers are still here.'
    });
  } finally {
    lock.releaseLock();
  }
}

function handleCompletePrepare_(p) {
  return withCompleteLock_(function () {
    var validated = validateComplete_(p);
    if (!validated.ok) return json({ result: 'error', retryable: true, message: validated.message });
    return prepareComplete_(validated.value);
  });
}

function handleCompleteCommit_(p) {
  return withCompleteLock_(function () {
    var validated = validateComplete_(p);
    if (!validated.ok) return json({ result: 'error', retryable: true, message: validated.message });
    var value = validated.value;
    var fingerprint = completeFingerprint_(value);
    var existing = loadRecordKey_('COMPLETE_SUB_', value.submissionId);
    if (existing && existing.status === 'success') {
      if (existing.fingerprint !== fingerprint) {
        return json({
          result: 'error',
          retryable: false,
          maintenanceId: existing.maintenanceId,
          message: 'This job update was already saved for ' + existing.maintenanceId + '. It was not changed.'
        });
      }
      return json(existing.result);
    }
    if (existing && existing.status === 'partial') {
      return json(existing.result || {
        result: 'error',
        partial: true,
        retryable: false,
        maintenanceId: value.maintenanceId,
        message: 'This job update was not fully saved. Check the maintenance record before writing anything else.'
      });
    }
    if (!existing || existing.status !== 'pending' || existing.fingerprint !== fingerprint) {
      return json({
        result: 'error',
        retryable: true,
        message: 'The photographs were not attached to this job update. Submit the form again. Your answers are still here.'
      });
    }
    for (var i = 0; i < value.photoNames.length; i++) {
      if ((existing.photosUploaded || []).indexOf(value.photoNames[i]) === -1) {
        return json({
          result: 'error',
          retryable: true,
          maintenanceId: value.maintenanceId,
          message: 'Not every photograph was uploaded, so the job was not saved. Your answers are still here.'
        });
      }
    }
    return commitComplete_(value, existing);
  });
}

function handleCompletePhoto_(p) {
  var submissionId = String(p.submissionId || '').trim();
  if (!submissionIdOk_(submissionId)) {
    return json({ result: 'error', retryable: true, message: 'The job could not be identified. Reload the page and try again. Nothing was saved.' });
  }
  var fileName = String(p.fileName || '').trim().toLowerCase();
  if (!/^work-\d{2}\.(jpg|jpeg|png|webp)$/.test(fileName)) {
    return json({ result: 'error', retryable: true, message: 'That photograph could not be accepted. Your answers are still here.' });
  }
  var image = cleanPhoto_(p.imageBase64);
  if (!image.ok) return json({ result: 'error', retryable: true, message: image.message });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return json({
      result: 'error',
      retryable: true,
      message: 'Another job update is being saved. Wait a moment and try again. Your answers are still here.'
    });
  }
  try {
    var record = loadRecordKey_('COMPLETE_SUB_', submissionId);
    if (!record || (record.status !== 'pending' && record.status !== 'success')) {
      return json({ result: 'error', retryable: true, message: 'Submit the job before uploading photographs. Your answers are still here.' });
    }
    if (record.status === 'success') {
      if ((record.photosUploaded || []).indexOf(fileName) !== -1) {
        return json({ result: 'ok', fileName: fileName, maintenanceId: record.maintenanceId });
      }
      return json({
        result: 'error',
        retryable: false,
        maintenanceId: record.maintenanceId,
        message: 'This job update was already saved for ' + record.maintenanceId + '. The photograph was not added.'
      });
    }
    if ((record.photosExpected || []).indexOf(fileName) === -1) {
      return json({ result: 'error', retryable: true, message: 'That photograph is not part of this job update. Your answers are still here.' });
    }
    uploadFaultPhoto_(record.workId, fileName, image.value, p.mimeType);
    var uploaded = record.photosUploaded || [];
    if (uploaded.indexOf(fileName) === -1) uploaded.push(fileName);
    record.photosUploaded = uploaded;
    rememberRecord_('COMPLETE_SUB_', COMPLETE_INDEX_KEY, submissionId, record);
    return json({ result: 'ok', fileName: fileName, maintenanceId: record.maintenanceId });
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The photograph was not uploaded. ' + publicMessage_(err) + ' Your answers are still here.'
    });
  } finally {
    lock.releaseLock();
  }
}

function optionalNamed_(value, label) {
  var text = String(value == null ? '' : value).trim();
  if (text.length > MAX_NAME) return { ok: false, message: label + ' is too long.' };
  return { ok: true, value: text };
}

function optionalLong_(value, label) {
  var text = String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!String(text).trim()) return { ok: true, value: '' };
  if (text.length > MAX_TEXT) return { ok: false, message: label + ' is too long.' };
  return { ok: true, value: text };
}

function workPhotoNames_(data) {
  var raw = data.photoNames;
  if (typeof raw === 'string') {
    if (!String(raw).trim()) raw = [];
    else {
      try { raw = JSON.parse(raw); } catch (err) { raw = null; }
    }
  }
  if (!raw) raw = [];
  if (Object.prototype.toString.call(raw) !== '[object Array]') {
    return { ok: false, message: 'The photographs could not be read. Nothing was saved.' };
  }
  if (raw.length > MAX_PHOTOS) return { ok: false, message: 'You can attach up to 10 photographs.' };
  var names = [];
  var seen = {};
  for (var i = 0; i < raw.length; i++) {
    var name = String(raw[i] || '').trim().toLowerCase();
    if (!/^work-\d{2}\.(jpg|jpeg|png|webp)$/.test(name)) {
      return { ok: false, message: 'One of the photographs could not be accepted. Nothing was saved.' };
    }
    if (seen[name]) return { ok: false, message: 'Photograph names must be unique. Nothing was saved.' };
    seen[name] = true;
    names.push(name);
  }
  return { ok: true, value: names };
}

function completeOutcome_(data) {
  var choice = String(data.outcome || '').trim();
  if (choice === CLOSE_JOB) return { ok: true, value: CLOSE_JOB };
  if (choice === OTHER) {
    var text = preserveText_(data.outcomeOther, 'Explain the other outcome. Nothing was saved.', 'The explanation');
    if (!text.ok) return text;
    if (text.value === CLOSE_JOB) {
      return { ok: false, message: 'Choose Close Job for that outcome. Nothing was saved.' };
    }
    return { ok: true, value: text.value };
  }
  return { ok: false, message: 'Choose Close Job or Other. Nothing was saved.' };
}

function validateComplete_(data) {
  data = data || {};
  var submissionId = String(data.submissionId || '').trim();
  if (!submissionIdOk_(submissionId)) {
    return { ok: false, message: 'The job completion could not be identified. Reload the page and try again. Nothing was saved.' };
  }
  var label = String(data.label == null ? '' : data.label).trim();
  var maintenanceId = String(data.maintenanceId || '').trim().toUpperCase();
  var prefix = labelId_(label);
  if (!prefix || prefix !== maintenanceId) {
    return { ok: false, message: 'Select a maintenance job. Nothing was saved.' };
  }
  var permit = optionalNamed_(data.permit, 'The permit number');
  if (!permit.ok) return permit;
  var workUndertaken = optionalLong_(data.workUndertaken, 'Work undertaken');
  if (!workUndertaken.ok) return workUndertaken;
  var workOutstanding = optionalLong_(data.workOutstanding, 'Work outstanding');
  if (!workOutstanding.ok) return workOutstanding;
  var completed = String(data.completed || '').trim();
  if (completed !== 'Yes' && completed !== 'No') {
    return { ok: false, message: 'Choose whether the job has been completed. Nothing was saved.' };
  }
  var outcome = completeOutcome_(data);
  if (!outcome.ok) return outcome;
  var photos = workPhotoNames_(data);
  if (!photos.ok) return photos;
  return {
    ok: true,
    value: {
      submissionId: submissionId,
      label: label,
      maintenanceId: maintenanceId,
      permit: permit.value,
      workUndertaken: workUndertaken.value,
      workOutstanding: workOutstanding.value,
      completed: completed,
      outcome: outcome.value,
      photoNames: photos.value
    }
  };
}

function completionFromRow_(sheet, row) {
  function text(col) {
    var value = sheet.getRange(row, col).getValue();
    if (value == null) return '';
    return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }
  var completedRaw = String(text(25)).trim();
  var outcomeRaw = text(26);
  var outcome = '';
  var outcomeOther = '';
  if (String(outcomeRaw).trim() === CLOSE_JOB) outcome = CLOSE_JOB;
  else if (String(outcomeRaw).trim()) {
    outcome = OTHER;
    outcomeOther = outcomeRaw;
  }
  return {
    permit: String(text(22)).trim(),
    workUndertaken: String(text(23)).trim() ? text(23) : '',
    workOutstanding: String(text(24)).trim() ? text(24) : '',
    completed: completedRaw === 'Yes' || completedRaw === 'No' ? completedRaw : '',
    outcome: outcome,
    outcomeOther: outcomeOther
  };
}

function findJobFolder_(maintenanceId) {
  DriveApp.getFolderById(DRIVE_FAULT_PARENT);
  var found = driveFoldersNamed_(DRIVE_FAULT_PARENT, maintenanceId);
  if (found.length > 1) throw new Error('More than one Drive folder is named ' + maintenanceId + '.');
  if (!found.length) throw new Error('The job folder for ' + maintenanceId + ' was not found, so nothing was saved.');
  return found[0];
}

function ensureWorkFolder_(maintenanceId) {
  var job = findJobFolder_(maintenanceId);
  var name = maintenanceId + ' | Work Undertaken';
  var work = driveEnsureFolder_(job.id, name);
  return {
    jobId: job.id,
    workId: work.id,
    workUrl: 'https://drive.google.com/drive/folders/' + work.id
  };
}

function completeLink_(maintenanceId, workUrl) {
  return '=HYPERLINK("' + String(workUrl).replace(/"/g, '') + '","' + maintenanceId + ' | Work Undertaken")';
}

function completeFingerprint_(value) {
  return digest_(JSON.stringify({
    submissionId: value.submissionId,
    label: value.label,
    maintenanceId: value.maintenanceId,
    permit: value.permit,
    workUndertaken: value.workUndertaken,
    workOutstanding: value.workOutstanding,
    completed: value.completed,
    outcome: value.outcome,
    photoNames: value.photoNames
  }));
}

function prepareComplete_(value) {
  var fingerprint = completeFingerprint_(value);
  var existing = loadRecordKey_('COMPLETE_SUB_', value.submissionId);
  if (existing && existing.status === 'success') {
    if (existing.fingerprint !== fingerprint) {
      return json({
        result: 'error',
        retryable: false,
        maintenanceId: existing.maintenanceId,
        message: 'This job update was already saved for ' + existing.maintenanceId + '. It was not changed.'
      });
    }
    return json(existing.result);
  }
  if (existing && existing.status === 'partial') {
    return json(existing.result || {
      result: 'error',
      partial: true,
      retryable: false,
      maintenanceId: existing.maintenanceId || value.maintenanceId,
      message: 'This job update was not fully saved. Check the maintenance record before writing anything else.'
    });
  }
  var sheet = requireSheet_(SpreadsheetApp.openById(SSID_MAINTENANCE));
  var found = findReviewRow_(sheet, value.maintenanceId, value.label);
  if (!found.ok) return json({ result: 'error', retryable: true, message: found.message });
  var folders;
  try {
    folders = ensureWorkFolder_(value.maintenanceId);
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      maintenanceId: value.maintenanceId,
      message: publicMessage_(err) + ' Your answers are still here.'
    });
  }
  var uploaded = [];
  if (existing && existing.status === 'pending') {
    uploaded = existing.photosUploaded || [];
    if (existing.fingerprint !== fingerprint) {
      uploaded = uploaded.filter(function (name) {
        return value.photoNames.indexOf(name) !== -1;
      });
    }
  }
  var pending = {
    status: 'pending',
    fingerprint: fingerprint,
    maintenanceId: value.maintenanceId,
    label: value.label,
    row: found.row,
    workId: folders.workId,
    workUrl: folders.workUrl,
    photosExpected: value.photoNames,
    photosUploaded: uploaded
  };
  rememberRecord_('COMPLETE_SUB_', COMPLETE_INDEX_KEY, value.submissionId, pending);
  if (value.photoNames.length) {
    return json({
      result: 'pending',
      retryable: true,
      maintenanceId: value.maintenanceId,
      folderUrl: folders.workUrl
    });
  }
  return commitComplete_(value, pending);
}

function protectedCompleteCols_() {
  var cols = [];
  var col;
  for (col = 1; col <= 21; col++) cols.push(col);
  return cols;
}

function assertCompleteWritable_(sheet, row, link) {
  var col;
  for (col = COMPLETE_FIRST_COL; col <= COMPLETE_LAST_COL; col++) {
    var formula = String(sheet.getRange(row, col).getFormula() || '');
    if (formula.trim() !== '') {
      throw new Error('Column ' + columnLetter_(col) + ' contains a formula. It was not overwritten.');
    }
  }
  var linkRange = sheet.getRange(row, COMPLETE_LINK_COL);
  var current = String(linkRange.getFormula() || '');
  if (current === link) return;
  if (current.trim() !== '' || String(linkRange.getValue() == null ? '' : linkRange.getValue()).trim() !== '') {
    throw new Error('Column AA already has different data. It was not overwritten.');
  }
}

function applyCompleteText_(sheet, row, col, value, written) {
  if (row < REVIEW_START_ROW) throw new Error('Refusing to write above the maintenance requests.');
  if (col < COMPLETE_FIRST_COL || col > COMPLETE_LAST_COL) throw new Error('Refusing to write outside columns V to Z.');
  var range = sheet.getRange(row, col);
  var formula = String(range.getFormula() || '');
  if (formula.trim() !== '') throw new Error('Column ' + columnLetter_(col) + ' contains a formula. It was not overwritten.');
  var expected = String(value);
  var current = range.getValue();
  if (current == null) current = '';
  if (String(current) === expected) return;
  var stored = {
    sheet: sheet,
    row: row,
    col: col,
    formula: formula,
    value: range.getValue(),
    format: range.getNumberFormat()
  };
  written.push(stored);
  if (expected === '') {
    range.clearContent();
    return;
  }
  range.setNumberFormat('@');
  range.setValue(expected);
}

function applyCompleteLink_(sheet, row, formula, written) {
  if (row < REVIEW_START_ROW) throw new Error('Refusing to write above the maintenance requests.');
  var range = sheet.getRange(row, COMPLETE_LINK_COL);
  var current = String(range.getFormula() || '');
  if (current === formula) return;
  if (current.trim() !== '' || String(range.getValue() == null ? '' : range.getValue()).trim() !== '') {
    throw new Error('Column AA already has different data. It was not overwritten.');
  }
  written.push({
    sheet: sheet,
    row: row,
    col: COMPLETE_LINK_COL,
    formula: current,
    value: range.getValue(),
    format: range.getNumberFormat()
  });
  range.setFormula(formula);
}

function verifyComplete_(sheet, row, value, link) {
  var expected = [value.permit, value.workUndertaken, value.workOutstanding, value.completed, value.outcome];
  var col;
  for (col = 0; col < expected.length; col++) {
    var range = sheet.getRange(row, COMPLETE_FIRST_COL + col);
    if (String(range.getFormula() || '').trim() !== '') {
      throw new Error('Saved completion cells on row ' + row + ' could not be confirmed.');
    }
    var current = range.getValue();
    if (current == null) current = '';
    if (String(current) !== String(expected[col])) {
      throw new Error('Saved completion cells on row ' + row + ' could not be confirmed.');
    }
  }
  if (String(sheet.getRange(row, COMPLETE_LINK_COL).getFormula() || '') !== link) {
    throw new Error('The work folder link on row ' + row + ' could not be confirmed.');
  }
}

function commitComplete_(value, pending) {
  var fingerprint = completeFingerprint_(value);
  var sheet = requireSheet_(SpreadsheetApp.openById(SSID_MAINTENANCE));
  var found = findReviewRow_(sheet, value.maintenanceId, value.label);
  if (!found.ok) return json({ result: 'error', retryable: true, message: found.message });
  var folders = ensureWorkFolder_(value.maintenanceId);
  var link = completeLink_(value.maintenanceId, folders.workUrl);
  var before = snapshotCols_(sheet, found.row, protectedCompleteCols_());
  var written = [];
  try {
    assertCompleteWritable_(sheet, found.row, link);
    applyCompleteText_(sheet, found.row, 22, value.permit, written);
    applyCompleteText_(sheet, found.row, 23, value.workUndertaken, written);
    applyCompleteText_(sheet, found.row, 24, value.workOutstanding, written);
    applyCompleteText_(sheet, found.row, 25, value.completed, written);
    applyCompleteText_(sheet, found.row, 26, value.outcome, written);
    applyCompleteLink_(sheet, found.row, link, written);
    verifyComplete_(sheet, found.row, value, link);
    if (!sameSnapshot_(sheet, found.row, before)) {
      throw new Error('Columns A to U changed. The job update was not kept.');
    }
    if (pending && pending.workId && pending.workId !== folders.workId) {
      throw new Error('The work folder changed before the job was saved.');
    }
  } catch (err) {
    var failed = rollbackWritten_(written);
    if (failed.length || !sameSnapshot_(sheet, found.row, before)) {
      var partial = {
        result: 'error',
        partial: true,
        retryable: false,
        maintenanceId: value.maintenanceId,
        message: 'The job update may be incomplete. Check ' + value.maintenanceId + ' before trying again.'
      };
      rememberRecord_('COMPLETE_SUB_', COMPLETE_INDEX_KEY, value.submissionId, {
        status: 'partial',
        fingerprint: fingerprint,
        maintenanceId: value.maintenanceId,
        result: partial
      });
      return json(partial);
    }
    return json({
      result: 'error',
      retryable: true,
      message: publicMessage_(err) + ' Your answers are still here.'
    });
  }
  var result = {
    result: 'success',
    maintenanceId: value.maintenanceId,
    label: value.label,
    row: found.row,
    folderUrl: folders.workUrl
  };
  rememberRecord_('COMPLETE_SUB_', COMPLETE_INDEX_KEY, value.submissionId, {
    status: 'success',
    fingerprint: fingerprint,
    maintenanceId: value.maintenanceId,
    workId: folders.workId,
    workUrl: folders.workUrl,
    photosUploaded: pending && pending.photosUploaded ? pending.photosUploaded : [],
    result: result
  });
  return json(result);
}

function handleStatusJobs_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return json({ result: 'error', retryable: true, message: 'The job list is busy. Wait a moment and try again.' });
  }
  try {
    return json({ result: 'ok', jobs: statusJobs_() });
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The maintenance jobs could not be loaded. ' + publicMessage_(err)
    });
  } finally {
    lock.releaseLock();
  }
}

function handleStatusDetail_(p) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return json({ result: 'error', retryable: true, message: 'The job is busy. Wait a moment and try again.' });
  }
  try {
    var sheet = requireSheet_(SpreadsheetApp.openById(SSID_MAINTENANCE));
    var found = findStatusRow_(sheet, p);
    if (!found.ok) return json({ result: 'error', retryable: true, message: found.message });
    return json(statusDetail_(sheet, found.row));
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The job could not be loaded. ' + publicMessage_(err)
    });
  } finally {
    lock.releaseLock();
  }
}

function handleStatusPhoto_(p) {
  var fileId = String(p.fileId || '').trim();
  var kind = String(p.folderKind || '').trim().toLowerCase();
  var size = String(p.size || '').trim().toLowerCase() === 'full' ? 1600 : 480;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(fileId) || (kind !== 'requests' && kind !== 'work')) {
    return json({ result: 'error', retryable: true, message: 'That photograph could not be opened.' });
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return json({ result: 'error', retryable: true, message: 'The photographs are busy. Wait a moment and try again.' });
  }
  try {
    var sheet = requireSheet_(SpreadsheetApp.openById(SSID_MAINTENANCE));
    var found = findStatusRow_(sheet, p);
    if (!found.ok) return json({ result: 'error', retryable: true, message: found.message });
    var folders = statusFolders_(sheet, found.row);
    var folderId = kind === 'work' ? folders.workId : folders.requestsId;
    if (!folderId) return json({ result: 'error', retryable: true, message: 'That photograph is not in this job folder.' });
    var image = driveThumbnailBytes_(fileId, size);
    var allowed = false;
    for (var i = 0; i < image.parents.length; i++) {
      if (image.parents[i] === folderId) allowed = true;
    }
    if (!allowed) return json({ result: 'error', retryable: true, message: 'That photograph is not in this job folder.' });
    return json({
      result: 'ok',
      fileId: image.id,
      name: image.name,
      mimeType: image.mimeType,
      imageBase64: image.imageBase64
    });
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The photograph could not be opened. ' + publicMessage_(err)
    });
  } finally {
    lock.releaseLock();
  }
}

function statusJobs_() {
  var sheet = requireSheet_(SpreadsheetApp.openById(SSID_MAINTENANCE));
  var maxRows = sheet.getMaxRows();
  if (maxRows < REVIEW_START_ROW) return [];
  var height = maxRows - REVIEW_START_ROW + 1;
  var ids = sheet.getRange(REVIEW_START_ROW, 1, height, 1).getDisplayValues();
  var labels = sheet.getRange(REVIEW_START_ROW, 2, height, 1).getDisplayValues();
  var statuses = sheet.getRange(REVIEW_START_ROW, STATUS_COL, height, 1).getDisplayValues();
  var jobs = [];
  for (var i = 0; i < labels.length; i++) {
    var label = String(labels[i][0] == null ? '' : labels[i][0]).trim();
    if (!label) continue;
    jobs.push({
      row: i + REVIEW_START_ROW,
      maintenanceId: String(ids[i][0] == null ? '' : ids[i][0]).trim().toUpperCase(),
      label: label,
      status: statusPlain_(statuses[i][0])
    });
  }
  return jobs;
}

function statusHint_(data) {
  var row = parseInt(data && data.row, 10);
  if (isNaN(row)) row = 0;
  var label = String(data && data.label != null ? data.label : '').trim();
  var maintenanceId = String(data && data.maintenanceId || '').trim().toUpperCase();
  return { row: row, label: label, maintenanceId: maintenanceId };
}

function findStatusRow_(sheet, data) {
  var hint = statusHint_(data);
  if (!hint.label) return { ok: false, message: 'Select a maintenance job.' };
  var maxRows = sheet.getMaxRows();
  if (hint.row >= REVIEW_START_ROW && hint.row <= maxRows) {
    var hintedId = String(sheet.getRange(hint.row, 1).getDisplayValue() || '').trim().toUpperCase();
    var hintedLabel = String(sheet.getRange(hint.row, 2).getDisplayValue() || '').trim();
    if (hintedLabel === hint.label && hintedId === hint.maintenanceId) return { ok: true, row: hint.row };
  }
  if (maxRows < REVIEW_START_ROW) {
    return { ok: false, message: 'That maintenance job is no longer on the Submission Log.' };
  }
  var height = maxRows - REVIEW_START_ROW + 1;
  var ids = sheet.getRange(REVIEW_START_ROW, 1, height, 1).getDisplayValues();
  var labels = sheet.getRange(REVIEW_START_ROW, 2, height, 1).getDisplayValues();
  var matches = [];
  for (var i = 0; i < labels.length; i++) {
    var label = String(labels[i][0] == null ? '' : labels[i][0]).trim();
    var id = String(ids[i][0] == null ? '' : ids[i][0]).trim().toUpperCase();
    if (label === hint.label && id === hint.maintenanceId) matches.push(i + REVIEW_START_ROW);
  }
  if (matches.length === 1) return { ok: true, row: matches[0] };
  if (!matches.length) return { ok: false, message: 'That maintenance job is no longer on the Submission Log.' };
  return { ok: false, message: 'That job appears more than once. Open it again from the list.' };
}

function statusPlain_(value) {
  if (value == null) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, 'Europe/London', 'dd/MM/yyyy');
  }
  var text = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!String(text).trim()) return '';
  if (/^#(N\/A|REF!|ERROR!|VALUE!|NAME\?|DIV\/0!|NULL!)/.test(String(text).trim())) return '';
  return text;
}

function folderLink_(formula, displayValue) {
  var sources = [String(formula || ''), String(displayValue || '')];
  for (var i = 0; i < sources.length; i++) {
    var match = sources[i].match(/https:\/\/drive\.google\.com\/drive\/folders\/([A-Za-z0-9_-]+)/);
    if (match) {
      return { id: match[1], url: 'https://drive.google.com/drive/folders/' + match[1] };
    }
  }
  return { id: '', url: '' };
}

function childFolderId_(parentId, name) {
  if (!parentId || !name) return '';
  var found = driveFoldersNamed_(parentId, name);
  if (found.length !== 1) return '';
  return found[0].id;
}

function statusFolders_(sheet, row) {
  var maintenanceId = String(sheet.getRange(row, 1).getDisplayValue() || '').trim().toUpperCase();
  var requestsLink = folderLink_(sheet.getRange(row, 13).getFormula(), sheet.getRange(row, 13).getDisplayValue());
  var workLink = folderLink_(sheet.getRange(row, COMPLETE_LINK_COL).getFormula(), sheet.getRange(row, COMPLETE_LINK_COL).getDisplayValue());
  var requestsId = '';
  if (MAINTENANCE_ID_RE.test(maintenanceId) && requestsLink.id) {
    try {
      requestsId = childFolderId_(requestsLink.id, maintenanceId + ' | Requests');
    } catch (err) {
      requestsId = '';
    }
  }
  return {
    requestsId: requestsId,
    requestsUrl: requestsLink.url,
    workId: workLink.id,
    workUrl: workLink.url
  };
}

function safeJobImages_(folderId) {
  if (!folderId) return { photos: [], message: '' };
  try {
    return { photos: driveImagesInFolder_(folderId), message: '' };
  } catch (err) {
    return { photos: [], message: 'The photographs could not be loaded.' };
  }
}

function statusDetail_(sheet, row) {
  function cell(col) {
    return statusPlain_(sheet.getRange(row, col).getValue());
  }
  var folders = statusFolders_(sheet, row);
  var requests = safeJobImages_(folders.requestsId);
  var work = safeJobImages_(folders.workId);
  var partsDisplay = String(sheet.getRange(row, 20).getDisplayValue() || '').trim();
  var partsError = /^#/.test(partsDisplay);
  return {
    result: 'ok',
    row: row,
    maintenanceId: String(sheet.getRange(row, 1).getDisplayValue() || '').trim().toUpperCase(),
    label: String(sheet.getRange(row, 2).getDisplayValue() || '').trim(),
    date: cell(3),
    reporter: cell(5),
    lineArea: cell(6),
    equipment: cell(7),
    priority: cell(8),
    description: cell(10),
    owner: cell(15),
    dueDate: cell(17),
    assessment: cell(19),
    parts: partsError ? '' : statusPlain_(partsDisplay),
    partsError: partsError,
    permit: cell(22),
    workUndertaken: cell(23),
    workOutstanding: cell(24),
    completed: cell(25),
    status: statusPlain_(sheet.getRange(row, STATUS_COL).getDisplayValue()),
    requestsFolderUrl: folders.requestsUrl,
    workFolderUrl: folders.workUrl,
    requestsPhotos: requests.photos,
    workPhotos: work.photos,
    requestsPhotoMessage: requests.message,
    workPhotoMessage: work.message
  };
}

function driveImagesInFolder_(folderId) {
  var q = "trashed = false and mimeType contains 'image/' and '" + folderId + "' in parents";
  var url = 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType)&pageSize=20&q=' + encodeURIComponent(q);
  var data = driveFetch_('get', url);
  var files = data.files || [];
  var images = [];
  for (var i = 0; i < files.length; i++) {
    var mime = String(files[i].mimeType || '');
    if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp' && mime !== 'image/gif') continue;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(files[i].id || ''))) continue;
    images.push({ id: String(files[i].id), name: String(files[i].name || 'Photograph'), mimeType: mime });
    if (images.length >= 20) break;
  }
  return images;
}

function driveThumbnailBytes_(fileId, size) {
  var meta = driveFetch_('get', 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?supportsAllDrives=true&fields=id,name,mimeType,parents,thumbnailLink');
  var mime = String(meta.mimeType || '');
  if (mime.indexOf('image/') !== 0) throw new Error('That file is not a photograph.');
  var link = String(meta.thumbnailLink || '');
  var bytes;
  if (link) {
    var sized = link.replace(/=s\d+$/, '=s' + String(size));
    bytes = driveAuthorizedBytes_(sized);
  } else {
    bytes = driveAuthorizedBytes_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true');
  }
  if (!bytes || bytes.length > 1500000) throw new Error('The photograph is too large to preview.');
  return {
    id: String(meta.id || fileId),
    name: String(meta.name || 'Photograph'),
    mimeType: mime,
    parents: meta.parents || [],
    imageBase64: Utilities.base64Encode(bytes)
  };
}

function driveAuthorizedBytes_(url) {
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('The photograph could not be opened (' + code + ').');
  return resp.getBlob().getBytes();
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
