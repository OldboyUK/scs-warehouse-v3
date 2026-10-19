const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const core = require('../netlify/functions/ncrCore');

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

function createSheet(maxRows) {
  const cells = new Map();
  const sheet = {
    maxRows: maxRows || 12,
    failWrites: 0,
    writeLog: [],
    clearLog: [],
    gid: 0,
    getName: function () { return 'NCR Database'; },
    getSheetId: function () { return sheet.gid; },
    getMaxRows: function () { return sheet.maxRows; },
    insertRowsAfter: function (after, count) { sheet.maxRows += count; },
    key: function (row, col) { return row + ':' + col; },
    cell: function (row, col) {
      if (row < 1 || col < 1 || row > sheet.maxRows || col > 30) {
        throw new Error('Range exceeds grid r' + row + 'c' + col + ' max ' + sheet.maxRows);
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
    }
  };

  sheet.getRange = function (row, col, numRows, numCols) {
    const height = numRows == null ? 1 : numRows;
    const width = numCols == null ? 1 : numCols;
    if (row + height - 1 > sheet.maxRows || col + width - 1 > 30) {
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
        if (sheet.failWrites > 0) {
          sheet.failWrites -= 1;
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
        if (String(formula || '').trim() === '') rec.display = null;
        else if (rec.display == null) rec.display = '';
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

const world = {
  sheet: createSheet(12),
  props: {},
  locked: false,
  now: new Date('2026-06-15T12:00:00Z')
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
      if (id !== '1qJK9f0BcaPMuPXk3CKfFX_D-PAQ5pFTHB7bpCNRjpHY') throw new Error('Unexpected spreadsheet');
      return {
        getSheetByName: function (name) {
          return name === 'NCR Database' ? world.sheet : null;
        }
      };
    },
    flush: function () {}
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
vm.runInContext(fs.readFileSync(path.join(__dirname, '../GOOGLE SCRIPTS/Quality.js'), 'utf8'), context);
context.londonNow_ = function () { return world.now; };

function fresh() {
  world.sheet = createSheet(12);
  world.props = {};
  world.locked = false;
  world.now = new Date('2026-06-15T12:00:00Z');
}

function post(extra) {
  const params = Object.assign({
    token: 'J4PAN88',
    action: 'ncr_create',
    submissionId: 'sub-00000001',
    priority: 'High',
    reporter: 'Zoe Ibbotson',
    category: 'Ingredients',
    batches: JSON.stringify(['BATCH001', '', 'BATCH002']),
    description: 'Seal damaged',
    involved: 'Line 2',
    happened: 'Leak',
    whenOccurred: 'Monday morning',
    whereOccurred: 'Bottling hall',
    why: 'Worn capper',
    remedial: 'Hold the pallet'
  }, extra || {});
  const out = context.doPost({
    parameter: params,
    postData: { type: 'application/x-www-form-urlencoded', contents: '' }
  });
  return JSON.parse(out.getContent());
}

function cell(row, col) {
  return world.sheet.getRange(row, col).getValue();
}

function display(row, col) {
  return world.sheet.getRange(row, col).getDisplayValue();
}

function findRow(ncr) {
  for (let row = 2; row <= world.sheet.getMaxRows(); row++) {
    if (String(display(row, 1)).trim() === ncr) return row;
  }
  return 0;
}

function countRows(ncr) {
  let count = 0;
  for (let row = 2; row <= world.sheet.getMaxRows(); row++) {
    if (String(display(row, 1)).trim() === ncr) count++;
  }
  return count;
}

function numberCases(date, ids) {
  return core.nextNcrNumber(ids, new Date(date));
}

const numbering = [
  ['2026-06-15T12:00:00Z', [], 'NCR26-001'],
  ['2026-06-15T12:00:00Z', ['NCR26-001', 'NCR26-002', 'NCR26-003', 'NCR26-004'], 'NCR26-005'],
  ['2026-06-15T12:00:00Z', ['NCR26-001', 'NCR26-005', 'NCR25-099', '', 'note', 'NCR26-1000', 'ncr26-002'], 'NCR26-006'],
  ['2027-01-01T00:30:00Z', ['NCR26-009', 'NCR25-010'], 'NCR27-001'],
  ['2026-12-31T23:30:00Z', ['NCR26-009'], 'NCR26-010']
];

numbering.forEach(function (item) {
  const result = numberCases(item[0], item[1]);
  assert(result.ok, 'number allocated for ' + item[2]);
  assertEqual(result.ncrNumber, item[2], 'core number ' + item[2]);
});

assertEqual(core.combineBatchNumbers(['BATCH001', ' BATCH002 ', '', 'BATCH003']).value, 'BATCH001, BATCH002, BATCH003', 'batch join');
assert(!core.combineBatchNumbers(['BATCH,1']).ok, 'comma batch rejected');
assert(!core.validateSection1({ submissionId: 'sub-00000001', reporter: 'Zoe Ibbotson', category: 'Ingredients', description: 'Leak' }).ok, 'priority required');
assert(!core.validateSection1({ submissionId: 'sub-00000001', priority: 'Urgent', reporter: 'Zoe Ibbotson', category: 'Ingredients', description: 'Leak' }).ok, 'priority list');
assertEqual(core.validateSection1({
  submissionId: 'sub-00000001',
  priority: 'Low',
  reporter: 'Angus Sales',
  category: 'Pre-Packaged Liquid',
  batches: ['A1'],
  description: 'Label missing'
}).value.category, 'Pre-Packaged Liquid', 'category accepted');
const section2 = core.validateSection2({ ncrNumber: 'ncr26-004', findings: '', correctiveDue: '', completedBy: '' });
assert(section2.ok && section2.value.ncrNumber === 'NCR26-004', 'section 2 blanks allowed');
assert(!core.validateSection2({ ncrNumber: 'NCR26-004', correctiveDue: '2026-02-31' }).ok, 'invalid date rejected');
assert(!core.validateSection2({ ncrNumber: 'NCR26-004', completedBy: 'Someone Else' }).ok, 'manager list');
assertEqual(core.optionalIsoDate('2026-11-01', 'Due Date').uk, '01/11/2026', 'uk date');

const bareSuccess = core.confirmedResult(JSON.stringify({ result: 'success' }), function (parsed) {
  return parsed.result === 'success' && core.isNcrNumber(parsed.ncrNumber);
}, 'The server did not confirm that the NCR was saved.');
assertEqual(bareSuccess.statusCode, 502, 'unconfirmed success is not returned as saved');
assertEqual(JSON.parse(bareSuccess.body).result, 'error', 'unconfirmed body is an error');

const htmlResult = core.confirmedResult('<html>ok</html>', function () { return true; }, 'not saved');
assertEqual(htmlResult.statusCode, 502, 'html is not a successful save');

fresh();
const first = post({ submissionId: 'seq-sub-000001' });
assertEqual(first.result, 'success', 'first create succeeds');
assertEqual(first.ncrNumber, 'NCR26-001', 'first NCR of 2026');
assertEqual(first.submittedOn, '15/06/2026', 'submission date uses the London calendar');
assertEqual(findRow('NCR26-001'), 2, 'first blank row is used');
assertEqual(cell(2, 3), 'High', 'priority column C');
assertEqual(cell(2, 4), 'Zoe Ibbotson', 'reporter column D');
assertEqual(cell(2, 5), 'Ingredients', 'category column E');
assertEqual(cell(2, 6), 'BATCH001, BATCH002', 'batches column F');
assertEqual(cell(2, 7), 'Seal damaged', 'description column G');
assertEqual(cell(2, 8), 'Line 2', 'involved column H');
assertEqual(cell(2, 9), 'Leak', 'happened column I');
assertEqual(cell(2, 10), 'Monday morning', 'when column J');
assertEqual(cell(2, 11), 'Bottling hall', 'where column K');
assertEqual(cell(2, 12), 'Worn capper', 'why column L');
assertEqual(cell(2, 13), 'Hold the pallet', 'remedial column M');
assertEqual(cell(2, 14), '', 'section 1 leaves findings blank');
assertEqual(cell(1, 1), '', 'header row untouched');
assertEqual(world.sheet.getMaxRows(), 12, 'blank formula-sized sheet is not extended');

const second = post({ submissionId: 'seq-sub-000002', priority: 'Low', reporter: 'Tom Ebdon', category: 'Packaging', description: 'Crushed carton' });
assertEqual(second.ncrNumber, 'NCR26-002', 'second NCR increments');
assertEqual(countRows('NCR26-001') + countRows('NCR26-002'), 2, 'two distinct rows');

fresh();
world.sheet.seed(2, 1, { value: 'NCR26-001' });
world.sheet.seed(3, 1, { value: 'NCR26-002' });
world.sheet.seed(4, 1, { value: 'NCR26-003' });
world.sheet.seed(5, 1, { value: 'NCR26-004' });
const fifth = post({ submissionId: 'seq-sub-000005' });
assertEqual(fifth.ncrNumber, 'NCR26-005', 'fifth NCR of the year');

fresh();
world.sheet.seed(2, 1, { value: 'NCR26-001' });
world.sheet.seed(4, 1, { value: 'NCR26-005' });
world.sheet.seed(5, 1, { value: 'NCR25-040' });
const gap = post({ submissionId: 'gap-sub-000001' });
assertEqual(gap.ncrNumber, 'NCR26-006', 'gap uses the highest sequence, not the count');
assertEqual(findRow('NCR26-006'), 3, 'empty display between records is used');

fresh();
world.now = new Date('2027-01-01T00:30:00Z');
world.sheet.seed(2, 1, { value: 'NCR26-009' });
const nextYear = post({ submissionId: 'year-sub-000001' });
assertEqual(nextYear.ncrNumber, 'NCR27-001', 'new year starts at 001');
assertEqual(cell(2, 1), 'NCR26-009', 'previous year row unchanged');

fresh();
world.now = new Date('2026-12-31T23:30:00Z');
const yearEnd = post({ submissionId: 'year-end-000001' });
assertEqual(yearEnd.ncrNumber, 'NCR26-001', 'London date just before midnight stays in 2026');

fresh();
world.sheet.seed(2, 1, { formula: '=IF(B2="","","")', value: '', display: '' });
world.sheet.seed(3, 1, { formula: '=IF(B3="","","")', value: '', display: '' });
world.sheet.seed(4, 1, { value: 'NCR26-002', display: 'NCR26-002' });
world.sheet.seed(5, 1, { formula: '=IF(B5="","","")', value: '', display: '' });
const beforeMax = world.sheet.getMaxRows();
const formulaRow = post({ submissionId: 'formula-sub-0001' });
assertEqual(formulaRow.ncrNumber, 'NCR26-003', 'existing year sequence still increments');
assertEqual(findRow('NCR26-003'), 2, 'blank formula row is used instead of the bottom');
assertEqual(world.sheet.getRange(2, 1).getFormula(), '', 'NCR number replaces the blank formula');
assertEqual(cell(4, 1), 'NCR26-002', 'later record stays put');
assertEqual(world.sheet.getMaxRows(), beforeMax, 'sheet is not extended below formula rows');

fresh();
world.sheet.seed(2, 1, { formula: '=ARRAYFORMULA(IF(B2:B="","",""))', value: '', display: '' });
const skippedArray = post({ submissionId: 'array-sub-000001' });
assertEqual(findRow(skippedArray.ncrNumber), 3, 'array formula cell itself is skipped');
assert(world.sheet.getRange(2, 1).getFormula().indexOf('ARRAYFORMULA') !== -1, 'array formula left in place');

fresh();
world.sheet.seed(2, 1, { formula: '=IF(B2="","","")', value: '', display: '' });
world.sheet.seed(2, 2, { value: 'keep me' });
const skippedData = post({ submissionId: 'keep-sub-0000001' });
assertEqual(findRow(skippedData.ncrNumber), 3, 'row with other data is not overwritten');
assertEqual(cell(2, 2), 'keep me', 'unrelated cell preserved');
assertEqual(display(2, 1), '', 'occupied blank-number row stays blank');

fresh();
world.sheet = createSheet(4);
world.sheet.seed(2, 1, { value: 'NCR26-001' });
world.sheet.seed(3, 1, { value: 'NCR26-002' });
world.sheet.seed(4, 1, { value: 'NCR26-008' });
const appended = post({ submissionId: 'append-sub-00001' });
assertEqual(appended.ncrNumber, 'NCR26-009', 'sequence continues when no blank row exists');
assertEqual(findRow('NCR26-009'), 5, 'a row is added only after real records');
assertEqual(cell(2, 1), 'NCR26-001', 'existing row not replaced');

fresh();
context.saveRecord_('reserved-sub-0001', {
  status: 'pending',
  ncrNumber: 'NCR26-001',
  submittedOn: '01/06/2026',
  row: 2,
  fingerprint: 'other'
});
const reserved = post({ submissionId: 'reserved-sub-0002' });
assertEqual(reserved.ncrNumber, 'NCR26-002', 'pending number is not issued twice');

fresh();
const sameA = post({ submissionId: 'same-submission-01', description: 'First version' });
const sameB = post({ submissionId: 'same-submission-01', description: 'First version' });
assertEqual(sameA.ncrNumber, sameB.ncrNumber, 'repeat of the same request keeps the NCR number');
assertEqual(countRows(sameA.ncrNumber), 1, 'repeat does not add a row');
const changed = post({ submissionId: 'same-submission-01', description: 'Changed version' });
assertEqual(changed.result, 'error', 'changed retry is rejected');
assertEqual(cell(findRow(sameA.ncrNumber), 7), 'First version', 'original description kept');
assertEqual(countRows(sameA.ncrNumber), 1, 'rejected retry does not add a row');

fresh();
world.locked = true;
const blocked = post({ submissionId: 'locked-sub-00001' });
assertEqual(blocked.result, 'error', 'locked create fails');
assert(!/success/.test(blocked.result), 'locked create is not success');
assertEqual(findRow('NCR26-001'), 0, 'locked create writes nothing');
assertEqual(world.locked, true, 'failed lock does not release someone else');
world.locked = false;

fresh();
const missingPriority = post({ submissionId: 'bad-priority-001', priority: '' });
assertEqual(missingPriority.result, 'error', 'missing priority fails');
assertEqual(findRow('NCR26-001'), 0, 'invalid create writes nothing');
const badBatch = post({ submissionId: 'bad-batch-00001', batches: JSON.stringify(['BAD,1']) });
assertEqual(badBatch.result, 'error', 'comma batch fails');
assertEqual(findRow('NCR26-001'), 0, 'rejected batch writes nothing');
const denied = post({ submissionId: 'denied-sub-00001', token: 'nope' });
assertEqual(denied.result, 'error', 'bad token fails');

fresh();
world.sheet.seed(2, 1, { formula: '=IF(B2="","","")', value: '', display: '' });
world.sheet.failWrites = 1;
const failedSave = post({ submissionId: 'fail-sub-0000001' });
assertEqual(failedSave.result, 'error', 'write failure is an error');
assert(!failedSave.ncrNumber, 'write failure does not return an NCR number');
assertEqual(display(2, 1), '', 'failed save restores the blank formula display');
assert(String(world.sheet.getRange(2, 1).getFormula()).indexOf('IF(') !== -1, 'failed save restores the formula');
assertEqual(findRow('NCR26-001'), 0, 'failed save leaves no NCR number');

fresh();
const created = post({ submissionId: 'section2-sub-001', description: 'Original description' });
const submittedOn = cell(findRow(created.ncrNumber), 2);
world.sheet.writeLog = [];
world.sheet.clearLog = [];
const updated = post({
  action: 'ncr_update',
  ncrNumber: created.ncrNumber,
  findings: 'Capper jaw worn',
  correctiveActions: 'Replace jaw',
  correctiveDue: '2026-11-01',
  correctiveComplete: '',
  rootCause: 'No spare check',
  preventativeActions: 'Add spare to weekly check',
  preventativeDue: '2026-11-15',
  preventativeComplete: '2026-11-10',
  ncrCompleted: '',
  completedBy: 'Tom Ebdon'
});
assertEqual(updated.result, 'success', 'section 2 saves');
assertEqual(updated.ncrNumber, created.ncrNumber, 'section 2 keeps the NCR number');
const row = findRow(created.ncrNumber);
assertEqual(countRows(created.ncrNumber), 1, 'section 2 does not add a row');
assertEqual(cell(row, 2), submittedOn, 'submission date unchanged');
assertEqual(cell(row, 7), 'Original description', 'section 1 description unchanged');
assertEqual(cell(row, 3), 'High', 'priority unchanged');
assertEqual(cell(row, 14), 'Capper jaw worn', 'findings column N');
assertEqual(cell(row, 15), 'Replace jaw', 'corrective actions column O');
assertEqual(cell(row, 16), '01/11/2026', 'corrective due column P');
assertEqual(cell(row, 17), '', 'corrective complete column Q stays blank');
assertEqual(cell(row, 18), 'No spare check', 'root cause column R');
assertEqual(cell(row, 19), 'Add spare to weekly check', 'preventative actions column S');
assertEqual(cell(row, 20), '15/11/2026', 'preventative due column T');
assertEqual(cell(row, 21), '10/11/2026', 'preventative complete column U');
assertEqual(cell(row, 22), '', 'NCR completed column V stays blank');
assertEqual(cell(row, 23), 'Tom Ebdon', 'completed by column W');
world.sheet.writeLog.forEach(function (entry) {
  assert(entry.col >= 14 && entry.col <= 23, 'section 2 write stays in N-W');
});
world.sheet.clearLog.forEach(function (entry) {
  assert(entry.col >= 14 && entry.col <= 23, 'section 2 clear stays in N-W');
});

world.sheet.writeLog = [];
const updatedAgain = post({
  action: 'ncr_update',
  ncrNumber: created.ncrNumber,
  findings: 'Confirmed worn jaw',
  correctiveActions: 'Replace jaw',
  correctiveDue: '2026-11-01',
  correctiveComplete: '',
  rootCause: 'No spare check',
  preventativeActions: 'Add spare to weekly check',
  preventativeDue: '2026-11-15',
  preventativeComplete: '2026-11-10',
  ncrCompleted: '',
  completedBy: 'Tom Ebdon'
});
assertEqual(updatedAgain.result, 'success', 'section 2 can be saved again');
assertEqual(countRows(created.ncrNumber), 1, 'second investigation save does not add a row');
assertEqual(cell(row, 14), 'Confirmed worn jaw', 'findings updated in place');
assertEqual(cell(row, 2), submittedOn, 'second save keeps the submission date');
assertEqual(cell(row, 7), 'Original description', 'second save keeps section 1');
assert(world.sheet.writeLog.every(function (entry) { return entry.col === 14; }), 'second save writes only the changed investigation cell');

const loaded = post({ action: 'ncr_get', ncrNumber: created.ncrNumber });
assertEqual(loaded.result, 'success', 'existing NCR can be loaded');
assertEqual(loaded.findings, 'Confirmed worn jaw', 'loaded findings');
assertEqual(loaded.correctiveDue, '2026-11-01', 'loaded due date is an ISO date');
assertEqual(loaded.description, 'Original description', 'loaded section 1 description');
assertEqual(loaded.submittedOn, submittedOn, 'loaded submission date');

const missing = post({ action: 'ncr_update', ncrNumber: 'NCR26-999', findings: 'Should not exist' });
assertEqual(missing.result, 'error', 'unknown NCR is rejected');
assertEqual(findRow('NCR26-999'), 0, 'unknown NCR does not create a row');
let stray = false;
for (let r = 1; r <= world.sheet.getMaxRows(); r++) {
  for (let c = 1; c <= 23; c++) {
    if (String(cell(r, c)).indexOf('Should not exist') !== -1) stray = true;
  }
}
assert(!stray, 'unknown NCR writes nothing');

fresh();
const protectedRow = post({ submissionId: 'protect-sub-0001' });
const protectedAt = findRow(protectedRow.ncrNumber);
world.sheet.seed(protectedAt, 14, { formula: '=B2', value: 'formula', display: 'formula' });
const blockedUpdate = post({ action: 'ncr_update', ncrNumber: protectedRow.ncrNumber, findings: 'Do not overwrite' });
assertEqual(blockedUpdate.result, 'error', 'formula in the investigation is not overwritten');
assertEqual(world.sheet.getRange(protectedAt, 14).getFormula(), '=B2', 'investigation formula remains');
assertEqual(cell(protectedAt, 7), 'Seal damaged', 'section 1 remains when section 2 is refused');

(async function handlers() {
  const previous = process.env.QUALITY_SCRIPT_URL;
  delete process.env.QUALITY_SCRIPT_URL;
  const submit = require('../netlify/functions/submitNcr').handler;
  const update = require('../netlify/functions/updateNcr').handler;
  const getNcr = require('../netlify/functions/getNcr').handler;

  const method = await submit({ httpMethod: 'GET', body: '' });
  assertEqual(method.statusCode, 405, 'create rejects GET');

  const badJson = await submit({ httpMethod: 'POST', body: '{' });
  assertEqual(badJson.statusCode, 400, 'create rejects unreadable body');

  const badFields = await submit({
    httpMethod: 'POST',
    body: JSON.stringify({ submissionId: 'sub-00000001', priority: 'High' })
  });
  assertEqual(badFields.statusCode, 400, 'create rejects an incomplete report');
  assertEqual(JSON.parse(badFields.body).result, 'error', 'incomplete report is an error');

  const noUrl = await submit({
    httpMethod: 'POST',
    body: JSON.stringify({
      submissionId: 'sub-00000001',
      priority: 'Medium',
      reporter: 'Angus Sales',
      category: 'Finished Product',
      batches: ['BATCH001', 'BATCH002', 'BATCH003'],
      description: 'Leak at filler'
    })
  });
  assertEqual(noUrl.statusCode, 500, 'missing script URL does not pretend to save');
  assertEqual(JSON.parse(noUrl.body).result, 'error', 'missing script URL returns an error');

  const badDate = await update({
    httpMethod: 'POST',
    body: JSON.stringify({ ncrNumber: 'NCR26-001', correctiveDue: '2026-02-31' })
  });
  assertEqual(badDate.statusCode, 400, 'update rejects an invalid date');

  const badNumber = await getNcr({ httpMethod: 'POST', body: JSON.stringify({ ncrNumber: '26-1' }) });
  assertEqual(badNumber.statusCode, 400, 'lookup rejects a bad NCR number');

  if (previous == null) delete process.env.QUALITY_SCRIPT_URL;
  else process.env.QUALITY_SCRIPT_URL = previous;

  const menu = fs.readFileSync(path.join(__dirname, '../menu.html'), 'utf8');
  const qualityPage = fs.readFileSync(path.join(__dirname, '../quality/index.html'), 'utf8');
  const ncrPage = fs.readFileSync(path.join(__dirname, '../quality/ncrs.html'), 'utf8');
  const form = fs.readFileSync(path.join(__dirname, '../quality/raise-ncr.js'), 'utf8');
  assert(menu.indexOf('href="/quality/"') !== -1 && menu.indexOf('>Quality<') !== -1, 'Quality menu link remains');
  assert(menu.indexOf('>Warehouse<') !== -1 && menu.indexOf('>HR<') !== -1, 'existing menus remain');
  assert(qualityPage.indexOf('>NCRs<') !== -1 && qualityPage.indexOf('href="ncrs.html"') !== -1, 'Quality opens NCRs');
  assert(ncrPage.indexOf('>Raise NCR<') !== -1 && ncrPage.indexOf('href="raise-ncr.html"') !== -1, 'NCRs opens Raise NCR');
  assert(form.indexOf('Section 1: Raising the Report (to be completed by reporter)') !== -1, 'section 1 title');
  assert(form.indexOf('Section 2: Investigation (to be completed by Manager)') !== -1, 'section 2 title');
  assert(form.indexOf('Save and Proceed to Section 2') !== -1 && form.indexOf('Save and Exit') !== -1, 'section 1 buttons');
  ['Low', 'Medium', 'High', 'Zoe Ibbotson', 'Tom Ebdon', 'Angus Sales', 'Finished Product', 'Ingredients', 'Packaging', 'Pre-Packaged Liquid', 'Internal Process or Procedure', 'Add Another'].forEach(function (label) {
    assert(form.indexOf(label) !== -1, 'form contains ' + label);
  });

  if (failures) {
    console.error(failures + ' failed, ' + passes + ' passed');
    process.exit(1);
  }
  console.log(passes + ' passed');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
