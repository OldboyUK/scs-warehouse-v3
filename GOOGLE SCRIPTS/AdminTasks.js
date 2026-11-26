/**
 * SCS Admin Tasks — Create Task.
 *
 * Deploy this file as its own Apps Script web app (separate from Warehouse, Auth,
 * HR, Health and Safety, Quality, and Maintenance).
 * Execute as: Me. Who has access: Anyone.
 * The deploying account must be able to edit spreadsheet
 * 1Ylcv5M-Kb0QsTU5sWkxtloVb7C4EndkZu1rRPT8ILeY
 * and must allow UrlFetchApp (scope https://www.googleapis.com/auth/script.external_request
 * plus https://www.googleapis.com/auth/spreadsheets).
 *
 * After deploying a new version, set the web app /exec URL in Netlify as ADMIN_TASKS_SCRIPT_URL.
 * Do not put that URL in the frontend.
 *
 * Writes one Task row and one Actions row per action.
 * Only the listed columns are written, one cell at a time.
 * Column A and column E are formula-owned on both sheets and are never written.
 * Task gid 1159021811: B title, C task area ID, D task ID, F description.
 * Task column G is never written.
 * Actions gid 1408515271: B task area ID, C task ID, D action ID, F description, G owner, H due date, I priority, J stage.
 * A new action is written as Open in column J.
 * Complete Actions updates an existing Actions row in columns J, K and L only.
 *
 * The next row is the first column A cell whose displayed text is empty.
 * A formula that displays "" is available. A column A cell that displays an ID is not.
 */

var API_TOKEN = 'J4PAN88';
var SSID_ADMIN = '1Ylcv5M-Kb0QsTU5sWkxtloVb7C4EndkZu1rRPT8ILeY';
var SHEET_TASK = 'Task';
var GID_TASK = 1159021811;
var SHEET_ACTIONS = 'Actions';
var GID_ACTIONS = 1408515271;
var TASK_AREAS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTabUIIs_BN-OjPd_ClG7ys-Cjwzi8O2XtBd3byC0IpAA3KBjiufvUurnEZWWuW1t9jFf2tNW_uwAIy/pub?gid=369796982&single=true&output=csv';
var OWNERS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGQPFKtlsrGvGNCDKR1OuNP6Dh0687pb8EnpRhJmbD0WxMaHqiX6ia_VUoRudMNylVjkLI4YJ0gsj-/pub?gid=559712901&single=true&output=csv';

var TASK_WRITE_COLUMNS = [2, 3, 4, 6];
var ACTION_WRITE_COLUMNS = [2, 3, 4, 6, 7, 8, 9, 10];
var ACTION_STAGE_OPEN = 'Open';
var MAX_TEXT = 8000;
var MAX_ACTIONS = 100;
var SUBMISSION_INDEX_KEY = 'AT_TASK_SUBMISSION_INDEX';

function doPost(e) {
  try {
    var p = readPostParams_(e);
    var token = String(p.token || '').trim();
    if (token !== API_TOKEN) {
      return json({ result: 'error', retryable: false, message: 'Unauthorized' });
    }

    var action = String(p.action || '').trim().toLowerCase();
    if (action === 'admin_task_submit') return handleAdminTaskSubmit_(p);
    if (action === 'admin_actions_list') return handleAdminActionsList_();
    if (action === 'admin_action_update') return handleAdminActionUpdate_(p);
    return json({ result: 'error', retryable: false, message: 'Unknown action: ' + action });
  } catch (err) {
    return json({ result: 'error', retryable: true, message: publicMessage_(err) });
  }
}

function handleAdminTaskSubmit_(p) {
  var taskAreas;
  var owners;
  try {
    taskAreas = loadTaskAreas_();
    owners = loadOwners_();
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'Task areas or owners could not be loaded, so the task was not saved. ' + publicMessage_(err)
    });
  }

  var validated = validateSubmission_(p, taskAreas, owners);
  if (!validated.ok) {
    return json({ result: 'error', retryable: true, message: validated.message });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return json({
      result: 'error',
      retryable: true,
      message: 'Another administrative task is being saved. Please wait a moment and try again.'
    });
  }

  try {
    return saveTask_(validated.value);
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The administrative task was not saved. ' + publicMessage_(err)
    });
  } finally {
    lock.releaseLock();
  }
}

function saveTask_(value) {
  var fingerprint = fingerprint_(value);
  var existing = loadRecord_(value.submissionId);

  if (existing && existing.status === 'success') {
    if (existing.fingerprint !== fingerprint) {
      return json({
        result: 'error',
        retryable: false,
        partial: true,
        taskAreaId: existing.taskAreaId,
        taskId: existing.taskId,
        actionIds: existing.actionIds || [],
        message: 'This submission was already saved as ' + existing.taskAreaId + '-' + existing.taskId + '. It was not changed and was not saved again.'
      });
    }
    return json(existing.result);
  }

  if (existing && existing.status === 'partial') {
    return json(existing.result || {
      result: 'error',
      partial: true,
      retryable: false,
      taskAreaId: existing.taskAreaId,
      taskId: existing.taskId,
      actionIds: existing.actionIds || [],
      message: 'This submission was not fully saved. Task ' + existing.taskAreaId + '-' + existing.taskId + ' needs to be checked before anything else is written.'
    });
  }

  var ss = SpreadsheetApp.openById(SSID_ADMIN);
  var taskSheet = requireSheet_(ss, SHEET_TASK, GID_TASK);
  var actionsSheet = requireSheet_(ss, SHEET_ACTIONS, GID_ACTIONS);
  assertNoArrayFormula_(taskSheet, TASK_WRITE_COLUMNS, 'Task');
  assertNoArrayFormula_(actionsSheet, ACTION_WRITE_COLUMNS, 'Actions');

  var taskAreaId = value.taskAreaId;
  var taskId;
  var actionIds;

  if (existing && existing.status === 'pending') {
    taskId = String(existing.taskId || '');
    actionIds = existing.actionIds || [];
    var rowsExist = submissionRowsExist_(taskSheet, actionsSheet, taskAreaId, taskId, actionIds);
    if (existing.fingerprint !== fingerprint) {
      if (rowsExist) {
        return json({
          result: 'error',
          retryable: false,
          partial: true,
          taskAreaId: taskAreaId,
          taskId: taskId,
          actionIds: actionIds,
          message: 'This submission is already in progress with different details. Task ' + taskAreaId + '-' + taskId + ' was left unchanged. Nothing new was written.'
        });
      }
      actionIds = actionIdsForNewTask_(value.actions.length);
      saveRecord_(value.submissionId, pendingRecord_(value, fingerprint, taskAreaId, taskId, actionIds));
    } else if (!taskId || !sameIds_(actionIds, actionIdsForNewTask_(value.actions.length))) {
      return json({
        result: 'error',
        partial: true,
        retryable: false,
        taskAreaId: taskAreaId,
        taskId: taskId,
        actionIds: actionIds,
        message: 'This submission was interrupted and cannot be continued safely. Task ' + (taskId ? taskAreaId + '-' + taskId : '(unknown)') + ' needs to be checked. Nothing new was written.'
      });
    }
  } else {
    var identities = taskIdentityIds_(taskSheet).concat(reservedTaskCodes_());
    taskId = nextTaskId_(taskAreaId, identities);
    actionIds = actionIdsForNewTask_(value.actions.length);
    saveRecord_(value.submissionId, pendingRecord_(value, fingerprint, taskAreaId, taskId, actionIds));
  }

  var written = [];
  var taskRow = 0;
  var actionRows = [];
  try {
    taskRow = findTaskRow_(taskSheet, taskAreaId, taskId);
    if (!taskRow) taskRow = findSafeRows_(taskSheet, 1)[0];
    alignRow_(taskSheet, taskRow, taskCells_(taskAreaId, taskId, value), written);

    var missing = [];
    for (var j = 0; j < actionIds.length; j++) {
      var existingActionRow = findActionRow_(actionsSheet, taskAreaId, taskId, actionIds[j]);
      if (existingActionRow) actionRows[j] = existingActionRow;
      else missing.push(j);
    }
    if (missing.length) {
      var freeRows = findSafeRows_(actionsSheet, missing.length);
      for (var m = 0; m < missing.length; m++) {
        var index = missing[m];
        actionRows[index] = freeRows[m];
        alignRow_(actionsSheet, freeRows[m], actionCells_(taskAreaId, taskId, actionIds[index], value.actions[index]), written);
      }
    }

    SpreadsheetApp.flush();
    verifyRow_(taskSheet, taskRow, taskCells_(taskAreaId, taskId, value));
    for (var k = 0; k < actionIds.length; k++) {
      if (!actionRows[k]) throw new Error('Action ' + actionIds[k] + ' could not be confirmed.');
      verifyRow_(actionsSheet, actionRows[k], actionCells_(taskAreaId, taskId, actionIds[k], value.actions[k]));
    }

    var success = successResult_(taskAreaId, taskId, actionIds);
    saveRecord_(value.submissionId, {
      status: 'success',
      fingerprint: fingerprint,
      taskAreaId: taskAreaId,
      taskId: taskId,
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
        taskAreaId: taskAreaId,
        taskId: taskId,
        actionIds: actionIds,
        message: 'The administrative task was not saved. ' + publicMessage_(err) + ' Task ' + taskAreaId + '-' + taskId + ' was left unchanged where it already existed.'
      };
      saveRecord_(value.submissionId, {
        status: 'partial',
        fingerprint: fingerprint,
        taskAreaId: taskAreaId,
        taskId: taskId,
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
        taskAreaId: taskAreaId,
        taskId: taskId,
        actionIds: actionIds,
        message: 'The administrative task was not fully saved. Task ' + taskAreaId + '-' + taskId + ' needs to be checked on the Task and Actions sheets. Do not submit this same task again. ' + publicMessage_(err)
      };
      saveRecord_(value.submissionId, {
        status: 'partial',
        fingerprint: fingerprint,
        taskAreaId: taskAreaId,
        taskId: taskId,
        actionIds: actionIds,
        result: partialResult
      });
      return json(partialResult);
    }

    var stillThere = submissionRowsExist_(taskSheet, actionsSheet, taskAreaId, taskId, actionIds);
    if (stillThere) {
      saveRecord_(value.submissionId, pendingRecord_(value, fingerprint, taskAreaId, taskId, actionIds));
      return json({
        result: 'error',
        retryable: true,
        taskAreaId: taskAreaId,
        taskId: taskId,
        actionIds: actionIds,
        message: 'The administrative task was not fully saved. Task ' + taskAreaId + '-' + taskId + ' is already reserved. Submit again to finish the missing records. A duplicate task will not be created. ' + publicMessage_(err)
      });
    }

    deleteRecord_(value.submissionId);
    return json({
      result: 'error',
      retryable: true,
      message: 'The administrative task was not saved. ' + publicMessage_(err)
    });
  }
}

function pendingRecord_(value, fingerprint, taskAreaId, taskId, actionIds) {
  return {
    status: 'pending',
    fingerprint: fingerprint,
    taskAreaId: taskAreaId,
    taskId: taskId,
    actionIds: actionIds
  };
}

function successResult_(taskAreaId, taskId, actionIds) {
  var completeActionIds = [];
  for (var i = 0; i < actionIds.length; i++) {
    completeActionIds.push(completeActionId_(taskAreaId, taskId, actionIds[i]));
  }
  return {
    result: 'success',
    taskAreaId: taskAreaId,
    taskId: taskId,
    actionIds: actionIds,
    completeTaskId: completeTaskId_(taskAreaId, taskId),
    completeActionIds: completeActionIds
  };
}

function taskCells_(taskAreaId, taskId, value) {
  return [
    { col: 2, value: value.title, type: 'text' },
    { col: 3, value: taskAreaId, type: 'text' },
    { col: 4, value: taskId, type: 'text' },
    { col: 6, value: value.description, type: 'text' }
  ];
}

function actionCells_(taskAreaId, taskId, actionId, action) {
  return [
    { col: 2, value: taskAreaId, type: 'text' },
    { col: 3, value: taskId, type: 'text' },
    { col: 4, value: actionId, type: 'text' },
    { col: 6, value: action.description, type: 'text' },
    { col: 7, value: action.owner, type: 'text' },
    { col: 8, value: action.dueDate, type: 'text' },
    { col: 9, value: action.priority, type: 'number' },
    { col: 10, value: ACTION_STAGE_OPEN, type: 'text' }
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
  var allowed = sheet.getName() === SHEET_TASK ? TASK_WRITE_COLUMNS : ACTION_WRITE_COLUMNS;
  if (allowed.indexOf(col) === -1) {
    throw new Error('Refusing to write column ' + columnLetter_(col) + ' on ' + sheet.getName() + '.');
  }
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
        throw new Error(label + ' column ' + columnLetter_(columns[c]) + ' contains an array formula. The task was not saved, so those formulas were not overwritten.');
      }
    }
  }
}

function taskIdentityIds_(sheet) {
  var ids = [];
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) return ids;
  var num = maxRows - 1;
  var displays = sheet.getRange(2, 1, num, 1).getDisplayValues();
  var areaValues = sheet.getRange(2, 3, num, 1).getValues();
  var taskValues = sheet.getRange(2, 4, num, 1).getValues();
  for (var i = 0; i < num; i++) {
    var area = String(areaValues[i][0] == null ? '' : areaValues[i][0]).trim();
    var task = String(taskValues[i][0] == null ? '' : taskValues[i][0]).trim();
    if (/^[A-Za-z0-9]{6}$/.test(area) && /^TA\d+$/.test(task)) {
      ids.push(area + '-' + formatTaskId_(parseInt(task.substring(2), 10)));
    }
    var shown = String(displays[i][0] == null ? '' : displays[i][0]).trim();
    var match = shown.match(/^([A-Za-z0-9]{6})-TA(\d+)$/);
    if (match) ids.push(match[1] + '-' + formatTaskId_(parseInt(match[2], 10)));
  }
  return ids;
}

function submissionRowsExist_(taskSheet, actionsSheet, taskAreaId, taskId, actionIds) {
  if (findTaskRow_(taskSheet, taskAreaId, taskId)) return true;
  var list = actionIds || [];
  for (var i = 0; i < list.length; i++) {
    if (findActionRow_(actionsSheet, taskAreaId, taskId, list[i])) return true;
  }
  return false;
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

function findTaskRow_(sheet, taskAreaId, taskId) {
  var byDisplay = findIdRow_(sheet, completeTaskId_(taskAreaId, taskId));
  if (byDisplay) return byDisplay;
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) return 0;
  var num = maxRows - 1;
  var displays = sheet.getRange(2, 1, num, 1).getDisplayValues();
  var areaValues = sheet.getRange(2, 3, num, 1).getValues();
  var taskValues = sheet.getRange(2, 4, num, 1).getValues();
  for (var i = 0; i < num; i++) {
    var shown = String(displays[i][0] == null ? '' : displays[i][0]).trim();
    if (shown) continue;
    if (String(areaValues[i][0] == null ? '' : areaValues[i][0]).trim() === taskAreaId &&
        String(taskValues[i][0] == null ? '' : taskValues[i][0]).trim() === taskId) {
      return i + 2;
    }
  }
  return 0;
}

function findActionRow_(sheet, taskAreaId, taskId, actionId) {
  var byDisplay = findIdRow_(sheet, completeActionId_(taskAreaId, taskId, actionId));
  if (byDisplay) return byDisplay;
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) return 0;
  var num = maxRows - 1;
  var displays = sheet.getRange(2, 1, num, 1).getDisplayValues();
  var areaValues = sheet.getRange(2, 2, num, 1).getValues();
  var taskValues = sheet.getRange(2, 3, num, 1).getValues();
  var actionValues = sheet.getRange(2, 4, num, 1).getValues();
  for (var i = 0; i < num; i++) {
    var shown = String(displays[i][0] == null ? '' : displays[i][0]).trim();
    if (shown) continue;
    if (String(areaValues[i][0] == null ? '' : areaValues[i][0]).trim() === taskAreaId &&
        String(taskValues[i][0] == null ? '' : taskValues[i][0]).trim() === taskId &&
        String(actionValues[i][0] == null ? '' : actionValues[i][0]).trim() === actionId) {
      return i + 2;
    }
  }
  return 0;
}

function completeTaskId_(taskAreaId, taskId) {
  return String(taskAreaId || '') + '-' + String(taskId || '');
}

function completeActionId_(taskAreaId, taskId, actionId) {
  return completeTaskId_(taskAreaId, taskId) + '-' + String(actionId || '');
}

function nextTaskId_(area, ids) {
  var re = new RegExp('^' + escapeRegExp_(area) + '-TA(\\d+)$');
  var max = 0;
  var existing = {};
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i] || '').trim();
    if (!id) continue;
    var match = id.match(re);
    if (!match) continue;
    var n = parseInt(match[1], 10);
    if (n > max) max = n;
    existing[area + '-' + formatTaskId_(n)] = true;
  }

  var next = max + 1;
  var guard = 0;
  var candidate = area + '-' + formatTaskId_(next);
  while (existing[candidate]) {
    next++;
    guard++;
    if (guard > 10000) throw new Error('Could not allocate a unique task ID.');
    candidate = area + '-' + formatTaskId_(next);
  }
  return formatTaskId_(next);
}

function actionIdsForNewTask_(count) {
  var ids = [];
  for (var i = 1; i <= count; i++) ids.push('AC' + String(i));
  return ids;
}

function sameIds_(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (var i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function formatTaskId_(n) {
  var suffix = n < 1000 ? pad3_(n) : String(n);
  return 'TA' + suffix;
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

function fetchCsv_(url, label) {
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code !== 200 || !text || String(text).replace(/^\uFEFF/, '').trim().charAt(0) === '<') {
    throw new Error(label + ' request failed (' + code + ').');
  }
  return text;
}

function loadTaskAreas_() {
  var areas = taskAreasFromCsv_(fetchCsv_(TASK_AREAS_CSV_URL, 'Task areas'));
  if (!areas.length) throw new Error('The task area list was empty.');
  return areas;
}

function loadOwners_() {
  var owners = ownersFromCsv_(fetchCsv_(OWNERS_CSV_URL, 'Owners'));
  if (!owners.length) throw new Error('The owner list was empty.');
  return owners;
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

function taskAreaIdFromValue_(value) {
  var text = String(value || '');
  if (text.length < 6) return '';
  var code = text.substring(0, 6);
  if (!/^[A-Za-z0-9]{6}$/.test(code)) return '';
  if (text.length > 6 && /[A-Za-z0-9]/.test(text.charAt(6))) return '';
  return code;
}

function taskAreasFromCsv_(text) {
  var rows = parseCsv_(text);
  var list = [];
  var seen = {};

  for (var i = 1; i < rows.length; i++) {
    var source = rows[i] || [];
    var label = String(source[1] == null ? '' : source[1]).trim();
    var value = String(source[2] == null ? '' : source[2]).trim();
    if (!label || !value || seen[value]) continue;
    var id = taskAreaIdFromValue_(value);
    if (!id) continue;
    seen[value] = true;
    list.push({ label: label, value: value, id: id });
  }

  return list;
}

function ownersFromCsv_(text) {
  var rows = parseCsv_(text);
  var list = [];
  var seen = {};

  for (var i = 1; i < rows.length; i++) {
    var source = rows[i] || [];
    var name = String(source[2] == null ? '' : source[2]).trim();
    if (!name || seen[name]) continue;
    seen[name] = true;
    list.push(name);
  }

  return list;
}

function loadTaskAreasFromText_(text) {
  return taskAreasFromCsv_(text);
}

function loadOwnersFromText_(text) {
  return ownersFromCsv_(text);
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

  var dd = day < 10 ? '0' + day : String(day);
  var mm = month < 10 ? '0' + month : String(month);
  return dd + '/' + mm + '/' + String(year);
}

function requireText_(value, label) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return { ok: false, message: label };
  if (text.length > MAX_TEXT) return { ok: false, message: label + ' is too long.' };
  return { ok: true, value: text };
}

function validateSubmission_(payload, areas, owners) {
  var data = payload || {};
  var submissionId = String(data.submissionId || '').trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(submissionId)) {
    return { ok: false, message: 'The submission could not be identified. Reload the page and try again.' };
  }

  var taskAreaValue = String(data.taskAreaValue == null ? '' : data.taskAreaValue).trim();
  var area = null;
  var list = areas || [];
  for (var a = 0; a < list.length; a++) {
    if (list[a] && list[a].value === taskAreaValue) {
      area = list[a];
      break;
    }
  }
  if (!area) return { ok: false, message: 'Select the relevant task area.' };
  if (/[\u0000-\u001F]/.test(taskAreaValue) || taskAreaValue.length > 300) {
    return { ok: false, message: 'Select the relevant task area.' };
  }
  var taskAreaId = taskAreaIdFromValue_(area.value);
  if (!taskAreaId || taskAreaId !== area.id) {
    return { ok: false, message: 'The selected task area does not start with a 6-character task area ID.' };
  }

  var title = requireText_(data.title, 'Please give this job a title.');
  if (!title.ok) return title;
  var description = requireText_(data.description, 'Enter a task description.');
  if (!description.ok) return description;

  if (!Array.isArray(data.actions) || data.actions.length < 1) {
    return { ok: false, message: 'Add at least one action.' };
  }
  if (data.actions.length > MAX_ACTIONS) {
    return { ok: false, message: 'An administrative task can include up to ' + MAX_ACTIONS + ' actions.' };
  }

  var ownerList = owners || [];
  var actions = [];
  for (var i = 0; i < data.actions.length; i++) {
    var source = data.actions[i] || {};
    var labelNo = i + 1;
    var actionText = requireText_(source.description, 'Enter the description for Action ' + labelNo + '.');
    if (!actionText.ok) return actionText;
    var owner = String(source.owner == null ? '' : source.owner).trim();
    if (!owner || ownerList.indexOf(owner) === -1) {
      return { ok: false, message: 'Select an owner for Action ' + labelNo + '.' };
    }
    var dueDate = parseDueDate_(source.dueDate);
    if (!dueDate) return { ok: false, message: 'Enter a valid due date for Action ' + labelNo + '.' };
    var priority = parseScore_(source.priority);
    if (priority == null) return { ok: false, message: 'Select a priority from 1 to 5 for Action ' + labelNo + '.' };
    actions.push({
      description: actionText.value,
      owner: owner,
      dueDate: dueDate,
      priority: priority
    });
  }

  return {
    ok: true,
    value: {
      submissionId: submissionId,
      taskAreaValue: area.value,
      taskAreaLabel: area.label,
      taskAreaId: taskAreaId,
      title: title.value,
      description: description.value,
      actions: actions
    }
  };
}

function fingerprint_(value) {
  var canonical = JSON.stringify({
    submissionId: value.submissionId,
    taskAreaValue: value.taskAreaValue,
    taskAreaId: value.taskAreaId,
    title: value.title,
    description: value.description,
    actions: value.actions.map(function (action) {
      return {
        description: action.description,
        owner: action.owner,
        dueDate: action.dueDate,
        priority: action.priority
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
  var raw = props_().getProperty('AT_SUB_' + submissionId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

function saveRecord_(submissionId, record) {
  record.at = Date.now();
  var props = props_();
  props.setProperty('AT_SUB_' + submissionId, JSON.stringify(record));
  var index = [];
  try { index = JSON.parse(props.getProperty(SUBMISSION_INDEX_KEY) || '[]'); } catch (err) { index = []; }
  if (!Array.isArray(index)) index = [];
  index = index.filter(function (item) { return item !== submissionId; });
  index.push(submissionId);
  while (index.length > 100) {
    var oldId = index.shift();
    props.deleteProperty('AT_SUB_' + oldId);
  }
  props.setProperty(SUBMISSION_INDEX_KEY, JSON.stringify(index));
}

function deleteRecord_(submissionId) {
  var props = props_();
  props.deleteProperty('AT_SUB_' + submissionId);
  var index = [];
  try { index = JSON.parse(props.getProperty(SUBMISSION_INDEX_KEY) || '[]'); } catch (err) { index = []; }
  if (!Array.isArray(index)) index = [];
  props.setProperty(SUBMISSION_INDEX_KEY, JSON.stringify(index.filter(function (item) {
    return item !== submissionId;
  })));
}

function reservedTaskCodes_() {
  var ids = [];
  var index = [];
  try { index = JSON.parse(props_().getProperty(SUBMISSION_INDEX_KEY) || '[]'); } catch (err) { index = []; }
  if (!Array.isArray(index)) return ids;
  for (var i = 0; i < index.length; i++) {
    var record = loadRecord_(index[i]);
    if (!record || !record.taskAreaId || !record.taskId) continue;
    if (record.status === 'pending' || record.status === 'success' || record.status === 'partial') {
      ids.push(String(record.taskAreaId) + '-' + String(record.taskId));
    }
  }
  return ids;
}

var ACTION_STATUSES = ['Open', 'In Progress', 'Blocked', 'Cancelled', 'Completed'];
var ACTION_UPDATE_COLUMNS = [10, 11, 12];
var UPDATE_INDEX_KEY = 'AT_ACTION_UPDATE_INDEX';
var MAX_EVIDENCE = 8000;
var MAX_NOTE_CELL = 50000;

function handleAdminActionsList_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return json({
      result: 'error',
      retryable: true,
      message: 'Actions are being updated. Please wait a moment and try again.'
    });
  }
  try {
    var ss = SpreadsheetApp.openById(SSID_ADMIN);
    var actionsSheet = requireSheet_(ss, SHEET_ACTIONS, GID_ACTIONS);
    return json({ result: 'ok', actions: listActions_(actionsSheet) });
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'Actions could not be loaded. ' + publicMessage_(err)
    });
  } finally {
    lock.releaseLock();
  }
}

function handleAdminActionUpdate_(p) {
  var validated = validateActionUpdate_(p);
  if (!validated.ok) {
    return json({ result: 'error', retryable: true, message: validated.message });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return json({
      result: 'error',
      retryable: true,
      message: 'Another action update is being saved. Please wait a moment and try again.'
    });
  }
  try {
    return saveActionUpdate_(validated.value);
  } catch (err) {
    return json({
      result: 'error',
      retryable: true,
      message: 'The action update was not saved. ' + publicMessage_(err)
    });
  } finally {
    lock.releaseLock();
  }
}

function saveActionUpdate_(value) {
  var fingerprint = updateFingerprint_(value);
  var existing = loadUpdate_(value.submissionId);
  if (existing && existing.status === 'success') {
    if (existing.fingerprint !== fingerprint) {
      return json({
        result: 'error',
        retryable: false,
        message: 'This update was already saved for ' + existing.completeActionId + '. It was not changed and the evidence was not added again.'
      });
    }
    return json(existing.result);
  }
  if (existing && existing.status === 'partial') {
    return json(existing.result || {
      result: 'error',
      partial: true,
      retryable: false,
      message: 'This update was not fully saved. Check ' + value.completeActionId + ' before trying again.'
    });
  }

  var ss = SpreadsheetApp.openById(SSID_ADMIN);
  var actionsSheet = requireSheet_(ss, SHEET_ACTIONS, GID_ACTIONS);
  assertNoArrayFormula_(actionsSheet, ACTION_UPDATE_COLUMNS, 'Actions');
  var row = findUpdateRow_(actionsSheet, value);
  if (!row) {
    return json({
      result: 'error',
      retryable: true,
      message: 'That action could not be found. Refresh the list and select it again. Nothing was changed.'
    });
  }
  if (!rowMatchesUpdate_(actionsSheet, row, value)) {
    return json({
      result: 'error',
      retryable: false,
      message: 'That action no longer matches the selected record. Nothing was changed.'
    });
  }

  var currentEvidence = cellText_(actionsSheet, row, 12);
  var submittedOn = todayUk_();
  var entry = evidenceEntry_(submittedOn, value.evidence);
  var combined = appendEvidence_(currentEvidence, entry);
  if (combined.length > MAX_NOTE_CELL) {
    return json({
      result: 'error',
      retryable: false,
      message: 'The evidence history for this action is full. Nothing was changed.'
    });
  }

  var previous = [];
  try {
    previous = replaceUpdateCells_(actionsSheet, row, [
      { col: 10, value: value.status },
      { col: 11, value: submittedOn },
      { col: 12, value: combined }
    ]);
    SpreadsheetApp.flush();
    verifyUpdate_(actionsSheet, row, value.status, submittedOn, combined);
    var success = {
      result: 'success',
      completeActionId: value.completeActionId,
      taskAreaId: value.taskAreaId,
      taskId: value.taskId,
      actionId: value.actionId,
      status: value.status,
      submittedOn: submittedOn,
      evidence: combined
    };
    saveUpdate_(value.submissionId, {
      status: 'success',
      fingerprint: fingerprint,
      completeActionId: value.completeActionId,
      result: success
    });
    return json(success);
  } catch (err) {
    var failed = restoreUpdateCells_(actionsSheet, previous);
    if (failed.length) {
      var partialResult = {
        result: 'error',
        partial: true,
        retryable: false,
        completeActionId: value.completeActionId,
        message: 'The action update was not fully saved. Check ' + value.completeActionId + ' on the Actions sheet before trying again. ' + publicMessage_(err)
      };
      saveUpdate_(value.submissionId, {
        status: 'partial',
        fingerprint: fingerprint,
        completeActionId: value.completeActionId,
        result: partialResult
      });
      return json(partialResult);
    }
    return json({
      result: 'error',
      retryable: true,
      message: 'The action update was not saved. ' + publicMessage_(err)
    });
  }
}

function listActions_(sheet) {
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) return [];
  var num = maxRows - 1;
  var colA = sheet.getRange(2, 1, num, 1).getDisplayValues();
  var colB = sheet.getRange(2, 2, num, 1).getDisplayValues();
  var colC = sheet.getRange(2, 3, num, 1).getDisplayValues();
  var colD = sheet.getRange(2, 4, num, 1).getDisplayValues();
  var colE = sheet.getRange(2, 5, num, 1).getDisplayValues();
  var colG = sheet.getRange(2, 7, num, 1).getDisplayValues();
  var colH = sheet.getRange(2, 8, num, 1).getDisplayValues();
  var colJ = sheet.getRange(2, 10, num, 1).getDisplayValues();
  var colL = sheet.getRange(2, 12, num, 1).getDisplayValues();
  var actions = [];
  var seen = {};
  for (var i = 0; i < num; i++) {
    var label = String(colE[i][0] == null ? '' : colE[i][0]).trim();
    if (!label) continue;
    var identity = actionIdentity_(colA[i][0], colB[i][0], colC[i][0], colD[i][0]);
    if (!identity || seen[identity.completeActionId]) continue;
    seen[identity.completeActionId] = true;
    var evidence = String(colL[i][0] == null ? '' : colL[i][0]);
    if (evidence.length > 20000) evidence = evidence.substring(0, 20000);
    var rawStatus = String(colJ[i][0] == null ? '' : colJ[i][0]).trim();
    actions.push({
      completeActionId: identity.completeActionId,
      taskAreaId: identity.taskAreaId,
      taskId: identity.taskId,
      actionId: identity.actionId,
      label: label,
      owner: String(colG[i][0] == null ? '' : colG[i][0]).trim(),
      dueDate: String(colH[i][0] == null ? '' : colH[i][0]).trim(),
      status: ACTION_STATUSES.indexOf(rawStatus) === -1 ? '' : rawStatus,
      statusLabel: rawStatus || 'No status',
      evidence: evidence
    });
  }
  return actions;
}

function actionIdentity_(complete, area, task, action) {
  var shown = String(complete == null ? '' : complete).trim();
  var taskAreaId = String(area == null ? '' : area).trim();
  var taskId = String(task == null ? '' : task).trim();
  var actionId = String(action == null ? '' : action).trim();
  var parsed = parseCompleteActionId_(shown);
  if (parsed) {
    if (!taskAreaId) taskAreaId = parsed.taskAreaId;
    if (!taskId) taskId = parsed.taskId;
    if (!actionId) actionId = parsed.actionId;
    if (taskAreaId !== parsed.taskAreaId || taskId !== parsed.taskId || actionId !== parsed.actionId) return null;
    return parsed;
  }
  if (!/^[A-Za-z0-9]{6}$/.test(taskAreaId) || !/^TA\d+$/.test(taskId) || !/^AC\d+$/.test(actionId)) return null;
  return {
    completeActionId: completeActionId_(taskAreaId, taskId, actionId),
    taskAreaId: taskAreaId,
    taskId: taskId,
    actionId: actionId
  };
}

function parseCompleteActionId_(value) {
  var match = String(value || '').trim().match(/^([A-Za-z0-9]{6})-(TA\d+)-(AC\d+)$/);
  if (!match) return null;
  return {
    completeActionId: match[1] + '-' + match[2] + '-' + match[3],
    taskAreaId: match[1],
    taskId: match[2],
    actionId: match[3]
  };
}

function findUpdateRow_(sheet, value) {
  var byDisplay = findIdRow_(sheet, value.completeActionId);
  var byParts = findActionRow_(sheet, value.taskAreaId, value.taskId, value.actionId);
  if (byDisplay && byParts && byDisplay !== byParts) return 0;
  return byDisplay || byParts || 0;
}

function rowMatchesUpdate_(sheet, row, value) {
  var shown = cellDisplay_(sheet, row, 1);
  var area = cellDisplay_(sheet, row, 2);
  var task = cellDisplay_(sheet, row, 3);
  var action = cellDisplay_(sheet, row, 4);
  if (shown && shown !== value.completeActionId) return false;
  if (area && area !== value.taskAreaId) return false;
  if (task && task !== value.taskId) return false;
  if (action && action !== value.actionId) return false;
  return true;
}

function cellDisplay_(sheet, row, col) {
  var values = sheet.getRange(row, col).getDisplayValues();
  return String(values[0][0] == null ? '' : values[0][0]).trim();
}

function cellText_(sheet, row, col) {
  var values = sheet.getRange(row, col).getDisplayValues();
  return String(values[0][0] == null ? '' : values[0][0]);
}

function validateActionUpdate_(payload) {
  var data = payload || {};
  var submissionId = String(data.submissionId || '').trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(submissionId)) {
    return { ok: false, message: 'The submission could not be identified. Reload the page and try again.' };
  }
  var identity = parseCompleteActionId_(data.completeActionId);
  if (!identity) return { ok: false, message: 'Select an action from the list.' };
  var taskAreaId = String(data.taskAreaId || '').trim();
  var taskId = String(data.taskId || '').trim();
  var actionId = String(data.actionId || '').trim();
  if ((taskAreaId && taskAreaId !== identity.taskAreaId) ||
      (taskId && taskId !== identity.taskId) ||
      (actionId && actionId !== identity.actionId)) {
    return { ok: false, message: 'Select an action from the list.' };
  }
  var evidence = String(data.evidence == null ? '' : data.evidence).trim();
  if (!evidence) return { ok: false, message: 'Enter the evidence of work carried out.' };
  if (evidence.length > MAX_EVIDENCE) return { ok: false, message: 'The evidence of work carried out is too long.' };
  var status = String(data.status || '').trim();
  if (ACTION_STATUSES.indexOf(status) === -1) {
    return { ok: false, message: 'Select the current status of this action.' };
  }
  return {
    ok: true,
    value: {
      submissionId: submissionId,
      completeActionId: identity.completeActionId,
      taskAreaId: identity.taskAreaId,
      taskId: identity.taskId,
      actionId: identity.actionId,
      evidence: evidence,
      status: status
    }
  };
}

function evidenceEntry_(date, evidence) {
  return String(date) + ' - Work carried out: ' + String(evidence);
}

function appendEvidence_(existing, entry) {
  var prior = String(existing == null ? '' : existing).replace(/\s+$/, '');
  if (!prior) return entry;
  return prior + '\n' + entry;
}

function todayUk_() {
  return Utilities.formatDate(new Date(), 'Europe/London', 'dd/MM/yyyy');
}

function updateFingerprint_(value) {
  return [
    value.submissionId,
    value.completeActionId,
    value.status,
    value.evidence
  ].join('\n');
}

function replaceUpdateCells_(sheet, row, cells) {
  if (row < 2) throw new Error('Refusing to write on the header row.');
  var previous = [];
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
    if (ACTION_UPDATE_COLUMNS.indexOf(cell.col) === -1) {
      throw new Error('Refusing to write column ' + columnLetter_(cell.col) + ' on ' + sheet.getName() + '.');
    }
    var range = sheet.getRange(row, cell.col);
    var formula = range.getFormula();
    if (formula != null && String(formula).trim() !== '') {
      throw new Error('Column ' + columnLetter_(cell.col) + ' on Actions contains a formula. The update was not saved.');
    }
    previous.push({
      row: row,
      col: cell.col,
      value: range.getValue(),
      format: range.getNumberFormat()
    });
    range.setNumberFormat('@');
    range.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(String(cell.value)).build());
  }
  return previous;
}

function restoreUpdateCells_(sheet, previous) {
  var failed = [];
  for (var i = previous.length - 1; i >= 0; i--) {
    var entry = previous[i];
    try {
      var range = sheet.getRange(entry.row, entry.col);
      var empty = entry.value == null || String(entry.value) === '';
      if (empty) {
        range.clearContent();
      } else {
        range.setNumberFormat('@');
        range.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(String(entry.value)).build());
      }
      if (entry.format != null && entry.format !== '') range.setNumberFormat(entry.format);
      var now = range.getValue();
      if (empty) {
        if (now != null && String(now) !== '') failed.push(entry);
      } else if (String(now) !== String(entry.value)) {
        failed.push(entry);
      }
    } catch (err) {
      failed.push(entry);
    }
  }
  return failed;
}

function verifyUpdate_(sheet, row, status, submittedOn, evidence) {
  if (cellDisplay_(sheet, row, 10) !== status) throw new Error('The status could not be confirmed.');
  if (cellDisplay_(sheet, row, 11) !== submittedOn) throw new Error('The submission date could not be confirmed.');
  if (cellText_(sheet, row, 12) !== evidence) throw new Error('The evidence could not be confirmed.');
}

function loadUpdate_(submissionId) {
  var raw = props_().getProperty('AT_UPD_' + submissionId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

function saveUpdate_(submissionId, record) {
  record.at = Date.now();
  var props = props_();
  props.setProperty('AT_UPD_' + submissionId, JSON.stringify(record));
  var index = [];
  try { index = JSON.parse(props.getProperty(UPDATE_INDEX_KEY) || '[]'); } catch (err) { index = []; }
  if (!Array.isArray(index)) index = [];
  index = index.filter(function (item) { return item !== submissionId; });
  index.push(submissionId);
  while (index.length > 100) {
    props.deleteProperty('AT_UPD_' + index.shift());
  }
  props.setProperty(UPDATE_INDEX_KEY, JSON.stringify(index));
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
  return text || 'The administrative task could not be saved.';
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
