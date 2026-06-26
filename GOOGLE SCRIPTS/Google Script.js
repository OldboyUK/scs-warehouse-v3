/** SCS Warehouse - Unified Router **/
/** Deploy manually in Google Apps Script; set the /exec URL in Netlify env (APPS_SCRIPT_URL). */

/** ====== CONFIG ====== **/
const API_TOKEN = 'J4PAN88';

// Main spreadsheet
const SSID_MAIN     = '1nlXghFbza3hblt80Oegu81hpWGv2C4Ax3iPVA43XsrA';
const SSID_DISPATCH = '1nlXghFbza3hblt80Oegu81hpWGv2C4Ax3iPVA43XsrA';

const SHEET_PALLET_ENTRY        = 'PALLET ENTRY';
const SHEET_DISPATCH            = 'PALLET DISPATCH';
const SHEET_LOCATION_ASSIGNMENT = 'LOCATION ASSIGNMENT';

/** ====== MAIN ENTRY POINT ====== **/
function doPost(e) {
  try {
    const p = (e && e.parameter) ? e.parameter : {};
    const token = (p.token || '').trim();

    if (token !== API_TOKEN) {
      return json({ result: 'error', message: 'Unauthorized' });
    }

    const action = (p.action || '').trim().toLowerCase();

    // Priority order - be more specific
    if (action === 'location_assignment')               return handleLocationAssignment(p);
    if (action === 'goods_in_3p' || isGoods3P(p))       return handleGoods3P(p);
    if (action === 'dispatch'    || isDispatch(p))      return handleDispatch(p);
    if (action === 'pallet_entry'|| isPalletEntry(p))   return handlePalletEntry(p);

    return json({ result: 'error', message: 'Unknown action: ' + action });

  } catch (err) {
    return json({ result: 'error', message: String(err) });
  }
}

/** ====== ROUTE HELPERS ====== **/
function isGoods3P(p)       { return !!(p.helper || p.company || p.product); }
function isDispatch(p)      { return !!(p.pallet && p.date && p.time && !p.location); }
function isPalletEntry(p)   { return !!(p.code && p.run && p.units); }

/** ====== HANDLERS ====== **/

// GOODS IN (3P) — writes to PALLET ENTRY (same sheet as COUNTS)
function handleGoods3P(p) {
  const pallet  = (p.pallet  || '').trim();
  const units   = (p.units   || '').trim();
  const format  = (p.format  || '').trim();
  let   bbe     = (p.bbe     || '').trim();
  const duty    = (p.duty    || '').trim();
  const runCode = (p.run     || '').trim();

  if (!pallet || !units || !runCode || !format) {
    return json({ result: 'error', message: 'Missing required fields' });
  }

  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const dateStr = Utilities.formatDate(now, tz, 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(now, tz, 'HH:mm:ss');

  const ss = openSpreadsheet(SSID_MAIN);
  const shMain = ss.getSheetByName(SHEET_PALLET_ENTRY);
  if (!shMain) return json({ result: 'error', message: 'PALLET ENTRY sheet not found' });

  const nextRow = findNextDataRow(shMain);
  writeGoods3PToPalletEntry(shMain, nextRow, pallet, runCode, units, dateStr, timeStr, format, bbe, duty);

  return json({ result: 'success' });
}

// DISPATCH
function handleDispatch(p) {
  const pallet = (p.pallet || '').trim();
  const date   = (p.date   || '').trim();
  const time   = (p.time   || '').trim();

  if (!pallet || !date || !time) return json({ result: 'error', message: 'Missing fields' });

  const ss = openSpreadsheet(SSID_DISPATCH);
  const sh = ss.getSheetByName(SHEET_DISPATCH);
  if (!sh) return json({ result: 'error', message: 'Dispatch sheet not found' });

  sh.appendRow([pallet, date, time]);
  return json({ result: 'success' });
}

// PALLET ENTRY (COUNTS)
function handlePalletEntry(p) {
  const code  = (p.code  || '').trim();
  const run   = (p.run   || '').trim();
  const units = (p.units || '').trim();
  const date  = (p.date  || '').trim();
  const time  = (p.time  || '').trim();

  if (!code || !run || !units) {
    return json({ result: 'error', message: 'Missing fields (code, run, units)' });
  }

  const ss = openSpreadsheet(SSID_MAIN);
  const sh = ss.getSheetByName(SHEET_PALLET_ENTRY);
  
  if (!sh) return json({ result: 'error', message: 'PALLET ENTRY sheet not found' });

  const columnAValues = sh.getRange("A:A").getValues();
  let lastRow = 0;
  for (let i = columnAValues.length - 1; i >= 0; i--) {
    if (columnAValues[i][0] !== "") {
      lastRow = i + 1;
      break;
    }
  }
  const nextRow = lastRow + 1;

  sh.getRange(nextRow, 1, 1, 5).setValues([[code, run, units, date, time]]);

  return json({ result: 'success' });
}

// LOCATION ASSIGNMENT
function handleLocationAssignment(p) {
  const pallet   = (p.pallet   || '').trim();
  const location = (p.location || '').trim();
  const date     = (p.date     || '').trim();
  const time     = (p.time     || '').trim();

  if (!pallet || !location) {
    return json({ result: 'error', message: 'Missing pallet or location' });
  }

  const ss = openSpreadsheet(SSID_MAIN);
  const sh = ss.getSheetByName('LOCATION ASSIGNMENT');
  
  if (!sh) return json({ result: 'error', message: 'LOCATION ASSIGNMENT sheet not found' });

  const lastRow = sh.getLastRow();
  const nextRow = lastRow + 1;

  sh.getRange(nextRow, 1, 1, 4).setValues([[pallet, location, date, time]]);

  return json({ result: 'success' });
}

/** ====== HELPERS ====== **/
function findNextDataRow(sh) {
  const columnAValues = sh.getRange('A:A').getValues();
  let lastRow = 0;
  for (let i = columnAValues.length - 1; i >= 0; i--) {
    if (columnAValues[i][0] !== '') {
      lastRow = i + 1;
      break;
    }
  }
  return lastRow + 1;
}

function writeGoods3PToPalletEntry(sh, nextRow, pallet, runCode, units, dateStr, timeStr, format, bbe, duty) {
  sh.getRange(nextRow, 1).setValue(pallet);
  sh.getRange(nextRow, 2).setValue(runCode);
  sh.getRange(nextRow, 3).setValue(Number(units));
  sh.getRange(nextRow, 4).setValue(dateStr);
  sh.getRange(nextRow, 5).setValue(timeStr);
  // F, G, I: leave VLOOKUP formulas untouched
  sh.getRange(nextRow, 8).clearContent();
  sh.getRange(nextRow, 8).setValue(format);
  sh.getRange(nextRow, 10).setValue(bbe);
  sh.getRange(nextRow, 11).setValue(duty);
}

function openSpreadsheet(id) {
  return SpreadsheetApp.openById(id);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}