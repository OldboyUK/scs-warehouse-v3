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

function createSheet(maxRows, sheetName) {
  const cells = new Map();
  const sheet = {
    maxRows: maxRows || 8,
    failOnCol: 0,
    writeLog: [],
    clearLog: [],
    getName: function () { return sheetName || 'Submission Log'; },
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

function seedHeaders(sheet) {
  ['Maintenance ID', 'Job', 'Date', 'User', 'Reporter', 'Line / Area', 'Machine / Equipment', 'Priority', '', 'Description of issue', 'Parts requested', 'Raise maintenance request', 'Folder'].forEach(function (text, index) {
    if (text) sheet.seed(1, index + 1, { value: text });
  });
}

function driveNamed(name) {
  return world.drive.nodes.filter(function (node) { return node.name === name; });
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
    },
    newBlob: function (bytes, mime, name) {
      return {
        name: name,
        getContentType: function () { return mime; },
        getBytes: function () { return bytes; }
      };
    },
    base64Decode: function (text) { return Buffer.from(String(text), 'base64'); },
    base64Encode: function (bytes) { return Buffer.from(bytes).toString('base64'); }
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
          if (name === 'Submission Log') return world.sheet;
          if (name === 'Helper') return world.helper;
          return null;
        }
      };
    },
    flush: function () {}
  },
  encodeURIComponent: encodeURIComponent,
  DriveApp: {
    getFolderById: function (id) {
      if (id !== '1AMvZj3XOytmfdiWSIT-EQ7mH8FVQsBxs') throw new Error('permission denied');
      return {
        getName: function () { return 'Maintenance jobs'; },
        createFolder: function (name) {
          const folderId = 'probe-' + world.drive.next++;
          world.drive.nodes.push({
            id: folderId,
            name: name,
            parentId: id,
            mimeType: 'application/vnd.google-apps.folder',
            trashed: false
          });
          return {
            setTrashed: function (trashed) {
              world.drive.nodes.forEach(function (node) {
                if (node.id === folderId) node.trashed = !!trashed;
              });
            }
          };
        }
      };
    }
  },
  ScriptApp: {
    getOAuthToken: function () { return 'test-token'; },
    AuthMode: { FULL: 'FULL' },
    requireScopes: function (mode, scopes) {
      if (mode !== 'FULL') throw new Error('unexpected auth mode');
      if (scopes.indexOf('https://www.googleapis.com/auth/drive') === -1) throw new Error('full Drive scope was not requested');
      if (scopes.indexOf('https://www.googleapis.com/auth/drive.readonly') !== -1) throw new Error('read-only Drive scope was requested');
    }
  },
  Logger: { log: function () {} },
  UrlFetchApp: {
    fetch: function (url, options) {
      options = options || {};
      const method = String(options.method || 'get').toLowerCase();
      const respond = function (code, text) {
        return {
          getResponseCode: function () { return code; },
          getContentText: function () { return text; }
        };
      };
      if (url === core.DROPDOWNS_CSV_URL) return respond(200, world.csv);
      if (String(url).indexOf('https://www.googleapis.com/upload/drive/') === 0) {
        const meta = String(options.payload || '').match(/\{[\s\S]*?\}/);
        const data = JSON.parse(meta[0]);
        const id = 'file-' + world.drive.next++;
        world.drive.nodes.push({ id: id, name: data.name, parentId: data.parents[0], mimeType: 'image/jpeg' });
        return respond(200, JSON.stringify({ id: id, name: data.name }));
      }
      if (String(url).indexOf('https://www.googleapis.com/drive/v3/files') === 0 && method === 'get') {
        const q = decodeURIComponent(String(url).split('q=')[1] || '');
        const name = (q.match(/name = '((?:\\'|[^'])*)'/) || [])[1].replace(/\\'/g, "'");
        const parentId = (q.match(/'([^']+)' in parents/) || [])[1];
        const files = world.drive.nodes.filter(function (node) {
          return node.parentId === parentId && node.name === name;
        }).map(function (node) {
          return { id: node.id, name: node.name, mimeType: node.mimeType };
        });
        return respond(200, JSON.stringify({ files: files }));
      }
      if (String(url).indexOf('https://www.googleapis.com/drive/v3/files') === 0 && method === 'post') {
        const data = JSON.parse(options.payload);
        const id = 'folder-' + world.drive.next++;
        world.drive.nodes.push({
          id: id,
          name: data.name,
          parentId: data.parents[0],
          mimeType: data.mimeType || 'application/vnd.google-apps.folder'
        });
        return respond(200, JSON.stringify({ id: id, name: data.name }));
      }
      throw new Error('Unexpected fetch ' + url);
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

function fresh() {
  world.sheet = createSheet(8);
  seedHeaders(world.sheet);
  world.helper = createSheet(6, 'Helper');
  world.helper.seed(1, 1, { value: 'Owner' });
  world.helper.seed(2, 1, { value: 'Alex P' });
  world.helper.seed(3, 1, { value: ' ' });
  world.helper.seed(4, 1, { value: 'Sam K' });
  world.helper.seed(5, 1, { value: 'Alex P' });
  world.props = {};
  world.locked = false;
  world.now = new Date('2026-06-15T12:00:00Z');
  world.csv = FIXTURE;
  world.drive = { next: 1, nodes: [] };
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
    user: 'Test User',
    reporter: '',
    title: 'Filler guard missing',
    photoNames: [],
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
    user: 'Someone Signed In',
    reporter: '',
    title: 'Loose cable',
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
  assertEqual(other.value.user, 'Someone Signed In', 'signed-in user does not have to be in the dropdown');
  assertEqual(other.value.title, 'Loose cable', 'title is stored');
  assertEqual(other.value.reporter, 'Someone Signed In', 'self report stores the signed-in user as the reporter');
  assertEqual(other.value.photoNames.length, 0, 'a report can have no photographs');

  const wrongMachine = core.validateFault({
    submissionId: 'sub-00000001',
    reporterMode: 'other',
    user: 'Test User',
    reporter: 'Jody R',
    title: 'Wrong machine',
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
    user: 'Test User',
    reporter: 'Jody R',
    title: 'Noise',
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
  world.sheet.seed(2, 2, { value: 'MA0009 | Old title' });
  world.sheet.seed(2, 3, { value: '01/01/2026' });
  world.sheet.seed(2, 4, { value: 'Old User' });
  world.sheet.seed(2, 5, { value: 'Old Reporter' });
  world.sheet.seed(2, 6, { value: 'Old Area' });
  world.sheet.seed(2, 7, { value: 'Old Machine' });
  world.sheet.seed(2, 8, { value: 'Low Priority' });
  world.sheet.seed(2, 9, { value: 'Leave this cell' });
  world.sheet.seed(2, 10, { value: 'Old fault' });
  world.sheet.seed(2, 11, { value: 'Old part' });
  world.sheet.seed(2, 12, { value: 'No' });
  world.sheet.seed(2, 15, { formula: '=1+1', value: 2, display: '2' });
  world.sheet.seed(3, 15, { formula: '=2+2', value: 4, display: '4' });
  world.sheet.seed(5, 1, { formula: '=""', display: '', value: '' });

  const saved = post({
    priority: 'High Priority - Urgent Risk to Safety of People or Food',
    parts: 'Guard'
  });
  assertEqual(saved.result, 'success', 'first occupied-sheet save succeeds');
  assertEqual(saved.maintenanceId, 'MA0010', 'next id follows the highest existing id');
  assertEqual(saved.submittedOn, '15/06/2026', 'date is generated on the server in London');
  assertEqual(cell(3, 1), 'MA0010', 'id is written to column A');
  assertEqual(cell(3, 2), 'MA0010 | Filler guard missing', 'column B joins the id and title');
  assertEqual(cell(3, 3), '15/06/2026', 'date is written to column C');
  assertEqual(cell(3, 4), 'Test User', 'signed-in user is written to column D');
  assertEqual(cell(3, 5), 'Test User', 'self report stores the signed-in user as the reporter');
  assertEqual(cell(3, 6), 'Laboratory', 'area is written to column F');
  assertEqual(cell(3, 7), 'DMA', 'equipment is written to column G');
  assertEqual(cell(3, 8), 'High Priority', 'priority category only is written to column H');
  assert(String(cell(3, 8)).indexOf('Urgent') === -1, 'priority explanation is not stored');
  assertEqual(cell(3, 9), 'Filler guard missing', 'the descriptive title is written to column I');
  assertEqual(cell(3, 10), 'Guard missing from the filler', 'description is written to column J');
  assertEqual(cell(3, 11), 'Guard', 'parts are written to column K');
  assertEqual(cell(3, 12), 'Yes', 'raising a request writes Yes to column L');
  assert(String(formula(3, 13)).indexOf('HYPERLINK') !== -1, 'column M is a hyperlink');
  assert(String(formula(3, 13)).indexOf(driveNamed('MA0010')[0].id) !== -1, 'column M links to the job folder');
  assertEqual(driveNamed('MA0010 | Requests').length, 1, 'the Requests folder is created');
  assertEqual(driveNamed('MA0010 | Completed').length, 0, 'a completed folder is not created');
  assertEqual(cell(2, 1), 'MA0009', 'existing id is not overwritten');
  assertEqual(cell(2, 4), 'Old User', 'existing user is not overwritten');
  assertEqual(cell(2, 5), 'Old Reporter', 'existing reporter is not overwritten');
  assertEqual(cell(2, 9), 'Leave this cell', 'existing column I is not overwritten');
  assertEqual(cell(2, 10), 'Old fault', 'existing description is not overwritten');
  assertEqual(formula(2, 15), '=1+1', 'unrelated formula is preserved');
  assertEqual(formula(3, 15), '=2+2', 'formula beside the new row is preserved');
  assertEqual(formula(5, 1), '=""', 'later blank formula is not the first row used');
  assertEqual(cell(1, 1), 'Maintenance ID', 'header row is not overwritten');
  assertEqual(cell(1, 4), 'User', 'user header is not overwritten');
  assertEqual(cell(1, 5), 'Reporter', 'reporter header is not overwritten');
  assertEqual(display(8, 1), '', 'a later empty row is not used while an earlier row is free');
  assertEqual(idRows().length, 2, 'existing and new ids both remain');

  const again = post();
  assertEqual(again.result, 'success', 'retry of the same submission succeeds');
  assertEqual(again.maintenanceId, 'MA0010', 'retry returns the original id');
  assertEqual(idRows().length, 2, 'retry does not add a row');

  const changed = post({ description: 'A different fault' });
  assertEqual(changed.result, 'error', 'changed retry is not saved as a new report');
  assert(String(changed.maintenanceId) === 'MA0010', 'changed retry names the original id');
  assertEqual(cell(3, 10), 'Guard missing from the filler', 'original description stays in place');
  assertEqual(idRows().length, 2, 'changed retry does not add a row');

  fresh();
  const first = post({ submissionId: 'sub-00000011', parts: '' });
  assertEqual(first.maintenanceId, 'MA0001', 'empty log starts at MA0001');
  assertEqual(cell(2, 11), '', 'blank parts stay blank');
  assert(!world.sheet.writeLog.some(function (entry) { return entry.col === 11; }), 'blank parts cell is not written');
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

  fresh();
  const other = post({
    submissionId: 'sub-other-001',
    reporterMode: 'other',
    user: 'Test User',
    reporter: 'Jody R',
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
  assertEqual(cell(2, 4), 'Test User', 'signed-in user is column D');
  assertEqual(cell(2, 5), 'Jody R', 'a different reporter is column E');
  assertEqual(cell(2, 6), 'Mezzanine', 'free-text area is saved');
  assertEqual(cell(2, 7), 'Loose cable', 'free-text equipment is saved');
  assertEqual(cell(2, 8), 'Unsure', 'unsure priority is shortened');
  assertEqual(cell(2, 12), 'No', 'marking the job completed writes No to column L');
  assert(cell(2, 6) !== 'Other' && cell(2, 7) !== 'Other', 'the word Other is not saved');

  fresh();
  const samePerson = post({
    submissionId: 'sub-same-0001',
    reporterMode: 'other',
    user: 'Jody R',
    reporter: 'Jody R'
  });
  assertEqual(samePerson.result, 'success', 'a reporter who is the signed-in user still saves');
  assertEqual(cell(2, 4), 'Jody R', 'that person is stored as the user');
  assertEqual(cell(2, 5), 'Jody R', 'the selected reporter is stored even when it is the same person');

  fresh();
  world.sheet.seed(2, 9, { value: 'Already titled' });
  const occupiedTitle = post({ submissionId: 'sub-title-0001', title: 'New title' });
  assertEqual(occupiedTitle.maintenanceId, 'MA0001', 'a filled title cell does not block the next id');
  assertEqual(cell(2, 9), 'Already titled', 'an existing title is not overwritten');
  assertEqual(cell(3, 1), 'MA0001', 'the report uses the next row when column I is already filled');
  assertEqual(cell(3, 9), 'New title', 'the descriptive title is written on that next row');

  fresh();
  const prepared = post({
    submissionId: 'sub-photo-01',
    title: 'Belt slip',
    description: 'The belt slips under load',
    photoNames: ['fault-01.jpg', 'fault-02.jpg']
  });
  assertEqual(prepared.result, 'pending', 'photographs are uploaded before the row is confirmed');
  assertEqual(prepared.maintenanceId, 'MA0001', 'the job id is reserved before the photographs upload');
  assertEqual(cell(2, 1), '', 'the row is not written before the photographs upload');
  assertEqual(driveNamed('MA0001').length, 1, 'the job folder is created before the photographs upload');
  assertEqual(driveNamed('MA0001 | Requests').length, 1, 'the Requests folder is created before the photographs upload');
  const preparedAgain = post({
    submissionId: 'sub-photo-01',
    title: 'Belt slip',
    description: 'The belt slips under load',
    photoNames: ['fault-01.jpg', 'fault-02.jpg']
  });
  assertEqual(preparedAgain.maintenanceId, 'MA0001', 'preparing the same report again does not allocate another id');
  assertEqual(driveNamed('MA0001').length, 1, 'preparing again does not create a second job folder');
  function postPhoto(name) {
    const out = context.doPost({
      parameter: {},
      postData: {
        type: 'application/json',
        contents: JSON.stringify({
          token: 'J4PAN88',
          action: 'fault_photo',
          submissionId: 'sub-photo-01',
          fileName: name,
          mimeType: 'image/jpeg',
          imageBase64: Buffer.from('photo-' + name).toString('base64')
        })
      }
    });
    return JSON.parse(out.getContent());
  }
  assertEqual(postPhoto('fault-01.jpg').result, 'ok', 'the first photograph uploads');
  assertEqual(postPhoto('fault-02.jpg').result, 'ok', 'the second photograph uploads');
  assertEqual(postPhoto('fault-01.jpg').result, 'ok', 'uploading the same photograph again does not fail');
  const requestsFolder = driveNamed('MA0001 | Requests')[0];
  const uploaded = world.drive.nodes.filter(function (node) {
    return node.parentId === requestsFolder.id && node.mimeType !== 'application/vnd.google-apps.folder';
  });
  assertEqual(uploaded.length, 2, 'both photographs are in the Requests folder and the retry did not add a third');
  assertEqual(uploaded.map(function (node) { return node.name; }).sort().join('|'), 'fault-01.jpg|fault-02.jpg', 'photograph file names are kept');
  const committed = post({
    action: 'fault_commit',
    submissionId: 'sub-photo-01',
    title: 'Belt slip',
    description: 'The belt slips under load',
    photoNames: ['fault-01.jpg', 'fault-02.jpg']
  });
  assertEqual(committed.result, 'success', 'the report is confirmed after the photographs upload');
  assertEqual(committed.maintenanceId, 'MA0001', 'the confirmed id is the reserved id');
  assertEqual(cell(2, 1), 'MA0001', 'the id is written after the photographs upload');
  assertEqual(cell(2, 2), 'MA0001 | Belt slip', 'the title is joined to the id');
  assertEqual(cell(2, 9), 'Belt slip', 'the descriptive title is written to column I when photographs are saved');
  assertEqual(cell(2, 10), 'The belt slips under load', 'the description is column J');
  assert(String(formula(2, 13)).indexOf(driveNamed('MA0001')[0].id) !== -1, 'column M links to the top-level job folder');
  const committedAgain = post({
    action: 'fault_commit',
    submissionId: 'sub-photo-01',
    title: 'Belt slip',
    description: 'The belt slips under load',
    photoNames: ['fault-01.jpg', 'fault-02.jpg']
  });
  assertEqual(committedAgain.result, 'success', 'committing the same report again succeeds');
  assertEqual(committedAgain.maintenanceId, 'MA0001', 'a second commit does not allocate another id');
  assertEqual(idRows().length, 1, 'a second commit does not add a row');

  fresh();
  const noPhoto = post({ submissionId: 'sub-nophoto-1', title: 'No picture', description: 'Still a fault' });
  assertEqual(noPhoto.result, 'success', 'a report with no photographs is saved');
  assertEqual(noPhoto.maintenanceId, 'MA0001', 'a report with no photographs still gets an id');
  assertEqual(driveNamed('MA0001').length, 1, 'a job folder is created when there are no photographs');
  assertEqual(driveNamed('MA0001 | Requests').length, 1, 'the Requests folder is created when there are no photographs');
  assertEqual(world.drive.nodes.filter(function (node) { return node.mimeType !== 'application/vnd.google-apps.folder'; }).length, 0, 'no photograph file is created when none were selected');

  fresh();
  const wrong = post({ submissionId: 'sub-wrong-001', area: 'Laboratory', equipment: 'Depalletiser' });
  assertEqual(wrong.result, 'error', 'wrong equipment is rejected by the script');
  assertEqual(world.sheet.writeLog.length, 0, 'rejected equipment writes nothing');

  fresh();
  const unknown = post({ submissionId: 'sub-unknown-01', reporterMode: 'other', user: 'Test User', reporter: 'Not A Person', area: 'Laboratory', equipment: 'DMA' });
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
  assertEqual(names.join('|'), 'Warehouse|Schedule|HR|Quality|Maintenance|Health and Safety', 'menu order places Schedule after Warehouse and Maintenance between Quality and Health and Safety');
  assert(menu.indexOf('href="/quality/"') !== -1, 'Quality menu link remains');
  assert(menu.indexOf('href="/warehouse/"') !== -1 && menu.indexOf('href="/hr/"') !== -1, 'Warehouse and HR links remain');
  assert(menu.indexOf('href="/health-safety/"') !== -1, 'Health and Safety link remains');
  assert(home.indexOf('>Report Fault<') !== -1 && home.indexOf('href="report-fault.html"') !== -1, 'Maintenance opens Report Fault');
  assert(home.indexOf('>Review Maintenance Requests<') !== -1 && home.indexOf('href="review-requests.html"') !== -1, 'Maintenance opens Review Maintenance Requests');
  const reviewPage = fs.readFileSync(path.join(root, 'maintenance/review-requests.html'), 'utf8');
  const review = fs.readFileSync(path.join(root, 'maintenance/review-requests.js'), 'utf8');
  assert(reviewPage.indexOf('review-requests.js') !== -1, 'review page loads its script');
  [
    'Please assign an owner to this job',
    'Please assign a department',
    'Please enter a due date',
    'Is a permit to work required?',
    'Assessing the task, is there any impact to Food Safety or Health and Safety that has not been considered?',
    'Would you like to order parts now or later?',
    'Order Parts Now',
    'Order Parts Later',
    'Ordering parts is not available yet. Nothing else was saved.',
    'You can order parts later. Nothing else was saved.',
    'Quality',
    'Engineering',
    'Logistics',
    'Management'
  ].forEach(function (label) {
    assert(review.indexOf(label) !== -1, 'review form contains ' + label);
  });
  assert(review.indexOf('type="date"') !== -1, 'due date uses a date picker');
  assert(review.indexOf('/.netlify/functions/reviewMaintenance') !== -1, 'review posts to the Netlify function');
  assert(review.indexOf('J4PAN88') === -1 && review.indexOf('script.google.com') === -1, 'review page has no script credential or web app URL');
  assert(review.indexOf('order_parts') === -1, 'parts ordering is not submitted');
  assert(script.indexOf('var REVIEW_LAST_COL = 19') !== -1, 'review stops at column S');
  assert(script.indexOf("var SHEET_HELPER = 'Helper'") !== -1, 'owners are read from the Helper sheet');
  assert(page.indexOf('report-fault.js') !== -1, 'report page loads its script');
  [
    'Please use this form for reporting faults or an unsafe condition with the machines or equipment',
    'Are you reporting this on behalf of yourself or another operator?',
    'Please select the operating line or area where the machine or equipment can be found',
    'Please select the Machine or piece of equipment that is faulty or in an unsafe condition.',
    'Please select a priority',
    'Please write a descriptive title for the fault or unsafe condition. This will be used to later in conjunction with Maintenance ID to quickly identify the job.',
    'Please write a description of the fault or unsafe condition',
    'Parts requested',
    'Would you like to mark the job as completed or raise a maintenance request',
    'Add photographs',
    'Submit Fault Report',
    'Self',
    'Another Operator',
    'Raise Maintenance Request',
    'Mark job as completed',
    'High Priority - Urgent Risk to Safety of People or Food',
    'Medium Priority - A condition which must be addressed as it is likely to worsen, but does not pose an immediate risk',
    'Low Priority - A condition which must be improved, but is not urgent',
    'Stock Request - Used for requesting spare parts',
    'Unsure - Please Allocate the Priority for Me'
  ].forEach(function (label) {
    assert(form.indexOf(label) !== -1, 'form contains ' + label);
  });
  assert(form.indexOf('SCSAuth.getUsername()') !== -1, 'self uses the signed-in user');
  assert(form.indexOf('type="file"') !== -1 && form.indexOf('accept="image/*"') !== -1 && form.indexOf('multiple') !== -1, 'photographs can be selected');
  assert(form.indexOf('getUserMedia') === -1, 'the form does not open the camera itself');
  assert(form.indexOf('Work in Progress') === -1, 'the photo control is no longer a placeholder');
  assert(form.indexOf('/.netlify/functions/uploadFaultPhoto') !== -1, 'photographs post to the upload function');
  assert(form.indexOf('J4PAN88') === -1 && form.indexOf('script.google.com') === -1, 'frontend has no script credential or web app URL');
  assert(form.indexOf('/.netlify/functions/submitFault') !== -1, 'form posts to the Netlify function');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'GOOGLE SCRIPTS/maintenance-appsscript.json'), 'utf8'));
  assertEqual(manifest.webapp.executeAs, 'USER_DEPLOYING', 'Maintenance web app runs as the deploying account');
  assertEqual(manifest.webapp.access, 'ANYONE_ANONYMOUS', 'Maintenance web app stays anonymous for Netlify');
  assert(manifest.oauthScopes.indexOf('https://www.googleapis.com/auth/drive') !== -1, 'Maintenance manifest requests full Drive');
  assert(manifest.oauthScopes.indexOf('https://www.googleapis.com/auth/drive.readonly') === -1, 'Maintenance manifest does not request read-only Drive');
  assert(script.indexOf('https://www.googleapis.com/auth/drive') !== -1, 'editor authorisation requests full Drive');
  assert(script.indexOf('https://www.googleapis.com/auth/drive.readonly') === -1, 'script does not request read-only Drive');
  assert(script.indexOf('function authorizeMaintenanceDrive') !== -1, 'editor function is available to grant Drive');
  assert(script.indexOf('appendRow') === -1 && script.indexOf('setValues') === -1, 'writer does not append or bulk-write');
  assert(script.indexOf('deleteRow') === -1 && script.indexOf('clearContents') === -1, 'writer does not delete rows or clear the sheet');
  assert(script.indexOf(core.SSID_MAINTENANCE) !== -1 && script.indexOf('Submission Log') !== -1, 'writer targets Submission Log');
}

function testDriveAuthorisation() {
  fresh();
  context.authorizeMaintenanceDrive();
  const probes = world.drive.nodes.filter(function (node) {
    return node.name.indexOf('_maintenance_auth_probe_') === 0;
  });
  assertEqual(probes.length, 1, 'authorisation creates one probe folder');
  assertEqual(probes[0].parentId, '1AMvZj3XOytmfdiWSIT-EQ7mH8FVQsBxs', 'probe is created in the Maintenance parent');
  assert(probes[0].trashed, 'authorisation removes the probe folder');
}

function reviewLists() {
  const out = context.doPost({
    parameter: { token: 'J4PAN88', action: 'review_lists' },
    postData: { type: 'application/x-www-form-urlencoded', contents: '' }
  });
  return JSON.parse(out.getContent());
}

function postReview(extra) {
  const params = Object.assign({
    token: 'J4PAN88',
    action: 'review_save',
    submissionId: 'review-0001',
    user: 'Test User',
    label: 'MA0042 | Conveyor belt motor failure',
    maintenanceId: 'MA0042',
    owner: 'Alex P',
    department: 'Engineering',
    dueDate: '2026-11-17',
    permit: 'Yes',
    assessment: 'No extra food safety impact.\nGuarding already considered.'
  }, extra || {});
  const out = context.doPost({
    parameter: params,
    postData: { type: 'application/x-www-form-urlencoded', contents: '' }
  });
  return JSON.parse(out.getContent());
}

function seedRequest(row, id, title) {
  world.sheet.seed(row, 1, { value: id });
  world.sheet.seed(row, 2, { value: id + ' | ' + title });
  world.sheet.seed(row, 3, { value: '01/06/2026' });
  world.sheet.seed(row, 4, { value: 'Reporter User' });
  world.sheet.seed(row, 9, { value: title });
  world.sheet.seed(row, 10, { value: 'Original description' });
  world.sheet.seed(row, 13, { formula: '=HYPERLINK("https://drive.google.com/drive/folders/job","' + id + '")', value: id });
}

function testReview() {
  const kept = core.validateReview({
    submissionId: 'review-0001',
    user: 'Test User',
    label: 'MA0042 | Conveyor belt motor failure',
    maintenanceId: 'ma0042',
    owner: 'Alex P',
    department: 'Engineering',
    dueDate: '2026-11-17',
    permit: 'Yes',
    assessment: 'Line one\r\nLine two'
  }, ['Alex P']);
  assert(kept.ok, 'a complete review passes validation');
  assertEqual(kept.value.maintenanceId, 'MA0042', 'the maintenance id is normalised');
  assertEqual(kept.value.assessment, 'Line one\nLine two', 'assessment line breaks are preserved');
  assert(!core.validateReview(Object.assign({}, kept.value, { dueDate: '2026-02-31' }), ['Alex P']).ok, 'an impossible due date is rejected');
  assert(!core.validateReview(Object.assign({}, kept.value, { department: 'Warehouse' }), ['Alex P']).ok, 'an unknown department is rejected');
  assert(!core.validateReview(Object.assign({}, kept.value, { assessment: ' \n ' }), ['Alex P']).ok, 'a blank assessment is rejected');
  assert(!core.validateReview(Object.assign({}, kept.value, { owner: 'Nobody' }), ['Alex P']).ok, 'an owner who is not on the list is rejected');

  fresh();
  seedRequest(2, 'MA0001', 'Hidden first row');
  seedRequest(3, 'MA0042', 'Conveyor belt motor failure');
  world.sheet.seed(3, 14, { value: 'Old reviewer' });
  world.sheet.seed(3, 20, { formula: '=ROW()', value: 3, display: '3' });
  seedRequest(5, 'MA0043', 'Second job');
  world.sheet.seed(6, 1, { value: 'MA0099' });
  world.sheet.seed(6, 2, { value: 'MA0043 | Second job' });

  const listed = reviewLists();
  assertEqual(listed.result, 'ok', 'the review list loads');
  assertEqual(listed.owners.join('|'), 'Alex P|Sam K', 'Helper column A supplies owners, skipping blanks and duplicates');
  assertEqual(listed.requests.map(function (item) { return item.label; }).join('|'), 'MA0042 | Conveyor belt motor failure|MA0043 | Second job', 'column B from row 3 is listed and row 2 is not');
  assertEqual(listed.requests[0].row, 3, 'the selected request remembers its spreadsheet row');
  assertEqual(listed.requests[0].maintenanceId, 'MA0042', 'the request keeps the id from column A');
  assert(listed.requests[1].duplicate, 'a repeated request is marked so it cannot be updated');

  let refused = false;
  try { context.writeTextCell_(world.sheet, 3, 20, 'no', []); } catch (err) { refused = true; }
  assert(refused, 'column T cannot be written');
  assertEqual(formula(3, 20), '=ROW()', 'trying column T leaves its formula in place');

  const wrongDepartment = postReview({ department: 'Warehouse' });
  assertEqual(wrongDepartment.result, 'error', 'an unknown department is not saved');
  assertEqual(world.sheet.writeLog.length, 0, 'a rejected review writes nothing');

  const saved = postReview();
  assertEqual(saved.result, 'success', 'the review updates the existing request');
  assertEqual(saved.maintenanceId, 'MA0042', 'the review does not create a maintenance id');
  assertEqual(saved.row, 3, 'the review writes the row whose label still matches');
  assertEqual(saved.dueOn, '17/11/2026', 'the due date is confirmed in UK format');
  assertEqual(cell(3, 14), 'Test User', 'column N stores the signed-in user');
  assertEqual(cell(3, 15), 'Alex P', 'column O stores the owner');
  assertEqual(cell(3, 16), 'Engineering', 'column P stores the department');
  assert(cell(3, 17) instanceof Date, 'column Q stores a date value');
  assertEqual(formatDate(cell(3, 17), 'Europe/London', 'dd/MM/yyyy'), '17/11/2026', 'column Q displays as DD/MM/YYYY');
  assertEqual(world.sheet.cell(3, 17).format, 'dd/MM/yyyy', 'column Q uses a UK date format');
  assertEqual(cell(3, 18), 'Yes', 'column R stores the permit answer');
  assertEqual(cell(3, 19), 'No extra food safety impact.\nGuarding already considered.', 'column S preserves the assessment and its line break');
  assertEqual(cell(3, 1), 'MA0042', 'column A is not overwritten');
  assertEqual(cell(3, 2), 'MA0042 | Conveyor belt motor failure', 'column B is not overwritten');
  assertEqual(cell(3, 4), 'Reporter User', 'column D is not overwritten');
  assertEqual(cell(3, 9), 'Conveyor belt motor failure', 'column I is not overwritten');
  assertEqual(cell(3, 10), 'Original description', 'column J is not overwritten');
  assert(String(formula(3, 13)).indexOf('HYPERLINK') !== -1, 'column M keeps its hyperlink');
  assertEqual(formula(3, 20), '=ROW()', 'column T keeps its formula');
  assertEqual(cell(2, 1), 'MA0001', 'the row above the review range is not updated');
  assert(world.sheet.writeLog.every(function (entry) { return entry.col >= 14 && entry.col <= 19; }), 'only columns N to S are written');
  assert(!world.sheet.writeLog.some(function (entry) { return entry.col === 20 || entry.col <= 13; }), 'columns A to M and T are not written');
  assertEqual(world.drive.nodes.length, 0, 'a review does not create a Drive folder');
  assert(!Object.prototype.hasOwnProperty.call(world.props, 'FAULT_SUBMISSION_INDEX'), 'a review does not join the fault id sequence');
  assertEqual(idRows().length, 4, 'a review does not add a row');

  const writes = world.sheet.writeLog.length;
  const again = postReview();
  assertEqual(again.result, 'success', 'submitting the same review again succeeds');
  assertEqual(again.maintenanceId, 'MA0042', 'the repeated review keeps the same id');
  assertEqual(world.sheet.writeLog.length, writes, 'the repeated review does not write again');

  const changed = postReview({ owner: 'Sam K' });
  assertEqual(changed.result, 'error', 'changing a saved review under the same submission does not write');
  assertEqual(cell(3, 15), 'Alex P', 'the saved owner stays in place');

  const duplicate = postReview({
    submissionId: 'review-0002',
    label: 'MA0043 | Second job',
    maintenanceId: 'MA0043'
  });
  assertEqual(duplicate.result, 'error', 'a repeated request is not updated');
  assertEqual(cell(5, 14), '', 'the first copy of a repeated request is not written');
  assertEqual(cell(6, 14), '', 'the second copy of a repeated request is not written');

  world.sheet.seed(3, 2, { value: 'MA0042 | Renamed after selection' });
  const moved = postReview({ submissionId: 'review-0003' });
  assertEqual(moved.result, 'error', 'a request whose title changed is not updated');
  assertEqual(cell(3, 15), 'Alex P', 'the earlier review remains after the title changes');
  world.sheet.seed(3, 2, { value: 'MA0042 | Conveyor belt motor failure' });

  const updated = postReview({ submissionId: 'review-0004', owner: 'Sam K', permit: 'No' });
  assertEqual(updated.result, 'success', 'a later review can update the same request');
  assertEqual(updated.maintenanceId, 'MA0042', 'the later review still does not create an id');
  assertEqual(cell(3, 15), 'Sam K', 'column O is updated on the same row');
  assertEqual(cell(3, 18), 'No', 'column R is updated on the same row');
  assertEqual(cell(3, 1), 'MA0042', 'the later review still does not change column A');

  fresh();
  seedRequest(3, 'MA0042', 'Conveyor belt motor failure');
  world.sheet.seed(3, 14, { formula: '=A3', value: 'MA0042' });
  const protectedCell = postReview({ submissionId: 'review-0005' });
  assertEqual(protectedCell.result, 'error', 'a formula in the review columns stops the save');
  assertEqual(formula(3, 14), '=A3', 'the formula in column N is not overwritten');
  assertEqual(cell(3, 15), '', 'later review columns are not written after a formula is found');

  fresh();
  world.helper = null;
  const missingHelper = reviewLists();
  assertEqual(missingHelper.result, 'error', 'a missing Helper sheet does not pretend to load');
  assert(String(missingHelper.message).indexOf('Helper') !== -1, 'the missing Helper sheet is named');
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

  const reviewHandler = require('../netlify/functions/reviewMaintenance').handler;
  const reviewGet = await reviewHandler({ httpMethod: 'GET', body: '' });
  assertEqual(reviewGet.statusCode, 405, 'review GET is rejected');
  const reviewBad = await reviewHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'review_save', submissionId: 'review-0001' })
  });
  assertEqual(reviewBad.statusCode, 400, 'an incomplete review is rejected before the script');
  assertEqual(JSON.parse(reviewBad.body).result, 'error', 'an incomplete review is not a success');

  const previous = process.env.MAINTENANCE_SCRIPT_URL;
  delete process.env.MAINTENANCE_SCRIPT_URL;
  const noUrl = await submit({
    httpMethod: 'POST',
    body: JSON.stringify({
      submissionId: 'sub-00000001',
      reporterMode: 'other',
      user: 'Test User',
      reporter: 'Jody R',
      title: 'Live list check',
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
  testDriveAuthorisation();
  testReview();
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
