const fs = require('fs');
const path = require('path');
const vm = require('vm');
const core = require('../netlify/functions/adminTaskCore');

let passes = 0;
let failures = 0;

function assert(condition, message) {
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  } else {
    passes++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    failures++;
    console.error('FAIL: ' + message + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
  } else {
    passes++;
  }
}

assertEqual(core.appendEvidence('Earlier visit', core.evidenceEntry('26/11/2026', 'Replaced the seal')),
  'Earlier visit\n26/11/2026 - Work carried out: Replaced the seal',
  'new evidence is appended with the submission date');
assertEqual(core.appendEvidence('', core.evidenceEntry('26/11/2026', 'First note')),
  '26/11/2026 - Work carried out: First note',
  'the first evidence entry has no leading blank line');
assertEqual(core.validateActionUpdate({
  submissionId: 'update-0001',
  completeActionId: 'AD1001-TA001-AC1',
  evidence: 'Replaced the seal',
  status: 'Completed'
}).value.taskId, 'TA001', 'the action ID is taken from the complete action ID');
assert(core.validateActionUpdate({
  submissionId: 'update-0001',
  completeActionId: 'AD1001-TA001-AC1',
  taskId: 'TA002',
  evidence: 'Replaced the seal',
  status: 'Completed'
}).ok === false, 'a mismatched task ID is rejected');
assert(core.validateActionUpdate({
  submissionId: 'update-0001',
  completeActionId: 'AD1001-TA001-AC1',
  evidence: '   ',
  status: 'Open'
}).ok === false, 'blank evidence is rejected');
assert(core.ACTION_STATUSES.join('|'), 'Open|In Progress|Blocked|Cancelled|Completed', 'statuses stay in the required order');

let openCount = 0;
let locked = false;
let setValuesCount = 0;
let clearCount = 0;
const properties = {};

function createSheet() {
  const cells = new Map();
  const sheet = {
    maxRows: 12,
    maxCols: 16,
    failOnWrite: 0,
    writeCount: 0,
    hookWrite: null,
    cell: function (row, col) {
      const key = row + ',' + col;
      if (!cells.has(key)) cells.set(key, { value: '', formula: '', format: '' });
      return cells.get(key);
    },
    seed: function (row, col, data) {
      const cell = sheet.cell(row, col);
      if (data.formula != null) cell.formula = data.formula;
      if (data.value != null) {
        cell.value = data.value;
        if (data.formula == null) {
          cell.formula = '';
          delete cell.display;
        }
      }
      if (data.display !== undefined) cell.display = data.display;
    },
    shown: function (row, col) {
      const cell = sheet.cell(row, col);
      if (col === 1 && cell.formula) {
        const area = String(sheet.cell(row, 2).value || '').trim();
        const task = String(sheet.cell(row, 3).value || '').trim();
        const action = String(sheet.cell(row, 4).value || '').trim();
        if (area && task && action) return area + '-' + task + '-' + action;
        if (cell.display !== undefined) return cell.display;
        return '';
      }
      if (cell.display !== undefined) return cell.display;
      if (cell.formula) return '';
      return cell.value == null ? '' : cell.value;
    },
    snapshot: function () {
      const snap = {};
      cells.forEach(function (cell, key) {
        if (cell.value !== '' || cell.formula !== '') snap[key] = { value: cell.value, formula: cell.formula };
      });
      return snap;
    },
    getName: function () { return 'Actions'; },
    getSheetId: function () { return 1408515271; },
    getMaxRows: function () { return sheet.maxRows; },
    getLastRow: function () { return 6; },
    getRange: function (row, col, numRows, numCols) {
      if (numRows == null) numRows = 1;
      if (numCols == null) numCols = 1;
      const endRow = row + numRows - 1;
      const endCol = col + numCols - 1;
      return {
        getValue: function () { return sheet.cell(row, col).value; },
        getFormula: function () { return sheet.cell(row, col).formula; },
        getNumberFormat: function () { return sheet.cell(row, col).format; },
        setNumberFormat: function (format) { sheet.cell(row, col).format = format; },
        setRichTextValue: function (rich) {
          sheet.writeCount += 1;
          if (sheet.hookWrite) sheet.hookWrite();
          if (sheet.failOnWrite && sheet.writeCount === sheet.failOnWrite) throw new Error('Simulated write failure');
          const cell = sheet.cell(row, col);
          cell.value = rich.text;
          cell.formula = '';
        },
        clearContent: function () {
          const cell = sheet.cell(row, col);
          cell.value = '';
          cell.formula = '';
        },
        clear: function () { clearCount++; throw new Error('clear() is forbidden'); },
        setValues: function () { setValuesCount++; throw new Error('setValues() is forbidden'); },
        getValues: function () {
          const values = [];
          for (let r = row; r <= endRow; r++) {
            const line = [];
            for (let c = col; c <= endCol; c++) line.push(sheet.cell(r, c).value);
            values.push(line);
          }
          return values;
        },
        getFormulas: function () {
          const formulas = [];
          for (let r = row; r <= endRow; r++) {
            const line = [];
            for (let c = col; c <= endCol; c++) line.push(sheet.cell(r, c).formula);
            formulas.push(line);
          }
          return formulas;
        },
        getDisplayValues: function () {
          const values = [];
          for (let r = row; r <= endRow; r++) {
            const line = [];
            for (let c = col; c <= endCol; c++) line.push(sheet.shown(r, c));
            values.push(line);
          }
          return values;
        }
      };
    }
  };
  return sheet;
}

let actions;

function seedAction(row, area, task, actionId, label, status, evidence) {
  actions.seed(row, 1, { formula: '=ID', display: '' });
  actions.seed(row, 2, { value: area });
  actions.seed(row, 3, { value: task });
  actions.seed(row, 4, { value: actionId });
  actions.seed(row, 5, { formula: '=LABEL', display: label });
  actions.seed(row, 6, { value: 'Do the work' });
  actions.seed(row, 7, { value: 'Jody R' });
  actions.seed(row, 8, { value: '19/10/2026' });
  actions.seed(row, 9, { value: 3 });
  if (status) actions.seed(row, 10, { value: status });
  if (evidence) actions.seed(row, 12, { value: evidence });
}

function resetWorld() {
  openCount = 0;
  locked = false;
  setValuesCount = 0;
  clearCount = 0;
  Object.keys(properties).forEach(function (key) { delete properties[key]; });
  actions = createSheet();
  actions.seed(1, 1, { value: 'Action ID' });
  seedAction(2, 'AD1001', 'TA001', 'AC1', 'Collect the invoices', 'Open', 'Earlier visit');
  seedAction(3, 'AD1001', 'TA001', 'AC2', 'Collect the invoices', 'Completed', '');
  seedAction(4, 'AD1002', 'TA001', 'AC1', '', 'Open', 'Hidden');
  actions.seed(5, 5, { value: 'A description with no identity' });
}

const context = {
  JSON: JSON, Math: Math, Date: Date, Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp, parseInt: parseInt,
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: function (text) { return { _text: text, setMimeType: function () { return this; } }; }
  },
  LockService: {
    getScriptLock: function () {
      return {
        tryLock: function () {
          if (locked) return false;
          locked = true;
          return true;
        },
        releaseLock: function () { locked = false; }
      };
    }
  },
  PropertiesService: {
    getScriptProperties: function () {
      return {
        getProperty: function (key) { return Object.prototype.hasOwnProperty.call(properties, key) ? properties[key] : null; },
        setProperty: function (key, value) { properties[key] = String(value); },
        deleteProperty: function (key) { delete properties[key]; }
      };
    }
  },
  Utilities: { formatDate: function () { return '26/11/2026'; } },
  SpreadsheetApp: {
    flush: function () {},
    openById: function (id) {
      openCount++;
      if (id !== '1Ylcv5M-Kb0QsTU5sWkxtloVb7C4EndkZu1rRPT8ILeY') throw new Error('Unexpected spreadsheet');
      return { getSheetByName: function (name) { return name === 'Actions' ? actions : null; } };
    },
    newRichTextValue: function () {
      let text = '';
      return { setText: function (value) { text = String(value); return this; }, build: function () { return { text: text }; } };
    }
  }
};

vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../GOOGLE SCRIPTS/AdminTasks.js'), 'utf8'), context);

function post(action, payload, token) {
  const output = context.doPost({
    postData: {
      type: 'application/json',
      contents: JSON.stringify(Object.assign({ token: token || 'J4PAN88', action: action }, payload || {}))
    }
  });
  return JSON.parse(output._text);
}

function update(overrides) {
  return post('admin_action_update', Object.assign({
    submissionId: 'update-submission-01',
    completeActionId: 'AD1001-TA001-AC1',
    evidence: 'Replaced the seal',
    status: 'Completed'
  }, overrides || {}));
}

function changedKeys(before, after) {
  const keys = new Set(Object.keys(before).concat(Object.keys(after)));
  const changed = [];
  keys.forEach(function (key) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
  });
  return changed.sort();
}

resetWorld();
const listed = post('admin_actions_list');
assertEqual(listed.result, 'ok', 'the action list loads');
assertEqual(listed.actions.map(function (item) { return item.label + '=' + item.completeActionId + '=' + item.status; }).join('|'),
  'Collect the invoices=AD1001-TA001-AC1=Open|Collect the invoices=AD1001-TA001-AC2=Completed',
  'column E labels are kept and blank or unidentified rows are ignored');
assertEqual(listed.actions[0].owner, 'Jody R', 'the list keeps the owner from the same row');
assertEqual(listed.actions[0].dueDate, '19/10/2026', 'the list keeps the due date from the same row');
assertEqual(listed.actions[0].evidence, 'Earlier visit', 'existing evidence is returned with its action');
assert(listed.actions[0].completeActionId !== listed.actions[1].completeActionId, 'similar descriptions stay tied to different action IDs');

resetWorld();
const before = actions.snapshot();
const saved = update();
assertEqual(saved.result, 'success', 'an existing action can be updated');
assertEqual(saved.status, 'Completed', 'the selected status is returned');
assertEqual(saved.submittedOn, '26/11/2026', 'the submission date is today');
assertEqual(actions.cell(2, 10).value, 'Completed', 'status is written to column J');
assertEqual(actions.cell(2, 11).value, '26/11/2026', 'the submission date is written to column K');
assertEqual(actions.cell(2, 12).value, 'Earlier visit\n26/11/2026 - Work carried out: Replaced the seal', 'new evidence is appended to column L');
assertEqual(actions.cell(2, 1).formula, '=ID', 'column A formula stays in place');
assertEqual(actions.cell(2, 5).formula, '=LABEL', 'column E formula stays in place');
assertEqual(actions.cell(2, 2).value, 'AD1001', 'column B is unchanged');
assertEqual(actions.cell(2, 6).value, 'Do the work', 'column F is unchanged');
assertEqual(actions.cell(2, 9).value, 3, 'column I is unchanged');
assertEqual(actions.cell(3, 10).value, 'Completed', 'a different action is not updated');
assertEqual(actions.cell(3, 12).value, '', 'a different action does not receive the evidence');
const changes = changedKeys(before, actions.snapshot());
assertEqual(changes.join('|'), ['2,10', '2,11', '2,12'].join('|'), 'only columns J, K and L change');
assertEqual(actions.maxRows, 12, 'the update does not add a row');

const again = update();
assertEqual(again.result, 'success', 'the same submission returns success');
assertEqual(actions.cell(2, 12).value, 'Earlier visit\n26/11/2026 - Work carried out: Replaced the seal', 'a repeated submit does not append the evidence twice');

const second = update({
  submissionId: 'update-submission-02',
  evidence: 'Checked the repair',
  status: 'In Progress'
});
assertEqual(second.result, 'success', 'a later update is saved');
assertEqual(actions.cell(2, 10).value, 'In Progress', 'the status can move away from Completed');
assertEqual(actions.cell(2, 12).value,
  'Earlier visit\n26/11/2026 - Work carried out: Replaced the seal\n26/11/2026 - Work carried out: Checked the repair',
  'the second evidence entry is appended under the first');

resetWorld();
const denied = update({ status: 'Done' });
assertEqual(denied.result, 'error', 'an unknown status is rejected');
assertEqual(openCount, 0, 'an invalid update does not open the spreadsheet');
assertEqual(actions.cell(2, 10).value, 'Open', 'an invalid update does not change the status');

resetWorld();
const missing = update({ completeActionId: 'AD1009-TA009-AC9', submissionId: 'missing-update-01' });
assertEqual(missing.result, 'error', 'a missing action is rejected');
assertEqual(actions.cell(2, 12).value, 'Earlier visit', 'a missing action does not change evidence');
assertEqual(actions.maxRows, 12, 'a missing action does not create a record');

resetWorld();
actions.seed(2, 10, { formula: '=STATUS', value: 'Open' });
const blockedFormula = actions.snapshot();
const formulaResult = update({ submissionId: 'formula-update-01' });
assertEqual(formulaResult.result, 'error', 'a formula in the status column blocks the update');
assertEqual(JSON.stringify(actions.snapshot()), JSON.stringify(blockedFormula), 'a blocked update leaves the row unchanged');

resetWorld();
actions.failOnWrite = 1;
const original = actions.snapshot();
const failed = update({ submissionId: 'failed-update-01' });
assertEqual(failed.result, 'error', 'a write failure returns an error');
assert(failed.result !== 'success', 'a write failure is not success');
assertEqual(JSON.stringify(actions.snapshot()), JSON.stringify(original), 'a failed update restores the previous cells');
actions.failOnWrite = 0;
const retried = update({ submissionId: 'failed-update-01' });
assertEqual(retried.result, 'success', 'the same update can be retried');
assertEqual((actions.cell(2, 12).value.match(/Work carried out/g) || []).length, 1, 'the retry appends the evidence once');

resetWorld();
let secondResult = null;
actions.hookWrite = function () {
  if (secondResult) return;
  secondResult = update({ submissionId: 'locked-update-02', evidence: 'Other user', status: 'Blocked' });
};
const firstLocked = update({ submissionId: 'locked-update-01', evidence: 'First user', status: 'In Progress' });
assertEqual(firstLocked.result, 'success', 'the lock holder still saves');
assertEqual(secondResult.result, 'error', 'a simultaneous update is rejected while the lock is held');
assertEqual((actions.cell(2, 12).value.match(/Other user/g) || []).length, 0, 'the locked update does not overwrite the evidence');
actions.hookWrite = null;
const afterLock = update({ submissionId: 'locked-update-02', evidence: 'Other user', status: 'Blocked' });
assertEqual(afterLock.result, 'success', 'the second update is saved after the lock is released');
assert(actions.cell(2, 12).value.indexOf('First user') !== -1 && actions.cell(2, 12).value.indexOf('Other user') !== -1, 'both evidence entries are kept');
assertEqual(actions.cell(2, 10).value, 'Blocked', 'the later status is the one stored');

assertEqual(setValuesCount, 0, 'setValues was never used');
assertEqual(clearCount, 0, 'whole-range clear was never used');

const page = fs.readFileSync(path.join(__dirname, '../admin-tasks/complete-actions.js'), 'utf8');
const home = fs.readFileSync(path.join(__dirname, '../admin-tasks/index.html'), 'utf8');
assert(home.indexOf('href="create-task.html"') < home.indexOf('href="complete-actions.html"'), 'Complete Actions is listed with Create Task');
['Complete Actions', 'Evidence of Work Carried Out', 'Please select the current status of this Action', 'Submit Update', 'What would you like to do next?', 'Return to Admin Tasks', 'Complete Another Task', '#ffcfc9', '#ffe5a0', '#e8eaed', '#d4edbc', 'Open', 'In Progress', 'Blocked', 'Cancelled', 'Completed'].forEach(function (label) {
  assert(page.indexOf(label) !== -1, 'complete actions contains ' + label);
});
assert(page.indexOf('fetch(SCRIPT_URL') !== -1, 'the update is sent through the backend');

if (failures) {
  console.error(failures + ' failed, ' + passes + ' passed');
  process.exit(1);
}
console.log(passes + ' passed');
