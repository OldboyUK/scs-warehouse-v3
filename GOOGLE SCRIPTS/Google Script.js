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
const SHEET_STAGING             = 'STAGING';
const SHEET_PRODUCT_DB_3PT      = 'PRODUCT DATABASE (3PT)';

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
    if (action === 'add_third_party_product')            return handleAddThirdPartyProduct(p);
    if (action === 'staging')                            return handleStaging(p);
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

// ADVANCED OPTIONS — Add Third Party Product → PRODUCT DATABASE (3PT)
function handleAddThirdPartyProduct(p) {
  const customer        = (p.customer        || '').trim();
  const productName     = (p.productName     || '').trim();
  const recipeIteration = (p.recipeIteration || '').trim();
  const liquidType      = (p.liquidType      || '').trim();
  const abv             = (p.abv             || '').trim();

  if (!customer || !productName || !recipeIteration || !liquidType || !abv) {
    return json({ result: 'error', message: 'Missing required fields' });
  }

  const recipeNum = Number(recipeIteration);
  const abvNum    = Number(abv);
  if (isNaN(recipeNum) || recipeNum < 1) {
    return json({ result: 'error', message: 'Invalid recipe iteration' });
  }
  if (isNaN(abvNum) || abvNum < 0 || abvNum > 100) {
    return json({ result: 'error', message: 'ABV must be between 0 and 100' });
  }

  const ss = openSpreadsheet(SSID_MAIN);
  const sh = ss.getSheetByName(SHEET_PRODUCT_DB_3PT);
  if (!sh) return json({ result: 'error', message: 'Sheet not found: ' + SHEET_PRODUCT_DB_3PT });

  const row = findFirstBlankDisplayRowInColumnA(sh, 2);
  if (!row) return json({ result: 'error', message: 'No available row found in column A' });

  const tz = Session.getScriptTimeZone();
  const dateStr = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy');

  // Column A has formulas — do not write to A; only write specified cells
  sh.getRange(row, 2).setValue(customer);     // B
  sh.getRange(row, 4).setValue(productName);   // D
  sh.getRange(row, 10).setValue(liquidType);  // J
  sh.getRange(row, 11).setValue(abvNum);       // K
  sh.getRange(row, 32).setValue(dateStr);      // AF

  return json({ result: 'success', row: row });
}

// DISPATCH — A=reference, B=pallet, C=time, D=date
function handleDispatch(p) {
  const reference = (p.reference || p.collectionId || 'No Reference').trim() || 'No Reference';
  const pallet    = normalizePalletId(p.pallet || '');
  const date      = (p.date || '').trim();
  const time      = (p.time || '').trim();

  if (!pallet || !date || !time) return json({ result: 'error', message: 'Missing fields' });

  const ss = openSpreadsheet(SSID_DISPATCH);
  const sh = ss.getSheetByName(SHEET_DISPATCH);
  if (!sh) return json({ result: 'error', message: 'Dispatch sheet not found' });

  const nextRow = sh.getLastRow() + 1;

  sh.getRange(nextRow, 1).setValue(reference);

  // Must format as text BEFORE setValue — setValues/appendRow coerce to number and drop leading zeros
  const palletCell = sh.getRange(nextRow, 2);
  palletCell.setNumberFormat('@');
  palletCell.setValue(String(pallet));

  sh.getRange(nextRow, 3).setValue(time);
  sh.getRange(nextRow, 4).setValue(date);

  return json({ result: 'success' });
}

// STAGING — write columns A–G only (H is a sheet formula / VLOOKUP)
function handleStaging(p) {
  const collectionId = (p.collectionId || '').trim();
  const pallet       = normalizePalletId(p.pallet || '');
  const run          = (p.run          || '').trim();
  const company      = (p.company      || '').trim();
  const product      = (p.product      || '').trim();
  const format       = (p.format       || '').trim();
  const qty          = (p.qty          || '').trim();

  if (!collectionId || !pallet || !run || !qty) {
    return json({ result: 'error', message: 'Missing staging fields' });
  }

  const ss = openSpreadsheet(SSID_MAIN);
  const sh = ss.getSheetByName(SHEET_STAGING);
  if (!sh) return json({ result: 'error', message: 'STAGING sheet not found' });

  const nextRow = findNextDataRow(sh);

  // Write pallet as text first so Sheets does not drop a leading zero
  sh.getRange(nextRow, 1).setValue(collectionId);
  const palletCell = sh.getRange(nextRow, 2);
  palletCell.setNumberFormat('@');
  palletCell.setValue(String(pallet));
  sh.getRange(nextRow, 3, nextRow, 7).setValues([[
    run,
    company,
    product,
    format,
    Number(qty)
  ]]);

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

  // Always write A:E. Do not touch F:K or M (lookups / existing sheet behaviour).
  sh.getRange(nextRow, 1, 1, 5).setValues([[code, run, units, date, time]]);

  // Edit Pallet re-configuration only: L = comment, N = boolean TRUE
  const reconfigRaw = String(p.reconfiguration == null ? '' : p.reconfiguration).trim().toLowerCase();
  const isReconfiguration = reconfigRaw === 'true' || reconfigRaw === '1' || reconfigRaw === 'yes';
  if (isReconfiguration) {
    const comment = p.comment == null ? '' : String(p.comment);
    sh.getRange(nextRow, 12).setValue(comment); // column L
    sh.getRange(nextRow, 14).setValue(true);    // column N
  }

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
// Pallet IDs are always 15 digits; pad leading zeros if Sheets dropped them
function normalizePalletId(id) {
  const s = String(id || '').trim();
  if (/^\d+$/.test(s) && s.length > 0 && s.length < 15) return s.padStart(15, '0');
  return s;
}

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

function findFirstBlankDisplayRowInColumnA(sh, startRow) {
  startRow = startRow || 2;
  const maxRows = sh.getMaxRows();
  const numRows = maxRows - startRow + 1;
  if (numRows <= 0) return null;

  const displayValues = sh.getRange(startRow, 1, numRows, 1).getDisplayValues();
  for (let i = 0; i < displayValues.length; i++) {
    if ((displayValues[i][0] || '').trim() === '') {
      return startRow + i;
    }
  }
  return null;
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