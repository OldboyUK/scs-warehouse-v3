const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
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

const AREA_CSV = [
  'Admin Task Area,Title / Activity,HELPER,Scope',
  'ZZ9999,General Administration,AD1001 | General Administration,decoy',
  'DECOY,Managerial,AD1002 | Managerial,',
  'DECOY,Quoted,"AD1003 | Quoted, name",',
  'DECOY,Pack,AD1004 | Pack (A)+,',
  ',Blank label,AD1005 | Blank,',
  'DECOY,,AD1006 | No label,',
  'DECOY,Duplicate,AD1001 | General Administration,',
  'DECOY,Short,ABC,',
  'DECOY,Ambiguous,AD10067 Extra,',
  'DECOY,Same label,AD1007 | Same label,',
  'DECOY,Same label,AD1008 | Other label,'
].join('\n');

const OWNER_CSV = [
  'FIRST NAME,LAST NAME,STAFF ID,PIN Hash,ACTIVE',
  'Jody,Ranni,Jody R,$2a$12$secret,TRUE',
  'Aaron,Sadd,Aaron S,$2a$12$other,TRUE',
  'Jody,Again,Jody R,$2a$12$secret,TRUE',
  ',Blank,,$2a$12$nope,TRUE',
  'Zoe,Ibbotson,"Smith, Jo",$2a$12$zoe,FALSE'
].join('\n');

let areaCsv = AREA_CSV;
let ownerCsv = OWNER_CSV;
let openCount = 0;
let setValuesCount = 0;
let clearCount = 0;
let locked = false;
const properties = {};

function createSheet(name, gid, maxRows) {
  const cells = new Map();
  const sheet = {
    name: name,
    gid: gid,
    maxRows: maxRows || 30,
    maxCols: 20,
    failOnWrite: 0,
    writeCount: 0,
    failClear: false,
    insertCount: 0,
    hookWrite: null,
    key: function (row, col) { return row + ',' + col; },
    cell: function (row, col) {
      if (row < 1 || col < 1 || row > sheet.maxRows || col > sheet.maxCols) {
        throw new Error('Range exceeds grid limits r' + row + 'c' + col + ' max ' + sheet.maxRows);
      }
      const key = sheet.key(row, col);
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
      if (data.format != null) cell.format = data.format;
    },
    computedId: function (row) {
      if (name === 'Task') {
        const area = String(sheet.cell(row, 3).value || '').trim();
        const task = String(sheet.cell(row, 4).value || '').trim();
        if (!area || !task) return '';
        return area + '-' + task;
      }
      if (name === 'Actions') {
        const area = String(sheet.cell(row, 2).value || '').trim();
        const task = String(sheet.cell(row, 3).value || '').trim();
        const action = String(sheet.cell(row, 4).value || '').trim();
        if (!area || !task || !action) return '';
        return area + '-' + task + '-' + action;
      }
      return '';
    },
    shown: function (row, col) {
      const cell = sheet.cell(row, col);
      if (col === 1 && cell.formula) {
        const computed = sheet.computedId(row);
        if (computed) return computed;
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
        if (cell.value !== '' || cell.formula !== '') {
          snap[key] = { value: cell.value, formula: cell.formula };
        }
      });
      return snap;
    },
    getName: function () { return name; },
    getSheetId: function () { return gid; },
    getMaxRows: function () { return sheet.maxRows; },
    getLastRow: function () {
      let last = 0;
      cells.forEach(function (cell, key) {
        if (cell.value === '' && cell.formula === '') return;
        const row = Number(key.split(',')[0]);
        if (row > last) last = row;
      });
      return last;
    },
    insertRowsAfter: function (after, howMany) {
      if (after !== sheet.maxRows) throw new Error('Refusing to insert rows in the middle at ' + after);
      sheet.maxRows += howMany;
      sheet.insertCount += 1;
    },
    getRange: function (row, col, numRows, numCols) {
      if (numRows == null) numRows = 1;
      if (numCols == null) numCols = 1;
      const endRow = row + numRows - 1;
      const endCol = col + numCols - 1;
      if (row < 1 || col < 1 || endRow > sheet.maxRows || endCol > sheet.maxCols) {
        throw new Error('Range exceeds grid limits ' + row + ':' + endRow + ' c' + col);
      }
      return {
        getValue: function () { return sheet.cell(row, col).value; },
        getFormula: function () { return sheet.cell(row, col).formula; },
        getNumberFormat: function () { return sheet.cell(row, col).format; },
        setNumberFormat: function (format) { sheet.cell(row, col).format = format; },
        setValue: function (value) {
          sheet.noteWrite();
          const cell = sheet.cell(row, col);
          if (typeof value === 'string' && value.charAt(0) === '=') {
            cell.formula = value;
            cell.value = 'COMPUTED';
            return;
          }
          cell.value = value;
          cell.formula = '';
        },
        setRichTextValue: function (rich) {
          sheet.noteWrite();
          const cell = sheet.cell(row, col);
          cell.value = rich.text;
          cell.formula = '';
        },
        clearContent: function () {
          if (sheet.failClear) throw new Error('Simulated clear failure');
          const cell = sheet.cell(row, col);
          cell.value = '';
          cell.formula = '';
        },
        clear: function () {
          clearCount++;
          throw new Error('clear() is forbidden');
        },
        setValues: function () {
          setValuesCount++;
          throw new Error('setValues() is forbidden');
        },
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
    },
    noteWrite: function () {
      sheet.writeCount += 1;
      if (sheet.hookWrite) sheet.hookWrite();
      if (sheet.failOnWrite && sheet.writeCount === sheet.failOnWrite) {
        throw new Error('Simulated write failure');
      }
    }
  };
  return sheet;
}

function columnIds(sheet) {
  const ids = [];
  for (let row = 2; row <= sheet.getMaxRows(); row++) {
    const value = String(sheet.shown(row, 1) || '').trim();
    if (value) ids.push(value);
  }
  return ids;
}

function seedIdFormulas(sheet) {
  for (let row = 2; row <= sheet.maxRows; row++) {
    sheet.seed(row, 1, { formula: '=ID', display: '' });
    sheet.seed(row, 5, { formula: '=INFO' });
  }
}

let tasks;
let actions;

function resetWorld() {
  openCount = 0;
  setValuesCount = 0;
  clearCount = 0;
  locked = false;
  Object.keys(properties).forEach(function (key) { delete properties[key]; });
  tasks = createSheet('Task', 1159021811, 30);
  actions = createSheet('Actions', 1408515271, 30);
  tasks.seed(1, 1, { value: 'Task ID' });
  actions.seed(1, 1, { value: 'Action ID' });
  seedIdFormulas(tasks);
  seedIdFormulas(actions);
  areaCsv = AREA_CSV;
  ownerCsv = OWNER_CSV;
}

const context = {
  console: console,
  JSON: JSON,
  Math: Math,
  Date: Date,
  Object: Object,
  Array: Array,
  String: String,
  Number: Number,
  RegExp: RegExp,
  parseInt: parseInt,
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: function (text) {
      return { _text: text, setMimeType: function () { return this; } };
    }
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
  UrlFetchApp: {
    fetch: function (url) {
      const address = String(url || '');
      const body = address.indexOf('559712901') !== -1 ? ownerCsv : address.indexOf('369796982') !== -1 ? areaCsv : '';
      return {
        getResponseCode: function () { return body ? 200 : 500; },
        getContentText: function () { return body; }
      };
    }
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: function (algo, text) {
      const hash = crypto.createHash('sha256').update(String(text), 'utf8').digest();
      return Array.from(hash.values());
    }
  },
  SpreadsheetApp: {
    flush: function () {},
    openById: function (id) {
      openCount++;
      if (id !== '1Ylcv5M-Kb0QsTU5sWkxtloVb7C4EndkZu1rRPT8ILeY') throw new Error('Unexpected spreadsheet');
      return {
        getSheetByName: function (name) {
          if (name === 'Task') return tasks;
          if (name === 'Actions') return actions;
          return null;
        }
      };
    },
    newRichTextValue: function () {
      let text = '';
      return {
        setText: function (value) { text = String(value); return this; },
        build: function () { return { text: text }; }
      };
    }
  }
};

vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../GOOGLE SCRIPTS/AdminTasks.js'), 'utf8'), context);

function post(payload, token) {
  const output = context.doPost({
    postData: {
      type: 'application/json',
      contents: JSON.stringify(Object.assign({
        token: token || 'J4PAN88',
        action: 'admin_task_submit'
      }, payload))
    }
  });
  return JSON.parse(output._text);
}

let seq = 0;
function payload(overrides) {
  seq++;
  const body = {
    submissionId: 'sub-' + String(seq).padStart(8, '0'),
    taskAreaValue: 'AD1001 | General Administration',
    title: 'File the return',
    description: 'Prepare the quarterly return',
    actions: [
      { description: 'Collect the invoices', owner: 'Jody R', dueDate: '2026-10-19', priority: 2 }
    ]
  };
  if (!overrides) return body;
  return Object.assign(body, overrides);
}

function changedKeys(before, after) {
  const keys = new Set(Object.keys(before).concat(Object.keys(after)));
  const changed = [];
  keys.forEach(function (key) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
  });
  return changed.sort();
}

const areas = core.taskAreasFromCsv(AREA_CSV);
const owners = core.ownersFromCsv(OWNER_CSV);
assertEqual(areas.map(function (area) { return area.label + '=' + area.id; }).join('|'), [
  'General Administration=AD1001',
  'Managerial=AD1002',
  'Quoted=AD1003',
  'Pack=AD1004',
  'Blank label=AD1005',
  'Same label=AD1007',
  'Same label=AD1008'
].join('|'), 'task areas come from column B and the ID comes from column C');
assertEqual(areas[0].value, 'AD1001 | General Administration', 'the dropdown keeps the column C value');
assert(areas.every(function (area) { return area.id !== 'ZZ9999'; }), 'column A is not used as the task area ID');
assertEqual(core.taskAreaIdFromValue('AD1001 | General Administration'), 'AD1001', 'task area ID is the first six characters');
assertEqual(core.taskAreaIdFromValue('AD1004 | Pack (A)+'), 'AD1004', 'punctuation after the ID stays out of the ID');
assertEqual(core.taskAreaIdFromValue('ABC'), '', 'a short helper is not turned into an ID');
assertEqual(core.taskAreaIdFromValue('AD10067 Extra'), '', 'a seventh alphanumeric character is rejected');
assertEqual(JSON.stringify(context.loadTaskAreasFromText_(AREA_CSV)), JSON.stringify(areas), 'script task areas match the shared parser');
assertEqual(owners.join('|'), 'Jody R|Aaron S|Smith, Jo', 'owners come from column C, keep order, and drop blanks and duplicates');
assert(owners.join('|').indexOf('$2a$') === -1, 'PIN hashes are not owner names');
assertEqual(context.loadOwnersFromText_(OWNER_CSV).join('|'), owners.join('|'), 'script owners match the shared parser');
assertEqual(core.parseDueDate('2026-10-19'), '19/10/2026', 'iso date becomes uk date');
assertEqual(core.parseDueDate('19/10/2026'), '19/10/2026', 'uk date stays uk date');
assertEqual(core.parseDueDate('2026-02-31'), null, 'invalid calendar date rejected');
assertEqual(core.parseDueDate('2024-02-29'), '29/02/2024', 'leap day accepted');
assertEqual(core.parseScore(4), 4, 'numeric priority accepted');
assertEqual(core.parseScore('5'), 5, 'string priority accepted');
assertEqual(core.parseScore('1 — Lowest'), null, 'priority label is not written');
assertEqual(core.parseScore(1.5), null, 'fractional priority rejected');

const badCases = [
  [{}, 'task area'],
  [payload({ taskAreaValue: 'General Administration' }), 'label alone'],
  [payload({ taskAreaValue: 'ZZ9999' }), 'column A decoy'],
  [payload({ title: '   ' }), 'title'],
  [payload({ description: '' }), 'description'],
  [payload({ actions: [] }), 'at least one'],
  [payload({ actions: [{ description: '', owner: 'Jody R', dueDate: '2026-10-19', priority: 1 }] }), 'description for action'],
  [payload({ actions: [{ description: 'Do it', owner: 'Intern', dueDate: '2026-10-19', priority: 1 }] }), 'owner'],
  [payload({ actions: [{ description: 'Do it', owner: '$2a$12$secret', dueDate: '2026-10-19', priority: 1 }] }), 'hash owner'],
  [payload({ actions: [{ description: 'Do it', owner: 'Jody R', dueDate: '', priority: 1 }] }), 'due date'],
  [payload({ actions: [{ description: 'Do it', owner: 'Jody R', dueDate: '2026-10-19', priority: '1 — Lowest' }] }), 'priority label'],
  [payload({ submissionId: 'short' }), 'identified']
];
badCases.forEach(function (entry) {
  const result = core.validateSubmission(entry[0], areas, owners);
  assert(result.ok === false && result.message, 'core rejects ' + entry[1]);
  const scriptResult = context.validateSubmission_(entry[0], areas, owners);
  assert(scriptResult.ok === false, 'script rejects ' + entry[1]);
});
const accepted = core.validateSubmission(payload({ taskId: 'TA999', taskAreaId: 'ZZ9999' }), areas, owners);
assertEqual(accepted.value.taskAreaId, 'AD1001', 'validation derives the ID from column C');
assertEqual(accepted.value.taskAreaLabel, 'General Administration', 'validation keeps the column B label');
assert(!Object.prototype.hasOwnProperty.call(accepted.value, 'taskId'), 'validation does not accept a client task ID');

core.loadReferenceData(function (url) {
  const body = String(url).indexOf('559712901') !== -1 ? OWNER_CSV : AREA_CSV;
  return Promise.resolve({
    ok: true,
    status: 200,
    text: function () { return Promise.resolve(body); }
  });
}).then(function (data) {
  assert(JSON.stringify(data).indexOf('$2a$') === -1, 'reference data returned to the app contains no PIN hash');
  assertEqual(data.owners.join('|'), owners.join('|'), 'reference owners match column C');
  assertEqual(data.taskAreas[0].id, 'AD1001', 'reference task area ID comes from column C');
}).catch(function (err) {
  failures++;
  console.error('FAIL: reference data load ' + err.message);
});

assertEqual(context.nextTaskId_('AD1001', []), 'TA001', 'the first task in an area is TA001');
assertEqual(context.nextTaskId_('AD1001', ['AD1001-TA001', 'AD1001-TA003', 'AD1002-TA009']), 'TA004', 'a gap uses the highest suffix and ignores other areas');
assertEqual(context.nextTaskId_('AD1002', ['AD1001-TA004']), 'TA001', 'a different task area starts again at TA001');
assertEqual(context.nextTaskId_('AD1001', ['AD1001-TA1']), 'TA002', 'an unpadded existing suffix still occupies TA001');
assertEqual(context.actionIdsForNewTask_(3).join(','), 'AC1,AC2,AC3', 'a new task starts its actions at AC1');
assertEqual(context.actionIdsForNewTask_(10)[9], 'AC10', 'action numbers are not zero padded');

resetWorld();
const denied = post(payload(), 'nope');
assertEqual(denied.result, 'error', 'bad token is rejected');
assertEqual(openCount, 0, 'bad token does not open the spreadsheet');

resetWorld();
const invalid = post(payload({ actions: [{ description: 'Do it', owner: 'Intern', dueDate: '2026-10-19', priority: 1 }] }));
assertEqual(invalid.result, 'error', 'invalid owner rejected');
assert(invalid.result !== 'success', 'invalid owner is not success');
assertEqual(openCount, 0, 'invalid submission does not open the spreadsheet');
assertEqual(columnIds(tasks).length, 0, 'invalid submission writes no task');

resetWorld();
tasks.seed(2, 5, { formula: '=INFO' });
tasks.seed(2, 7, { value: 'future' });
actions.seed(2, 5, { formula: '=INFO' });
actions.seed(2, 11, { value: 'keep-k' });
actions.seed(2, 12, { value: 'keep-l' });
actions.seed(2, 13, { value: 'keep-m' });
const beforeTask = tasks.snapshot();
const beforeAction = actions.snapshot();
const saved = post(payload({ description: '=1+1', taskId: 'TA999', actionIds: ['AC9'], taskAreaId: 'ZZ9999' }));
assertEqual(saved.result, 'success', 'one action saves');
assertEqual(saved.taskAreaId, 'AD1001', 'task area ID is the six-character code');
assertEqual(saved.taskId, 'TA001', 'first task ID ignores a client-supplied ID');
assertEqual(saved.actionIds.join(','), 'AC1', 'first action ID ignores a client-supplied ID');
assertEqual(saved.completeTaskId, 'AD1001-TA001', 'complete task ID is assembled for display');
assertEqual(saved.completeActionIds.join(','), 'AD1001-TA001-AC1', 'complete action ID is assembled for display');
assertEqual(tasks.cell(2, 1).formula, '=ID', 'task column A formula stays in place');
assertEqual(tasks.cell(2, 1).value, '', 'task column A is not written');
assertEqual(tasks.shown(2, 1), 'AD1001-TA001', 'task column A formula displays the complete ID');
assertEqual(tasks.cell(2, 2).value, 'File the return', 'title written to column B');
assertEqual(tasks.cell(2, 3).value, 'AD1001', 'task area ID written to column C');
assert(tasks.cell(2, 3).value !== 'AD1001 | General Administration', 'the combined dropdown value is not written');
assert(tasks.cell(2, 3).value !== 'ZZ9999', 'column A of the task area sheet is not written');
assertEqual(tasks.cell(2, 4).value, 'TA001', 'task ID written to column D');
assertEqual(tasks.cell(2, 5).formula, '=INFO', 'task column E formula untouched');
assertEqual(tasks.cell(2, 6).value, '=1+1', 'description stored as text');
assertEqual(tasks.cell(2, 6).formula, '', 'description was not stored as a formula');
assertEqual(tasks.cell(2, 7).value, 'future', 'task column G untouched');
assertEqual(tasks.insertCount, 0, 'an earlier blank column A row does not insert rows');
assertEqual(actions.cell(2, 1).formula, '=ID', 'action column A formula stays in place');
assertEqual(actions.cell(2, 1).value, '', 'action column A is not written');
assertEqual(actions.shown(2, 1), 'AD1001-TA001-AC1', 'action column A formula displays the complete ID');
assertEqual(actions.cell(2, 2).value, 'AD1001', 'task area ID written to action column B');
assertEqual(actions.cell(2, 3).value, 'TA001', 'task ID written to action column C');
assertEqual(actions.cell(2, 4).value, 'AC1', 'action ID written to column D');
assertEqual(actions.cell(2, 5).formula, '=INFO', 'action column E formula untouched');
assertEqual(actions.cell(2, 6).value, 'Collect the invoices', 'action description written to column F');
assertEqual(actions.cell(2, 7).value, 'Jody R', 'owner written to column G');
assertEqual(actions.cell(2, 8).value, '19/10/2026', 'due date written as dd/MM/yyyy');
assertEqual(actions.cell(2, 9).value, 2, 'priority stored as a number');
assertEqual(actions.cell(2, 10).value, 'Open', 'a new action starts at Open in column J');
assertEqual(actions.cell(2, 11).value, 'keep-k', 'action column K untouched');
assertEqual(actions.cell(2, 12).value, 'keep-l', 'action column L untouched');
assertEqual(actions.cell(2, 13).value, 'keep-m', 'action column M untouched');
assertEqual(tasks.cell(1, 1).value, 'Task ID', 'header row untouched');
const taskChanges = changedKeys(beforeTask, tasks.snapshot());
assertEqual(taskChanges.join('|'), ['2,2', '2,3', '2,4', '2,6'].join('|'), 'only task destination cells changed');
const actionChanges = changedKeys(beforeAction, actions.snapshot());
assertEqual(actionChanges.join('|'), ['2,10', '2,2', '2,3', '2,4', '2,6', '2,7', '2,8', '2,9'].join('|'), 'only action destination cells changed');

resetWorld();
const same = payload({
  submissionId: 'same-submission-0001',
  actions: [
    { description: 'First action', owner: 'Jody R', dueDate: '2026-01-05', priority: 1 },
    { description: 'Second action', owner: 'Aaron S', dueDate: '2026-11-02', priority: 5 },
    { description: 'Third action', owner: 'Smith, Jo', dueDate: '2026-12-01', priority: 3 }
  ]
});
const three = post(same);
assertEqual(three.result, 'success', 'three actions save');
assertEqual(three.taskId, 'TA001', 'one task ID for three actions');
assertEqual(three.actionIds.join(','), 'AC1,AC2,AC3', 'actions on a new task increment from AC1');
assertEqual(columnIds(tasks).length, 1, 'three actions do not create three tasks');
assertEqual(columnIds(actions).join(','), 'AD1001-TA001-AC1,AD1001-TA001-AC2,AD1001-TA001-AC3', 'each action has its own row');
assertEqual(actions.cell(2, 3).value, 'TA001', 'first action uses the task ID');
assertEqual(actions.cell(4, 3).value, 'TA001', 'third action uses the same task ID');
assertEqual(actions.cell(2, 4).value, 'AC1', 'first action code');
assertEqual(actions.cell(3, 4).value, 'AC2', 'second action code');
assertEqual(actions.cell(4, 4).value, 'AC3', 'third action code');
assertEqual(actions.cell(2, 10).value, 'Open', 'the first action starts Open');
assertEqual(actions.cell(3, 10).value, 'Open', 'the second action starts Open');
assertEqual(actions.cell(4, 10).value, 'Open', 'the third action starts Open');
assertEqual(actions.cell(2, 7).value, 'Jody R', 'first owner stays with the first action');
assertEqual(actions.cell(3, 7).value, 'Aaron S', 'second owner stays with the second action');
assertEqual(actions.cell(4, 7).value, 'Smith, Jo', 'a comma in an owner is preserved');
assertEqual(actions.cell(2, 8).value, '05/01/2026', 'single digit day is padded');
assertEqual(actions.cell(3, 9).value, 5, 'highest priority is stored as 5');
const duplicate = post(same);
assertEqual(duplicate.result, 'success', 'repeat submission returns success');
assertEqual(duplicate.taskId, three.taskId, 'repeat submission returns the original task ID');
assertEqual(duplicate.actionIds.join(','), three.actionIds.join(','), 'repeat submission returns the original action IDs');
assertEqual(columnIds(tasks).length, 1, 'repeat submission does not add a task');
assertEqual(columnIds(actions).length, 3, 'repeat submission does not add actions');
assertEqual(openCount, 1, 'repeat submission does not open the spreadsheet again');

const second = post(payload({ title: 'Second task' }));
assertEqual(second.taskId, 'TA002', 'the next task in the same area increments');
assertEqual(second.actionIds.join(','), 'AC1', 'a new task starts its actions at AC1 again');
assertEqual(actions.cell(5, 3).value, 'TA002', 'the new action uses the new task ID');
assertEqual(actions.cell(5, 4).value, 'AC1', 'the new action does not continue the previous action numbers');
assertEqual(actions.cell(5, 10).value, 'Open', 'the next task action also starts Open');
assertEqual(actions.shown(5, 1), 'AD1001-TA002-AC1', 'the new action ID is displayed by column A');
const other = post(payload({ taskAreaValue: 'AD1002 | Managerial', title: 'Other area' }));
assertEqual(other.taskAreaId, 'AD1002', 'the other task area ID is taken from its helper');
assertEqual(other.taskId, 'TA001', 'a different task area starts again at TA001');
assertEqual(other.actionIds.join(','), 'AC1', 'the other area also starts actions at AC1');
assertEqual(tasks.cell(4, 3).value, 'AD1002', 'the other area code is written from column C');

resetWorld();
tasks.seed(2, 3, { value: 'AD1001' });
tasks.seed(2, 4, { value: 'TA001' });
tasks.seed(3, 3, { value: 'AD1001' });
tasks.seed(3, 4, { value: 'TA003' });
tasks.seed(4, 3, { value: 'AD1002' });
tasks.seed(4, 4, { value: 'TA009' });
const gapped = post(payload());
assertEqual(gapped.taskId, 'TA004', 'the next ID follows the highest suffix for that area');
assertEqual(tasks.cell(2, 4).value, 'TA001', 'an existing task ID is not overwritten');
assertEqual(tasks.cell(5, 4).value, 'TA004', 'the first blank column A row receives the new task ID');
assertEqual(tasks.cell(5, 3).value, 'AD1001', 'the first blank column A row receives the task area ID');
assertEqual(tasks.shown(5, 1), 'AD1001-TA004', 'the blank formula displays the new task ID');
assertEqual(tasks.insertCount, 0, 'formula rows below the write are not a reason to append');

resetWorld();
tasks.seed(2, 1, { formula: '=IF(C2="","",C2&"-"&D2)', display: '' });
tasks.seed(2, 5, { formula: '=A2' });
tasks.seed(2, 7, { value: 'still-here' });
tasks.seed(8, 1, { formula: '=C8&"-"&D8', display: 'AD1001-TA014' });
const skipped = post(payload());
assertEqual(skipped.taskId, 'TA015', 'a formula-displayed ID counts toward the next suffix');
assertEqual(tasks.cell(2, 1).formula, '=IF(C2="","",C2&"-"&D2)', 'an empty formula result stays in column A');
assertEqual(tasks.cell(2, 3).value, 'AD1001', 'the empty formula row receives the task area ID');
assertEqual(tasks.cell(2, 4).value, 'TA015', 'the empty formula row receives the task ID');
assertEqual(tasks.shown(2, 1), 'AD1001-TA015', 'the empty formula then displays the complete ID');
assertEqual(tasks.cell(2, 5).formula, '=A2', 'the column E formula on the written row stays');
assertEqual(tasks.cell(2, 7).value, 'still-here', 'task column G on the written row stays');
assertEqual(tasks.cell(8, 1).formula, '=C8&"-"&D8', 'a formula-only ID is not overwritten');
assertEqual(tasks.cell(8, 3).value, '', 'a formula-only ID row does not receive new components');
assertEqual(tasks.insertCount, 0, 'an earlier blank display row does not append below the formulas');

resetWorld();
tasks.seed(1, 2, { formula: '=ARRAYFORMULA(A2:A)' });
const blockedFormula = tasks.snapshot();
const arrayResult = post(payload());
assertEqual(arrayResult.result, 'error', 'array formula blocks the save');
assert(arrayResult.result !== 'success', 'array formula does not report success');
assertEqual(JSON.stringify(tasks.snapshot()), JSON.stringify(blockedFormula), 'array formula sheet is unchanged');

resetWorld();
tasks.seed(1, 1, { formula: '=ARRAYFORMULA(IF(C2:C="","",C2:C&"-"&D2:D))' });
const arrayOwned = post(payload());
assertEqual(arrayOwned.result, 'success', 'an array formula in column A does not block the save');
assertEqual(tasks.cell(1, 1).formula, '=ARRAYFORMULA(IF(C2:C="","",C2:C&"-"&D2:D))', 'the column A array formula is not overwritten');
assertEqual(tasks.cell(2, 3).value, 'AD1001', 'component values are still written beside a column A array formula');

resetWorld();
const narrow = createSheet('Task', 1159021811, 3);
const narrowActions = createSheet('Actions', 1408515271, 10);
tasks = narrow;
actions = narrowActions;
tasks.seed(1, 1, { value: 'Task ID' });
tasks.seed(2, 1, { value: 'AD1001-TA001' });
tasks.seed(3, 1, { value: 'AD1001-TA002' });
actions.seed(1, 1, { value: 'Action ID' });
const inserted = post(payload());
assertEqual(inserted.taskId, 'TA003', 'a full sheet still allocates the next ID');
assertEqual(tasks.cell(4, 1).value, '', 'the inserted row does not receive a written ID');
assertEqual(tasks.cell(4, 3).value, 'AD1001', 'the inserted row receives the task area ID');
assertEqual(tasks.cell(4, 4).value, 'TA003', 'the inserted row receives the task ID');
assertEqual(tasks.cell(2, 1).value, 'AD1001-TA001', 'the inserted row does not shift existing IDs');
assert(tasks.insertCount > 0, 'rows are inserted only when the grid is full');

resetWorld();
context.saveRecord_('reserved-submission-01', {
  status: 'pending',
  fingerprint: 'different',
  taskAreaId: 'AD1001',
  taskId: 'TA001',
  actionIds: ['AC1']
});
const reserved = post(payload({ submissionId: 'sub-reserved-0002' }));
assertEqual(reserved.taskId, 'TA002', 'a reserved task ID is not given to the next submission');
assertEqual(columnIds(tasks).filter(function (id) { return id === 'AD1001-TA001'; }).length, 0, 'the reserved ID is not written as an extra row');

resetWorld();
const formBody = payload({ submissionId: 'form-submission-0001', title: 'Form post' });
const formResult = JSON.parse(context.doPost({
  parameter: {
    token: 'J4PAN88',
    action: 'admin_task_submit',
    submissionId: formBody.submissionId,
    taskAreaValue: formBody.taskAreaValue,
    title: formBody.title,
    description: formBody.description,
    actions: JSON.stringify(formBody.actions)
  }
})._text);
assertEqual(formResult.result, 'success', 'form-encoded submission is accepted');
assertEqual(formResult.taskId, 'TA001', 'form-encoded submission still allocates the task ID');
assertEqual(tasks.cell(2, 2).value, 'Form post', 'form-encoded title is written');

resetWorld();
actions.failOnWrite = 1;
const originalTasks = tasks.snapshot();
const originalActions = actions.snapshot();
const failed = post(payload({ submissionId: 'rollback-submission-01' }));
assertEqual(failed.result, 'error', 'write failure returns an error');
assert(failed.result !== 'success', 'write failure is not success');
assertEqual(failed.retryable, true, 'rolled back failure can be retried');
assertEqual(JSON.stringify(tasks.snapshot()), JSON.stringify(originalTasks), 'rolled back task sheet matches the original');
assertEqual(JSON.stringify(actions.snapshot()), JSON.stringify(originalActions), 'rolled back action sheet matches the original');
actions.failOnWrite = 0;
const retried = post(payload({ submissionId: 'rollback-submission-01' }));
assertEqual(retried.result, 'success', 'retry after rollback saves');
assertEqual(columnIds(tasks).length, 1, 'retry after rollback creates one task');

resetWorld();
actions.failOnWrite = 1;
tasks.failClear = true;
const partial = post(payload({ submissionId: 'partial-submission-01' }));
assertEqual(partial.result, 'error', 'failed rollback returns an error');
assertEqual(partial.partial, true, 'failed rollback is marked partial');
assertEqual(partial.retryable, false, 'failed rollback is not a blind retry');
assertEqual(partial.taskId, 'TA001', 'partial failure names the task ID');
assertEqual(columnIds(tasks).length, 1, 'partial failure keeps the task that could not be removed');
const partialAgain = post(payload({ submissionId: 'partial-submission-01' }));
assertEqual(partialAgain.result, 'error', 'repeating a partial submission does not report success');
assertEqual(partialAgain.taskId, 'TA001', 'repeating a partial submission returns the same task');
assertEqual(columnIds(tasks).length, 1, 'repeating a partial submission does not add a task');
assertEqual(columnIds(actions).length, 0, 'repeating a partial submission does not add actions');

resetWorld();
const resumeBody = payload({
  submissionId: 'resume-submission-0001',
  title: 'Reserved task',
  description: 'Already on the sheet',
  actions: [{ description: 'Finish the action', owner: 'Aaron S', dueDate: '2026-10-19', priority: 4 }]
});
const validated = context.validateSubmission_(resumeBody, areas, owners);
tasks.seed(6, 1, { value: 'AD1001-TA005' });
tasks.seed(6, 2, { value: validated.value.title });
tasks.seed(6, 3, { value: validated.value.taskAreaId });
tasks.seed(6, 4, { value: 'TA005' });
tasks.seed(6, 6, { value: validated.value.description });
context.saveRecord_(resumeBody.submissionId, {
  status: 'pending',
  fingerprint: context.fingerprint_(validated.value),
  taskAreaId: 'AD1001',
  taskId: 'TA005',
  actionIds: ['AC1']
});
const resumed = post(resumeBody);
assertEqual(resumed.result, 'success', 'a pending submission can be finished');
assertEqual(resumed.taskId, 'TA005', 'resume keeps the reserved task ID');
assertEqual(resumed.actionIds.join(','), 'AC1', 'resume uses the reserved action ID');
assertEqual(columnIds(tasks).filter(function (id) { return id === 'AD1001-TA005'; }).length, 1, 'resume does not create a second copy of the task');
assertEqual(tasks.cell(6, 1).value, 'AD1001-TA005', 'resume does not replace the displayed task ID');
assertEqual(actions.cell(2, 1).formula, '=ID', 'resume leaves the action ID formula alone');
assertEqual(actions.cell(2, 2).value, 'AD1001', 'resumed action uses the reserved task area ID');
assertEqual(actions.cell(2, 3).value, 'TA005', 'resumed action uses the reserved task ID');
assertEqual(actions.cell(2, 4).value, 'AC1', 'resumed action uses the reserved action code');
assertEqual(actions.shown(2, 1), 'AD1001-TA005-AC1', 'resumed action ID is displayed by column A');
assertEqual(actions.cell(2, 10).value, 'Open', 'a resumed new action starts Open');

resetWorld();
let secondResult = null;
tasks.hookWrite = function () {
  if (secondResult) return;
  secondResult = post(payload({ submissionId: 'locked-submission-02', title: 'Other user' }));
};
const firstLocked = post(payload({ submissionId: 'locked-submission-01', title: 'First user' }));
assertEqual(firstLocked.result, 'success', 'the lock holder still saves');
assertEqual(secondResult.result, 'error', 'a simultaneous submission is rejected while the lock is held');
assertEqual(columnIds(tasks).length, 1, 'a locked-out submission does not take an ID');
tasks.hookWrite = null;
const afterLock = post(payload({ submissionId: 'locked-submission-02', title: 'Other user' }));
assertEqual(afterLock.result, 'success', 'the second user can save after the lock is released');
assert(afterLock.taskId !== firstLocked.taskId, 'simultaneous submissions receive different task IDs');
assertEqual(columnIds(tasks).length, 2, 'two sequential saves create two tasks');

assertEqual(setValuesCount, 0, 'setValues was never used');
assertEqual(clearCount, 0, 'whole-range clear was never used');

const draftContext = {
  crypto: { randomUUID: function () { return '11111111-1111-4111-8111-111111111111'; } }
};
vm.createContext(draftContext);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../admin-tasks/task-draft.js'), 'utf8'), draftContext);
const draft = draftContext.AdminTaskDraft;

function memoryStorage() {
  const data = {};
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem: function (key, value) { data[key] = String(value); },
    removeItem: function (key) { delete data[key]; },
    data: data
  };
}

const blank = draft.blankState();
assert(draft.isMeaningful(blank) === false, 'a blank task is not an unfinished draft');
assertEqual(draft.KEY, 'scs_admin_task_draft', 'draft uses local storage key');
const typed = draft.snapshot({
  step: 2,
  taskAreaValue: 'AD1001 | General Administration',
  title: 'File the return',
  description: 'Prepare it',
  actions: [
    { description: 'First', owner: 'Jody R', dueDate: '2026-10-19', priority: '2' },
    { description: 'Second', owner: 'Aaron S', dueDate: '2026-11-02', priority: '5' }
  ],
  submissionId: 'draft-submission-0001',
  taskId: 'TA001',
  actionIds: ['AC1'],
  pin: '1234',
  password: 'secret'
});
assert(!Object.prototype.hasOwnProperty.call(typed, 'taskId'), 'draft does not store a task ID');
assert(!Object.prototype.hasOwnProperty.call(typed, 'pin'), 'draft does not store a PIN');
assert(!Object.prototype.hasOwnProperty.call(typed, 'password'), 'draft does not store a password');
assertEqual(typed.actions[1].description, 'Second', 'draft keeps action order');
const store = memoryStorage();
draft.write(store, typed);
const restored = draft.read(store);
assertEqual(restored.step, 2, 'draft restores the page');
assertEqual(restored.taskAreaValue, 'AD1001 | General Administration', 'draft restores the task area');
assertEqual(restored.actions.map(function (action) { return action.owner; }).join('|'), 'Jody R|Aaron S', 'draft restores every action');
assertEqual(draft.recoveryChoice('continue', false), 'continue', 'Continue restores the draft');
assertEqual(draft.recoveryChoice('start-new', false), 'confirm', 'Start New Task asks for confirmation');
assert(store.data[draft.KEY], 'confirmation alone does not discard the draft');
assertEqual(draft.recoveryChoice('start-new', true), 'discard', 'confirmed Start New Task discards the draft');
draft.clear(store);
assertEqual(draft.read(store), null, 'clear removes the draft');
draft.write(store, typed);
const failedStore = memoryStorage();
failedStore.setItem(draft.KEY, store.data[draft.KEY]);
assert(draft.read(failedStore), 'a failed submission can keep the same draft');
draft.write(failedStore, blank);
assertEqual(draft.read(failedStore), null, 'an empty replacement removes the draft');

const root = path.join(__dirname, '..');
const menu = fs.readFileSync(path.join(root, 'menu.html'), 'utf8');
const home = fs.readFileSync(path.join(root, 'admin-tasks/index.html'), 'utf8');
const page = fs.readFileSync(path.join(root, 'admin-tasks/create-task.html'), 'utf8');
const form = fs.readFileSync(path.join(root, 'admin-tasks/create-task.js'), 'utf8');
const names = [];
const re = /<span class="module-name">([^<]+)<\/span>/g;
let match;
while ((match = re.exec(menu))) names.push(match[1]);
assertEqual(names.join('|'), 'Warehouse|Schedule|HR|Admin Tasks|Quality|Maintenance|Health and Safety', 'Admin Tasks sits between HR and Quality');
assert(menu.indexOf('href="/admin-tasks/"') !== -1, 'Admin Tasks menu link opens the module');
assert(menu.indexOf('href="/warehouse/"') !== -1 && menu.indexOf('href="/hr/"') !== -1, 'Warehouse and HR links remain');
assert(menu.indexOf('href="/quality/"') !== -1 && menu.indexOf('href="/maintenance/"') !== -1, 'Quality and Maintenance links remain');
assert(menu.indexOf('href="/health-safety/"') !== -1 && menu.indexOf('href="/schedule/"') !== -1, 'Health and Safety and Schedule links remain');
assert(home.indexOf('>Create Task<') !== -1 && home.indexOf('href="create-task.html"') !== -1, 'Admin Tasks opens Create Task');
assert(home.indexOf('>Complete Actions<') !== -1 && home.indexOf('href="complete-actions.html"') !== -1, 'Admin Tasks opens Complete Actions beside Create Task');
assert(page.indexOf('task-draft.js') !== -1 && page.indexOf('create-task.js') !== -1, 'Create Task loads the draft and page scripts');
[
  'Add Administrative Task',
  'Add Actions',
  'Review Administrative Task',
  'Select the relevant task area',
  'Please give this job a title',
  'This will be used in conjunction with the Admin Task ID to help identify the correct job later.',
  'Task Description',
  'Please record any actions required to resolve this job below.',
  'Add Another Task?',
  'Priority Level (1–5)',
  '1 — Lowest',
  '5 — Highest',
  '1 is the lowest priority and 5 is the highest.',
  'You have an unfinished Administrative Task. Would you like to continue where you left off?',
  'Continue',
  'Start New Task',
  'Submit Task',
  'type="date"'
].forEach(function (label) {
  assert(form.indexOf(label) !== -1, 'create task contains ' + label);
});
assert(form.indexOf('localStorage') !== -1, 'draft uses local storage');
assert(form.indexOf('sessionStorage') === -1, 'draft is not limited to the current tab');
assert(form.indexOf('559712901') === -1, 'the browser does not fetch the staff CSV');
assert(form.split('fetch(SCRIPT_URL').length === 2, 'Google Sheets is contacted only from Submit Task');
assert(form.indexOf("body.result !== 'success'") !== -1 && form.indexOf('AdminTaskDraft.clear(storage)') !== -1, 'the draft is cleared from the success path');

Promise.resolve().then(function () {
  delete process.env.ADMIN_TASKS_SCRIPT_URL;
  const submit = require('../netlify/functions/submitAdminTask');
  const lists = require('../netlify/functions/adminTaskLists');
  return Promise.all([
    submit.handler({ httpMethod: 'POST', body: '{}' }),
    lists.handler({ httpMethod: 'POST' })
  ]);
}).then(function (responses) {
  assertEqual(responses[0].statusCode, 500, 'missing script URL does not pretend to save');
  assertEqual(JSON.parse(responses[0].body).result, 'error', 'missing script URL returns an error');
  assertEqual(responses[1].statusCode, 405, 'task lists reject a POST');
  finish();
}).catch(function (err) {
  failures++;
  console.error('FAIL: handler guard ' + err.message);
  finish();
});

function finish() {
  if (failures) {
    console.error(failures + ' failed, ' + passes + ' passed');
    process.exit(1);
  }
  console.log(passes + ' passed');
}
