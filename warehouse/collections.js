const app = document.getElementById('app');

const COLLECTIONS_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=810040978&single=true&output=csv';
const DISPATCH_HISTORY_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=848481035&single=true&output=csv';

const PALLET_ENTRY_URL = `${window.location.origin}/.netlify/functions/submit`;
const LOCATION_URL = `${window.location.origin}/.netlify/functions/assignLocation`;
const STAGING_URL = `${window.location.origin}/.netlify/functions/staging`;

const PICKING_COLS = {
  collectionRef: 0,
  pickRef: 1,
  palletId: 2,
  runCode: 3,
  company: 4,
  product: 5,
  format: 6,
  totalUnits: 7,
  pickQty: 8,
  location: 9,
  pickStatus: 10
};

let allCollectionRows = [];
let dispatchedPalletIds = new Set();
let currentCollection = null;
let pickMode = false;

/** Active pick session for the currently scanned collection line */
let activePick = null;

/* =========================
   CSV parsing (multiline-safe)
========================= */
function splitCSVRows(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      if (current.trim()) rows.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) rows.push(current);
  return rows;
}

function parseCSVRow(line) {
  const out = [];
  let cur = '';
  let q = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { q = false; }
      } else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') { q = true; }
      else cur += ch;
    }
  }

  out.push(cur);
  return out;
}

function cleanCSVField(value) {
  return String(value || '').trim().replace(/^"|"$/g, '');
}

function isHeaderRow(fields, headerLabel) {
  return cleanCSVField(fields[0]).toUpperCase().replace(/\s+/g, ' ').includes(headerLabel);
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function formatDateTimeForSheets() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return {
    date: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  };
}

function parseUnits(value) {
  const n = parseInt(String(value || '').replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function getUniqueCollectionIds() {
  const ids = new Set();
  for (const row of allCollectionRows) {
    if (row.collectionId) ids.add(row.collectionId);
  }
  return Array.from(ids).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function statusLabel(status) {
  switch (status) {
    case 'dispatched': return 'Dispatched';
    case 'staged': return 'Staged';
    case 'partial': return 'Partially Picked';
    default: return 'Pending';
  }
}

function isPalletDone(pallet) {
  return pallet.status === 'dispatched' || pallet.status === 'staged' || pallet.status === 'partial';
}

function applyHistoryStatus(pallets) {
  for (const p of pallets) {
    if (dispatchedPalletIds.has(p.palletId)) {
      p.status = 'dispatched';
    }
  }
}

function buildCollection(collectionId) {
  const rows = allCollectionRows.filter(r => r.collectionId === collectionId);
  if (!rows.length) return null;

  const pallets = rows.map(r => ({
    key: r.pickRef || `${r.collectionId}|${r.palletId}|${r.runCode}`,
    pickRef: r.pickRef,
    palletId: r.palletId,
    runCode: r.runCode,
    company: r.company,
    product: r.product,
    format: r.format,
    availableUnits: r.availableUnits,
    unitsRequired: r.unitsRequired,
    location: r.location,
    status: 'pending',
    pickedQty: 0,
    pickedPalletId: ''
  }));

  applyHistoryStatus(pallets);

  return {
    id: collectionId,
    company: rows[0].company || '',
    pallets
  };
}

function progressText(collection) {
  const total = collection.pallets.length;
  const done = collection.pallets.filter(isPalletDone).length;
  return `${done} / ${total} picked`;
}

function isCollectionComplete(collection) {
  return collection.pallets.length > 0 && collection.pallets.every(isPalletDone);
}

function palletConfigForDisplay(pallet) {
  const parts = [pallet.product, pallet.format].filter(Boolean);
  return parts.join(' — ') || pallet.runCode || '-';
}

function pickQtyForDisplay(pallet) {
  return `${pallet.unitsRequired}/${pallet.availableUnits}`;
}

function tableHTML(collection) {
  const rows = collection.pallets.map(p => `
    <tr>
      <td>${escapeHTML(statusLabel(p.status))}</td>
      <td>${escapeHTML(p.palletId)}</td>
      <td class="pre-line">${escapeHTML(palletConfigForDisplay(p))}</td>
      <td class="pick-qty">${escapeHTML(pickQtyForDisplay(p))}</td>
      <td>${escapeHTML(p.location || '-')}</td>
    </tr>
  `).join('');

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Pallet ID</th>
            <th>Pallet Configuration</th>
            <th>Pick</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function summaryHTML(collection) {
  return UI.summaryCard([
    { label: 'Collection ID', value: escapeHTML(collection.id) },
    { label: 'Customer', value: escapeHTML(collection.company || '-') },
    { label: 'Progress', value: escapeHTML(progressText(collection)) }
  ]);
}

function showLoading(message) {
  app.innerHTML = `<p class="status">${escapeHTML(message || 'Loading…')}</p>`;
}

function showSelectStep() {
  pickMode = false;
  currentCollection = null;
  activePick = null;

  const ids = getUniqueCollectionIds();
  if (!ids.length) {
    app.innerHTML = '<p class="status">No Collection Requests found.</p>';
    return;
  }

  app.innerHTML = `
    <label for="collectionSelect">Select Collection ID:</label>
    <select id="collectionSelect">
      <option value="">-- Choose a collection --</option>
      ${ids.map(id => `<option value="${escapeHTML(id)}">${escapeHTML(id)}</option>`).join('')}
    </select>
    <div class="actions mt-3">
      <button class="btn btn-primary" onclick="openSelectedCollection()">Open Collection</button>
    </div>
  `;
}

function openSelectedCollection() {
  const id = (document.getElementById('collectionSelect').value || '').trim();
  if (!id) {
    alert('Please choose a Collection ID.');
    return;
  }
  openCollection(id);
}

function openCollection(collectionId) {
  currentCollection = buildCollection(collectionId);
  if (!currentCollection) {
    alert('Collection not found.');
    return;
  }

  if (isCollectionComplete(currentCollection)) {
    showCompleteScreen();
    return;
  }

  pickMode = false;
  activePick = null;
  showOverviewStep();
}

function showOverviewStep() {
  if (!currentCollection) return;

  app.innerHTML = `
    ${summaryHTML(currentCollection)}
    ${tableHTML(currentCollection)}
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showSelectStep()">Change Collection</button>
      <button class="btn btn-success" onclick="startPick()">Pick Items</button>
    </div>
  `;
}

function startPick() {
  if (!currentCollection || isCollectionComplete(currentCollection)) {
    showCompleteScreen();
    return;
  }
  pickMode = true;
  activePick = null;
  showPickStep();
}

function showPickStep(message, isError) {
  if (!currentCollection) return;

  const msgClass = isError ? 'text-error' : '';

  app.innerHTML = `
    ${summaryHTML(currentCollection)}
    ${tableHTML(currentCollection)}
    <div id="dispatchMessage" class="status ${msgClass}">${message ? escapeHTML(message) : 'Scan or enter a pallet barcode.'}</div>
    <label for="palletInput">Pallet Identifier (15-digit code):</label>
    <input id="palletInput" maxlength="15" placeholder="Scan or type 15 digits" />
    <div class="actions mt-3">
      <button class="btn btn-success" onclick="confirmScanPallet()">Confirm Pallet</button>
      ${UI.cameraButton('Use Camera', 'startCameraScan()')}
    </div>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="stopPick()">Back to Collection</button>
    </div>
  `;

  const input = document.getElementById('palletInput');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmScanPallet();
  });

  function focusPalletInput() {
    const el = document.getElementById('palletInput');
    if (!el) return;
    el.focus();
    if (el.select) el.select();
  }

  setTimeout(focusPalletInput, 0);
  setTimeout(focusPalletInput, 120);
}

function stopPick() {
  pickMode = false;
  activePick = null;
  showOverviewStep();
}

function confirmScanPallet() {
  const val = (document.getElementById('palletInput').value || '').trim();
  if (val.length !== 15 || isNaN(val)) {
    showPickStep('Please enter a valid 15-digit number.', true);
    return;
  }
  processPalletScan(val);
}

function processPalletScan(palletId) {
  if (!currentCollection) return;

  const matches = currentCollection.pallets.filter(p => p.palletId === palletId);
  if (!matches.length) {
    showPickStep('This pallet is not part of this Collection.', true);
    return;
  }

  const pending = matches.filter(p => !isPalletDone(p));
  if (!pending.length) {
    showPickStep('This pallet has already been completed.', true);
    return;
  }

  if (pending.length === 1) {
    beginQuantityStep(pending[0]);
    return;
  }

  showLineSelectStep(pending);
}

function showLineSelectStep(lines) {
  app.innerHTML = `
    ${summaryHTML(currentCollection)}
    <p class="status">Multiple items on this pallet. Select the line to pick:</p>
    <label for="lineSelect">Item</label>
    <select id="lineSelect">
      ${lines.map((p, i) => `
        <option value="${i}">
          ${escapeHTML(p.runCode)} — ${escapeHTML(p.product)} (${escapeHTML(String(p.unitsRequired))} req / ${escapeHTML(String(p.availableUnits))} avail)
        </option>
      `).join('')}
    </select>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showPickStep()">Back</button>
      <button class="btn btn-primary" onclick="confirmLineSelect()">Next</button>
    </div>
  `;
  window._lineSelectOptions = lines;
}

function confirmLineSelect() {
  const lines = window._lineSelectOptions || [];
  const idx = parseInt(document.getElementById('lineSelect').value, 10);
  const line = lines[idx];
  if (!line) {
    alert('Please select an item.');
    return;
  }
  beginQuantityStep(line);
}

function beginQuantityStep(pallet) {
  activePick = {
    line: pallet,
    originalPalletId: pallet.palletId,
    pickedQty: pallet.unitsRequired,
    remainingQty: 0,
    needsSplit: false,
    splitWritten: false,
    originalKeeps: null, // 'picked' | 'remaining' — which stock keeps the original pallet ID
    splitScanTarget: 'picked', // 'picked' | 'remaining' — which stock the current scan is for
    newPalletId: '',
    pickedPalletId: pallet.palletId,
    locationBase: ''
  };
  showQuantityStep();
}

function showQuantityStep(message, isError) {
  const line = activePick.line;
  const msgClass = isError ? 'text-error' : '';
  const defaultQty = Math.min(line.unitsRequired, line.availableUnits);

  app.innerHTML = `
    ${summaryHTML(currentCollection)}
    ${UI.summaryCard([
      { label: 'Pallet ID', value: escapeHTML(line.palletId) },
      { label: 'Run Code', value: escapeHTML(line.runCode || '-') },
      { label: 'Product', value: escapeHTML(line.product || '-') },
      { label: 'Format', value: escapeHTML(line.format || '-') },
      { label: 'Required Units', value: String(line.unitsRequired) },
      { label: 'Available Units', value: String(line.availableUnits) }
    ])}
    <div id="dispatchMessage" class="status ${msgClass}">${message ? escapeHTML(message) : 'Enter pick quantity (defaults to required).'}</div>
    <label for="pickQty">Pick Quantity</label>
    <input id="pickQty" type="number" min="1" max="${line.availableUnits}" value="${defaultQty}" />
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showPickStep()">Back</button>
      <button class="btn btn-success" onclick="confirmPickQuantity()">Confirm Quantity</button>
    </div>
  `;

  const input = document.getElementById('pickQty');
  input.focus();
  if (input.select) input.select();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmPickQuantity();
  });
}

function confirmPickQuantity() {
  const line = activePick.line;
  const qty = parseInt(document.getElementById('pickQty').value, 10);

  if (!qty || qty < 1) {
    showQuantityStep('Enter a valid pick quantity.', true);
    return;
  }
  if (qty > line.availableUnits) {
    showQuantityStep('Cannot exceed Available Units.', true);
    return;
  }

  activePick.pickedQty = qty;
  activePick.remainingQty = line.availableUnits - qty;
  activePick.needsSplit = qty < line.availableUnits;
  activePick.pickedPalletId = line.palletId;
  activePick.newPalletId = '';
  activePick.originalKeeps = null;
  activePick.splitScanTarget = 'picked';

  if (!activePick.needsSplit) {
    proceedToStaging();
    return;
  }

  showPickedPalletScanStep();
}

function showPickedPalletScanStep(message, isError) {
  activePick.splitScanTarget = 'picked';
  const msgClass = isError ? 'text-error' : '';

  app.innerHTML = `
    ${summaryHTML(currentCollection)}
    <p class="status">A split is required. Scan or enter the pallet ID for the <strong>picked</strong> stock (${activePick.pickedQty} units).</p>
    ${UI.summaryCard([
      { label: 'Original Pallet', value: escapeHTML(activePick.originalPalletId) },
      { label: 'Picked Quantity', value: String(activePick.pickedQty) },
      { label: 'Remaining Quantity', value: String(activePick.remainingQty) }
    ])}
    <div id="dispatchMessage" class="status ${msgClass}">${message ? escapeHTML(message) : 'Scan or enter the pallet ID for the picked stock.'}</div>
    <label for="palletInput">Pallet Identifier (15-digit code):</label>
    <input id="palletInput" maxlength="15" placeholder="Scan or type 15 digits" />
    <div class="actions mt-3">
      <button class="btn btn-success" onclick="confirmSplitPalletScan()">Confirm Pallet</button>
      ${UI.cameraButton('Use Camera', 'startSplitPalletCameraScan()')}
    </div>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showQuantityStep()">Back</button>
    </div>
  `;

  const input = document.getElementById('palletInput');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmSplitPalletScan();
  });
  setTimeout(() => { input.focus(); if (input.select) input.select(); }, 0);
}

function showSamePalletConfirmStep() {
  app.innerHTML = `
    ${summaryHTML(currentCollection)}
    ${UI.summaryCard([
      { label: 'Original Pallet', value: escapeHTML(activePick.originalPalletId) },
      { label: 'Picked Quantity', value: String(activePick.pickedQty) },
      { label: 'Remaining Quantity', value: String(activePick.remainingQty) }
    ])}
    <div id="dispatchMessage" class="status">It appears that the scanned pallet ID is the same as the original pallet ID. Would you like to assign a new pallet ID to the remaining stock instead?</div>
    <div class="actions mt-3">
      <button class="btn btn-success" onclick="confirmAssignRemainingNewPallet()">Yes</button>
      <button class="btn btn-ghost" onclick="showPickedPalletScanStep()">No</button>
    </div>
  `;
}

function confirmAssignRemainingNewPallet() {
  showRemainingPalletScanStep();
}

function showRemainingPalletScanStep(message, isError) {
  activePick.splitScanTarget = 'remaining';
  const msgClass = isError ? 'text-error' : '';

  app.innerHTML = `
    ${summaryHTML(currentCollection)}
    <p class="status">Scan or enter the pallet ID for the <strong>remaining</strong> stock (${activePick.remainingQty} units).</p>
    ${UI.summaryCard([
      { label: 'Original Pallet', value: escapeHTML(activePick.originalPalletId) },
      { label: 'Picked Quantity', value: String(activePick.pickedQty) },
      { label: 'Remaining Quantity', value: String(activePick.remainingQty) }
    ])}
    <div id="dispatchMessage" class="status ${msgClass}">${message ? escapeHTML(message) : 'Scan or enter a new pallet ID for the remaining stock.'}</div>
    <label for="palletInput">Pallet Identifier (15-digit code):</label>
    <input id="palletInput" maxlength="15" placeholder="Scan or type 15 digits" />
    <div class="actions mt-3">
      <button class="btn btn-success" onclick="confirmSplitPalletScan()">Confirm Pallet</button>
      ${UI.cameraButton('Use Camera', 'startSplitPalletCameraScan()')}
    </div>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showPickedPalletScanStep()">Back</button>
    </div>
  `;

  const input = document.getElementById('palletInput');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmSplitPalletScan();
  });
  setTimeout(() => { input.focus(); if (input.select) input.select(); }, 0);
}

function confirmSplitPalletScan() {
  const val = (document.getElementById('palletInput').value || '').trim();
  if (val.length !== 15 || isNaN(val)) {
    const show = activePick.splitScanTarget === 'remaining'
      ? showRemainingPalletScanStep
      : showPickedPalletScanStep;
    show('Please enter a valid 15-digit number.', true);
    return;
  }
  processSplitPalletScan(val);
}

function processSplitPalletScan(palletId) {
  if (activePick.splitScanTarget === 'remaining') {
    if (palletId === activePick.originalPalletId) {
      showRemainingPalletScanStep('New pallet ID must be different from the original.', true);
      return;
    }

    // Remaining stock gets the new pallet ID; picked keeps original
    activePick.originalKeeps = 'picked';
    activePick.newPalletId = palletId;
    activePick.pickedPalletId = activePick.originalPalletId;
    proceedToStaging();
    return;
  }

  // Scanning for picked stock
  if (palletId === activePick.originalPalletId) {
    showSamePalletConfirmStep();
    return;
  }

  // Picked stock receives the new pallet ID; remaining keeps original
  activePick.originalKeeps = 'remaining';
  activePick.newPalletId = palletId;
  activePick.pickedPalletId = palletId;
  proceedToStaging();
}

async function proceedToStaging() {
  try {
    showLoading(activePick.needsSplit && !activePick.splitWritten ? 'Writing pallet split…' : 'Preparing…');

    if (activePick.needsSplit && !activePick.splitWritten) {
      await writeSplitPalletEntries();
      activePick.splitWritten = true;
    }

    showStageLocationStep();
  } catch (err) {
    console.error(err);
    const backFn = !activePick.needsSplit
      ? showQuantityStep
      : activePick.splitScanTarget === 'remaining'
        ? showRemainingPalletScanStep
        : showPickedPalletScanStep;
    backFn(err.message || 'Failed to continue. Please try again.', true);
  }
}

async function writeSplitPalletEntries() {
  const run = activePick.line.runCode;
  const linePickRef = activePick.line.pickRef || '';
  const removedQty = activePick.originalKeeps === 'picked'
    ? activePick.remainingQty
    : activePick.pickedQty;

  // Row 1: original pallet negative movement for stock removed
  await submitPalletEntry(activePick.originalPalletId, run, -removedQty, linePickRef);
  // Row 2: new pallet positive movement for transferred quantity
  await submitPalletEntry(activePick.newPalletId, run, removedQty, linePickRef);
}

async function submitPalletEntry(code, run, units, movementPickRef) {
  const { date, time } = formatDateTimeForSheets();
  const body = new URLSearchParams();
  body.append('code', code);
  body.append('run', run);
  body.append('units', String(units));
  body.append('pickRef', movementPickRef || '');
  body.append('date', date);
  body.append('time', time);

  const res = await fetch(PALLET_ENTRY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json();
  if (data.result !== 'ok' && data.result !== 'success') {
    throw new Error(data.message || 'Pallet entry failed.');
  }
}

function normalizePalletId(id) {
  const s = String(id || '').trim();
  if (/^\d{14}$/.test(s)) return '0' + s;
  return s;
}

async function submitStaging(location) {
  const line = activePick.line;
  const body = new URLSearchParams();
  body.append('collectionId', currentCollection.id);
  body.append('pickRef', line.pickRef || '');
  body.append('pallet', normalizePalletId(activePick.pickedPalletId));
  body.append('run', line.runCode);
  body.append('company', line.company);
  body.append('product', line.product);
  body.append('format', line.format);
  body.append('qty', String(activePick.pickedQty));
  if (location) body.append('location', location);

  const res = await fetch(STAGING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json();
  if (data.result !== 'ok' && data.result !== 'success') {
    throw new Error(data.message || 'Staging write failed.');
  }
}

async function submitLocationAssignment(palletId, location) {
  const { date, time } = formatDateTimeForSheets();
  const body = new URLSearchParams();
  body.append('pallet', palletId);
  body.append('location', location);
  body.append('date', date);
  body.append('time', time);

  const res = await fetch(LOCATION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json();
  if (data.result !== 'ok' && data.result !== 'success') {
    throw new Error(data.message || 'Location assignment failed.');
  }
}

/* ===== Stage / Location Assignment (reuse Put Away rules) ===== */
function isLowerBayLocation(code) {
  const v = (code || '').trim();
  return v.length === 10 && v.endsWith('1');
}

function isUpperBayBase(code) {
  return (code || '').trim().endsWith('-');
}

function showStageLocationStep(message, isError) {
  const msgClass = isError ? 'text-error' : '';
  const backAction = activePick.splitWritten
    ? ''
    : `<button class="btn btn-ghost" onclick="${activePick.needsSplit ? (activePick.splitScanTarget === 'remaining' ? 'showRemainingPalletScanStep()' : 'showPickedPalletScanStep()') : 'showQuantityStep()'}">Back</button>`;

  app.innerHTML = `
    ${summaryHTML(currentCollection)}
    <p class="status">Assign a staging location for picked pallet <strong>${escapeHTML(activePick.pickedPalletId)}</strong>, or skip.</p>
    <div id="dispatchMessage" class="status ${msgClass}">${message ? escapeHTML(message) : 'Scan or enter a location code.'}</div>
    <label for="locationInput">Location Code:</label>
    <input id="locationInput" placeholder="Scan or type location" autocomplete="off" />
    <div id="bayChooser" class="mt-4 hidden">
      <p>This location ends with “-”. Choose a bay:</p>
      <div class="bay-grid">
        <button class="btn btn-secondary" onclick="chooseBay(2)">2</button>
        <button class="btn btn-secondary" onclick="chooseBay(3)">3</button>
        <button class="btn btn-secondary" onclick="chooseBay(4)">4</button>
      </div>
    </div>
    <div class="actions mt-3">
      <button class="btn btn-success" onclick="confirmStageLocation()">Confirm Location</button>
      ${UI.cameraButton('Use Camera', 'startLocationCameraScan()')}
    </div>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="skipStageLocation()">Skip Location</button>
      ${backAction}
    </div>
  `;

  ensureBayGridStyle();

  const input = document.getElementById('locationInput');
  input.focus();
  input.addEventListener('input', () => handleLocationLive(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmStageLocation();
    }
  });
}

function ensureBayGridStyle() {
  if (document.getElementById('bay-grid-style')) return;
  const style = document.createElement('style');
  style.id = 'bay-grid-style';
  style.textContent = `
    .bay-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      width: 100%;
    }
    .bay-grid .btn {
      width: 100%;
      min-width: 0;
      padding-left: 0.5rem;
      padding-right: 0.5rem;
    }
    .hidden { display: none !important; }
  `;
  document.head.appendChild(style);
}

function handleLocationLive(raw) {
  const v = (raw || '').trim();
  const chooser = document.getElementById('bayChooser');
  if (!chooser) return;
  if (isUpperBayBase(v)) {
    activePick.locationBase = v;
    chooser.classList.remove('hidden');
  } else {
    activePick.locationBase = '';
    chooser.classList.add('hidden');
  }
}

function chooseBay(n) {
  const base = activePick.locationBase || (document.getElementById('locationInput')?.value || '').trim();
  if (!base.endsWith('-')) {
    alert('No base location found. Please scan or type the location ending with “-” again.');
    return;
  }
  const code = `${base}${n}`;
  const input = document.getElementById('locationInput');
  if (input) input.value = code;
  activePick.locationBase = '';
  const chooser = document.getElementById('bayChooser');
  if (chooser) chooser.classList.add('hidden');
  completeStage(code);
}

function confirmStageLocation() {
  const v = (document.getElementById('locationInput')?.value || '').trim();
  if (!v) {
    showStageLocationStep('Enter a location or tap Skip Location.', true);
    return;
  }
  if (isUpperBayBase(v)) {
    activePick.locationBase = v;
    handleLocationLive(v);
    showStageLocationStep('Choose bay 2, 3, or 4 for this upper location.', true);
    return;
  }
  if (!isLowerBayLocation(v) && !/^.+\d$/.test(v)) {
    // Allow confirmed codes that already include bay digit (e.g. W2-A-3-B-2)
    // while still guiding lower/upper bay patterns used by Put Away.
  }
  completeStage(v);
}

function skipStageLocation() {
  completeStage('');
}

async function completeStage(location) {
  try {
    showLoading('Writing staging record…');
    if (location) {
      await submitLocationAssignment(activePick.pickedPalletId, location);
    }
    await submitStaging(location);
    finalizePick();
  } catch (err) {
    console.error(err);
    showStageLocationStep(err.message || 'Staging failed. Please try again.', true);
  }
}

function finalizePick() {
  const line = activePick.line;
  const isPartialQty = activePick.pickedQty < line.unitsRequired;

  line.status = isPartialQty ? 'partial' : 'staged';
  line.pickedQty = activePick.pickedQty;
  line.pickedPalletId = activePick.pickedPalletId;

  const doneLabel = statusLabel(line.status);
  activePick = null;

  if (isCollectionComplete(currentCollection)) {
    showCompleteScreen();
    return;
  }

  showPickStep(`${doneLabel} — continue scanning the next pallet.`, false);
}

function showCompleteScreen() {
  if (!currentCollection) return;
  pickMode = false;
  activePick = null;

  const total = currentCollection.pallets.length;
  const partial = currentCollection.pallets.filter(p => p.status === 'partial').length;

  app.innerHTML = UI.successScreen(
    'Collection Complete',
    UI.summaryCard([
      { label: 'Collection ID', value: escapeHTML(currentCollection.id) },
      { label: 'Customer', value: escapeHTML(currentCollection.company || '-') },
      { label: 'Total lines completed', value: String(total) },
      ...(partial ? [{ label: 'Partially picked', value: String(partial) }] : [])
    ]),
    `<a href="index.html" class="btn btn-primary">Return to Main Menu</a>`
  );
}

/* ===== Camera scanning ===== */
async function startCameraScan() {
  await runPalletCameraScan(raw => {
    if (raw.length !== 15 || isNaN(raw)) {
      showPickStep('Scanned code is not a valid 15-digit number.', true);
      return;
    }
    processPalletScan(raw);
  }, () => showPickStep('Barcode detection failed.', true));
}

async function startSplitPalletCameraScan() {
  const showCurrent = () => activePick.splitScanTarget === 'remaining'
    ? showRemainingPalletScanStep
    : showPickedPalletScanStep;

  await runPalletCameraScan(raw => {
    if (raw.length !== 15 || isNaN(raw)) {
      showCurrent()('Scanned code is not a valid 15-digit number.', true);
      return;
    }
    processSplitPalletScan(raw);
  }, () => showCurrent()('Barcode detection failed.', true));
}

async function startLocationCameraScan() {
  await runPalletCameraScan(raw => {
    if (isUpperBayBase(raw)) {
      showStageLocationStep();
      const input = document.getElementById('locationInput');
      if (input) {
        input.value = raw;
        handleLocationLive(raw);
      }
      return;
    }
    if (raw) {
      completeStage(raw);
      return;
    }
    showStageLocationStep('Unrecognised location code.', true);
  }, () => showStageLocationStep('Barcode detection failed.', true));
}

async function runPalletCameraScan(onSuccess, onFail) {
  if (typeof BarcodeDetector === 'undefined') {
    alert('Barcode scanning is not supported in this browser.');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    await video.play();

    app.innerHTML = `
      ${currentCollection ? summaryHTML(currentCollection) : ''}
      ${UI.scanCard('')}
    `;
    const frame = app.querySelector('.scan-frame');
    if (frame) frame.appendChild(video);
    else app.appendChild(video);
    video.style.width = '100%';
    video.style.maxWidth = '320px';

    const detector = new BarcodeDetector({ formats: ['code_128', 'ean_13'] });

    const scan = async () => {
      try {
        const barcodes = await detector.detect(video);
        if (barcodes.length > 0) {
          stream.getTracks().forEach(t => t.stop());
          onSuccess((barcodes[0].rawValue || '').trim());
          return;
        }
        requestAnimationFrame(scan);
      } catch (err) {
        console.error(err);
        stream.getTracks().forEach(t => t.stop());
        onFail();
      }
    };

    scan();
  } catch (err) {
    alert('Camera access denied or unavailable.');
  }
}

/* ===== Data load ===== */
function loadCollectionRows(text) {
  const rowStrings = splitCSVRows(text);
  allCollectionRows = [];

  for (let i = 0; i < rowStrings.length; i++) {
    const r = parseCSVRow(rowStrings[i]);
    if (i === 0 && isHeaderRow(r, 'COLLECTION')) continue;

    const collectionId = cleanCSVField(r[PICKING_COLS.collectionRef]);
    const pickRef = cleanCSVField(r[PICKING_COLS.pickRef]);
    const palletId = cleanCSVField(r[PICKING_COLS.palletId]);
    if (!collectionId || !palletId) continue;

    allCollectionRows.push({
      collectionId,
      pickRef,
      palletId,
      runCode: cleanCSVField(r[PICKING_COLS.runCode]),
      company: cleanCSVField(r[PICKING_COLS.company]),
      product: cleanCSVField(r[PICKING_COLS.product]),
      format: cleanCSVField(r[PICKING_COLS.format]),
      availableUnits: parseUnits(r[PICKING_COLS.totalUnits]),
      unitsRequired: parseUnits(r[PICKING_COLS.pickQty]),
      location: cleanCSVField(r[PICKING_COLS.location])
    });
  }
}

function extractDispatchPalletId(fields) {
  const colA = cleanCSVField(fields[0]);
  const colB = cleanCSVField(fields[1]);

  // New format: A=reference, B=pallet ID
  if (/^\d+$/.test(colB)) return normalizePalletId(colB);

  // Legacy format: A=pallet ID
  if (/^\d+$/.test(colA)) return normalizePalletId(colA);

  return '';
}

function loadDispatchHistory(text) {
  const rowStrings = splitCSVRows(text);
  dispatchedPalletIds.clear();

  for (let i = 0; i < rowStrings.length; i++) {
    const r = parseCSVRow(rowStrings[i]);
    if (i === 0 && (isHeaderRow(r, 'PALLET') || isHeaderRow(r, 'REFERENCE') || isHeaderRow(r, 'COLLECTION'))) continue;

    const palletId = extractDispatchPalletId(r);
    if (!palletId) continue;
    dispatchedPalletIds.add(palletId);
  }
}

async function init() {
  showLoading('Loading collection data…');
  try {
    const [collectionsRes, dispatchRes] = await Promise.all([
      fetch(COLLECTIONS_CSV),
      fetch(DISPATCH_HISTORY_CSV)
    ]);

    if (!collectionsRes.ok || !dispatchRes.ok) {
      throw new Error('Failed to load CSV data.');
    }

    const [collectionsText, dispatchText] = await Promise.all([
      collectionsRes.text(),
      dispatchRes.text()
    ]);

    loadCollectionRows(collectionsText);
    loadDispatchHistory(dispatchText);
    showSelectStep();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<p class="status">Failed to load data. Please refresh and try again.</p>`;
  }
}

window.openSelectedCollection = openSelectedCollection;
window.startPick = startPick;
window.stopPick = stopPick;
window.confirmScanPallet = confirmScanPallet;
window.startCameraScan = startCameraScan;
window.showSelectStep = showSelectStep;
window.confirmLineSelect = confirmLineSelect;
window.confirmPickQuantity = confirmPickQuantity;
window.confirmSplitPalletScan = confirmSplitPalletScan;
window.startSplitPalletCameraScan = startSplitPalletCameraScan;
window.confirmAssignRemainingNewPallet = confirmAssignRemainingNewPallet;
window.showQuantityStep = showQuantityStep;
window.showPickedPalletScanStep = showPickedPalletScanStep;
window.showRemainingPalletScanStep = showRemainingPalletScanStep;
window.showPickStep = showPickStep;
window.showStageLocationStep = showStageLocationStep;
window.confirmStageLocation = confirmStageLocation;
window.skipStageLocation = skipStageLocation;
window.chooseBay = chooseBay;
window.startLocationCameraScan = startLocationCameraScan;

init();
