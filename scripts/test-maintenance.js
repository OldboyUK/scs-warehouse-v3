const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const fetch = require('node-fetch');
const core = require('../netlify/functions/maintenanceCore');

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

function formatDate(date, timeZone, format) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const map = {};
  parts.forEach(function (part) { map[part.type] = part.value; });
  return String(format)
    .replace('yyyy', map.year)
    .replace('dd', map.day)
    .replace('MM', map.month)
    .replace('HH', map.hour || '')
    .replace('mm', map.minute || '')
    .replace('ss', map.second || '');
}

const FIXTURE = [
  'Operator,Line / Area,Machine / Equipment,Priority',
  'Jody R,Internal Blending Area,Pall Crossflow,High Priority - Urgent Risk to Safety of People or Food',
  'Zoe I,Laboratory,DMA,',
  ',Laboratory,CBox,',
  ',Laboratory,Hanna Titrator,',
  ',"Office Area, Toilets and Break Room",Desks,',
  ',Bottling Line,Depalletiser,',
  ',Bottling Line,Cimec Filler,'
].join('\n');

function createSheet(maxRows) {
  const cells = new Map();
  const sheet = {
    maxRows: maxRows || 8,
    failOnCol: 0,
    writeLog: [],
    clearLog: [],
    getName: function () { return 'Submission Log'; },
    getMaxRows: function () { return sheet.maxRows; },
    getMaxColumns: function () { return 26; },
    insertRowsAfter: function (after, count) { sheet.maxRows += count; },
    key: function (row, col) { return row + ':' + col; },
    cell: function (row, col) {
      if (row < 1 || col < 1 || row > sheet.maxRows || col > 40) {
        throw new Error('Range exceeds grid r' + row + 'c' + col);
      }
      const key = sheet.key(row, col);
      if (!cells.has(key)) cells.set(key, { value: '', formula: '', format: 'General', display: null });
      return cells.get(key);
    },
    seed: function (row, col, data) {
      const rec = sheet.cell(row, col);
      if (data.formula != null) rec.formula = data.formula;
      if (data.value != null) rec.value = data.value;
      if (data.display !== undefined) rec.display = data.display;
      if (data.format != null) rec.format = data.format;
    },
    shown: function (rec) {
      if (rec.display != null) return rec.display;
      if (rec.value == null) return '';
      return String(rec.value);
    },
    getLastColumn: function () {
      let max = 0;
      cells.forEach(function (rec, key) {
        const col = Number(key.split(':')[1]);
        const has = (rec.value != null && String(rec.value) !== '') || String(rec.formula || '') !== '' || (rec.display != null && rec.display !== '');
        if (has && col > max) max = col;
      });
      return max;
    }
  };

  sheet.getRange = function (row, col, numRows, numCols) {
    const height = numRows == null ? 1 : numRows;
    const width = numCols == null ? 1 : numCols;
    if (row + height - 1 > sheet.maxRows || col + width - 1 > 40) {
      throw new Error('Range exceeds grid ' + row + ',' + col + ' ' + height + 'x' + width);
    }
    return {
      getValue: function () {
        if (height !== 1 || width !== 1) throw new Error('getValue on multi');
        return sheet.cell(row, col).value;
      },
      getFormula: function () {
        if (height !== 1 || width !== 1) throw new Error('getFormula on multi');
        return sheet.cell(row, col).formula;
      },
      getDisplayValue: function () {
        return sheet.shown(sheet.cell(row, col));
      },
      getDisplayValues: function () {
        const out = [];
        for (let r = 0; r < height; r++) {
          const line = [];
          for (let c = 0; c < width; c++) line.push(sheet.shown(sheet.cell(row + r, col + c)));
          out.push(line);
        }
        return out;
      },
      getNumberFormat: function () { return sheet.cell(row, col).format; },
      setNumberFormat: function (fmt) {
        for (let r = 0; r < height; r++) {
          for (let c = 0; c < width; c++) sheet.cell(row + r, col + c).format = fmt;
        }
      },
      setValue: function (v) {
        if (height !== 1 || width !== 1) throw new Error('setValue on multi cell range');
        if (sheet.failOnCol && sheet.failOnCol === col) {
          sheet.failOnCol = 0;
          throw new Error('Simulated write failure');
        }
        const rec = sheet.cell(row, col);
        rec.value = v;
        rec.formula = '';
        rec.display = null;
        sheet.writeLog.push({ row: row, col: col, value: v });
      },
      setFormula: function (formula) {
        if (height !== 1 || width !== 1) throw new Error('setFormula on multi');
        const rec = sheet.cell(row, col);
        rec.formula = formula;
        rec.value = '';
        rec.display = '';
      },
      clearContent: function () {
        if (height * width !== 1) throw new Error('clearContent on multi cell range');
        const rec = sheet.cell(row, col);
        rec.value = '';
        rec.formula = '';
        rec.display = null;
        sheet.clearLog.push({ row: row, col: col });
      },
      setValues: function () { throw new Error('setValues was called'); },
      clear: function () { throw new Error('range.clear was called'); }
    };
  };
  return sheet;
}

function seedHeaders(sheet, includeOperator) {
  const headers = ['Maintenance ID', 'Date', 'Line / Area', 'Machine / Equipment', 'Priority', 'Description', 'Parts', 'Maintenance Request'];
  if (includeOperator !== false) headers.push('Operator');
  headers.forEach(function (text, index) {
    sheet.seed(1, index + 1, { value: text });
  });
}

const world = {
  sheet: createSheet(8),
  props: {},
  locked: false,
  now: new Date('2026-06-15T12:00:00Z'),
  csv: FIXTURE
};

const context = {
  world: world,
  console: console,
  JSON: JSON,
  Date: Date,
  Number: Number,
  String: String,
  Object: Object,
  Array: Array,
  Math: Math,
  parseInt: parseInt,
  isNaN: isNaN,
  Utilities: {
    formatDate: formatDate,
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: function (alg, value) {
      const buf = crypto.createHash('sha256').update(String(value), 'utf8').digest();
      const out = [];
      for (let i = 0; i < buf.length; i++) out.push(buf[i] > 127 ? buf[i] - 256 : buf[i]);
      return out;
    }
  },
  LockService: {
    getScriptLock: function () {
      return {
        tryLock: function () {
          if (world.locked) return false;
          world.locked = true;
          return true;
        },
        releaseLock: function () { world.locked = false; }
      };
    }
  },
  PropertiesService: {
    getScriptProperties: function () {
      return {
        getProperty: function (key) { return Object.prototype.hasOwnProperty.call(world.props, key) ? world.props[key] : null; },
        setProperty: function (key, value) { world.props[key] = String(value); },
        deleteProperty: function (key) { delete world.props[key]; }
      };
    }
  },
  SpreadsheetApp: {
    openById: function (id) {
      if (id !== core.SSID_MAINTENANCE) throw new Error('Unexpected spreadsheet');
      return {
        getSheetByName: function (name) {
          return name === 'Submission Log' ? world.sheet : null;
        }
      };
    },
    flush: function () {}
  },
  UrlFetchApp: {
    fetch: function (url) {
      if (url !== core.DROPDOWNS_CSV_URL) throw new Error('Unexpected CSV url');
      return {
        getResponseCode: function () { return 200; },
        getContentText: function () { return world.csv; }
      };
    }
  },
  ContentService: {
    MimeType: { JSON: 'JSON' },
    createTextOutput: function (text) {
      return {
        text: text,
        setMimeType: function () { return this; },
        getContent: function () { return text; }
      };
    }
  }
};

vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../GOOGLE SCRIPTS/Maintenance.js'), 'utf8'), context);
context.londonNow_ = function () { return world.now; };

function fresh(includeOperator) {
  world.sheet = createSheet(8);
  seedHeaders(world.sheet, includeOperator);
  world.props = {};
  world.locked = false;
  world.now = new Date('2026-06-15T12:00:00Z');
  world.csv = FIXTURE;
}

function cell(row, col) {
  return world.sheet.getRange(row, col).getValue();
}

function formula(row, col) {
  return world.sheet.getRange(row, col).getFormula();
}

function display(row, col) {
  return world.sheet.getRange(row, col).getDisplayValue();
}

function idRows() {
  const rows = [];
  for (let row = 2; row <= world.sheet.getMaxRows(); row++) {
    if (/^MA\d{4}$/.test(String(display(row, 1)).trim())) rows.push(row);
  }
  return rows;
}

function post(extra) {
  const params = Object.assign({
    token: 'J4PAN88',
    action: 'fault_create',
    submissionId: 'sub-00000001',
    reporterMode: 'self',
    operator: 'Test User',
    area: 'Laboratory',
    areaOther: '',
    equipment: 'DMA',
    equipmentOther: '',
    priority: 'High Priority',
    description: 'Guard missing from the filler',
    parts: 'Guard',
    maintenanceRequest: 'Yes'
  }, extra || {});
  const out = context.doPost({
    parameter: params,
    postData: { type: 'application/x-www-form-urlencoded', contents: '' }
  });
  return JSON.parse(out.getContent());
}

function testIds() {
  assertEqual(core.nextMaintenanceId([]).maintenanceId, 'MA0001', 'first id is MA0001');
  assertEqual(core.nextMaintenanceId(['MA0001', 'MA0003']).maintenanceId, 'MA0004', 'gap is not filled; next is after the highest id');
  assertEqual(core.nextMaintenanceId(['MA0009']).maintenanceId, 'MA0010', 'tenth id keeps four digits');
  assertEqual(core.nextMaintenanceId(['MA0099']).maintenanceId, 'MA0100', 'hundredth id keeps four digits');
  assertEqual(core.nextMaintenanceId(['MA0999']).maintenanceId, 'MA1000', 'thousands keep four or more digits within the pattern');
  assertEqual(core.nextMaintenanceId(['MA0001', 'MA0001', 'junk', '', 'MA007', 'MA00007']).maintenanceId, 'MA0002', 'invalid and duplicate ids are ignored');
  assertEqual(core.nextMaintenanceId(['ma0007']).maintenanceId, 'MA0008', 'lowercase ids still count');
  assertEqual(core.nextMaintenanceId(['MA9999']).ok, false, 'sequence stops at MA9999');

  [[], ['MA0001', 'MA0003'], ['note', 'MA0010'], ['MA9999']].forEach(function (ids, index) {
    const left = core.nextMaintenanceId(ids);
    const right = context.nextMaintenanceId_(ids);
    assertEqual(left.ok, right.ok, 'script id rule matches core ' + index);
    assertEqual(left.maintenanceId || '', right.maintenanceId || '', 'script id value matches core ' + index);
  });
}

function testLists() {
  const lists = core.listsFromCsv(FIXTURE);
  assertEqual(lists.operators.join('|'), 'Jody R|Zoe I', 'operators come from column A and skip blanks');
  assert(lists.operators.indexOf('Operator') === -1, 'header is not an operator');
  assert(lists.operators.indexOf('') === -1, 'blank operator is ignored');
  assertEqual(lists.areas[0], 'Internal Blending Area', 'first area keeps sheet order');
  assertEqual(lists.areas[1], 'Laboratory', 'Laboratory stays in order');
  assert(lists.areas.indexOf('Office Area, Toilets and Break Room') !== -1, 'quoted area with a comma stays one value');
  assertEqual(lists.areas.join('|'), 'Internal Blending Area|Laboratory|Office Area, Toilets and Break Room|Bottling Line', 'areas are unique and ordered');
  assertEqual(lists.equipmentByArea.Laboratory.join('|'), 'DMA|CBox|Hanna Titrator', 'Laboratory equipment is only column C for Laboratory');
  assert(lists.equipmentByArea.Laboratory.indexOf('Depalletiser') === -1, 'Bottling equipment is not listed for Laboratory');
  assert(lists.equipmentByArea.Laboratory.indexOf('Pall Crossflow') === -1, 'blending equipment is not listed for Laboratory');
  assertEqual(core.canonicalPriority('High Priority - Urgent Risk to Safety of People or Food'), 'High Priority', 'priority keeps the category only');
  assertEqual(core.canonicalPriority('Medium Priority - A condition which must be addressed as it is likely to worsen, but does not pose an immediate risk'), 'Medium Priority', 'medium priority is shortened');
  assertEqual(core.canonicalPriority('Low Priority - A condition which must be improved, but is not urgent'), 'Low Priority', 'low priority is shortened');
  assertEqual(core.canonicalPriority('Stock Request - Used for requesting spare parts'), 'Stock Request', 'stock request is shortened');
  assertEqual(core.canonicalPriority('Unsure - Please Allocate the Priority for Me'), 'Unsure', 'unsure is shortened');
  assertEqual(core.canonicalPriority('High Priority'), 'High Priority', 'short priority is accepted');
  assertEqual(core.PRIORITY_OPTIONS.length, 5, 'exactly five priorities');

  const other = core.validateFault({
    submissionId: 'sub-00000001',
    reporterMode: 'self',
    operator: 'Someone Signed In',
    area: 'Other',
    areaOther: 'Mezzanine',
    equipment: 'Other',
    equipmentOther: 'Loose cable',
    priority: 'High Priority - Urgent Risk to Safety of People or Food',
    description: 'Cable hanging',
    parts: '',
    maintenanceRequest: 'No'
  }, lists);
  assert(other.ok, 'other area does not need a CSV match');
  assertEqual(other.value.lineArea, 'Mezzanine', 'free-text area is stored');
  assertEqual(other.value.equipment, 'Loose cable', 'free-text equipment is stored');
  assertEqual(other.value.priority, 'High Priority', 'validated priority is short');
  assertEqual(other.value.maintenanceRequest, 'No', 'maintenance answer is No');
  assertEqual(other.value.operator, 'Someone Signed In', 'self identity does not have to be in the dropdown');

  const wrongMachine = core.validateFault({
    submissionId: 'sub-00000001',
    reporterMode: 'other',
    operator: 'Jody R',
    area: 'Laboratory',
    equipment: 'Depalletiser',
    priority: 'Low Priority',
    description: 'Noise',
    parts: '',
    maintenanceRequest: 'Yes'
  }, lists);
  assert(!wrongMachine.ok, 'equipment from another area is rejected');

  const longRequest = core.validateFault({
    submissionId: 'sub-00000001',
    reporterMode: 'other',
    operator: 'Jody R',
    area: 'Laboratory',
    equipment: 'DMA',
    priority: 'Low Priority',
    description: 'Noise',
    maintenanceRequest: 'Yes - Raise Maintenance Request'
  }, lists);
  assert(!longRequest.ok, 'full maintenance button text is not a stored value');
}

function testSheetWrites() {
  fresh();
  world.sheet.seed(2, 1, { value: 'MA0009' });
  world.sheet.seed(2, 2, { value: '01/01/2026' });
  world.sheet.seed(2, 3, { value: 'Old Area' });
  world.sheet.seed(2, 4, { value: 'Old Machine' });
  world.sheet.seed(2, 5, { value: 'Low Priority' });
  world.sheet.seed(2, 6, { value: 'Old fault' });
  world.sheet.seed(2, 7, { value: 'Old part' });
  world.sheet.seed(2, 8, { value: 'No' });
  world.sheet.seed(2, 9, { value: 'Old Person' });
  world.sheet.seed(2, 12, { formula: '=1+1', value: 2, display: '2' });
  world.sheet.seed(3, 12, { formula: '=2+2', value: 4, display: '4' });
  world.sheet.seed(5, 1, { formula: '=""', display: '', value: '' });

  const saved = post({
    priority: 'High Priority - Urgent Risk to Safety of People or Food',
    parts: 'Guard'
  });
  assertEqual(saved.result, 'success', 'first occupied-sheet save succeeds');
  assertEqual(saved.maintenanceId, 'MA0010', 'next id follows the highest existing id');
  assertEqual(saved.submittedOn, '15/06/2026', 'date is generated on the server in London');
  assertEqual(saved.operatorColumn, 'I', 'operator is stored in the Operator column');
  assertEqual(cell(3, 1), 'MA0010', 'id is written to column A');
  assertEqual(cell(3, 2), '15/06/2026', 'date is written to column B');
  assertEqual(cell(3, 3), 'Laboratory', 'area is written to column C');
  assertEqual(cell(3, 4), 'DMA', 'equipment is written to column D');
  assertEqual(cell(3, 5), 'High Priority', 'priority category only is written to column E');
  assert(String(cell(3, 5)).indexOf('Urgent') === -1, 'priority explanation is not stored');
  assertEqual(cell(3, 6), 'Guard missing from the filler', 'description is written to column F');
  assertEqual(cell(3, 7), 'Guard', 'parts are written to column G');
  assertEqual(cell(3, 8), 'Yes', 'Yes is written to column H');
  assertEqual(cell(3, 9), 'Test User', 'signed-in operator is written beside the record');
  assertEqual(cell(2, 1), 'MA0009', 'existing id is not overwritten');
  assertEqual(cell(2, 6), 'Old fault', 'existing description is not overwritten');
  assertEqual(cell(2, 9), 'Old Person', 'existing operator is not overwritten');
  assertEqual(formula(2, 12), '=1+1', 'unrelated formula is preserved');
  assertEqual(formula(3, 12), '=2+2', 'formula beside the new row is preserved');
  assertEqual(formula(5, 1), '=""', 'later blank formula is not the first row used');
  assertEqual(cell(1, 1), 'Maintenance ID', 'header row is not overwritten');
  assertEqual(cell(1, 9), 'Operator', 'operator header is not overwritten');
  assertEqual(display(8, 1), '', 'a later empty row is not used while an earlier row is free');
  assertEqual(idRows().length, 2, 'existing and new ids both remain');

  const again = post();
  assertEqual(again.result, 'success', 'retry of the same submission succeeds');
  assertEqual(again.maintenanceId, 'MA0010', 'retry returns the original id');
  assertEqual(idRows().length, 2, 'retry does not add a row');

  const changed = post({ description: 'A different fault' });
  assertEqual(changed.result, 'error', 'changed retry is not saved as a new report');
  assert(String(changed.maintenanceId) === 'MA0010', 'changed retry names the original id');
  assertEqual(cell(3, 6), 'Guard missing from the filler', 'original description stays in place');
  assertEqual(idRows().length, 2, 'changed retry does not add a row');

  fresh();
  const first = post({ submissionId: 'sub-00000011', parts: '' });
  assertEqual(first.maintenanceId, 'MA0001', 'empty log starts at MA0001');
  assertEqual(cell(2, 7), '', 'blank parts stay blank');
  assert(!world.sheet.writeLog.some(function (entry) { return entry.col === 7; }), 'blank parts cell is not written');
  const second = post({ submissionId: 'sub-00000012', description: 'Second fault', parts: 'Seal' });
  assertEqual(second.maintenanceId, 'MA0002', 'second report increments');
  assertEqual(cell(3, 1), 'MA0002', 'second report uses the next row');
  assertEqual(cell(2, 1), 'MA0001', 'first report remains');

  fresh();
  world.sheet.seed(2, 1, { value: 'MA0001' });
  world.sheet.seed(3, 1, { value: 'MA0003' });
  const gap = post({ submissionId: 'sub-gap-0001' });
  assertEqual(gap.maintenanceId, 'MA0004', 'gap between MA0001 and MA0003 is not reused');
  assertEqual(cell(4, 1), 'MA0004', 'new id is placed on the first empty id row');
  assertEqual(cell(3, 1), 'MA0003', 'MA0003 stays where it was');

  fresh();
  world.sheet.seed(2, 1, { formula: '=""', display: '', value: '' });
  world.sheet.seed(3, 1, { formula: '=""', display: '', value: '' });
  world.sheet.seed(4, 1, { value: 'MA0002' });
  const blankFormula = post({ submissionId: 'sub-formula-01' });
  assertEqual(blankFormula.maintenanceId, 'MA0003', 'blank formulas do not count as ids');
  assertEqual(cell(2, 1), 'MA0003', 'first blank formula row is used instead of appending');
  assertEqual(formula(2, 1), '', 'the used id cell no longer has the placeholder formula');
  assertEqual(formula(3, 1), '=""', 'the next placeholder formula remains until it is used');
  assertEqual(cell(4, 1), 'MA0002', 'id below the formula block is untouched');
  assert(world.sheet.maxRows === 8, 'a row was not inserted below the formula block');

  fresh();
  world.sheet.seed(2, 1, { formula: '=ARRAYFORMULA(A2:A)', display: '', value: '' });
  const arrayFormula = post({ submissionId: 'sub-array-0001' });
  assertEqual(arrayFormula.result, 'success', 'array formula does not block a later empty row');
  assertEqual(formula(2, 1), '=ARRAYFORMULA(A2:A)', 'array formula is not overwritten');
  assertEqual(cell(3, 1), 'MA0001', 'the next safe row receives the id');

  fresh();
  world.sheet.seed(2, 1, { value: 'MA9999' });
  const full = post({ submissionId: 'sub-full-00001' });
  assertEqual(full.result, 'error', 'full sequence does not save');
  assertEqual(cell(2, 1), 'MA9999', 'full sequence does not overwrite the last id');
  assertEqual(idRows().length, 1, 'full sequence adds no id');

  fresh(false);
  const missing = post({ submissionId: 'sub-nocol-0001' });
  assertEqual(missing.result, 'error', 'missing operator column refuses the save');
  assert(missing.message.indexOf('no column') !== -1, 'missing operator column explains why');
  assertEqual(world.sheet.writeLog.length, 0, 'missing operator column writes nothing');
  assertEqual(world.sheet.clearLog.length, 0, 'missing operator column clears nothing');
  assertEqual(cell(1, 9), '', 'no operator header is created');
  assertEqual(display(2, 1), '', 'no id is written when the operator cannot be stored');

  fresh();
  world.sheet.seed(1, 10, { value: 'Reporter' });
  const ambiguous = post({ submissionId: 'sub-ambig-001' });
  assertEqual(ambiguous.result, 'error', 'two operator headers refuse the save');
  assertEqual(world.sheet.writeLog.length, 0, 'ambiguous operator headers write nothing');

  fresh();
  const other = post({
    submissionId: 'sub-other-001',
    reporterMode: 'other',
    operator: 'Jody R',
    area: 'Other',
    areaOther: 'Mezzanine',
    equipment: 'Other',
    equipmentOther: 'Loose cable',
    priority: 'Unsure - Please Allocate the Priority for Me',
    description: 'Cable hanging down',
    parts: '',
    maintenanceRequest: 'No'
  });
  assertEqual(other.result, 'success', 'other area and equipment save');
  assertEqual(cell(2, 3), 'Mezzanine', 'free-text area is saved');
  assertEqual(cell(2, 4), 'Loose cable', 'free-text equipment is saved');
  assertEqual(cell(2, 5), 'Unsure', 'unsure priority is shortened');
  assertEqual(cell(2, 8), 'No', 'No is saved rather than the button label');
  assertEqual(cell(2, 9), 'Jody R', 'dropdown operator is saved');
  assert(cell(2, 3) !== 'Other' && cell(2, 4) !== 'Other', 'the word Other is not saved');

  fresh();
  const wrong = post({ submissionId: 'sub-wrong-001', area: 'Laboratory', equipment: 'Depalletiser' });
  assertEqual(wrong.result, 'error', 'wrong equipment is rejected by the script');
  assertEqual(world.sheet.writeLog.length, 0, 'rejected equipment writes nothing');

  fresh();
  const unknown = post({ submissionId: 'sub-unknown-01', reporterMode: 'other', operator: 'Not A Person', area: 'Laboratory', equipment: 'DMA' });
  assertEqual(unknown.result, 'error', 'unknown operator is rejected');
  assertEqual(world.sheet.writeLog.length, 0, 'unknown operator writes nothing');

  fresh();
  const buttonText = post({ submissionId: 'sub-button-001', maintenanceRequest: 'Yes - Raise Maintenance Request' });
  assertEqual(buttonText.result, 'error', 'long maintenance text is rejected');
  assertEqual(world.sheet.writeLog.length, 0, 'rejected maintenance text writes nothing');

  fresh();
  world.sheet.seed(2, 1, { formula: '=""', display: '', value: '' });
  world.sheet.failOnCol = 3;
  const failed = post({ submissionId: 'sub-fail-00001' });
  assertEqual(failed.result, 'error', 'write failure is not a success');
  assert(!failed.maintenanceId, 'write failure does not return an id');
  assertEqual(formula(2, 1), '=""', 'failed write restores the id formula');
  assertEqual(display(2, 2), '', 'failed write removes the date it had started');
  assertEqual(idRows().length, 0, 'failed write leaves no maintenance id');
  const retried = post({ submissionId: 'sub-fail-00001' });
  assertEqual(retried.result, 'success', 'retry after a clean failure can save');
  assertEqual(retried.maintenanceId, 'MA0001', 'retry after a clean failure uses the next id');
  assertEqual(idRows().length, 1, 'retry creates one row');

  fresh();
  world.locked = true;
  const busy = post({ submissionId: 'sub-lock-00001' });
  assertEqual(busy.result, 'error', 'lock failure is not a success');
  assertEqual(world.sheet.writeLog.length, 0, 'lock failure writes nothing');
  assertEqual(world.locked, true, 'a lock that was not acquired is not released');

  fresh();
  context.saveRecord_('sub-pending99', {
    status: 'pending',
    fingerprint: 'different',
    maintenanceId: 'MA0008',
    submittedOn: '01/01/2026',
    row: 4
  });
  const reserved = post({ submissionId: 'sub-reserved01' });
  assertEqual(reserved.maintenanceId, 'MA0009', 'an in-progress id is not given to the next report');
  assertEqual(idRows().length, 1, 'the reserved id is not written as an extra row');

  fresh();
  const denied = post({ token: 'nope', submissionId: 'sub-denied-01' });
  assertEqual(denied.result, 'error', 'bad token is rejected');
  assertEqual(world.sheet.writeLog.length, 0, 'bad token writes nothing');
}

function testPages() {
  const root = path.join(__dirname, '..');
  const menu = fs.readFileSync(path.join(root, 'menu.html'), 'utf8');
  const form = fs.readFileSync(path.join(root, 'maintenance/report-fault.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'maintenance/report-fault.html'), 'utf8');
  const home = fs.readFileSync(path.join(root, 'maintenance/index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'GOOGLE SCRIPTS/Maintenance.js'), 'utf8');
  const names = [];
  const re = /<span class="module-name">([^<]+)<\/span>/g;
  let match;
  while ((match = re.exec(menu))) names.push(match[1]);
  assertEqual(names.join('|'), 'Warehouse|HR|Quality|Maintenance|Health and Safety', 'menu order places Maintenance between Quality and Health and Safety');
  assert(menu.indexOf('href="/quality/"') !== -1, 'Quality menu link remains');
  assert(menu.indexOf('href="/warehouse/"') !== -1 && menu.indexOf('href="/hr/"') !== -1, 'Warehouse and HR links remain');
  assert(menu.indexOf('href="/health-safety/"') !== -1, 'Health and Safety link remains');
  assert(home.indexOf('>Report Fault<') !== -1 && home.indexOf('href="report-fault.html"') !== -1, 'Maintenance opens Report Fault');
  assert(page.indexOf('report-fault.js') !== -1, 'report page loads its script');
  [
    'Please use this form for reporting faults or an unsafe condition with the machines or equipment',
    'Are you reporting this on behalf of yourself or another operator?',
    'Please select the operating line or area where the machine or equipment can be found',
    'Please select the Machine or piece of equipment that is faulty or in an unsafe condition.',
    'Please select a priority',
    'Please write a description of the fault or unsafe condition',
    'Parts requested',
    'Would you like to raise Maintenance request?',
    'Upload Photos of Faults',
    'Work in Progress',
    'Submit Fault Report',
    'Self',
    'Another Operator',
    'Yes - Raise Maintenance Request',
    'No - Log as Maintenance Completed',
    'High Priority - Urgent Risk to Safety of People or Food',
    'Medium Priority - A condition which must be addressed as it is likely to worsen, but does not pose an immediate risk',
    'Low Priority - A condition which must be improved, but is not urgent',
    'Stock Request - Used for requesting spare parts',
    'Unsure - Please Allocate the Priority for Me'
  ].forEach(function (label) {
    assert(form.indexOf(label) !== -1, 'form contains ' + label);
  });
  assert(form.indexOf('SCSAuth.getUsername()') !== -1, 'self uses the signed-in user');
  assert(form.indexOf('type="file"') === -1 && form.indexOf('getUserMedia') === -1, 'photo control does not upload');
  assert(form.indexOf('J4PAN88') === -1 && form.indexOf('script.google.com') === -1, 'frontend has no script credential or web app URL');
  assert(form.indexOf('/.netlify/functions/submitFault') !== -1, 'form posts to the Netlify function');
  assert(script.indexOf('appendRow') === -1 && script.indexOf('setValues') === -1, 'writer does not append or bulk-write');
  assert(script.indexOf('deleteRow') === -1 && script.indexOf('clearContents') === -1, 'writer does not delete rows or clear the sheet');
  assert(script.indexOf(core.SSID_MAINTENANCE) !== -1 && script.indexOf('Submission Log') !== -1, 'writer targets Submission Log');
}

function testScriptPages() {
  const submit = require('../netlify/functions/submitFault');
  const moved = '<HTML><HEAD><TITLE>Moved Temporarily</TITLE></HEAD><BODY>The document has moved <A HREF="https://script.googleusercontent.com/macros/echo?user_content_key=abc">here</A>.</BODY></HTML>';
  assertEqual(
    submit.scriptResultUrl(moved),
    'https://script.googleusercontent.com/macros/echo?user_content_key=abc',
    'moved page yields the script result URL'
  );
  assertEqual(submit.scriptResultUrl('<a href="https://evil.example/collect">x</a>'), '', 'non-script links are ignored');
  const signIn = submit.explainScriptPage('<!DOCTYPE html><html><title>Sign in - Google Accounts</title><body>accounts.google.com</body></html>');
  assert(signIn.indexOf('Anyone, even anonymous') !== -1, 'sign-in page names the anonymous access setting');
  assert(signIn.indexOf(submit.SIGN_IN_PAGE) === 0, 'sign-in page uses the deployment message');
  const auth = submit.explainScriptPage('<html><title>Authorization needed</title><body>Authorization is required to perform that action.</body></html>');
  assert(auth.indexOf('has not been authorized') !== -1, 'authorization page asks for a script run');
  const missing = submit.explainScriptPage('<html><title>Error</title><body>Sorry, unable to open the file at this time.</body></html>');
  assert(missing.indexOf('/exec') !== -1, 'missing web app names the exec URL');
}

async function testHandlerAndLiveCsv() {
  const submit = require('../netlify/functions/submitFault').handler;
  const getRes = await submit({ httpMethod: 'GET', body: '' });
  assertEqual(getRes.statusCode, 405, 'GET is rejected');
  const bad = await submit({ httpMethod: 'POST', body: '{' });
  assertEqual(bad.statusCode, 400, 'invalid JSON is rejected');
  assertEqual(JSON.parse(bad.body).result, 'error', 'invalid JSON is not a success');

  const previous = process.env.MAINTENANCE_SCRIPT_URL;
  delete process.env.MAINTENANCE_SCRIPT_URL;
  const noUrl = await submit({
    httpMethod: 'POST',
    body: JSON.stringify({
      submissionId: 'sub-00000001',
      reporterMode: 'other',
      operator: 'Jody R',
      area: 'Laboratory',
      equipment: 'DMA',
      priority: 'High Priority',
      description: 'Live list check',
      parts: '',
      maintenanceRequest: 'Yes'
    })
  });
  if (previous == null) delete process.env.MAINTENANCE_SCRIPT_URL;
  else process.env.MAINTENANCE_SCRIPT_URL = previous;
  assertEqual(noUrl.statusCode, 500, 'missing script URL does not pretend to save');
  const noUrlBody = JSON.parse(noUrl.body);
  assertEqual(noUrlBody.result, 'error', 'missing script URL returns an error');
  assert(!noUrlBody.maintenanceId, 'missing script URL returns no maintenance id');

  const response = await fetch(core.DROPDOWNS_CSV_URL);
  assert(response.ok, 'published dropdown CSV loads');
  const lists = core.listsFromCsv(await response.text());
  const lab = lists.equipmentByArea.Laboratory || [];
  assert(lab.indexOf('DMA') !== -1 && lab.indexOf('CBox') !== -1 && lab.indexOf('Sonicator') !== -1, 'live Laboratory equipment includes the published machines');
  assert(lab.indexOf('DMA') < lab.indexOf('CBox') && lab.indexOf('CBox') < lab.indexOf('Sonicator'), 'live Laboratory equipment keeps sheet order');
  assert(lab.indexOf('Pall Crossflow') === -1 && lab.indexOf('Depalletiser') === -1, 'live Laboratory equipment excludes other areas');
  assert(lists.areas.indexOf('Office Area, Toilets and Break Room') !== -1, 'live area with a comma stays one value');
  assert(lists.operators.indexOf('Jody R') !== -1 && lists.operators.indexOf('Zoe I') !== -1, 'live operators include published names');
  assert(lists.operators.indexOf('') === -1 && lists.operators.indexOf('Operator') === -1, 'live operators skip blanks and the header');
  assertEqual(new Set(lists.areas).size, lists.areas.length, 'live areas are unique');
}

async function main() {
  testIds();
  testLists();
  testSheetWrites();
  testPages();
  testScriptPages();
  await testHandlerAndLiveCsv();
  if (failures) {
    console.error(failures + ' failed, ' + passes + ' passed');
    process.exit(1);
  }
  console.log(passes + ' passed');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
