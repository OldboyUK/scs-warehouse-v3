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
const SHEET_INGREDIENTS_ENTRY   = 'PALLET ENTRY [INGREDIENTS]';
const SHEET_PACKAGING_ENTRY     = 'PALLET ENTRY [PACKAGING]';
const SHEET_GID_STOCK           = 1879287780;
const SKIPPED_BBE               = '01/01/3000';

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
    if (action === 'packaging_entry')                    return handlePackagingEntry(p);
    if (action === 'ingredients_entry')                  return handleIngredientsEntry(p);
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

// INBOUND INGREDIENTS — writes to PALLET ENTRY [INGREDIENTS]
function handleIngredientsEntry(p) {
  const pallet       = (p.pallet || '').trim();
  const customer     = (p.customer || '').trim();
  const customerCode = (p.customerCode || '').trim();
  const product      = (p.product || '').trim();
  const helper       = p.helper == null ? '' : String(p.helper).trim();
  const stockCodeF   = p.stockCodeF == null ? '' : String(p.stockCodeF).trim();
  const group        = String(p.ingredientGroup || p.group || '').trim();
  const lotCode      = (p.lotCode || '').trim();
  const abv          = (p.abv || '').trim();
  const bbe          = (p.bbe || '').trim();
  const containerType = (p.containerType || '').trim();
  const unitType     = (p.unitType || '').trim();
  const value        = (p.value || '').trim();
  const quantity     = (p.quantity || '').trim();
  const duty         = (p.duty || '').trim();
  const comments     = p.comments == null ? '' : String(p.comments);
  const username     = (p.username || p.user || '').trim();

  const manualRaw = String(p.manualEntry == null ? '' : p.manualEntry).trim().toLowerCase();
  const isManual = manualRaw === 'true' || manualRaw === '1' || manualRaw === 'yes';

  if (!pallet || !customer || !customerCode || !product || !bbe || !containerType || !unitType || !value || !quantity || !username) {
    return json({ result: 'error', message: 'Missing required fields' });
  }
  if (isManual && !group) {
    return json({ result: 'error', message: 'Missing group' });
  }

  if (!(pallet === 'NO_BARCODE' || /^\d{15}$/.test(pallet))) {
    return json({ result: 'error', message: 'Invalid pallet' });
  }

  const bbeMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(bbe);
  if (!bbeMatch) {
    return json({ result: 'error', message: 'BBE must be a date in DD/MM/YYYY format' });
  }
  const bbeDay = Number(bbeMatch[1]);
  const bbeMonth = Number(bbeMatch[2]);
  const bbeYear = Number(bbeMatch[3]);
  const bbeDate = new Date(bbeYear, bbeMonth - 1, bbeDay);
  if (bbeDate.getFullYear() !== bbeYear || bbeDate.getMonth() + 1 !== bbeMonth || bbeDate.getDate() !== bbeDay) {
    return json({ result: 'error', message: 'BBE must be a valid date' });
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  bbeDate.setHours(0, 0, 0, 0);
  if (bbeDate < today) {
    return json({ result: 'error', message: 'BBE must be today or later' });
  }

  let abvOut = '';
  if (abv !== '') {
    const abvNum = Number(abv);
    if (isNaN(abvNum) || abvNum < 0 || abvNum > 100) {
      return json({ result: 'error', message: 'ABV must be between 0 and 100' });
    }
    abvOut = abvNum;
  }

  const containerAllowed = ['Bag', 'Box', 'Carton', 'Bottle', 'Vial', 'Jerrycan', 'Drum', 'Pouch', 'Barrel', 'Keg', 'IBC'];
  if (containerAllowed.indexOf(containerType) === -1) {
    return json({ result: 'error', message: 'Invalid container type' });
  }

  const unitAllowed = ['Kg', 'g', 'L', 'ml'];
  if (unitAllowed.indexOf(unitType) === -1) {
    return json({ result: 'error', message: 'Invalid unit type' });
  }

  const valueNum = Number(value);
  if (isNaN(valueNum) || valueNum <= 0) {
    return json({ result: 'error', message: 'Value must be numeric and greater than zero' });
  }

  let unitOut = unitType;
  let valueOut = valueNum;
  if (unitType === 'g') {
    unitOut = 'Kg';
    valueOut = valueNum / 1000;
  } else if (unitType === 'ml') {
    unitOut = 'L';
    valueOut = valueNum / 1000;
  }

  let quantityNum = Number(quantity);
  if (containerType === 'IBC') {
    quantityNum = 1;
  } else if (isNaN(quantityNum) || quantityNum <= 0) {
    return json({ result: 'error', message: 'Quantity must be numeric and greater than zero' });
  }

  const dutyAllowed = ['Duty Suspended', 'Duty Paid', "Don't Know"];
  if (duty !== '' && dutyAllowed.indexOf(duty) === -1) {
    return json({ result: 'error', message: 'Invalid duty status' });
  }

  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const dateStr = Utilities.formatDate(now, tz, 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(now, tz, 'HH:mm:ss');

  const ss = openSpreadsheet(SSID_MAIN);
  const sh = ss.getSheetByName(SHEET_INGREDIENTS_ENTRY);
  if (!sh) return json({ result: 'error', message: 'PALLET ENTRY [INGREDIENTS] sheet not found' });

  const nextRow = Math.max(2, findNextDataRow(sh));
  const stockCode = isManual ? '' : stockCodeF;
  const groupOut = group;
  const bbeOut = bbe === SKIPPED_BBE ? '' : bbe;

  const palletCell = sh.getRange(nextRow, 1);
  palletCell.setNumberFormat('@');
  palletCell.setValue(String(pallet));

  // Do not write B (Stock ID) or P (Total Quantity); spreadsheet formulas own those cells.
  const lotCell = sh.getRange(nextRow, 9);
  lotCell.setNumberFormat('@');
  lotCell.setValue(String(lotCode));

  sh.getRange(nextRow, 3, 1, 5).setValues([[
    customer,
    customerCode,
    product,
    isManual ? '' : helper,
    stockCode
  ]]);

  const groupCell = sh.getRange(nextRow, 8);
  groupCell.setNumberFormat('@');
  groupCell.setValue(String(groupOut));

  sh.getRange(nextRow, 10, 1, 6).setValues([[
    abvOut,
    bbeOut,
    containerType,
    unitOut,
    valueOut,
    quantityNum
  ]]);

  sh.getRange(nextRow, 17, 1, 5).setValues([[
    duty,
    comments,
    username,
    dateStr,
    timeStr
  ]]);

  return json({ result: 'success' });
}

// INBOUND PACKAGING — writes to PALLET ENTRY [PACKAGING]
function handlePackagingEntry(p) {
  const pallet       = (p.pallet || '').trim();
  const customer     = (p.customer || '').trim();
  const customerCode = (p.customerCode || '').trim();
  const productType  = (p.productType || '').trim();
  const size         = (p.size || '').trim();
  const colour       = (p.colour || '').trim();
  const type         = (p.type || '').trim();
  const packageType  = (p.packageType || '').trim();
  const unitsPerPackage = (p.unitsPerPackage || '').trim();
  const packageQty   = (p.packageQty || '').trim();
  const comments     = p.comments == null ? '' : String(p.comments);
  const username     = (p.username || p.user || '').trim();

  if (!pallet || !customer || !customerCode || !productType || !packageType || !unitsPerPackage || !packageQty || !username) {
    return json({ result: 'error', message: 'Missing required fields' });
  }

  if (!(pallet === 'NO_BARCODE' || /^\d{15}$/.test(pallet))) {
    return json({ result: 'error', message: 'Invalid pallet' });
  }

  const packageAllowed = ['Box', 'Bundle', 'Bag', 'Individual Units'];
  if (packageAllowed.indexOf(packageType) === -1) {
    return json({ result: 'error', message: 'Invalid package type' });
  }

  let unitsPerPackageNum = Number(unitsPerPackage);
  let packageQtyNum = Number(packageQty);
  if (packageType === 'Individual Units') {
    unitsPerPackageNum = 1;
  } else if (isNaN(unitsPerPackageNum) || unitsPerPackageNum <= 0) {
    return json({ result: 'error', message: 'Units per package must be numeric and greater than zero' });
  }
  if (isNaN(packageQtyNum) || packageQtyNum <= 0) {
    return json({ result: 'error', message: 'Package quantity must be numeric and greater than zero' });
  }

  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const dateStr = Utilities.formatDate(now, tz, 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(now, tz, 'HH:mm:ss');

  const ss = openSpreadsheet(SSID_MAIN);
  const sh = ss.getSheetByName(SHEET_PACKAGING_ENTRY);
  if (!sh) return json({ result: 'error', message: 'PALLET ENTRY [PACKAGING] sheet not found' });

  const nextRow = Math.max(2, findNextDataRow(sh));

  const palletCell = sh.getRange(nextRow, 1);
  palletCell.setNumberFormat('@');
  palletCell.setValue(String(pallet));

  // Do not write B (Stock ID), I (Stock Code), or M (Total Qty); spreadsheet formulas own those cells.
  sh.getRange(nextRow, 3, 1, 6).setValues([[
    customer,
    customerCode,
    productType,
    size,
    colour,
    type
  ]]);

  sh.getRange(nextRow, 10, 1, 3).setValues([[
    packageType,
    unitsPerPackageNum,
    packageQtyNum
  ]]);

  sh.getRange(nextRow, 14, 1, 4).setValues([[
    comments,
    username,
    dateStr,
    timeStr
  ]]);

  return json({ result: 'success' });
}

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
  const leftover = getLeftoverStockBlockingDispatch(ss, pallet);
  if (leftover.error) {
    return json({ result: 'error', message: leftover.error });
  }
  if (leftover.lines && leftover.lines.length) {
    return json({ result: 'error', message: formatDispatchBlockedMessage(leftover.lines) });
  }

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

// STAGING — write A–H only (I location / J pick status are sheet formulas)
function handleStaging(p) {
  const collectionId = (p.collectionId || '').trim();
  const pickRef      = (p.pickRef      || '').trim();
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
  const pickRefCell = sh.getRange(nextRow, 2);
  pickRefCell.setNumberFormat('@');
  pickRefCell.setValue(pickRef);
  const palletCell = sh.getRange(nextRow, 3);
  palletCell.setNumberFormat('@');
  palletCell.setValue(String(pallet));
  sh.getRange(nextRow, 4, 1, 5).setValues([[
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
  const code    = (p.code    || '').trim();
  const run     = (p.run     || '').trim();
  const units   = (p.units   || '').trim();
  const pickRef = (p.pickRef || '').trim();
  const date    = (p.date    || '').trim();
  const time    = (p.time    || '').trim();

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

  // Always write A:E. Do not touch F:K or N (lookups / existing sheet behaviour).
  sh.getRange(nextRow, 1, 1, 5).setValues([[code, run, units, date, time]]);

  // Picking only: column P holds Pick Ref so STAGING can match the task, not the pallet ID.
  // Leave blank for Counts / Edit Pallet / other callers that do not send pickRef.
  if (pickRef) {
    const pickRefCell = sh.getRange(nextRow, 16);
    pickRefCell.setNumberFormat('@');
    pickRefCell.setValue(pickRef);
  }

  // Edit Pallet re-configuration only: L = comment, M = user, O = boolean TRUE
  const reconfigRaw = String(p.reconfiguration == null ? '' : p.reconfiguration).trim().toLowerCase();
  const isReconfiguration = reconfigRaw === 'true' || reconfigRaw === '1' || reconfigRaw === 'yes';
  if (isReconfiguration) {
    const comment = p.comment == null ? '' : String(p.comment);
    const username = (p.username || p.user || '').trim();
    sh.getRange(nextRow, 12).setValue(comment);  // column L — comments
    sh.getRange(nextRow, 13).setValue(username); // column M — current user
    sh.getRange(nextRow, 15).setValue(true);     // column O — reconfiguration
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

function getSheetByGid(ss, gid) {
  const id = Number(gid);
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === id) return sheets[i];
  }
  return null;
}

function getStockSheet(ss) {
  const byGid = getSheetByGid(ss, SHEET_GID_STOCK);
  if (byGid) return byGid;
  const names = ['STOCK COUNT', 'STOCK', 'PALLET CONFIGURATION', 'Pallet Configuration', 'PALLET CONFIG'];
  for (let i = 0; i < names.length; i++) {
    const sh = ss.getSheetByName(names[i]);
    if (sh) return sh;
  }
  return null;
}

function headerIndex(headers, testers) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').toUpperCase().replace(/\s+/g, ' ').trim();
    for (let j = 0; j < testers.length; j++) {
      if (testers[j](h)) return i;
    }
  }
  return -1;
}

function parseSheetUnits(value) {
  const n = parseInt(String(value || '').replace(/,/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

function getRemainingStockLines(ss, palletId) {
  const sh = getStockSheet(ss);
  if (!sh) {
    return { error: 'Cannot dispatch pallet. Unable to verify remaining stock: stock sheet not found.' };
  }

  const values = sh.getDataRange().getDisplayValues();
  if (!values.length) return { lines: [] };

  const headers = values[0];
  let palletCol = headerIndex(headers, [function (h) { return h.indexOf('PALLET') !== -1; }]);
  let runCol = headerIndex(headers, [function (h) { return h.indexOf('RUN') !== -1; }]);
  let availCol = headerIndex(headers, [function (h) { return h.indexOf('AVAILABLE') !== -1; }]);
  let unitsCol = headerIndex(headers, [function (h) {
    return h === 'UNITS' || (h.indexOf('UNIT') !== -1 && h.indexOf('TOTAL') === -1);
  }]);

  if (palletCol < 0) palletCol = 0;
  if (runCol < 0) runCol = 1;
  if (availCol < 0) availCol = unitsCol >= 0 ? unitsCol : (headers.length >= 7 ? 6 : 5);

  const target = normalizePalletId(palletId);
  const lines = [];
  for (let i = 1; i < values.length; i++) {
    const id = normalizePalletId(values[i][palletCol]);
    if (id !== target) continue;
    const units = parseSheetUnits(values[i][availCol]);
    if (units <= 0) continue;
    const runCode = String(values[i][runCol] || '').trim();
    if (!runCode) continue;
    lines.push({ runCode: runCode, units: units });
  }
  return { lines: lines };
}

function getStagedRunCodesForPallet(ss, palletId) {
  const sh = ss.getSheetByName(SHEET_STAGING);
  if (!sh) return [];
  const values = sh.getDataRange().getDisplayValues();
  const target = normalizePalletId(palletId);
  const runs = [];
  for (let i = 1; i < values.length; i++) {
    const id = normalizePalletId(values[i][2]);
    if (id !== target) continue;
    const run = String(values[i][3] || '').trim().toUpperCase();
    if (run) runs.push(run);
  }
  return runs;
}

function leftoverStockForDispatch(remainingLines, stagedRuns) {
  if (!stagedRuns || !stagedRuns.length) return [];
  const staged = {};
  for (let i = 0; i < stagedRuns.length; i++) {
    staged[String(stagedRuns[i] || '').trim().toUpperCase()] = true;
  }
  const leftover = [];
  for (let i = 0; i < remainingLines.length; i++) {
    const key = String(remainingLines[i].runCode || '').trim().toUpperCase();
    if (!staged[key]) leftover.push(remainingLines[i]);
  }
  return leftover;
}

function formatDispatchBlockedMessage(leftover) {
  const details = leftover.map(function (line) {
    return line.runCode + ' — ' + line.units + ' units remaining.';
  }).join('\n');
  return 'Cannot dispatch pallet\nThis pallet still contains stock that has not been picked or transferred.\n' + details + '\nThis stock must be picked or transferred to another pallet before dispatch.';
}

function getLeftoverStockBlockingDispatch(ss, palletId) {
  const remaining = getRemainingStockLines(ss, palletId);
  if (remaining.error) return remaining;
  const stagedRuns = getStagedRunCodesForPallet(ss, palletId);
  return { lines: leftoverStockForDispatch(remaining.lines || [], stagedRuns) };
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