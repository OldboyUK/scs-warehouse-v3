const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const core = require('../netlify/functions/riskAssessmentCore');

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

const CSV = [
  'AssessmentID,Title / Activity,HELPER',
  'DECOY-A,Warehouse movements,RA1016 | Warehouse',
  'DECOY-B,Line,LN1017 | Line check',
  'DECOY-C,Pack,"PK1018 | Pack (A)+"',
  'DECOY-D,Quoted,"QT1019 | Quoted, name"',
  'DECOY-E,Blank helper,',
  'DECOY-A,Duplicate,RA1016 | Warehouse',
  'SHORT,Too short,Bad',
  'AMBIG,Ambiguous,RA10167 Extra'
].join('\n');

let csvText = CSV;
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
      if (name === 'Hazards') {
        const activity = String(sheet.cell(row, 3).value || '').trim();
        const hazard = String(sheet.cell(row, 4).value || '').trim();
        if (!activity || !hazard) return '';
        return activity + '-' + hazard;
      }
      if (name === 'Actions') {
        const activity = String(sheet.cell(row, 2).value || '').trim();
        const hazard = String(sheet.cell(row, 3).value || '').trim();
        const action = String(sheet.cell(row, 4).value || '').trim();
        if (!activity || !hazard || !action) return '';
        return activity + '-' + hazard + '-' + action;
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
      if (after !== sheet.maxRows) {
        throw new Error('Refusing to insert rows in the middle at ' + after);
      }
      sheet.maxRows += howMany;
      sheet.insertCount += 1;
    },
    getRange: function (row, col, numRows, numCols) {
      if (numRows == null) numRows = 1;
      if (numCols == null) numCols = 1;
      const endRow = row + numRows - 1;
      const endCol = col + numCols - 1;
      if (row < 1 || col < 1 || endRow > sheet.maxRows || endCol > sheet.maxCols) {
        throw new Error('Range exceeds grid limits ' + row + ':' + endRow);
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
  }
}

let hazards;
let actions;

function resetWorld() {
  openCount = 0;
  setValuesCount = 0;
  clearCount = 0;
  locked = false;
  Object.keys(properties).forEach(function (key) { delete properties[key]; });
  hazards = createSheet('Hazards', 1159021811, 30);
  actions = createSheet('Actions', 1408515271, 30);
  hazards.seed(1, 1, { value: 'Hazard ID' });
  actions.seed(1, 1, { value: 'Action ID' });
  seedIdFormulas(hazards);
  seedIdFormulas(actions);
  csvText = CSV;
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
    fetch: function () {
      return {
        getResponseCode: function () { return csvText ? 200 : 500; },
        getContentText: function () { return csvText; }
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
      if (id !== '1m736CzXXQaOSSz23NswiOdDQ5iX4Jpjm3ROkllomgtU') {
        throw new Error('Unexpected spreadsheet');
      }
      return {
        getSheetByName: function (name) {
          if (name === 'Hazards') return hazards;
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
vm.runInContext(fs.readFileSync(path.join(__dirname, '../GOOGLE SCRIPTS/HealthSafety.js'), 'utf8'), context);

function post(payload, token) {
  const output = context.doPost({
    postData: {
      type: 'application/json',
      contents: JSON.stringify(Object.assign({
        token: token || 'J4PAN88',
        action: 'risk_assessment_submit'
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
    activity: 'RA1016 | Warehouse',
    hazardName: 'Wet floor',
    hazardDescription: 'Water by the tanker bay',
    whoMightBeHarmed: 'Warehouse staff can slip',
    currentControls: 'Spill kit in place',
    likelihood: 3,
    severity: 4,
    actions: [
      { description: 'Refresh the spill procedure', owner: 'Warehouse Manager', dueDate: '2026-10-19' }
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

resetWorld();

const activityNames = ['RA1016 | Warehouse', 'LN1017 | Line check', 'PK1018 | Pack (A)+', 'QT1019 | Quoted, name', 'Bad', 'RA10167 Extra'];
assertEqual(core.activitiesFromCsv(CSV).join('|'), activityNames.join('|'), 'activities come from column C and drop blanks');
assertEqual(context.loadActivitiesFromText_(CSV).join('|'), activityNames.join('|'), 'script activities come from column C');
assert(core.activitiesFromCsv(CSV).indexOf('DECOY-A') === -1, 'dropdown does not use column A');
assertEqual(core.activityCodeFromSelection('RA1016 | Warehouse'), 'RA1016', 'activity code is the first six characters');
assertEqual(core.activityCodeFromSelection('RA1016'), 'RA1016', 'a bare six-character code is accepted');
assertEqual(core.activityCodeFromSelection('PK1018 | Pack (A)+'), 'PK1018', 'punctuation after the code stays out of the code');
assertEqual(core.activityCodeFromSelection('Bad'), '', 'a short label is not turned into a code');
assertEqual(core.activityCodeFromSelection('RA10167 Extra'), '', 'a seventh alphanumeric character is rejected');
activityNames.forEach(function (activity) {
  assertEqual(context.activityCodeFromSelection_(activity), core.activityCodeFromSelection(activity), 'code extraction matches for ' + activity);
});
assertEqual(core.parseDueDate('2026-10-19'), '19/10/2026', 'iso date becomes uk date');
assertEqual(core.parseDueDate('19/10/2026'), '19/10/2026', 'uk date stays uk date');
assertEqual(core.parseDueDate('2026-02-31'), null, 'invalid calendar date rejected');
assertEqual(core.parseDueDate('2024-02-29'), '29/02/2024', 'leap day accepted');
assertEqual(core.parseDueDate('2023-02-29'), null, 'non-leap day rejected');
assertEqual(core.parseDueDate(''), null, 'blank date rejected');
assertEqual(core.parseScore(4), 4, 'numeric score accepted');
assertEqual(core.parseScore('5'), 5, 'string score accepted');
assertEqual(core.parseScore('05'), null, 'padded score rejected');
assertEqual(core.parseScore(1.5), null, 'fractional score rejected');

const activities = core.activitiesFromCsv(CSV);
const badCases = [
  [{}, 'activity'],
  [payload({ activity: 'Not real' }), 'activity'],
  [payload({ hazardName: '   ' }), 'name'],
  [payload({ hazardDescription: '' }), 'description'],
  [payload({ whoMightBeHarmed: '' }), 'harmed'],
  [payload({ currentControls: '' }), 'controls'],
  [payload({ likelihood: 6 }), 'likelihood'],
  [payload({ severity: '0' }), 'severity'],
  [payload({ actions: [] }), 'at least one'],
  [payload({ actions: [{ description: '', owner: 'CEO', dueDate: '2026-10-19' }] }), 'further action'],
  [payload({ actions: [{ description: 'Do it', owner: 'ceo', dueDate: '2026-10-19' }] }), 'owner'],
  [payload({ actions: [{ description: 'Do it', owner: 'CEO', dueDate: '' }] }), 'due date'],
  [payload({ submissionId: 'short' }), 'identified']
];
badCases.forEach(function (entry) {
  const result = core.validateSubmission(entry[0], activities);
  assert(result.ok === false && result.message, 'core rejects ' + entry[1]);
  const scriptResult = context.validateSubmission_(entry[0], activities);
  assert(scriptResult.ok === false, 'script rejects ' + entry[1]);
});
const shortCode = core.validateSubmission(payload({ activity: 'Bad' }), activities);
assert(shortCode.ok === false && shortCode.message.indexOf('6-character') !== -1, 'short activity code explains why it was rejected');
const ambiguousCode = core.validateSubmission(payload({ activity: 'RA10167 Extra' }), activities);
assert(ambiguousCode.ok === false && ambiguousCode.message.indexOf('6-character') !== -1, 'ambiguous activity code is rejected');
const accepted = core.validateSubmission(payload(), activities);
assertEqual(accepted.value.activity, 'RA1016 | Warehouse', 'selected activity label is preserved');
assertEqual(accepted.value.activityCode, 'RA1016', 'validation returns the activity code');

assertEqual(context.nextHazardId_('RA1016', ['RA1016-HZ001', 'RA1016-HZ002', 'RA1016-HZ004']), 'RA1016-HZ005', 'gap in suffixes uses the highest number');
assertEqual(context.nextHazardId_('RA1016', ['RA1016-HZ009', 'OTHER-HZ050', 'RA1016-HZ001']), 'RA1016-HZ010', 'sequence ignores other activities and row position');
assertEqual(context.nextHazardId_('Pack (A)+', []), 'Pack (A)+-HZ001', 'regex characters stay in the prefix');
assertEqual(context.nextHazardId_('RA1016-HZ001', ['RA1016-HZ001', 'RA1016-HZ001-HZ001']), 'RA1016-HZ001-HZ002', 'longer activity prefix is not parsed as the shorter id');
assertEqual(context.nextActionIds_('RA1016-HZ001', 2, ['RA1016-HZ001-AC1', 'RA1016-HZ001-AC2']).join(','), 'RA1016-HZ001-AC3,RA1016-HZ001-AC4', 'action suffix continues after existing ids');
assertEqual(context.nextActionIds_('RA1016-HZ001', 3, []).join(','), 'RA1016-HZ001-AC1,RA1016-HZ001-AC2,RA1016-HZ001-AC3', 'new hazard actions start at AC1');

resetWorld();
const denied = post(payload(), 'nope');
assertEqual(denied.result, 'error', 'bad token is rejected');
assertEqual(openCount, 0, 'bad token does not open the spreadsheet');

resetWorld();
const invalid = post(payload({ owner: 'nope', actions: [{ description: 'Do it', owner: 'Intern', dueDate: '2026-10-19' }] }));
assertEqual(invalid.result, 'error', 'invalid owner rejected');
assert(invalid.result !== 'success', 'invalid owner is not success');
assertEqual(openCount, 0, 'invalid submission does not open the spreadsheet');
assertEqual(columnIds(hazards).length, 0, 'invalid submission writes no hazard');

resetWorld();
hazards.seed(2, 5, { value: 42 });
hazards.seed(2, 11, { formula: '=D2' });
actions.seed(2, 5, { formula: '=A2' });
actions.seed(2, 9, { value: 'leave-me' });
const beforeHazard = hazards.snapshot();
const beforeAction = actions.snapshot();
const saved = post(payload({ hazardDescription: '=1+1' }));
assertEqual(saved.result, 'success', 'one action saves');
assertEqual(saved.hazardId, 'RA1016-HZ001', 'first hazard id');
assertEqual(saved.actionIds.join(','), 'RA1016-HZ001-AC1', 'first action id');
assertEqual(hazards.cell(2, 1).formula, '=ID', 'hazard column A formula stays in place');
assertEqual(hazards.cell(2, 1).value, '', 'hazard column A is not written');
assertEqual(hazards.shown(2, 1), 'RA1016-HZ001', 'hazard column A formula displays the complete id');
assertEqual(hazards.cell(2, 2).value, 'Wet floor', 'hazard name written to column B');
assertEqual(hazards.cell(2, 3).value, 'RA1016', 'activity code written to hazard column C');
assertEqual(hazards.cell(2, 4).value, 'HZ001', 'hazard code written to column D');
assertEqual(hazards.cell(2, 6).value, '=1+1', 'description stored as text');
assertEqual(hazards.cell(2, 6).formula, '', 'description was not stored as a formula');
assertEqual(hazards.cell(2, 7).value, 'Warehouse staff can slip', 'who harmed written to column G');
assertEqual(hazards.cell(2, 8).value, 'Spill kit in place', 'controls written to column H');
assertEqual(hazards.cell(2, 9).value, 3, 'likelihood stored as a number');
assertEqual(hazards.cell(2, 10).value, 4, 'severity stored as a number');
assertEqual(hazards.cell(2, 5).value, 42, 'column E value untouched');
assertEqual(hazards.cell(2, 11).formula, '=D2', 'column K formula untouched');
assertEqual(hazards.cell(30, 3).value, '', 'the write does not append below the formula area');
assertEqual(hazards.insertCount, 0, 'an earlier blank column A row does not insert rows');
assertEqual(actions.cell(2, 1).formula, '=ID', 'action column A formula stays in place');
assertEqual(actions.cell(2, 1).value, '', 'action column A is not written');
assertEqual(actions.shown(2, 1), 'RA1016-HZ001-AC1', 'action column A formula displays the complete id');
assertEqual(actions.cell(2, 2).value, 'RA1016', 'activity code written to action column B');
assertEqual(actions.cell(2, 3).value, 'HZ001', 'hazard code written to action column C');
assertEqual(actions.cell(2, 4).value, 'AC1', 'action code written to column D');
assertEqual(actions.cell(2, 6).value, 'Refresh the spill procedure', 'action description written to column F');
assertEqual(actions.cell(2, 7).value, 'Warehouse Manager', 'owner written to column G');
assertEqual(actions.cell(2, 8).value, '19/10/2026', 'due date written as dd/MM/yyyy');
assertEqual(actions.cell(2, 5).formula, '=A2', 'action column E formula untouched');
assertEqual(actions.cell(2, 9).value, 'leave-me', 'action column I untouched');
assertEqual(hazards.cell(1, 1).value, 'Hazard ID', 'header row untouched');
const hazardChanges = changedKeys(beforeHazard, hazards.snapshot());
assertEqual(hazardChanges.join('|'), ['2,10', '2,2', '2,3', '2,4', '2,6', '2,7', '2,8', '2,9'].join('|'), 'only hazard destination cells changed');
const actionChanges = changedKeys(beforeAction, actions.snapshot());
assertEqual(actionChanges.join('|'), ['2,2', '2,3', '2,4', '2,6', '2,7', '2,8'].join('|'), 'only action destination cells changed');

resetWorld();

const same = payload({
  submissionId: 'same-submission-0001',
  actions: [
    { description: 'First action', owner: 'CEO', dueDate: '2026-01-05' },
    { description: 'Second action', owner: 'Engineer', dueDate: '2026-11-02' },
    { description: 'Third action', owner: 'N/A', dueDate: '2026-12-01' }
  ]
});
const three = post(same);
assertEqual(three.result, 'success', 'three actions save');
assertEqual(three.hazardId, 'RA1016-HZ001', 'one hazard id for three actions');
assertEqual(three.actionIds.join(','), 'RA1016-HZ001-AC1,RA1016-HZ001-AC2,RA1016-HZ001-AC3', 'action ids share the hazard and increment');
assertEqual(columnIds(hazards).length, 1, 'three actions do not create three hazards');
assertEqual(columnIds(actions).join(','), three.actionIds.join(','), 'each action has its own row');
assertEqual(actions.cell(2, 2).value, 'RA1016', 'first action reuses the activity code');
assertEqual(actions.cell(3, 2).value, 'RA1016', 'second action reuses the activity code');
assertEqual(actions.cell(4, 2).value, 'RA1016', 'third action reuses the activity code');
assertEqual(actions.cell(2, 3).value, 'HZ001', 'first action reuses the hazard code');
assertEqual(actions.cell(3, 3).value, 'HZ001', 'second action reuses the hazard code');
assertEqual(actions.cell(4, 3).value, 'HZ001', 'third action reuses the hazard code');
assertEqual(actions.cell(2, 4).value, 'AC1', 'first action code');
assertEqual(actions.cell(3, 4).value, 'AC2', 'second action code');
assertEqual(actions.cell(4, 4).value, 'AC3', 'third action code');
assertEqual(actions.cell(2, 1).formula, '=ID', 'shared actions do not write column A');
assertEqual(actions.cell(2, 8).value, '05/01/2026', 'single digit day is padded');
const duplicate = post(same);
assertEqual(duplicate.result, 'success', 'repeat submission returns success');
assertEqual(duplicate.hazardId, three.hazardId, 'repeat submission returns the original hazard id');
assertEqual(columnIds(hazards).length, 1, 'repeat submission does not add a hazard');
assertEqual(columnIds(actions).length, 3, 'repeat submission does not add actions');
assertEqual(openCount, 1, 'repeat submission does not open the spreadsheet again');

const second = post(payload({ hazardName: 'Second hazard' }));
assertEqual(second.hazardId, 'RA1016-HZ002', 'second hazard for the same activity increments');
const other = post(payload({ activity: 'LN1017 | Line check', hazardName: 'Line hazard' }));
assertEqual(other.hazardId, 'LN1017-HZ001', 'a different activity starts its own sequence');
assertEqual(hazards.cell(4, 3).value, 'LN1017', 'the other activity code is written from its label');
const special = post(payload({ activity: 'PK1018 | Pack (A)+', hazardName: 'Special' }));
assertEqual(special.hazardId, 'PK1018-HZ001', 'punctuation in the label is not copied into the id');
const quoted = post(payload({ activity: 'QT1019 | Quoted, name', hazardName: 'Comma' }));
assertEqual(quoted.hazardId, 'QT1019-HZ001', 'a comma in the label stays out of the activity code');

resetWorld();
hazards.seed(2, 1, { value: 'RA1016-HZ009' });
hazards.seed(5, 1, { value: 'RA1016-HZ001' });
hazards.seed(3, 1, { value: 'OTHER-HZ003' });
const gapped = post(payload());
assertEqual(gapped.hazardId, 'RA1016-HZ010', 'next id follows the highest suffix, not the last row');
assertEqual(hazards.cell(2, 1).value, 'RA1016-HZ009', 'existing higher id is not overwritten');
assertEqual(hazards.cell(4, 1).formula, '=ID', 'the blank column A formula is not replaced');
assertEqual(hazards.cell(4, 3).value, 'RA1016', 'the first blank column A row receives the activity code');
assertEqual(hazards.cell(4, 4).value, 'HZ010', 'the first blank column A row receives the hazard code');
assertEqual(hazards.shown(4, 1), 'RA1016-HZ010', 'the blank formula displays the new hazard id');

resetWorld();
hazards.seed(2, 1, { value: 'RA1016-HZ001' });
hazards.seed(2, 6, { formula: '=1+1' });
hazards.seed(3, 1, { formula: '=IF(C3="","",C3&"-"&D3)', display: '' });
hazards.seed(3, 5, { formula: '=A3' });
hazards.seed(3, 11, { value: 'still-here' });
hazards.seed(8, 1, { formula: '=C8&"-"&D8', display: 'RA1016-HZ014' });
const skipped = post(payload());
assertEqual(skipped.hazardId, 'RA1016-HZ015', 'a formula-displayed id counts toward the next suffix');
assertEqual(hazards.cell(2, 1).value, 'RA1016-HZ001', 'a visible id is not overwritten');
assertEqual(hazards.cell(2, 6).formula, '=1+1', 'a row with a visible id is not used');
assertEqual(hazards.cell(2, 3).value, '', 'component columns on a visible id row stay empty');
assertEqual(hazards.cell(3, 1).formula, '=IF(C3="","",C3&"-"&D3)', 'an empty formula result stays in column A');
assertEqual(hazards.cell(3, 3).value, 'RA1016', 'the empty formula row receives the activity code');
assertEqual(hazards.cell(3, 4).value, 'HZ015', 'the empty formula row receives the hazard code');
assertEqual(hazards.shown(3, 1), 'RA1016-HZ015', 'the empty formula then displays the complete id');
assertEqual(hazards.cell(3, 5).formula, '=A3', 'unrelated formula on the written row stays');
assertEqual(hazards.cell(3, 11).value, 'still-here', 'unrelated value on the written row stays');
assertEqual(hazards.cell(8, 1).formula, '=C8&"-"&D8', 'a formula-only id is not overwritten');
assertEqual(hazards.cell(8, 3).value, '', 'a formula-only id row does not receive new components');
assertEqual(hazards.insertCount, 0, 'an earlier blank display row does not append below the formulas');

resetWorld();
hazards.seed(1, 6, { formula: '=ARRAYFORMULA(A2:A)' });
const blockedFormula = hazards.snapshot();
const arrayResult = post(payload());
assertEqual(arrayResult.result, 'error', 'array formula blocks the save');
assert(arrayResult.result !== 'success', 'array formula does not report success');
assertEqual(JSON.stringify(hazards.snapshot()), JSON.stringify(blockedFormula), 'array formula sheet is unchanged');

resetWorld();
hazards.seed(1, 1, { formula: '=ARRAYFORMULA(IF(C2:C="","",C2:C&"-"&D2:D))' });
const arrayOwned = post(payload());
assertEqual(arrayOwned.result, 'success', 'an array formula in column A does not block the save');
assertEqual(hazards.cell(1, 1).formula, '=ARRAYFORMULA(IF(C2:C="","",C2:C&"-"&D2:D))', 'the column A array formula is not overwritten');
assertEqual(hazards.cell(2, 3).value, 'RA1016', 'component values are still written beside a column A array formula');

resetWorld();
actions.seed(2, 1, { value: 'RA1016-HZ001-AC1' });
actions.seed(2, 6, { value: 'old action' });
actions.seed(3, 1, { value: 'RA1016-HZ001-AC2' });
const continued = post(payload({
  actions: [
    { description: 'New one', owner: 'Quality Manager', dueDate: '2026-10-20' },
    { description: 'New two', owner: 'Other', dueDate: '2026-10-21' }
  ]
}));
assertEqual(continued.actionIds.join(','), 'RA1016-HZ001-AC3,RA1016-HZ001-AC4', 'existing action ids are not reused');
assertEqual(actions.cell(2, 6).value, 'old action', 'existing action description stays');
assertEqual(actions.cell(2, 1).value, 'RA1016-HZ001-AC1', 'existing action id stays in place');
assertEqual(actions.cell(4, 1).formula, '=ID', 'new action rows leave column A to the formula');
assertEqual(actions.cell(4, 2).value, 'RA1016', 'continued action keeps the activity code');
assertEqual(actions.cell(4, 3).value, 'HZ001', 'continued action keeps the hazard code');
assertEqual(actions.cell(4, 4).value, 'AC3', 'continued action code follows the existing suffix');
assertEqual(actions.cell(5, 4).value, 'AC4', 'the next continued action increments');
assertEqual(actions.shown(4, 1), 'RA1016-HZ001-AC3', 'continued action id is displayed by column A');

resetWorld();
const narrow = createSheet('Hazards', 1159021811, 3);
const narrowActions = createSheet('Actions', 1408515271, 10);
hazards = narrow;
actions = narrowActions;
hazards.seed(1, 1, { value: 'Hazard ID' });
hazards.seed(2, 1, { value: 'RA1016-HZ001' });
hazards.seed(3, 1, { value: 'RA1016-HZ002' });
actions.seed(1, 1, { value: 'Action ID' });
const inserted = post(payload());
assertEqual(inserted.hazardId, 'RA1016-HZ003', 'full sheet still allocates the next id');
assertEqual(hazards.cell(4, 1).value, '', 'the inserted row does not receive a written id');
assertEqual(hazards.cell(4, 3).value, 'RA1016', 'the inserted row receives the activity code');
assertEqual(hazards.cell(4, 4).value, 'HZ003', 'the inserted row receives the hazard code');
assertEqual(hazards.cell(2, 1).value, 'RA1016-HZ001', 'inserted row does not shift existing ids');
assert(hazards.insertCount > 0, 'rows are inserted only when the grid is full');

resetWorld();
const hacked = post(payload({ hazardId: 'HACK-HZ999', actionIds: ['HACK-AC1'] }));
assertEqual(hacked.hazardId, 'RA1016-HZ001', 'client hazard ids are ignored');
assertEqual(hacked.actionIds[0], 'RA1016-HZ001-AC1', 'client action ids are ignored');

resetWorld();
const formBody = payload({ submissionId: 'form-submission-0001', hazardName: 'Form post' });
const formResult = JSON.parse(context.doPost({
  parameter: {
    token: 'J4PAN88',
    action: 'risk_assessment_submit',
    submissionId: formBody.submissionId,
    activity: formBody.activity,
    hazardName: formBody.hazardName,
    hazardDescription: formBody.hazardDescription,
    whoMightBeHarmed: formBody.whoMightBeHarmed,
    currentControls: formBody.currentControls,
    likelihood: String(formBody.likelihood),
    severity: String(formBody.severity),
    actions: JSON.stringify(formBody.actions)
  }
})._text);
assertEqual(formResult.result, 'success', 'form-encoded submission is accepted');
assertEqual(formResult.hazardId, 'RA1016-HZ001', 'form-encoded submission still allocates the hazard id');
assertEqual(hazards.cell(2, 2).value, 'Form post', 'form-encoded hazard name is written');

resetWorld();
actions.failOnWrite = 1;
const originalHazards = hazards.snapshot();
const originalActions = actions.snapshot();
const failed = post(payload({ submissionId: 'rollback-submission-01' }));
assertEqual(failed.result, 'error', 'write failure returns an error');
assert(failed.result !== 'success', 'write failure is not success');
assertEqual(failed.retryable, true, 'rolled back failure can be retried');
assertEqual(JSON.stringify(hazards.snapshot()), JSON.stringify(originalHazards), 'rolled back hazard sheet matches the original');
assertEqual(JSON.stringify(actions.snapshot()), JSON.stringify(originalActions), 'rolled back action sheet matches the original');
actions.failOnWrite = 0;
const retried = post(payload({ submissionId: 'rollback-submission-01' }));
assertEqual(retried.result, 'success', 'retry after rollback saves');
assertEqual(columnIds(hazards).length, 1, 'retry after rollback creates one hazard');

resetWorld();
actions.failOnWrite = 1;
hazards.failClear = true;
const partial = post(payload({ submissionId: 'partial-submission-01' }));
assertEqual(partial.result, 'error', 'failed rollback returns an error');
assertEqual(partial.partial, true, 'failed rollback is marked partial');
assertEqual(partial.retryable, false, 'failed rollback is not a blind retry');
assertEqual(partial.hazardId, 'RA1016-HZ001', 'partial failure names the hazard id');
assertEqual(columnIds(hazards).length, 1, 'partial failure keeps the hazard that could not be removed');
const partialAgain = post(payload({ submissionId: 'partial-submission-01' }));
assertEqual(partialAgain.result, 'error', 'repeating a partial submission does not report success');
assertEqual(partialAgain.hazardId, 'RA1016-HZ001', 'repeating a partial submission returns the same hazard');
assertEqual(columnIds(hazards).length, 1, 'repeating a partial submission does not add a hazard');
assertEqual(columnIds(actions).length, 0, 'repeating a partial submission does not add actions');

resetWorld();
hazards.seed(2, 1, { value: 'RA1016-HZ001' });
hazards.seed(3, 1, { value: 'RA1016-HZ002' });
const resumeBody = payload({
  submissionId: 'resume-submission-0001',
  hazardName: 'Reserved hazard',
  hazardDescription: 'Already on the sheet',
  whoMightBeHarmed: 'Staff',
  currentControls: 'Barrier',
  likelihood: 2,
  severity: 5,
  actions: [{ description: 'Finish the action', owner: 'CEO & Warehouse Manager', dueDate: '2026-10-19' }]
});
const validated = context.validateSubmission_(resumeBody, core.activitiesFromCsv(CSV));
hazards.seed(6, 1, { value: 'RA1016-HZ005' });
hazards.seed(6, 2, { value: validated.value.hazardName });
hazards.seed(6, 6, { value: validated.value.hazardDescription });
hazards.seed(6, 7, { value: validated.value.whoMightBeHarmed });
hazards.seed(6, 8, { value: validated.value.currentControls });
hazards.seed(6, 9, { value: validated.value.likelihood });
hazards.seed(6, 10, { value: validated.value.severity });
context.saveRecord_(resumeBody.submissionId, {
  status: 'pending',
  fingerprint: context.fingerprint_(validated.value),
  hazardId: 'RA1016-HZ005',
  actionIds: ['RA1016-HZ005-AC1']
});
const resumed = post(resumeBody);
assertEqual(resumed.result, 'success', 'pending submission can be finished');
assertEqual(resumed.hazardId, 'RA1016-HZ005', 'resume keeps the reserved hazard id');
assertEqual(resumed.actionIds.join(','), 'RA1016-HZ005-AC1', 'resume uses the reserved action id');
assertEqual(columnIds(hazards).filter(function (id) { return id === 'RA1016-HZ005'; }).length, 1, 'resume does not create a second copy of the hazard');
assertEqual(hazards.cell(6, 3).value, 'RA1016', 'resume writes the activity code onto the reserved hazard row');
assertEqual(hazards.cell(6, 4).value, 'HZ005', 'resume writes only the hazard code');
assertEqual(hazards.cell(6, 1).value, 'RA1016-HZ005', 'resume does not replace the displayed hazard id');
assertEqual(actions.cell(2, 1).formula, '=ID', 'resume leaves the action id formula alone');
assertEqual(actions.cell(2, 2).value, 'RA1016', 'resumed action uses the reserved activity code');
assertEqual(actions.cell(2, 3).value, 'HZ005', 'resumed action uses the reserved hazard code');
assertEqual(actions.cell(2, 4).value, 'AC1', 'resumed action uses the reserved action code');
assertEqual(actions.shown(2, 1), 'RA1016-HZ005-AC1', 'resumed action id is displayed by column A');

resetWorld();
let secondResult = null;
hazards.hookWrite = function () {
  if (secondResult) return;
  secondResult = post(payload({ submissionId: 'locked-submission-02', hazardName: 'Other user' }));
};
const firstLocked = post(payload({ submissionId: 'locked-submission-01', hazardName: 'First user' }));
assertEqual(firstLocked.result, 'success', 'the lock holder still saves');
assertEqual(secondResult.result, 'error', 'a simultaneous submission is rejected while the lock is held');
assertEqual(columnIds(hazards).length, 1, 'a locked-out submission does not take an id');
hazards.hookWrite = null;
const afterLock = post(payload({ submissionId: 'locked-submission-02', hazardName: 'Other user' }));
assertEqual(afterLock.result, 'success', 'the second user can save after the lock is released');
assert(afterLock.hazardId !== firstLocked.hazardId, 'simultaneous submissions receive different hazard ids');
assertEqual(columnIds(hazards).length, 2, 'two sequential saves create two hazards');

assertEqual(setValuesCount, 0, 'setValues was never used');
assertEqual(clearCount, 0, 'whole-range clear was never used');

if (failures) {
  console.error(failures + ' failed, ' + passes + ' passed');
  process.exit(1);
}
console.log(passes + ' passed');
