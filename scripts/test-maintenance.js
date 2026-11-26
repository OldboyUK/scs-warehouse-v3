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
      getValues: function () {
        const out = [];
        for (let r = 0; r < height; r++) {
          const line = [];
          for (let c = 0; c < width; c++) line.push(sheet.cell(row + r, col + c).value);
          out.push(line);
        }
        return out;
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
          if (name === 'Parts Requested') return world.parts;
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
      const imageRespond = function (id) {
        const bytes = Buffer.from('jpeg-' + id);
        return {
          getResponseCode: function () { return 200; },
          getContentText: function () { return ''; },
          getBlob: function () {
            return {
              getBytes: function () { return bytes; },
              getContentType: function () { return 'image/jpeg'; }
            };
          }
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
      if (String(url).indexOf('https://thumbnail.test/') === 0 && method === 'get') {
        const id = String(url).replace('https://thumbnail.test/', '').replace(/=s\d+$/, '');
        return imageRespond(id);
      }
      if (String(url).indexOf('https://www.googleapis.com/drive/v3/files') === 0 && method === 'get') {
        const fileMatch = String(url).match(/\/files\/([^/?]+)/);
        if (fileMatch && String(url).indexOf('q=') === -1) {
          const id = decodeURIComponent(fileMatch[1]);
          if (String(url).indexOf('alt=media') !== -1) return imageRespond(id);
          const node = world.drive.nodes.filter(function (item) { return item.id === id; })[0];
          if (!node) return respond(404, '{}');
          return respond(200, JSON.stringify({
            id: node.id,
            name: node.name,
            mimeType: node.mimeType,
            parents: [node.parentId],
            thumbnailLink: 'https://thumbnail.test/' + node.id + '=s220'
          }));
        }
        const q = decodeURIComponent(String(url).split('q=')[1] || '');
        const nameMatch = q.match(/name = '((?:\\'|[^'])*)'/);
        const parentId = (q.match(/'([^']+)' in parents/) || [])[1];
        const files = world.drive.nodes.filter(function (node) {
          if (node.parentId !== parentId) return false;
          if (!nameMatch) return String(node.mimeType || '').indexOf('image/') === 0;
          return node.name === nameMatch[1].replace(/\\'/g, "'");
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

function seedPartsSheet(sheet) {
  ['Part ID', 'Name of Part', 'Part', 'Purchaser', 'Supplier', 'Date Ordered', 'Date Arrived', 'Received by', 'Checked by', 'Receipt status'].forEach(function (text, index) {
    sheet.seed(1, index + 1, { value: text });
  });
  for (let row = 2; row <= sheet.getMaxRows(); row++) {
    sheet.seed(row, 3, { formula: '=A' + row + ' & " | " & B' + row, value: '' });
  }
}

function fresh() {
  world.sheet = createSheet(8);
  seedHeaders(world.sheet);
  world.parts = createSheet(8, 'Parts Requested');
  seedPartsSheet(world.parts);
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
  assertEqual(names.join('|'), 'Warehouse|Schedule|HR|Admin Tasks|Quality|Maintenance|Health and Safety', 'menu order places Schedule after Warehouse, Admin Tasks between HR and Quality, and Maintenance between Quality and Health and Safety');
  assert(menu.indexOf('href="/quality/"') !== -1, 'Quality menu link remains');
  assert(menu.indexOf('href="/warehouse/"') !== -1 && menu.indexOf('href="/hr/"') !== -1, 'Warehouse and HR links remain');
  assert(menu.indexOf('href="/health-safety/"') !== -1, 'Health and Safety link remains');
  assert(home.indexOf('>Report Fault<') !== -1 && home.indexOf('href="report-fault.html"') !== -1, 'Maintenance opens Report Fault');
  assert(home.indexOf('>Review Maintenance Requests<') !== -1 && home.indexOf('href="review-requests.html"') !== -1, 'Maintenance opens Review Maintenance Requests');
  assert(home.indexOf('>Order Parts<') !== -1 && home.indexOf('href="order-parts.html"') !== -1, 'Maintenance opens Order Parts');
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
  assert(review.indexOf('order_parts') === -1, 'parts ordering is not submitted from the review');
  assert(review.indexOf('order-parts.html?job=') !== -1, 'Order Parts Now opens the parts form for this job');
  assert(review.indexOf('Ordering parts is not available yet') === -1, 'Order Parts Now no longer shows the placeholder');
  const orderPage = fs.readFileSync(path.join(root, 'maintenance/order-parts.html'), 'utf8');
  const order = fs.readFileSync(path.join(root, 'maintenance/order-parts.js'), 'utf8');
  assert(orderPage.indexOf('order-parts.js') !== -1, 'order page loads its script');
  ['Select a maintenance job', 'Part Request', 'Name of Part', '+ Add Another Item', 'Current Orders Under This Job', 'Date Arrived', 'Received by', 'Checked by', 'As Described', 'Purchased Wrong Item', 'Received Wrong Item', 'Arrived Broken', 'parts-status-ok', 'parts-status-warn', 'parts-status-bad'].forEach(function (label) {
    assert(order.indexOf(label) !== -1, 'order form contains ' + label);
  });
  assert(order.indexOf('/.netlify/functions/orderParts') !== -1, 'order page posts to the Netlify function');
  assert(order.indexOf('J4PAN88') === -1 && order.indexOf('script.google.com') === -1, 'order page has no script credential or web app URL');
  assert(home.indexOf('>Complete Job<') !== -1 && home.indexOf('href="complete-job.html"') !== -1, 'Maintenance opens Complete Job');
  assert(home.indexOf('>Check Job Status<') !== -1 && home.indexOf('href="check-job-status.html"') !== -1, 'Maintenance opens Check Job Status');
  const statusPage = fs.readFileSync(path.join(root, 'maintenance/check-job-status.html'), 'utf8');
  const statusJs = fs.readFileSync(path.join(root, 'maintenance/check-job-status.js'), 'utf8');
  assert(statusPage.indexOf('check-job-status.js') !== -1, 'status page loads its script');
  ['Open Job', 'Awaiting Review', 'Awaiting Parts', 'Awaiting Completion', 'Completed', 'Cancelled', 'Hold', 'status-awaiting-review', 'status-awaiting-parts', 'status-awaiting-completion', 'status-completed', 'status-cancelled', 'status-hold', 'No parts recorded', 'No photographs have been added.'].forEach(function (label) {
    assert(statusJs.indexOf(label) !== -1, 'status page contains ' + label);
  });
  assert(statusJs.indexOf('/.netlify/functions/checkJobStatus') !== -1, 'status page posts to the Netlify function');
  assert(statusJs.indexOf('J4PAN88') === -1 && statusJs.indexOf('script.google.com') === -1, 'status page has no script credential or web app URL');
  assert(statusJs.indexOf('type="text"') === -1 && statusJs.indexOf('<textarea') === -1, 'job status is read only');
  assert(script.indexOf('var STATUS_COL = 28') !== -1, 'job status is read from column AB');
  const completePage = fs.readFileSync(path.join(root, 'maintenance/complete-job.html'), 'utf8');
  const complete = fs.readFileSync(path.join(root, 'maintenance/complete-job.js'), 'utf8');
  assert(completePage.indexOf('complete-job.js') !== -1, 'complete page loads its script');
  [
    'Please select job',
    'Ordered Parts',
    'Please enter the Permit to Work number',
    'Work Undertaken',
    'Work Outstanding',
    'Has the job been completed?',
    'Close Job',
    'Other',
    'Add Photos',
    'parts-status-ok',
    'parts-status-warn',
    'parts-status-bad',
    '>Show<',
    '>Hide<'
  ].forEach(function (label) {
    assert(complete.indexOf(label) !== -1, 'complete form contains ' + label);
  });
  assert(complete.indexOf('/.netlify/functions/completeJob') !== -1, 'complete page posts to the Netlify function');
  assert(complete.indexOf('/.netlify/functions/completeJobPhoto') !== -1, 'work photographs post to the upload function');
  assert(complete.indexOf('J4PAN88') === -1 && complete.indexOf('script.google.com') === -1, 'complete page has no script credential or web app URL');
  assert(complete.indexOf('data-save-receipt') === -1, 'complete job does not save receipts');
  assert(script.indexOf('var COMPLETE_LINK_COL = 27') !== -1, 'completion writes the work folder link in column AA');
  assert(script.indexOf('Work Undertaken') !== -1, 'completion creates a Work Undertaken folder');
  assert(script.indexOf("var SHEET_PARTS = 'Parts Requested'") !== -1, 'parts are written to Parts Requested');
  assert(review.indexOf('Find a maintenance request') === -1, 'the separate request search is not shown');
  assert(review.indexOf("OTHER = 'Other'") !== -1 && review.indexOf('departmentOther') !== -1, 'department can be Other with free text');
  assert(script.indexOf('var REVIEW_LAST_COL = 19') !== -1, 'review stops at column S');
  assert(script.indexOf('SHEET_HELPER') === -1 && script.indexOf('dropdownOwners_') !== -1, 'owners come from the Drop Downs list');
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
    owner: 'Jody R',
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
    owner: 'Jody R',
    department: 'Engineering',
    dueDate: '2026-11-17',
    permit: 'Yes',
    assessment: 'Line one\r\nLine two'
  }, ['Jody R']);
  assert(kept.ok, 'a complete review passes validation');
  assertEqual(kept.value.maintenanceId, 'MA0042', 'the maintenance id is normalised');
  assertEqual(kept.value.assessment, 'Line one\nLine two', 'assessment line breaks are preserved');
  assert(!core.validateReview(Object.assign({}, kept.value, { dueDate: '2026-02-31' }), ['Jody R']).ok, 'an impossible due date is rejected');
  assert(!core.validateReview(Object.assign({}, kept.value, { department: 'Warehouse' }), ['Jody R']).ok, 'an unknown department is rejected');
  assert(!core.validateReview(Object.assign({}, kept.value, { department: 'Other', departmentOther: ' ' }), ['Jody R']).ok, 'Other without a department is rejected');
  const otherDepartment = core.validateReview(Object.assign({}, kept.value, { department: 'Other', departmentOther: 'Night shift' }), ['Jody R']);
  assert(otherDepartment.ok, 'Other with a typed department passes validation');
  assertEqual(otherDepartment.value.department, 'Night shift', 'Other stores the typed department');
  assert(!core.validateReview(Object.assign({}, kept.value, { assessment: ' \n ' }), ['Jody R']).ok, 'a blank assessment is rejected');
  assert(!core.validateReview(Object.assign({}, kept.value, { owner: 'Nobody' }), ['Jody R']).ok, 'an owner who is not on the list is rejected');

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
  assertEqual(listed.owners.join('|'), 'Jody R|Zoe I', 'Drop Downs column A supplies owners from the second row');
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
  assertEqual(cell(3, 15), 'Jody R', 'column O stores the owner from Drop Downs');
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

  const changed = postReview({ owner: 'Zoe I' });
  assertEqual(changed.result, 'error', 'changing a saved review under the same submission does not write');
  assertEqual(cell(3, 15), 'Jody R', 'the saved owner stays in place');

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
  assertEqual(cell(3, 15), 'Jody R', 'the earlier review remains after the title changes');
  world.sheet.seed(3, 2, { value: 'MA0042 | Conveyor belt motor failure' });

  const updated = postReview({ submissionId: 'review-0004', owner: 'Zoe I', permit: 'No' });
  assertEqual(updated.result, 'success', 'a later review can update the same request');
  assertEqual(updated.maintenanceId, 'MA0042', 'the later review still does not create an id');
  assertEqual(cell(3, 15), 'Zoe I', 'column O is updated on the same row');
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
  seedRequest(3, 'MA0042', 'Conveyor belt motor failure');
  const other = postReview({ submissionId: 'review-other-01', department: 'Other', departmentOther: 'Night shift' });
  assertEqual(other.result, 'success', 'Other saves a typed department');
  assertEqual(cell(3, 16), 'Night shift', 'column P stores the typed department');
  assert(cell(3, 16) !== 'Other', 'the word Other is not saved');
  const blankOther = postReview({ submissionId: 'review-other-02', department: 'Other', departmentOther: ' ' });
  assertEqual(blankOther.result, 'error', 'Other without text is not saved');
  assertEqual(cell(3, 16), 'Night shift', 'a blank Other does not replace the saved department');
}

function partCell(row, col) {
  return world.parts.getRange(row, col).getValue();
}

function partFormula(row, col) {
  return world.parts.getRange(row, col).getFormula();
}

function seedPart(row, id, name, extra) {
  extra = extra || {};
  world.parts.seed(row, 1, { value: id });
  world.parts.seed(row, 2, { value: name });
  world.parts.seed(row, 3, { formula: '=A' + row + ' & " | " & B' + row, value: id + ' | ' + name });
  world.parts.seed(row, 4, { value: extra.purchaser || 'Jody R' });
  world.parts.seed(row, 5, { value: extra.supplier || 'Bearing Co' });
  if (extra.ordered) world.parts.seed(row, 6, { value: extra.ordered });
  if (extra.arrived) world.parts.seed(row, 7, { value: extra.arrived });
  if (extra.receivedBy) world.parts.seed(row, 8, { value: extra.receivedBy });
  if (extra.checkedBy) world.parts.seed(row, 9, { value: extra.checkedBy });
  if (extra.status) world.parts.seed(row, 10, { value: extra.status });
}

function postParts(extra) {
  const params = Object.assign({
    token: 'J4PAN88',
    action: 'parts_add',
    submissionId: 'parts-0001',
    label: 'MA0007 | Conveyor belt motor failure',
    maintenanceId: 'MA0007',
    items: JSON.stringify([{ purchaser: 'Jody R', name: 'Drive belt', supplier: 'Bearing Co', dateOrdered: '' }])
  }, extra || {});
  if (Array.isArray(params.items)) params.items = JSON.stringify(params.items);
  const out = context.doPost({
    parameter: params,
    postData: { type: 'application/x-www-form-urlencoded', contents: '' }
  });
  return JSON.parse(out.getContent());
}

function postReceipt(extra) {
  const params = Object.assign({
    token: 'J4PAN88',
    action: 'parts_receipt',
    submissionId: 'receipt-0001',
    maintenanceId: 'MA0007',
    partId: 'MA0007-P01',
    dateOrdered: '2026-11-01',
    dateArrived: '2026-11-17',
    receivedBy: 'Jody R',
    checkedBy: 'Zoe I',
    status: 'As Described'
  }, extra || {});
  const out = context.doPost({
    parameter: params,
    postData: { type: 'application/x-www-form-urlencoded', contents: '' }
  });
  return JSON.parse(out.getContent());
}

function testParts() {
  assert(core.partRowEmpty('', '', ''), 'a formula that displays nothing leaves the row empty');
  assert(!core.partRowEmpty('', '', 'MA0007-P01 | Motor'), 'a column C value occupies the row');
  assert(!core.partRowEmpty('MA0007-P01', '', ''), 'a part id occupies the row');
  assertEqual(core.nextPartIds([], 'MA0007', 1).ids[0], 'MA0007-P01', 'the first part is P01');
  assertEqual(core.nextPartIds(['MA0007-P01', 'MA0007-P04'], 'MA0007', 1).ids[0], 'MA0007-P05', 'numbering continues after the highest part');
  assertEqual(core.nextPartIds(['MA0007-P01'], 'MA0007', 2).ids.join('|'), 'MA0007-P02|MA0007-P03', 'several new parts get consecutive ids');
  assert(!core.validatePartsAdd({ submissionId: 'parts-0001', label: 'MA0007 | Job', maintenanceId: 'MA0007', items: [{ purchaser: 'Jody R', name: '', supplier: 'Bearing Co' }] }, ['Jody R']).ok, 'a part name is required');
  assert(!core.validatePartsAdd({ submissionId: 'parts-0001', label: 'MA0007 | Job', maintenanceId: 'MA0007', items: [{ purchaser: 'Nobody', name: 'Belt', supplier: 'Bearing Co' }] }, ['Jody R']).ok, 'a purchaser must be chosen from Drop Downs');
  assert(!core.validatePartsReceipt({ submissionId: 'receipt-0001', maintenanceId: 'MA0007', partId: 'MA0007-P01', status: 'Broken' }).ok === false || core.validatePartsReceipt({ submissionId: 'receipt-0001', maintenanceId: 'MA0007', partId: 'MA0008-P01', status: 'As Described' }).ok === false, 'a part from another job is rejected');
  assert(!core.validatePartsReceipt({ submissionId: 'receipt-0001', maintenanceId: 'MA0007', partId: 'MA0008-P01', dateOrdered: '', dateArrived: '', receivedBy: '', checkedBy: '', status: '' }).ok, 'a receipt for another job is rejected');

  fresh();
  seedRequest(3, 'MA0007', 'Conveyor belt motor failure');
  seedRequest(4, 'MA0008', 'Door sensor');
  const listed = context.doPost({
    parameter: { token: 'J4PAN88', action: 'parts_jobs' },
    postData: { type: 'application/x-www-form-urlencoded', contents: '' }
  });
  const jobs = JSON.parse(listed.getContent());
  assertEqual(jobs.result, 'ok', 'the parts job list loads');
  assert(jobs.requests.map(function (item) { return item.label; }).indexOf('MA0007 | Conveyor belt motor failure') !== -1, 'Submission Log column B from row 3 is listed');
  assertEqual(jobs.people.join('|'), 'Jody R|Zoe I', 'receipt names come from Drop Downs column A');

  const beforeLog = world.sheet.writeLog.length;
  const saved = postParts();
  assertEqual(saved.result, 'success', 'one part is saved');
  assertEqual(saved.parts[0].partId, 'MA0007-P01', 'the first part id uses the maintenance id');
  assertEqual(saved.parts[0].row, 2, 'the first empty parts row is used');
  assertEqual(partCell(2, 1), 'MA0007-P01', 'column A stores the part id');
  assertEqual(partCell(2, 2), 'Drive belt', 'column B stores the part name');
  assertEqual(partFormula(2, 3), '=A2 & " | " & B2', 'column C keeps its formula');
  assertEqual(partCell(2, 4), 'Jody R', 'column D stores the purchaser');
  assertEqual(partCell(2, 5), 'Bearing Co', 'column E stores the supplier');
  assertEqual(partCell(2, 6), '', 'date ordered can be left blank');
  assert(world.parts.writeLog.every(function (entry) { return entry.col !== 3; }), 'column C is not written');
  assertEqual(world.sheet.writeLog.length, beforeLog, 'adding parts does not change the Submission Log');
  assertEqual(partCell(2, 1) !== '' && partFormula(2, 3) !== '', true, 'the part id and formula are both present');

  const again = postParts();
  assertEqual(again.parts[0].partId, 'MA0007-P01', 'the same submission does not create another part');
  assertEqual(world.parts.writeLog.filter(function (entry) { return entry.col === 1; }).length, 1, 'a repeated submit does not write another part id');

  const changed = postParts({ items: [{ purchaser: 'Jody R', name: 'Different belt', supplier: 'Bearing Co', dateOrdered: '' }] });
  assertEqual(changed.result, 'error', 'changing a saved submission does not write again');
  assertEqual(partCell(2, 2), 'Drive belt', 'the saved part name stays in place');

  const several = postParts({
    submissionId: 'parts-0002',
    items: [
      { purchaser: 'Zoe I', name: 'Bearing', supplier: 'Motion Ltd', dateOrdered: '2026-11-17' },
      { purchaser: 'Jody R', name: 'Guard', supplier: 'Motion Ltd', dateOrdered: '' }
    ]
  });
  assertEqual(several.result, 'success', 'several parts can be saved together');
  assertEqual(several.parts.map(function (part) { return part.partId; }).join('|'), 'MA0007-P02|MA0007-P03', 'parts in one submission get consecutive ids');
  assertEqual(partCell(3, 1), 'MA0007-P02', 'the second part uses the next empty row');
  assertEqual(partCell(4, 1), 'MA0007-P03', 'the third part uses the following empty row');
  assert(partCell(3, 6) instanceof Date, 'date ordered is stored as a date');
  assertEqual(formatDate(partCell(3, 6), 'Europe/London', 'dd/MM/yyyy'), '17/11/2026', 'date ordered displays as DD/MM/YYYY');
  assertEqual(world.parts.getRange(3, 6).getNumberFormat(), 'dd/MM/yyyy', 'date ordered is not stored as text');
  assertEqual(partFormula(3, 3), '=A3 & " | " & B3', 'each new row keeps its own column C formula');
  assertEqual(partCell(4, 6), '', 'a blank date ordered is not filled in for the other part');

  fresh();
  seedRequest(3, 'MA0007', 'Conveyor belt motor failure');
  seedPart(2, 'MA0007-P01', 'Motor');
  seedPart(3, 'MA0007-P04', 'Sensor', { purchaser: 'Zoe I', supplier: 'Sensor Co' });
  world.parts.seed(2, 11, { value: 'Leave this cell' });
  const continued = postParts({ submissionId: 'parts-0003', items: [{ purchaser: 'Jody R', name: 'Belt', supplier: 'Bearing Co', dateOrdered: '' }] });
  assertEqual(continued.parts[0].partId, 'MA0007-P05', 'reopening the job continues after P04');
  assertEqual(continued.parts[0].row, 4, 'the part is written on the first genuinely empty row');
  assertEqual(partCell(2, 1), 'MA0007-P01', 'the existing P01 row is not overwritten');
  assertEqual(partCell(3, 1), 'MA0007-P04', 'the existing P04 row is not overwritten');
  assertEqual(partCell(2, 11), 'Leave this cell', 'cells outside the parts columns stay untouched');
  assertEqual(partFormula(2, 3), '=A2 & " | " & B2', 'the existing column C formula stays intact');

  const orders = JSON.parse(context.doPost({
    parameter: { token: 'J4PAN88', action: 'parts_orders', maintenanceId: 'MA0007' },
    postData: { type: 'application/x-www-form-urlencoded', contents: '' }
  }).getContent());
  assertEqual(orders.orders.map(function (order) { return order.partId; }).join('|'), 'MA0007-P01|MA0007-P04|MA0007-P05', 'current orders are the parts for this job');
  world.parts.seed(5, 1, { value: 'MA0008-P01' });
  world.parts.seed(5, 2, { value: 'Other job part' });
  world.parts.seed(5, 3, { formula: '=A5 & " | " & B5', value: 'MA0008-P01 | Other job part' });
  const onlyThisJob = JSON.parse(context.doPost({
    parameter: { token: 'J4PAN88', action: 'parts_orders', maintenanceId: 'MA0007' },
    postData: { type: 'application/x-www-form-urlencoded', contents: '' }
  }).getContent());
  assert(onlyThisJob.orders.map(function (order) { return order.partId; }).indexOf('MA0008-P01') === -1, 'parts for another job are not listed');

  world.parts.seed(6, 1, { value: '' });
  world.parts.seed(6, 2, { value: 'Listed from column C' });
  world.parts.seed(6, 3, { formula: '=A6 & " | " & B6', value: 'MA0007-P09 | Listed from column C' });
  const fromColumnC = JSON.parse(context.doPost({
    parameter: { token: 'J4PAN88', action: 'parts_orders', maintenanceId: 'MA0007' },
    postData: { type: 'application/x-www-form-urlencoded', contents: '' }
  }).getContent());
  assert(fromColumnC.orders.some(function (order) { return order.partId === 'MA0007-P09' && order.name === 'Listed from column C'; }), 'column C identifies a part when it shows the part id');

  const orderedOn = new Date(Date.UTC(2026, 10, 1, 12, 0, 0));
  fresh();
  seedRequest(3, 'MA0007', 'Conveyor belt motor failure');
  seedPart(2, 'MA0007-P01', 'Motor', { ordered: orderedOn, purchaser: 'Jody R', supplier: 'Bearing Co' });
  seedPart(3, 'MA0007-P02', 'Guard', { purchaser: 'Zoe I', supplier: 'Motion Ltd', status: 'As Described' });
  const formulaBefore = partFormula(2, 3);
  const receipt = postReceipt();
  assertEqual(receipt.result, 'success', 'a receipt is saved on the matching part');
  assertEqual(partCell(2, 1), 'MA0007-P01', 'the receipt does not change column A');
  assertEqual(partCell(2, 2), 'Motor', 'the receipt does not change the part name');
  assertEqual(partFormula(2, 3), formulaBefore, 'the receipt does not change column C');
  assertEqual(partCell(2, 4), 'Jody R', 'the receipt does not change the purchaser');
  assertEqual(partCell(2, 5), 'Bearing Co', 'the receipt does not change the supplier');
  assertEqual(formatDate(partCell(2, 6), 'Europe/London', 'dd/MM/yyyy'), '01/11/2026', 'an unchanged date ordered stays in place');
  assertEqual(formatDate(partCell(2, 7), 'Europe/London', 'dd/MM/yyyy'), '17/11/2026', 'date arrived is saved');
  assertEqual(partCell(2, 8), 'Jody R', 'received by is saved');
  assertEqual(partCell(2, 9), 'Zoe I', 'checked by is saved');
  assertEqual(partCell(2, 10), 'As Described', 'receipt status is saved');
  assertEqual(partCell(3, 2), 'Guard', 'the other part is not modified');
  assertEqual(partCell(3, 10), 'As Described', 'the other part keeps its own status');

  const movedDate = postReceipt({ submissionId: 'receipt-0002', dateOrdered: '2026-11-05', dateArrived: '2026-11-17', status: 'Received Wrong Item' });
  assertEqual(movedDate.result, 'success', 'date ordered can be amended');
  assertEqual(formatDate(partCell(2, 6), 'Europe/London', 'dd/MM/yyyy'), '05/11/2026', 'the amended date ordered is saved');
  assertEqual(partCell(2, 4), 'Jody R', 'amending the date does not clear the purchaser');
  assertEqual(partCell(2, 10), 'Received Wrong Item', 'the receipt status is updated on the same part');

  ['Purchased Wrong Item', 'Arrived Broken'].forEach(function (status) {
    const updated = postReceipt({ submissionId: 'receipt-' + status.replace(/\s/g, '-'), status: status, dateOrdered: '2026-11-05', dateArrived: '2026-11-17' });
    assertEqual(updated.result, 'success', status + ' can be saved');
    assertEqual(partCell(2, 10), status, status + ' is written on the selected part');
  });
  const rejected = postReceipt({ submissionId: 'receipt-bad', receivedBy: 'Nobody', status: 'As Described' });
  assertEqual(rejected.result, 'error', 'a person who is not on Drop Downs is rejected');
  assertEqual(partCell(2, 8), 'Jody R', 'a rejected receipt does not replace received by');

  const badPurchaser = postParts({ submissionId: 'parts-purchaser', items: [{ purchaser: 'Nobody', name: 'Belt', supplier: 'Bearing Co', dateOrdered: '' }] });
  assertEqual(badPurchaser.result, 'error', 'a purchaser who is not on Drop Downs is rejected');
  const missingName = postParts({ submissionId: 'parts-blank', items: [{ purchaser: 'Jody R', name: ' ', supplier: 'Bearing Co', dateOrdered: '' }] });
  assertEqual(missingName.result, 'error', 'a blank part name is not saved');
  const missingJob = postParts({ submissionId: 'parts-missing', label: 'MA0099 | Missing', maintenanceId: 'MA0099' });
  assertEqual(missingJob.result, 'error', 'an unknown maintenance job is not given parts');

  world.locked = true;
  const busy = postParts({ submissionId: 'parts-busy' });
  world.locked = false;
  assertEqual(busy.result, 'error', 'a busy parts save does not write');

  world.parts.seed(2, 3, { formula: '=A2 & " | " & B2', value: 'MA0007-P01 | Motor' });
  const shown = JSON.parse(context.doPost({
    parameter: { token: 'J4PAN88', action: 'parts_orders', maintenanceId: 'MA0007' },
    postData: { type: 'application/x-www-form-urlencoded', contents: '' }
  }).getContent());
  assert(shown.orders.some(function (order) { return order.partId === 'MA0007-P01' && order.name === 'Motor'; }), 'the selected job shows its existing part');
}

function seedJobFolder(id) {
  world.drive.nodes.push({
    id: 'job-' + id,
    name: id,
    parentId: '1AMvZj3XOytmfdiWSIT-EQ7mH8FVQsBxs',
    mimeType: 'application/vnd.google-apps.folder'
  });
}

function foldersNamed(name) {
  return world.drive.nodes.filter(function (node) {
    return node.name === name && node.mimeType === 'application/vnd.google-apps.folder';
  });
}

function postComplete(extra) {
  const params = Object.assign({
    token: 'J4PAN88',
    action: 'complete_prepare',
    submissionId: 'complete-0001',
    label: 'MA0007 | Conveyor belt motor failure',
    maintenanceId: 'MA0007',
    permit: 'PTW-15',
    workUndertaken: 'Replaced the motor',
    workOutstanding: 'Paint the guard',
    completed: 'No',
    outcome: 'Close Job',
    outcomeOther: '',
    photoNames: []
  }, extra || {});
  if (Array.isArray(params.photoNames)) params.photoNames = JSON.stringify(params.photoNames);
  const out = context.doPost({
    parameter: params,
    postData: { type: 'application/x-www-form-urlencoded', contents: '' }
  });
  return JSON.parse(out.getContent());
}

function postCompletePhoto(submissionId, fileName) {
  const out = context.doPost({
    parameter: {
      token: 'J4PAN88',
      action: 'complete_photo',
      submissionId: submissionId,
      fileName: fileName,
      mimeType: 'image/jpeg',
      imageBase64: Buffer.from('photo-' + fileName).toString('base64')
    },
    postData: { type: 'application/x-www-form-urlencoded', contents: '' }
  });
  return JSON.parse(out.getContent());
}

function testComplete() {
  const kept = core.validateComplete({
    submissionId: 'complete-0001',
    label: 'MA0007 | Conveyor belt motor failure',
    maintenanceId: 'ma0007',
    permit: ' PTW-15 ',
    workUndertaken: 'Line one\r\nLine two',
    workOutstanding: 'Paint the guard',
    completed: 'No',
    outcome: 'Close Job',
    photoNames: []
  });
  assert(kept.ok, 'a job can be closed while work is outstanding and completion is No');
  assertEqual(kept.value.maintenanceId, 'MA0007', 'the completion id is normalised');
  assertEqual(kept.value.workUndertaken, 'Line one\nLine two', 'work undertaken keeps line breaks');
  assertEqual(kept.value.permit, 'PTW-15', 'the permit number is trimmed');
  assert(!core.validateComplete(Object.assign({}, kept.value, { completed: '' })).ok, 'completion Yes or No is required');
  assert(!core.validateComplete(Object.assign({}, kept.value, { outcome: 'Other', outcomeOther: ' ' })).ok, 'Other needs an explanation');
  const other = core.validateComplete(Object.assign({}, kept.value, { outcome: 'Other', outcomeOther: 'Waiting for a part' }));
  assert(other.ok && other.value.outcome === 'Waiting for a part', 'Other stores the explanation');
  assert(!core.validateComplete(Object.assign({}, kept.value, { photoNames: ['fault-01.jpg'] })).ok, 'fault photographs are not accepted as work photographs');

  fresh();
  seedRequest(2, 'MA0006', 'Hidden on row 2');
  seedRequest(3, 'MA0007', 'Conveyor belt motor failure');
  seedRequest(4, 'MA0008', 'Door sensor');
  world.sheet.seed(3, 14, { value: 'Review owner' });
  world.sheet.seed(3, 20, { value: 'Leave column T' });
  world.sheet.seed(3, 21, { value: 'Leave column U' });
  seedPart(2, 'MA0007-P01', 'Drive belt', { status: 'As Described', receivedBy: 'Jody R' });
  seedPart(3, 'MA0007-P02', 'Guard', { status: 'Arrived Broken' });
  seedPart(4, 'MA0007-P03', 'Sensor', { status: 'Purchased Wrong Item' });
  seedPart(5, 'MA0008-P01', 'Other job');
  seedJobFolder('MA0007');
  const partBefore = JSON.stringify(world.parts.getRange(2, 1, 4, 10).getValues());
  const folderBefore = formula(3, 13);

  const listed = JSON.parse(context.doPost({
    parameter: { token: 'J4PAN88', action: 'complete_jobs' },
    postData: { type: 'application/x-www-form-urlencoded', contents: '' }
  }).getContent());
  assertEqual(listed.result, 'ok', 'the completion job list loads');
  assert(listed.requests.map(function (item) { return item.label; }).indexOf('MA0007 | Conveyor belt motor failure') !== -1, 'Submission Log column B from row 3 is listed');
  assert(listed.requests.map(function (item) { return item.label; }).indexOf('MA0006 | Hidden on row 2') === -1, 'row 2 is not offered as a job');

  const detail = JSON.parse(context.doPost({
    parameter: {
      token: 'J4PAN88',
      action: 'complete_detail',
      maintenanceId: 'MA0007',
      label: 'MA0007 | Conveyor belt motor failure'
    },
    postData: { type: 'application/x-www-form-urlencoded', contents: '' }
  }).getContent());
  assertEqual(detail.orders.map(function (order) { return order.partId + ':' + order.status; }).join('|'), 'MA0007-P01:As Described|MA0007-P02:Arrived Broken|MA0007-P03:Purchased Wrong Item', 'ordered parts for this job are loaded with their receipt status');
  assert(detail.orders.every(function (order) { return order.partId.indexOf('MA0008') !== 0; }), 'parts for another job are not included');

  const saved = postComplete({ workUndertaken: 'Line one\r\nLine two' });
  assertEqual(saved.result, 'success', 'a job is updated without creating a new maintenance ID');
  assertEqual(saved.maintenanceId, 'MA0007', 'the existing maintenance ID is used');
  assertEqual(saved.row, 3, 'the matching Submission Log row is updated');
  assertEqual(cell(3, 22), 'PTW-15', 'column V stores the permit number');
  assertEqual(cell(3, 23), 'Line one\nLine two', 'column W stores the work undertaken');
  assertEqual(cell(3, 24), 'Paint the guard', 'column X stores the work outstanding');
  assertEqual(cell(3, 25), 'No', 'column Y stores No when the user says the job is not completed');
  assertEqual(cell(3, 26), 'Close Job', 'column Z stores Close Job');
  const work = foldersNamed('MA0007 | Work Undertaken');
  assertEqual(work.length, 1, 'one Work Undertaken folder is created');
  assertEqual(work[0].parentId, 'job-MA0007', 'the work folder is inside the existing job folder');
  assertEqual(foldersNamed('MA0007').length, 1, 'the primary job folder is not duplicated');
  assertEqual(foldersNamed('MA0007 | Requests').length, 0, 'completion does not create a Requests folder');
  assertEqual(formula(3, 27), '=HYPERLINK("https://drive.google.com/drive/folders/' + work[0].id + '","MA0007 | Work Undertaken")', 'column AA links to the Work Undertaken folder');
  assertEqual(cell(3, 1), 'MA0007', 'column A is not changed');
  assertEqual(cell(3, 2), 'MA0007 | Conveyor belt motor failure', 'column B is not changed');
  assertEqual(formula(3, 13), folderBefore, 'the original folder link is not changed');
  assertEqual(cell(3, 14), 'Review owner', 'review columns are not changed');
  assertEqual(cell(3, 20), 'Leave column T', 'column T is not changed');
  assertEqual(cell(3, 21), 'Leave column U', 'column U is not changed');
  assertEqual(cell(4, 22), '', 'another job row is not updated');
  assertEqual(JSON.stringify(world.parts.getRange(2, 1, 4, 10).getValues()), partBefore, 'ordered parts and receipts are not changed');
  assertEqual(idRows().length, 3, 'completion does not add a Submission Log row');

  const again = postComplete({ workUndertaken: 'Line one\r\nLine two' });
  assertEqual(again.result, 'success', 'the same completion can be submitted again');
  assertEqual(foldersNamed('MA0007 | Work Undertaken').length, 1, 'a repeated submit reuses the Work Undertaken folder');

  const changed = postComplete({ workUndertaken: 'Different work' });
  assertEqual(changed.result, 'error', 'changing a saved completion does not write again');
  assertEqual(cell(3, 23), 'Line one\nLine two', 'the saved work undertaken stays in place');

  const updated = postComplete({ submissionId: 'complete-0002', workUndertaken: 'Adjusted the belt', completed: 'Yes', outcome: 'Other', outcomeOther: 'Handed to the next shift' });
  assertEqual(updated.result, 'success', 'a later update can change the same job');
  assertEqual(cell(3, 23), 'Adjusted the belt', 'column W is updated on the same row');
  assertEqual(cell(3, 25), 'Yes', 'column Y can be changed to Yes');
  assertEqual(cell(3, 26), 'Handed to the next shift', 'column Z stores the Other explanation');
  assert(cell(3, 26) !== 'Other', 'the word Other is not saved');
  assertEqual(foldersNamed('MA0007 | Work Undertaken').length, 1, 'a later update reuses the Work Undertaken folder');

  const blankOther = postComplete({ submissionId: 'complete-0003', outcome: 'Other', outcomeOther: ' ' });
  assertEqual(blankOther.result, 'error', 'Other without an explanation is not saved');
  assertEqual(cell(3, 26), 'Handed to the next shift', 'a blank Other does not replace column Z');

  world.sheet.seed(3, 23, { formula: '=A3', value: 'MA0007' });
  const formulaCell = postComplete({ submissionId: 'complete-formula' });
  assertEqual(formulaCell.result, 'error', 'a formula in the completion columns blocks the save');
  assertEqual(formula(3, 23), '=A3', 'the formula is not overwritten');
  assertEqual(cell(3, 22), 'PTW-15', 'earlier completion columns stay as they were');
  world.sheet.seed(3, 23, { formula: '', value: 'Adjusted the belt' });

  world.sheet.failOnCol = 24;
  const failed = postComplete({ submissionId: 'complete-fail', workOutstanding: 'Still to paint' });
  world.sheet.failOnCol = 0;
  assertEqual(failed.result, 'error', 'a failed write does not report success');
  assertEqual(cell(3, 24), 'Paint the guard', 'a failed write rolls back the work outstanding');
  assertEqual(cell(3, 21), 'Leave column U', 'a failed write does not touch column U');

  fresh();
  seedRequest(3, 'MA0007', 'Conveyor belt motor failure');
  seedJobFolder('MA0007');
  const prepared = postComplete({ photoNames: ['work-01.jpg', 'work-02.jpg'] });
  assertEqual(prepared.result, 'pending', 'photographs are uploaded before the row is saved');
  assertEqual(cell(3, 22), '', 'the row is not written before the photographs finish');
  assertEqual(foldersNamed('MA0007 | Work Undertaken').length, 1, 'the work folder exists before the photographs are uploaded');
  const firstPhoto = postCompletePhoto('complete-0001', 'work-01.jpg');
  assertEqual(firstPhoto.result, 'ok', 'the first photograph is uploaded');
  const early = postComplete({ action: 'complete_commit', photoNames: ['work-01.jpg', 'work-02.jpg'] });
  assertEqual(early.result, 'error', 'the job is not saved while a photograph is missing');
  assertEqual(cell(3, 22), '', 'a missing photograph leaves the row blank');
  const secondPhoto = postCompletePhoto('complete-0001', 'work-02.jpg');
  assertEqual(secondPhoto.result, 'ok', 'the second photograph is uploaded');
  const committed = postComplete({ action: 'complete_commit', photoNames: ['work-01.jpg', 'work-02.jpg'] });
  assertEqual(committed.result, 'success', 'the job is saved after both photographs upload');
  const workFolder = foldersNamed('MA0007 | Work Undertaken')[0];
  ['work-01.jpg', 'work-02.jpg'].forEach(function (name) {
    const file = world.drive.nodes.filter(function (node) { return node.name === name; })[0];
    assert(file && file.parentId === workFolder.id, name + ' is stored in the Work Undertaken folder');
  });
  assertEqual(formula(3, 27).indexOf(workFolder.id) !== -1, true, 'column AA points at the folder that holds the photographs');
  const retryFolder = postComplete({ photoNames: ['work-01.jpg', 'work-02.jpg'] });
  assertEqual(retryFolder.result, 'success', 'retrying the saved job does not upload again');
  assertEqual(foldersNamed('MA0007 | Work Undertaken').length, 1, 'a retry does not create another Work Undertaken folder');

  fresh();
  seedRequest(3, 'MA0007', 'Conveyor belt motor failure');
  const missingFolder = postComplete();
  assertEqual(missingFolder.result, 'error', 'a missing job folder stops the save');
  assert(missingFolder.message.indexOf('was not found') !== -1, 'the missing folder is explained');
  assertEqual(cell(3, 22), '', 'nothing is written when the job folder is missing');
  assertEqual(foldersNamed('MA0007').length, 0, 'completion does not create the primary job folder');

  seedJobFolder('MA0007');
  world.drive.nodes.push({
    id: 'job-MA0007-copy',
    name: 'MA0007',
    parentId: '1AMvZj3XOytmfdiWSIT-EQ7mH8FVQsBxs',
    mimeType: 'application/vnd.google-apps.folder'
  });
  const duplicateFolder = postComplete({ submissionId: 'complete-dup-folder' });
  assertEqual(duplicateFolder.result, 'error', 'two job folders with the same name stop the save');
  assertEqual(foldersNamed('MA0007 | Work Undertaken').length, 0, 'a work folder is not created when the job folder is ambiguous');
  assertEqual(cell(3, 22), '', 'an ambiguous job folder writes nothing');

  const wrong = postComplete({ submissionId: 'complete-wrong', label: 'MA0008 | Door sensor', maintenanceId: 'MA0008' });
  assertEqual(wrong.result, 'error', 'a job that is not on the log is not updated');
  assertEqual(cell(3, 1), 'MA0007', 'the wrong job does not replace the selected row');
}

function statusPost(action, extra) {
  const params = Object.assign({ token: 'J4PAN88', action: action }, extra || {});
  return JSON.parse(context.doPost({
    parameter: params,
    postData: { type: 'application/x-www-form-urlencoded', contents: '' }
  }).getContent());
}

function testStatus() {
  fresh();
  seedRequest(2, 'MA0006', 'Hidden on row 2');
  seedRequest(3, 'MA0007', 'Conveyor belt motor failure');
  seedRequest(4, 'MA0008', 'Door sensor');
  world.sheet.seed(3, 3, { value: '15/06/2026' });
  world.sheet.seed(3, 5, { value: 'Jody R' });
  world.sheet.seed(3, 6, { value: 'Bottling Line' });
  world.sheet.seed(3, 7, { value: 'Cimec Filler' });
  world.sheet.seed(3, 8, { value: 'High Priority' });
  world.sheet.seed(3, 10, { value: 'Line one\nLine two' });
  world.sheet.seed(3, 13, { formula: '=HYPERLINK("https://drive.google.com/drive/folders/job-MA0007","MA0007")', value: 'MA0007' });
  world.sheet.seed(3, 15, { value: 'Aaron S' });
  world.sheet.seed(3, 17, { value: new Date(Date.UTC(2026, 10, 17, 12, 0, 0)) });
  world.sheet.seed(3, 19, { value: 'Guard the line\nwhile the belt is off' });
  world.sheet.seed(3, 20, { formula: '=A3', value: '', display: 'MA0007-P01 Drive belt' });
  world.sheet.seed(3, 22, { value: 'PTW-15' });
  world.sheet.seed(3, 23, { value: 'Replaced the motor' });
  world.sheet.seed(3, 24, { value: 'Paint the guard' });
  world.sheet.seed(3, 25, { value: 'No' });
  world.sheet.seed(3, 27, { formula: '=HYPERLINK("https://drive.google.com/drive/folders/work-MA0007","MA0007 | Work Undertaken")', value: 'MA0007 | Work Undertaken' });
  world.sheet.seed(3, 28, { value: 'Awaiting Review' });
  world.sheet.seed(4, 28, { formula: '="Completed"', value: '', display: 'Completed' });
  world.sheet.seed(5, 2, { value: '   ' });
  const parent = '1AMvZj3XOytmfdiWSIT-EQ7mH8FVQsBxs';
  world.drive.nodes.push(
    { id: 'job-MA0007', name: 'MA0007', parentId: parent, mimeType: 'application/vnd.google-apps.folder' },
    { id: 'req-MA0007', name: 'MA0007 | Requests', parentId: 'job-MA0007', mimeType: 'application/vnd.google-apps.folder' },
    { id: 'img-1', name: 'fault-01.jpg', parentId: 'req-MA0007', mimeType: 'image/jpeg' },
    { id: 'notes', name: 'notes.pdf', parentId: 'req-MA0007', mimeType: 'application/pdf' },
    { id: 'work-MA0007', name: 'MA0007 | Work Undertaken', parentId: 'job-MA0007', mimeType: 'application/vnd.google-apps.folder' },
    { id: 'img-3', name: 'work-01.jpg', parentId: 'work-MA0007', mimeType: 'image/jpeg' },
    { id: 'img-secret', name: 'secret.jpg', parentId: 'job-MA0007', mimeType: 'image/jpeg' }
  );
  const beforeWrites = world.sheet.writeLog.length;
  const beforeNodes = world.drive.nodes.length;
  const listed = statusPost('status_jobs');
  assertEqual(listed.result, 'ok', 'the job status list loads');
  assertEqual(listed.jobs.map(function (job) { return job.label + '=' + job.status; }).join('|'), 'MA0007 | Conveyor belt motor failure=Awaiting Review|MA0008 | Door sensor=Completed', 'titles and statuses come from the same rows');
  assert(listed.jobs.every(function (job) { return job.row >= 3; }), 'the list starts at row 3');
  assertEqual(world.sheet.writeLog.length, beforeWrites, 'loading job status does not write the sheet');
  assertEqual(world.drive.nodes.length, beforeNodes, 'loading job status does not change Drive');

  const detail = statusPost('status_detail', { row: 3, label: 'MA0007 | Conveyor belt motor failure', maintenanceId: 'MA0007' });
  assertEqual(detail.result, 'ok', 'opening a job loads its row');
  assertEqual(detail.label, 'MA0007 | Conveyor belt motor failure', 'the job title is column B');
  assertEqual(detail.date, '15/06/2026', 'the fault date is shown in UK format');
  assertEqual(detail.reporter, 'Jody R', 'the reporter is column E');
  assertEqual(detail.lineArea, 'Bottling Line', 'the line is column F');
  assertEqual(detail.equipment, 'Cimec Filler', 'the machine is column G');
  assertEqual(detail.priority, 'High Priority', 'the priority is column H');
  assertEqual(detail.description, 'Line one\nLine two', 'the description keeps line breaks');
  assertEqual(detail.owner, 'Aaron S', 'the owner is column O');
  assertEqual(detail.dueDate, '17/11/2026', 'the due date is shown in UK format');
  assertEqual(detail.assessment, 'Guard the line\nwhile the belt is off', 'the assessment keeps line breaks');
  assertEqual(detail.parts, 'MA0007-P01 Drive belt', 'parts ordered shows the calculated summary');
  assert(detail.parts.indexOf('=A3') === -1, 'the parts formula is not shown');
  assertEqual(detail.permit, 'PTW-15', 'the permit number is column V');
  assertEqual(detail.workUndertaken, 'Replaced the motor', 'work undertaken is column W');
  assertEqual(detail.workOutstanding, 'Paint the guard', 'work outstanding is column X');
  assertEqual(detail.completed, 'No', 'job completion is column Y');
  assertEqual(detail.status, 'Awaiting Review', 'the detail status matches column AB');
  assertEqual(detail.requestsPhotos.map(function (photo) { return photo.id; }).join('|'), 'img-1', 'fault photographs come from the Requests folder');
  assertEqual(detail.workPhotos.map(function (photo) { return photo.id; }).join('|'), 'img-3', 'work photographs come from the Work Undertaken folder');
  assertEqual(detail.requestsFolderUrl, 'https://drive.google.com/drive/folders/job-MA0007', 'the original folder link is kept as a fallback');
  assertEqual(detail.workFolderUrl, 'https://drive.google.com/drive/folders/work-MA0007', 'the work folder link is kept as a fallback');
  assertEqual(world.sheet.writeLog.length, beforeWrites, 'opening a job does not write the sheet');
  assertEqual(world.drive.nodes.length, beforeNodes, 'opening a job does not create folders');
  assertEqual(cell(3, 28), 'Awaiting Review', 'reading status does not change column AB');

  const photo = statusPost('status_photo', { row: 3, label: 'MA0007 | Conveyor belt motor failure', maintenanceId: 'MA0007', folderKind: 'requests', fileId: 'img-1', size: 'thumb' });
  assertEqual(photo.result, 'ok', 'a fault photograph can be retrieved');
  assertEqual(Buffer.from(photo.imageBase64, 'base64').toString(), 'jpeg-img-1', 'the photograph bytes come from Drive');
  assertEqual(photo.mimeType, 'image/jpeg', 'the photograph is returned as an image');
  const hidden = statusPost('status_photo', { row: 3, label: 'MA0007 | Conveyor belt motor failure', maintenanceId: 'MA0007', folderKind: 'requests', fileId: 'img-secret', size: 'full' });
  assertEqual(hidden.result, 'error', 'a photograph outside the Requests folder is not returned');
  const workPhoto = statusPost('status_photo', { row: 3, label: 'MA0007 | Conveyor belt motor failure', maintenanceId: 'MA0007', folderKind: 'work', fileId: 'img-3', size: 'full' });
  assertEqual(workPhoto.result, 'ok', 'a work photograph can be enlarged');
  assertEqual(world.drive.nodes.length, beforeNodes, 'reading photographs does not change Drive');

  const other = statusPost('status_detail', { row: 4, label: 'MA0008 | Door sensor', maintenanceId: 'MA0008' });
  assertEqual(other.status, 'Completed', 'a status formula is shown by its result');
  assertEqual(other.parts, '', 'a blank parts summary is empty');
  assertEqual(other.requestsPhotos.length, 0, 'a job without photographs has an empty gallery');
  assertEqual(other.date, '01/06/2026', 'a blank extra date is not invented');
  const wrong = statusPost('status_detail', { row: 4, label: 'MA0007 | Conveyor belt motor failure', maintenanceId: 'MA0007' });
  assertEqual(wrong.row, 3, 'the job is found again when the hinted row no longer matches');
  assertEqual(formula(3, 13).indexOf('job-MA0007') !== -1, true, 'the original folder formula stays in place');
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

  const partsHandler = require('../netlify/functions/orderParts').handler;
  const partsGet = await partsHandler({ httpMethod: 'GET', body: '' });
  assertEqual(partsGet.statusCode, 405, 'parts GET is rejected');
  const partsBad = await partsHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'parts_add', submissionId: 'parts-0001', label: 'MA0007 | Job', maintenanceId: 'MA0007', items: [] })
  });
  assertEqual(partsBad.statusCode, 400, 'an empty parts order is rejected before the script');
  const partsWrong = await partsHandler({ httpMethod: 'POST', body: JSON.stringify({ action: 'parts_delete' }) });
  assertEqual(partsWrong.statusCode, 400, 'an unknown parts action is rejected');

  const statusHandler = require('../netlify/functions/checkJobStatus').handler;
  const statusGet = await statusHandler({ httpMethod: 'GET', body: '' });
  assertEqual(statusGet.statusCode, 405, 'status GET is rejected');
  const statusBad = await statusHandler({ httpMethod: 'POST', body: JSON.stringify({ action: 'status_detail', label: '', row: 3 }) });
  assertEqual(statusBad.statusCode, 400, 'a status detail without a job is rejected');
  const statusWrong = await statusHandler({ httpMethod: 'POST', body: JSON.stringify({ action: 'status_save' }) });
  assertEqual(statusWrong.statusCode, 400, 'an unknown status action is rejected');

  const completeHandler = require('../netlify/functions/completeJob').handler;
  const completeGet = await completeHandler({ httpMethod: 'GET', body: '' });
  assertEqual(completeGet.statusCode, 405, 'complete GET is rejected');
  const completeBad = await completeHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'complete_prepare', submissionId: 'complete-0001', label: 'MA0007 | Job', maintenanceId: 'MA0007' })
  });
  assertEqual(completeBad.statusCode, 400, 'an incomplete job update is rejected before the script');
  const completeWrong = await completeHandler({ httpMethod: 'POST', body: JSON.stringify({ action: 'complete_delete' }) });
  assertEqual(completeWrong.statusCode, 400, 'an unknown completion action is rejected');

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
  testParts();
  testComplete();
  testStatus();
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
