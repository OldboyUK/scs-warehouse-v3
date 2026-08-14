const app = document.getElementById('app');

const COLLECTIONS_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=810040978&single=true&output=csv';
const DISPATCH_HISTORY_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=848481035&single=true&output=csv';
const STOCK_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1879287780&single=true&output=csv';

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
/** Pallet ID → [{ runCode, company, product, format, units }] */
let palletStock = new Map();
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

function normalizePalletId(id) {
  const s = String(id || '').trim();
  if (/^\d+$/.test(s) && s.length > 0 && s.length < 15) return s.padStart(15, '0');
  return s;
}

function runKey(run) {
  return String(run || '').trim().toUpperCase();
}

function detectStockColumns(headerRow) {
  const cols = {
    palletId: 0,
    runCode: 1,
    company: 2,
    product: 3,
    format: 4,
    units: 5,
    availableUnits: -1
  };
  if (!headerRow || !headerRow.length) return cols;

  for (let i = 0; i < headerRow.length; i++) {
    const h = cleanCSVField(headerRow[i]).toUpperCase().replace(/\s+/g, ' ');
    if (h.includes('PALLET')) cols.palletId = i;
    else if (h.includes('RUN')) cols.runCode = i;
    else if (h.includes('COMPANY') || h.includes('CUSTOMER')) cols.company = i;
    else if (h.includes('PRODUCT')) cols.product = i;
    else if (h.includes('FORMAT')) cols.format = i;
    else if (h.includes('AVAILABLE')) cols.availableUnits = i;
    else if (h === 'UNITS' || (h.includes('UNIT') && !h.includes('TOTAL'))) cols.units = i;
  }
  return cols;
}

function loadPalletStock(text) {
  palletStock.clear();
  const rowStrings = splitCSVRows(text);
  let cols = detectStockColumns([]);

  for (let i = 0; i < rowStrings.length; i++) {
    const r = parseCSVRow(rowStrings[i]);
    if (i === 0 && isHeaderRow(r, 'PALLET')) {
      cols = detectStockColumns(r);
      continue;
    }

    const palletId = normalizePalletId(cleanCSVField(r[cols.palletId]));
    if (!palletId) continue;

    const unitsIndex = cols.availableUnits >= 0 ? cols.availableUnits : cols.units;
    const units = parseUnits(r[unitsIndex]);
    if (units <= 0) continue;

    const line = {
      palletId,
      runCode: cleanCSVField(r[cols.runCode]),
      company: cleanCSVField(r[cols.company]),
      product: cleanCSVField(r[cols.product]),
      format: cleanCSVField(r[cols.format]),
      units
    };

    if (!palletStock.has(palletId)) palletStock.set(palletId, []);
    palletStock.get(palletId).push(line);
  }
}

function getPhysicalStock(palletId) {
  return palletStock.get(normalizePalletId(palletId)) || [];
}

function applyLocalStockMove(fromId, toId, run, qty, meta) {
  const fromKey = normalizePalletId(fromId);
  const toKey = normalizePalletId(toId);
  const key = runKey(run);
  const amount = parseUnits(qty);
  if (!fromKey || !toKey || !key || amount <= 0) return;

  const fromLines = palletStock.get(fromKey) || [];
  const nextFrom = [];
  for (const line of fromLines) {
    if (runKey(line.runCode) !== key) {
      nextFrom.push(line);
      continue;
    }
    const left = line.units - amount;
    if (left > 0) nextFrom.push(Object.assign({}, line, { units: left }));
  }
  if (nextFrom.length) palletStock.set(fromKey, nextFrom);
  else palletStock.delete(fromKey);

  const toLines = palletStock.get(toKey) || [];
  const existing = toLines.find(line => runKey(line.runCode) === key);
  if (existing) {
    existing.units += amount;
  } else {
    toLines.push({
      palletId: toKey,
      runCode: (meta && meta.runCode) || run,
      company: (meta && meta.company) || '',
      product: (meta && meta.product) || '',
      format: (meta && meta.format) || '',
      units: amount
    });
  }
  palletStock.set(toKey, toLines);
}

function remainingStockAfterPick(palletId, pickedRun, pickedQty) {
  const remaining = [];
  const pickedKey = runKey(pickedRun);
  let foundPicked = false;

  for (const line of getPhysicalStock(palletId)) {
    if (runKey(line.runCode) === pickedKey) {
      foundPicked = true;
      const left = line.units - pickedQty;
      if (left > 0) remaining.push(Object.assign({}, line, { units: left }));
    } else {
      remaining.push(Object.assign({}, line));
    }
  }

  if (!foundPicked && activePick && activePick.line) {
    const left = activePick.line.availableUnits - pickedQty;
    if (left > 0) {
      remaining.push({
        palletId: normalizePalletId(palletId),
        runCode: activePick.line.runCode,
        company: activePick.line.company,
        product: activePick.line.product,
        format: activePick.line.format,
        units: left
      });
    }
  }

  return remaining;
}

function remainingStockHTML(lines) {
  if (!lines || !lines.length) return '';
  return `
    <div class="pallet-stock-list pallet-stock-list--remaining">
      ${lines.map(line => `
        <div class="pallet-stock-item pallet-stock-item--other">
          <div class="pallet-stock-main">
            <strong>${escapeHTML(line.runCode || '-')}</strong>
            <span>${escapeHTML([line.product, line.format].filter(Boolean).join(' — ') || 'Remaining stock')}</span>
          </div>
          <span class="pallet-stock-qty">${escapeHTML(String(line.units))} units</span>
        </div>
      `).join('')}
    </div>
  `;
}

function buildPalletContents(palletId) {
  const scannedId = normalizePalletId(palletId);
  const stock = getPhysicalStock(scannedId);
  const collectionLines = (currentCollection ? currentCollection.pallets : [])
    .filter(p => normalizePalletId(p.palletId) === scannedId);
  const pickableLines = collectionLines.filter(p => !isPalletDone(p));
  const items = [];
  const seenRuns = new Set();

  for (const line of stock) {
    const pending = pickableLines.find(p => runKey(p.runCode) === runKey(line.runCode));
    const anyLine = collectionLines.find(p => runKey(p.runCode) === runKey(line.runCode));
    items.push({
      pickable: !!pending,
      collectionLine: pending || null,
      runCode: line.runCode,
      company: line.company,
      product: line.product,
      format: line.format,
      units: line.units,
      alreadyDone: !pending && !!anyLine
    });
    seenRuns.add(runKey(line.runCode));
  }

  for (const line of pickableLines) {
    if (seenRuns.has(runKey(line.runCode))) continue;
    items.push({
      pickable: true,
      collectionLine: line,
      runCode: line.runCode,
      company: line.company,
      product: line.product,
      format: line.format,
      units: line.availableUnits,
      alreadyDone: false
    });
  }

  return { collectionLines, pickableLines, items };
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

  const scannedId = normalizePalletId(palletId);
  const contents = buildPalletContents(scannedId);

  if (!contents.collectionLines.length) {
    showPickStep('This pallet is not part of this Collection.', true);
    return;
  }

  if (!contents.pickableLines.length) {
    showPickStep('This pallet has already been completed.', true);
    return;
  }

  showPalletContentsStep(scannedId, contents);
}

function showPalletContentsStep(palletId, contents) {
  const items = contents.items;
  window._palletContentItems = items;

  const list = items.map((item, i) => {
    const meta = [item.product, item.format].filter(Boolean).join(' — ');
    const tag = item.pickable
      ? 'This pick'
      : item.alreadyDone
        ? 'Already picked'
        : 'Not part of this pick';
    const cls = item.pickable
      ? 'pallet-stock-item pallet-stock-item--pickable'
      : 'pallet-stock-item pallet-stock-item--other';
    const action = item.pickable
      ? `onclick="selectPalletStockLine(${i})"`
      : 'disabled';

    return `
      <button type="button" class="${cls}" ${action}>
        <div class="pallet-stock-main">
          <strong>${escapeHTML(item.runCode || '-')}</strong>
          <span>${escapeHTML(meta || 'Stock line')}</span>
        </div>
        <div class="pallet-stock-side">
          <span class="pallet-stock-qty">${escapeHTML(String(item.units))} units</span>
          <span class="pallet-stock-tag">${escapeHTML(tag)}</span>
        </div>
      </button>
    `;
  }).join('');

  app.innerHTML = `
    ${summaryHTML(currentCollection)}
    <p class="status">Pallet <strong>${escapeHTML(palletId)}</strong> — all stock currently on this pallet is shown below. Select a highlighted item to pick.</p>
    <div class="pallet-stock-list">
      ${list}
    </div>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showPickStep()">Back</button>
    </div>
  `;
}

function selectPalletStockLine(index) {
  const items = window._palletContentItems || [];
  const item = items[index];
  if (!item || !item.pickable || !item.collectionLine) return;
  beginQuantityStep(item.collectionLine);
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
    remainingStock: [],
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
  activePick.remainingStock = remainingStockAfterPick(line.palletId, line.runCode, qty);
  activePick.needsSplit = activePick.remainingStock.length > 0;
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
  const remainingIntro = (activePick.remainingStock || []).length
    ? 'Other stock still remains on this pallet. Scan a <strong>different</strong> pallet ID for the picked stock, or scan the original pallet to assign a new pallet ID to the remaining stock.'
    : 'A split is required. Scan or enter the pallet ID for the <strong>picked</strong> stock.';

  app.innerHTML = `
    ${summaryHTML(currentCollection)}
    <p class="status">${remainingIntro}</p>
    ${UI.summaryCard([
      { label: 'Original Pallet', value: escapeHTML(activePick.originalPalletId) },
      { label: 'Picked Run Code', value: escapeHTML(activePick.line.runCode || '-') },
      { label: 'Picked Quantity', value: String(activePick.pickedQty) }
    ])}
    ${remainingStockHTML(activePick.remainingStock || [])}
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
  showRemainingPalletScanStep(
    'The destination matches the source pallet and other stock still remains. Scan a NEW pallet ID for the remaining stock.',
    false
  );
}

function confirmAssignRemainingNewPallet() {
  showRemainingPalletScanStep();
}

function showRemainingPalletScanStep(message, isError) {
  activePick.splitScanTarget = 'remaining';
  const msgClass = isError ? 'text-error' : '';
  const remainingUnits = (activePick.remainingStock || []).reduce((sum, line) => sum + (line.units || 0), 0);

  app.innerHTML = `
    ${summaryHTML(currentCollection)}
    <p class="status">Scan or enter a <strong>new</strong> pallet ID for the remaining stock (${remainingUnits} units). Picked stock will stay on the original pallet.</p>
    ${UI.summaryCard([
      { label: 'Original Pallet', value: escapeHTML(activePick.originalPalletId) },
      { label: 'Picked Run Code', value: escapeHTML(activePick.line.runCode || '-') },
      { label: 'Picked Quantity', value: String(activePick.pickedQty) }
    ])}
    ${remainingStockHTML(activePick.remainingStock || [])}
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
    if (normalizePalletId(palletId) === normalizePalletId(activePick.originalPalletId)) {
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
  if (normalizePalletId(palletId) === normalizePalletId(activePick.originalPalletId)) {
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
  const line = activePick.line;
  const linePickRef = line.pickRef || '';

  if (activePick.originalKeeps === 'picked') {
    for (const rem of activePick.remainingStock || []) {
      const remPickRef = runKey(rem.runCode) === runKey(line.runCode) ? linePickRef : '';
      await submitPalletEntry(activePick.originalPalletId, rem.runCode, -rem.units, remPickRef);
      await submitPalletEntry(activePick.newPalletId, rem.runCode, rem.units, remPickRef);
      applyLocalStockMove(
        activePick.originalPalletId,
        activePick.newPalletId,
        rem.runCode,
        rem.units,
        rem
      );
    }
    return;
  }

  await submitPalletEntry(activePick.originalPalletId, line.runCode, -activePick.pickedQty, linePickRef);
  await submitPalletEntry(activePick.newPalletId, line.runCode, activePick.pickedQty, linePickRef);
  applyLocalStockMove(
    activePick.originalPalletId,
    activePick.newPalletId,
    line.runCode,
    activePick.pickedQty,
    line
  );
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
      palletId: normalizePalletId(palletId),
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
    const [collectionsRes, dispatchRes, stockRes] = await Promise.all([
      fetch(COLLECTIONS_CSV),
      fetch(DISPATCH_HISTORY_CSV),
      fetch(STOCK_CSV)
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

    if (stockRes.ok) {
      loadPalletStock(await stockRes.text());
    } else {
      palletStock.clear();
    }

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
window.selectPalletStockLine = selectPalletStockLine;
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
