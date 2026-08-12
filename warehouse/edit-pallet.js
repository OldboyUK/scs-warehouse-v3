// edit-pallet.js
// Remove a product from a pallet (negative PALLET ENTRY), optionally add another via Goods In-style flow.

const app = document.getElementById('app');

const PALLETS_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1165333250&single=true&output=csv';
const STOCK_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1879287780&single=true&output=csv';
const RUN_CODES_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1199565865&single=true&output=csv';
const ORDER_LOG_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=792145998&single=true&output=csv';
const SCRIPT_URL = `${window.location.origin}/.netlify/functions/submit`;

const PROGRESS_STEPS = ['Scan', 'Select', 'Remove', 'Replace'];
const ADD_PROGRESS_STEPS = ['Run Code', 'Units', 'Submit'];

let knownPallets = new Set();
let stockData = [];
let runCodes = [];
const orderLog = new Map();

let palletCode = '';
let palletLines = [];
let selectedLine = null;
let removeQty = 0;
let removeComment = '';
let addRunCode = '';
let addComment = '';

/* ---------- Helpers (aligned with Goods In / Picking) ---------- */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function formatDateTimeForSheets() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return {
    date: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  };
}

function findRunCode(value) {
  const v = (value || '').trim().toUpperCase();
  return runCodes.find(c => c.toUpperCase() === v) || null;
}

function normalizeRunCodeSearch(value) {
  return String(value || '').toUpperCase().replace(/-/g, '');
}

function runCodeSearchRank(code, query) {
  const normalizedCode = normalizeRunCodeSearch(code);
  const normalizedQuery = normalizeRunCodeSearch(query);
  if (!normalizedQuery) return 0;
  if (normalizedCode === normalizedQuery) return 0;
  if (normalizedCode.startsWith(normalizedQuery)) return 1;
  if (normalizedCode.includes(normalizedQuery)) return 2;
  return -1;
}

function filterRunCodes(query) {
  const normalizedQuery = normalizeRunCodeSearch(query);
  if (!normalizedQuery) {
    return runCodes.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  return runCodes
    .map(code => ({ code, rank: runCodeSearchRank(code, query) }))
    .filter(item => item.rank >= 0)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.code.localeCompare(b.code, undefined, { numeric: true });
    })
    .map(item => item.code);
}

function confirmationBlock({ code, run, product, format, units, company }) {
  const rows = [
    { label: 'Pallet ID', value: escapeHTML(code) },
    { label: 'Run Code', value: escapeHTML(run) }
  ];
  if (company) rows.push({ label: 'Company', value: escapeHTML(company) });
  rows.push(
    { label: 'Product', value: escapeHTML(product || '-') },
    { label: 'Format', value: escapeHTML(format || '-') }
  );
  if (typeof units === 'number') {
    rows.push({ label: 'Units', value: String(units) });
  }
  return UI.summaryCard(rows);
}

async function submitPalletEntry(code, run, units, comment, isReconfiguration) {
  const { date, time } = formatDateTimeForSheets();
  const body = new URLSearchParams();
  body.append('code', code);
  body.append('run', run);
  body.append('units', String(units));
  body.append('date', date);
  body.append('time', time);
  if (isReconfiguration) {
    body.append('comment', comment == null ? '' : String(comment));
    body.append('reconfiguration', 'true');
    const username =
      (typeof SCSAuth !== 'undefined' && SCSAuth.getUsername && SCSAuth.getUsername()) || '';
    body.append('username', username);
  }

  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json();
  if (data.result !== 'success' && data.result !== 'ok') {
    throw new Error(data.message || 'Submission failed');
  }
}

/* ---------- Data load ---------- */
async function loadData() {
  const [palletText, stockText, runText, orderText] = await Promise.all([
    fetch(PALLETS_CSV).then(r => r.text()),
    fetch(STOCK_CSV).then(r => r.text()),
    fetch(RUN_CODES_CSV).then(r => r.text()),
    fetch(ORDER_LOG_CSV).then(r => r.text())
  ]);

  knownPallets.clear();
  const palletRows = parseCSV(palletText);
  for (let i = 0; i < palletRows.length; i++) {
    const id = String(palletRows[i][0] || '').trim();
    if (!id || /pallet/i.test(id)) continue;
    knownPallets.add(id);
  }

  stockData = parseCSV(stockText);

  // A2:A — skip header row, take column A only
  const runRows = parseCSV(runText);
  runCodes = runRows.slice(1).map(row => String(row[0] || '').trim()).filter(Boolean);
  runCodes = Array.from(new Set(runCodes))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  orderLog.clear();
  const orderRows = parseCSV(orderText);
  for (const row of orderRows) {
    const run = String(row[0] || '').trim();
    if (!run) continue;
    orderLog.set(run, {
      product: String(row[3] || '').trim(),
      format: String(row[5] || '').trim()
    });
  }
}

function linesForPallet(palletId) {
  const lines = [];
  for (let i = 0; i < stockData.length; i++) {
    const row = stockData[i];
    const id = String(row[0] || '').trim();
    if (i === 0 && /pallet/i.test(id)) continue;
    if (id !== palletId) continue;

    const qty = parseInt(String(row[5] || '').replace(/,/g, ''), 10);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    lines.push({
      runCode: String(row[1] || '').trim(),
      company: String(row[2] || '').trim(),
      product: String(row[3] || '').trim(),
      format: String(row[4] || '').trim(),
      quantity: qty
    });
  }
  return lines;
}

/* ---------- Step 1: scan pallet ---------- */
function showScanStep(message, isError) {
  const msgClass = isError ? 'text-error' : '';
  app.innerHTML = `
    ${UI.progressBar(PROGRESS_STEPS, 0)}
    <label for="palletInput">Enter Pallet Identifier (15-digit code):</label>
    <input id="palletInput" maxlength="15" placeholder="Scan or type 15 digits" />
    <div class="status ${msgClass}">${message ? escapeHTML(message) : ''}</div>
    <div class="actions mt-3">
      <button class="btn btn-success" onclick="confirmPalletScan()">Confirm Pallet Barcode</button>
    </div>
    <hr>
    <p class="status">Tip: You can also scan using your camera.</p>
    <div class="actions mt-5">
      ${UI.cameraButton('Use Camera', 'startPalletCameraScan()')}
    </div>
  `;
  const input = document.getElementById('palletInput');
  input.focus();
  if (input.select) input.select();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmPalletScan();
  });
}

function confirmPalletScan() {
  const val = (document.getElementById('palletInput').value || '').trim();
  if (val.length !== 15 || isNaN(val)) {
    showScanStep('Please enter a valid 15-digit number.', true);
    return;
  }
  processPalletScan(val);
}

function processPalletScan(palletId) {
  if (!knownPallets.has(palletId)) {
    showScanStep('Pallet not found in the master list.', true);
    return;
  }

  const lines = linesForPallet(palletId);
  if (!lines.length) {
    showScanStep('No products found on this pallet.', true);
    return;
  }

  palletCode = palletId;
  palletLines = lines;
  selectedLine = null;
  removeQty = 0;
  removeComment = '';
  addRunCode = '';
  addComment = '';
  showSelectProductStep();
}

async function startPalletCameraScan() {
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

    app.innerHTML = UI.progressBar(PROGRESS_STEPS, 0) + UI.scanCard('');
    const frame = app.querySelector('.scan-frame');
    if (frame) frame.appendChild(video);
    video.style.width = '100%';
    video.style.maxWidth = '320px';

    const detector = new BarcodeDetector({ formats: ['code_128', 'ean_13'] });
    const scan = async () => {
      try {
        const barcodes = await detector.detect(video);
        if (barcodes.length > 0) {
          stream.getTracks().forEach(t => t.stop());
          const raw = (barcodes[0].rawValue || '').trim();
          if (raw.length !== 15 || isNaN(raw)) {
            showScanStep('Scanned code is not a valid 15-digit number.', true);
            return;
          }
          processPalletScan(raw);
          return;
        }
        requestAnimationFrame(scan);
      } catch (err) {
        console.error(err);
        stream.getTracks().forEach(t => t.stop());
        showScanStep('Barcode detection failed.', true);
      }
    };
    scan();
  } catch (err) {
    alert('Camera access denied or unavailable.');
  }
}

/* ---------- Step 2: select product ---------- */
function showSelectProductStep(message, isError) {
  const msgClass = isError ? 'text-error' : '';
  const options = palletLines.map((line, i) => `
    <option value="${i}">
      ${escapeHTML(line.runCode)} — ${escapeHTML(line.product)} (${escapeHTML(String(line.quantity))})
    </option>
  `).join('');

  app.innerHTML = `
    ${UI.progressBar(PROGRESS_STEPS, 1)}
    <p>Pallet: <strong>${escapeHTML(palletCode)}</strong></p>
    <label for="productSelect">Select product to remove:</label>
    <select id="productSelect">${options}</select>
    <div id="productDetails" class="mt-3"></div>
    <div class="status ${msgClass}">${message ? escapeHTML(message) : ''}</div>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showScanStep()">Back</button>
      <button class="btn btn-primary" onclick="confirmProductSelect()">Next</button>
    </div>
  `;

  const select = document.getElementById('productSelect');
  const renderDetails = () => {
    const line = palletLines[parseInt(select.value, 10)];
    if (!line) {
      document.getElementById('productDetails').innerHTML = '';
      return;
    }
    document.getElementById('productDetails').innerHTML = confirmationBlock({
      code: palletCode,
      run: line.runCode,
      company: line.company,
      product: line.product,
      format: line.format,
      units: line.quantity
    });
  };
  select.addEventListener('change', renderDetails);
  renderDetails();
}

function confirmProductSelect() {
  const idx = parseInt(document.getElementById('productSelect').value, 10);
  const line = palletLines[idx];
  if (!line) {
    showSelectProductStep('Please select a product.', true);
    return;
  }
  selectedLine = line;
  removeQty = line.quantity;
  removeComment = '';
  showRemoveQtyStep();
}

/* ---------- Step 3: remove quantity ---------- */
function showRemoveQtyStep(message, isError) {
  const msgClass = isError ? 'text-error' : '';
  app.innerHTML = `
    ${UI.progressBar(PROGRESS_STEPS, 2)}
    ${confirmationBlock({
      code: palletCode,
      run: selectedLine.runCode,
      company: selectedLine.company,
      product: selectedLine.product,
      format: selectedLine.format,
      units: selectedLine.quantity
    })}
    <label for="removeQty">How many units would you like to remove?</label>
    <input id="removeQty" type="number" min="1" max="${selectedLine.quantity}" value="${removeQty || selectedLine.quantity}" />
    <label for="removeCommentInput">Comments</label>
    <textarea id="removeCommentInput" rows="3" placeholder="Optional">${escapeHTML(removeComment)}</textarea>
    <div class="status ${msgClass}">${message ? escapeHTML(message) : ''}</div>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showSelectProductStep()">Back</button>
      <button class="btn btn-primary" onclick="confirmRemoveQty()">Next</button>
    </div>
  `;
  const input = document.getElementById('removeQty');
  input.focus();
  if (input.select) input.select();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmRemoveQty();
  });
}

function confirmRemoveQty() {
  const qty = parseInt(document.getElementById('removeQty').value, 10);
  const commentEl = document.getElementById('removeCommentInput');
  removeComment = commentEl ? commentEl.value : '';
  if (!qty || qty < 1) {
    showRemoveQtyStep('Enter a quantity greater than zero.', true);
    return;
  }
  if (qty > selectedLine.quantity) {
    showRemoveQtyStep('Cannot exceed the quantity currently on the pallet.', true);
    return;
  }
  removeQty = qty;
  showReplaceChoiceStep();
}

/* ---------- Step 4: add another product? ---------- */
function showReplaceChoiceStep() {
  app.innerHTML = `
    ${UI.progressBar(PROGRESS_STEPS, 3)}
    ${confirmationBlock({
      code: palletCode,
      run: selectedLine.runCode,
      company: selectedLine.company,
      product: selectedLine.product,
      format: selectedLine.format,
      units: removeQty
    })}
    <p class="status"><strong>Would you like to add a different product to this pallet?</strong></p>
    <p class="status">You might want to do this if, for example, you're adjusting this pallet because the wrong lot code was assigned to this pallet.</p>
    <div class="actions mt-3">
      <button class="btn btn-success" onclick="chooseAddProduct(true)">Yes</button>
      <button class="btn btn-ghost" onclick="chooseAddProduct(false)">No</button>
    </div>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showRemoveQtyStep()">Back</button>
    </div>
  `;
}

async function chooseAddProduct(addAnother) {
  try {
    app.innerHTML = `<p class="status">Writing stock removal…</p>`;
    await submitPalletEntry(palletCode, selectedLine.runCode, -removeQty, removeComment, true);

    if (!addAnother) {
      showFinishedScreen('Product removed from pallet.');
      return;
    }

    addComment = '';
    showAddRunCodeStep();
  } catch (err) {
    console.error(err);
    showReplaceChoiceStep();
    alert(err.message || 'Failed to write stock removal.');
  }
}

/* ---------- Goods In-style add flow (same pallet) ---------- */
function showAddRunCodeStep() {
  app.innerHTML = `
    ${UI.progressBar(ADD_PROGRESS_STEPS, 0)}
    <p>Adding a product to pallet <strong>${escapeHTML(palletCode)}</strong></p>
    <label>Select run code:</label>
    <div id="runCodeInput-wrap" class="combo-wrap">
      <input id="runCodeInput" placeholder="Type to search…" autocomplete="off">
      <button id="runCodeInput-toggle" type="button" class="combo-toggle" aria-label="Open suggestions">▾</button>
      <div id="runCodeInput-list" class="combo-list" hidden></div>
    </div>
    <div id="runDetails" class="mt-3"></div>
    <div class="actions mt-3">
      <button class="btn btn-primary" onclick="confirmAddRunCode()">Next</button>
    </div>
  `;
  setupRunCodeCombo();
}

function setupRunCodeCombo() {
  const input = document.getElementById('runCodeInput');
  const toggle = document.getElementById('runCodeInput-toggle');
  const list = document.getElementById('runCodeInput-list');
  const details = document.getElementById('runDetails');
  let open = false;
  let items = [];
  let highlight = -1;

  function filter(q) {
    items = filterRunCodes(q);
    render();
  }
  function render() {
    list.innerHTML = items.map((code, i) => `
      <div class="combo-option${i === highlight ? ' is-highlight' : ''}" data-value="${escapeHTML(code)}">
        ${escapeHTML(code)}
      </div>`).join('') || `<div class="status">No matches</div>`;
  }
  function openList() {
    if (!open) { list.hidden = false; open = true; }
  }
  function closeList() {
    if (open) { list.hidden = true; open = false; highlight = -1; }
  }
  function showDetails(val) {
    const run = findRunCode(val);
    if (!run) { details.innerHTML = ''; return; }
    const info = orderLog.get(run);
    if (info) {
      details.innerHTML = UI.summaryCard([
        { label: 'Product', value: escapeHTML(info.product || '-') },
        { label: 'Format', value: escapeHTML(info.format || '-') }
      ]);
    } else {
      details.innerHTML = '';
    }
  }
  function selectValue(val) {
    input.value = val;
    closeList();
    showDetails(val);
  }

  input.addEventListener('input', () => { filter(input.value); openList(); showDetails(input.value); });
  input.addEventListener('focus', () => { filter(input.value); showDetails(input.value); });
  input.addEventListener('keydown', e => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { filter(input.value); openList(); }
    if (!open && e.key === 'Enter') return;
    if (e.key === 'ArrowDown') { highlight = Math.min(highlight + 1, items.length - 1); e.preventDefault(); render(); }
    else if (e.key === 'ArrowUp') { highlight = Math.max(highlight - 1, 0); e.preventDefault(); render(); }
    else if (e.key === 'Enter') {
      if (open && highlight >= 0 && items[highlight]) { selectValue(items[highlight]); e.preventDefault(); }
    } else if (e.key === 'Escape') { closeList(); }
  });
  toggle.addEventListener('click', () => {
    if (open) closeList();
    else { filter(input.value); openList(); }
  });
  list.addEventListener('click', e => {
    const el = e.target.closest('.combo-option[data-value]');
    if (el) selectValue(el.dataset.value);
  });
  document.addEventListener('click', e => {
    const combo = document.getElementById('runCodeInput-wrap');
    if (combo && !combo.contains(e.target)) closeList();
  }, { capture: true });

  filter('');
  closeList();
  showDetails(input.value);
  input.focus();
}

function confirmAddRunCode() {
  const entered = document.getElementById('runCodeInput').value;
  const matched = findRunCode(entered);
  if (!matched) {
    alert('Please choose a valid run code from the list.');
    return;
  }
  addRunCode = matched;
  showAddUnitsStep();
}

function showAddUnitsStep(message, isError) {
  const info = orderLog.get(addRunCode) || { product: '-', format: '-' };
  const msgClass = isError ? 'text-error' : '';
  app.innerHTML = `
    ${UI.progressBar(ADD_PROGRESS_STEPS, 1)}
    ${confirmationBlock({
      code: palletCode,
      run: addRunCode,
      product: info.product,
      format: info.format
    })}
    <label for="unitInput">Enter number of units:</label>
    <input id="unitInput" type="number" min="1" />
    <div class="status ${msgClass}">${message ? escapeHTML(message) : ''}</div>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showAddRunCodeStep()">Back</button>
      <button class="btn btn-primary" onclick="confirmAddUnits()">Next</button>
    </div>
  `;
  const input = document.getElementById('unitInput');
  input.focus();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmAddUnits();
  });
}

function confirmAddUnits() {
  const units = parseInt(document.getElementById('unitInput').value, 10);
  if (!units || units <= 0) {
    showAddUnitsStep('Please enter a valid number of units greater than zero.', true);
    return;
  }
  showAddConfirmStep(units);
}

function showAddConfirmStep(units) {
  const info = orderLog.get(addRunCode) || { product: '-', format: '-' };
  app.innerHTML = `
    ${UI.progressBar(ADD_PROGRESS_STEPS, 2)}
    ${confirmationBlock({
      code: palletCode,
      run: addRunCode,
      product: info.product,
      format: info.format,
      units
    })}
    <label for="addCommentInput">Comments</label>
    <textarea id="addCommentInput" rows="3" placeholder="Optional">${escapeHTML(addComment)}</textarea>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="backFromAddConfirm(${units})">Back</button>
      <button class="btn btn-success" onclick="submitAddProduct(${units})">Confirm & Submit</button>
    </div>
  `;
}

function backFromAddConfirm(units) {
  const commentEl = document.getElementById('addCommentInput');
  addComment = commentEl ? commentEl.value : '';
  showAddUnitsStep();
}

async function submitAddProduct(units) {
  const commentEl = document.getElementById('addCommentInput');
  addComment = commentEl ? commentEl.value : '';
  try {
    app.innerHTML = `<p class="status">Writing stock addition…</p>`;
    await submitPalletEntry(palletCode, addRunCode, units, addComment, true);
    showFinishedScreen('Product removed and replacement added.');
  } catch (err) {
    console.error(err);
    app.innerHTML = UI.errorScreen(
      escapeHTML(err.message || 'Failed to write stock addition.'),
      `<button class="btn btn-ghost" onclick="showAddConfirmStep(${units})">Back</button>`
    );
  }
}

function showFinishedScreen(message) {
  app.innerHTML = UI.successScreen(
    message,
    UI.summaryCard([
      { label: 'Pallet ID', value: escapeHTML(palletCode) },
      { label: 'Removed', value: `${escapeHTML(selectedLine.runCode)} (−${removeQty})` },
      ...(addRunCode ? [{ label: 'Added', value: escapeHTML(addRunCode) }] : [])
    ]),
    `<button class="btn btn-primary" onclick="resetModule()">Edit Another Pallet</button>
     <a href="index.html" class="btn btn-ghost">Return to Main Menu</a>`
  );
}

function resetModule() {
  palletCode = '';
  palletLines = [];
  selectedLine = null;
  removeQty = 0;
  removeComment = '';
  addRunCode = '';
  addComment = '';
  showScanStep();
}

/* ---------- Expose + init ---------- */
window.confirmPalletScan = confirmPalletScan;
window.startPalletCameraScan = startPalletCameraScan;
window.showScanStep = showScanStep;
window.showSelectProductStep = showSelectProductStep;
window.confirmProductSelect = confirmProductSelect;
window.showRemoveQtyStep = showRemoveQtyStep;
window.confirmRemoveQty = confirmRemoveQty;
window.showReplaceChoiceStep = showReplaceChoiceStep;
window.chooseAddProduct = chooseAddProduct;
window.confirmAddRunCode = confirmAddRunCode;
window.showAddRunCodeStep = showAddRunCodeStep;
window.confirmAddUnits = confirmAddUnits;
window.showAddUnitsStep = showAddUnitsStep;
window.showAddConfirmStep = showAddConfirmStep;
window.backFromAddConfirm = backFromAddConfirm;
window.submitAddProduct = submitAddProduct;
window.resetModule = resetModule;

app.innerHTML = `<p class="status">Loading pallet data…</p>`;
loadData()
  .then(() => showScanStep())
  .catch(err => {
    console.error(err);
    app.innerHTML = `<p class="status text-error">Failed to load data. Please refresh and try again.</p>`;
  });
