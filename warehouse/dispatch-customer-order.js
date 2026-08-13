const app = document.getElementById('app');

const STAGING_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=332871798&single=true&output=csv';
const DISPATCH_HISTORY_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=848481035&single=true&output=csv';

const DISPATCH_URL = `${window.location.origin}/.netlify/functions/dispatch`;

const STAGING_COLS = {
  collectionRef: 0,
  pickRef: 1,
  palletId: 2,
  runCode: 3,
  company: 4,
  product: 5,
  format: 6,
  pickQty: 7,
  location: 8,
  pickStatus: 9
};

let allStagingRows = [];
let dispatchedPalletIds = new Set();
let currentCollection = null;
let dispatchMode = false;
let isSubmitting = false;

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
  for (const row of allStagingRows) {
    if (row.collectionId) ids.add(row.collectionId);
  }
  return Array.from(ids).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function statusLabel(status) {
  switch (status) {
    case 'dispatched': return 'Dispatched';
    default: return 'Picked';
  }
}

function isPalletDispatched(pallet) {
  return pallet.status === 'dispatched';
}

function applyHistoryStatus(pallets) {
  for (const p of pallets) {
    if (dispatchedPalletIds.has(p.palletId)) {
      p.status = 'dispatched';
    }
  }
}

function palletConfigForDisplay(pallet) {
  if (pallet.configLines && pallet.configLines.length) {
    return pallet.configLines.join('\n');
  }
  const parts = [pallet.product, pallet.format].filter(Boolean);
  return parts.join(' — ') || pallet.runCode || '-';
}

function buildCollection(collectionId) {
  const rows = allStagingRows.filter(r => r.collectionId === collectionId);
  if (!rows.length) return null;

  const byPallet = new Map();

  for (const r of rows) {
    let pallet = byPallet.get(r.palletId);
    if (!pallet) {
      pallet = {
        palletId: r.palletId,
        runCode: r.runCode,
        company: r.company,
        product: r.product,
        format: r.format,
        pickVolume: 0,
        location: '',
        configLines: [],
        status: 'picked'
      };
      byPallet.set(r.palletId, pallet);
    }

    pallet.pickVolume += r.pickVolume;

    if (r.location && !pallet.location) {
      pallet.location = r.location;
    }

    const config = [r.product, r.format].filter(Boolean).join(' — ') || r.runCode;
    if (config && !pallet.configLines.includes(config)) {
      pallet.configLines.push(config);
    }
  }

  const pallets = Array.from(byPallet.values());
  applyHistoryStatus(pallets);

  return {
    id: collectionId,
    company: rows[0].company || '',
    pallets
  };
}

function progressText(collection) {
  const total = collection.pallets.length;
  const done = collection.pallets.filter(isPalletDispatched).length;
  return `${done} / ${total} Pallets Dispatched`;
}

function isCollectionComplete(collection) {
  return collection.pallets.length > 0 && collection.pallets.every(isPalletDispatched);
}

function tableHTML(collection) {
  const rows = collection.pallets.map(p => `
    <tr>
      <td>${escapeHTML(statusLabel(p.status))}</td>
      <td>${escapeHTML(p.palletId)}</td>
      <td class="pre-line">${escapeHTML(palletConfigForDisplay(p))}</td>
      <td class="pick-qty">${escapeHTML(String(p.pickVolume || 0))}</td>
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
            <th>Pallet Config</th>
            <th>Pick Volume</th>
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

function wireOpenCollectionButton() {
  const select = document.getElementById('collectionSelect');
  const btn = document.getElementById('openCollectionBtn');
  if (!select || !btn) return;

  const sync = () => {
    btn.disabled = !(select.value || '').trim();
  };

  select.addEventListener('change', sync);
  sync();
}

function showSelectStep() {
  dispatchMode = false;
  currentCollection = null;
  isSubmitting = false;

  const ids = getUniqueCollectionIds();
  if (!ids.length) {
    app.innerHTML = '<p class="status">No staged collections found.</p>';
    return;
  }

  app.innerHTML = `
    <label for="collectionSelect">Select Collection ID:</label>
    <select id="collectionSelect">
      <option value="">-- Choose a collection --</option>
      ${ids.map(id => `<option value="${escapeHTML(id)}">${escapeHTML(id)}</option>`).join('')}
    </select>
    <div class="actions mt-3">
      <button id="openCollectionBtn" class="btn btn-primary" onclick="openSelectedCollection()" disabled>Open Collection</button>
    </div>
  `;

  wireOpenCollectionButton();
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

  dispatchMode = false;
  isSubmitting = false;
  showOverviewStep();
}

function showOverviewStep() {
  if (!currentCollection) return;

  app.innerHTML = `
    ${summaryHTML(currentCollection)}
    ${tableHTML(currentCollection)}
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showSelectStep()">Change Collection</button>
      <button class="btn btn-success" onclick="startDispatch()">Dispatch Items</button>
    </div>
  `;
}

function startDispatch() {
  if (!currentCollection || isCollectionComplete(currentCollection)) {
    showCompleteScreen();
    return;
  }
  dispatchMode = true;
  isSubmitting = false;
  showDispatchStep();
}

function stopDispatch() {
  dispatchMode = false;
  isSubmitting = false;
  showOverviewStep();
}

function showDispatchStep(message, isError) {
  if (!currentCollection) return;

  const msgClass = isError ? 'text-error' : '';
  const busy = isSubmitting;

  app.innerHTML = `
    ${summaryHTML(currentCollection)}
    ${tableHTML(currentCollection)}
    <div id="dispatchMessage" class="status ${msgClass}">${message ? escapeHTML(message) : 'Scan pallet barcode.'}</div>
    <label for="palletInput">Scan Pallet</label>
    <input id="palletInput" maxlength="15" placeholder="Scan or type 15 digits"
           inputmode="none" autocomplete="off" autocapitalize="off" ${busy ? 'disabled' : ''} />
    <div class="actions mt-3">
      <button class="btn btn-success" onclick="confirmScanPallet()" ${busy ? 'disabled' : ''}>Confirm Pallet</button>
      <button type="button" class="btn btn-secondary btn-block" onclick="startCameraScan()" ${busy ? 'disabled' : ''}>
        <span class="btn-icon">${UI.ICONS.camera}</span>Use Camera
      </button>
    </div>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="stopDispatch()" ${busy ? 'disabled' : ''}>Back to Collection</button>
    </div>
  `;

  const input = document.getElementById('palletInput');
  if (!input || busy) return;

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmScanPallet();
  });

  function focusPalletInput() {
    const el = document.getElementById('palletInput');
    if (!el || el.disabled) return;
    el.focus();
    if (el.select) el.select();
  }

  setTimeout(focusPalletInput, 0);
  setTimeout(focusPalletInput, 120);
}

function confirmScanPallet() {
  if (isSubmitting) return;

  const val = (document.getElementById('palletInput').value || '').trim();
  if (val.length !== 15 || isNaN(val)) {
    showDispatchStep('Please enter a valid 15-digit pallet number.', true);
    return;
  }
  processPalletScan(val);
}

function normalizePalletId(id) {
  const s = String(id || '').trim();
  if (/^\d+$/.test(s) && s.length > 0 && s.length < 15) return s.padStart(15, '0');
  return s;
}

function processPalletScan(palletId) {
  if (!currentCollection || isSubmitting) return;

  const scannedId = normalizePalletId(palletId);
  const match = currentCollection.pallets.find(p => normalizePalletId(p.palletId) === scannedId);
  if (!match) {
    showDispatchStep('This pallet is not part of this collection.', true);
    return;
  }

  if (isPalletDispatched(match) || dispatchedPalletIds.has(scannedId) || dispatchedPalletIds.has(match.palletId)) {
    match.status = 'dispatched';
    showDispatchStep('This pallet has already been dispatched.', true);
    return;
  }

  submitDispatch(match, scannedId);
}

async function submitDispatch(pallet, scannedId) {
  if (isSubmitting) return;
  isSubmitting = true;

  showDispatchStep('Dispatching…', false);

  const palletId = normalizePalletId(scannedId || pallet.palletId);
  const { date, time } = formatDateTimeForSheets();
  const body = new URLSearchParams();
  body.append('reference', currentCollection.id);
  body.append('pallet', palletId);
  body.append('date', date);
  body.append('time', time);

  try {
    const res = await fetch(DISPATCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const data = await res.json();

    if (data.result !== 'ok' && data.result !== 'success') {
      throw new Error(data.message || 'Dispatch failed.');
    }

    pallet.status = 'dispatched';
    pallet.palletId = palletId;
    dispatchedPalletIds.add(palletId);
    isSubmitting = false;

    if (isCollectionComplete(currentCollection)) {
      showCompleteScreen();
      return;
    }

    showDispatchStep(`Pallet ${palletId} dispatched — continue scanning.`, false);
  } catch (err) {
    console.error(err);
    isSubmitting = false;
    showDispatchStep('Dispatch failed. Please try again.', true);
  }
}

function showCompleteScreen() {
  if (!currentCollection) return;
  dispatchMode = false;
  isSubmitting = false;

  app.innerHTML = UI.successScreen(
    'Collection Complete',
    UI.summaryCard([
      { label: 'Collection ID', value: escapeHTML(currentCollection.id) },
      { label: 'Customer', value: escapeHTML(currentCollection.company || '-') },
      { label: 'Progress', value: escapeHTML(progressText(currentCollection)) }
    ]),
    `
      <button class="btn btn-primary" onclick="showSelectStep()">Dispatch Another Collection</button>
      <button class="btn btn-ghost" onclick="showSelectStep()">Change Collection</button>
    `
  );
}

/* ===== Camera scanning ===== */
async function startCameraScan() {
  if (isSubmitting) return;

  await runPalletCameraScan(raw => {
    if (raw.length !== 15 || isNaN(raw)) {
      showDispatchStep('Please enter a valid 15-digit pallet number.', true);
      return;
    }
    processPalletScan(raw);
  }, () => showDispatchStep('Barcode detection failed.', true));
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
function loadStagingRows(text) {
  const rowStrings = splitCSVRows(text);
  allStagingRows = [];

  for (let i = 0; i < rowStrings.length; i++) {
    const r = parseCSVRow(rowStrings[i]);
    if (i === 0 && isHeaderRow(r, 'COLLECTION')) continue;

    const collectionId = cleanCSVField(r[STAGING_COLS.collectionRef]);
    const pickRef = cleanCSVField(r[STAGING_COLS.pickRef]);
    const palletId = cleanCSVField(r[STAGING_COLS.palletId]);
    if (!collectionId || !palletId) continue;

    const locationRaw = cleanCSVField(r[STAGING_COLS.location]);
    const location = (!locationRaw || locationRaw === '#REF!' || locationRaw === 'FALSE')
      ? ''
      : locationRaw;

    allStagingRows.push({
      collectionId,
      pickRef,
      palletId: normalizePalletId(palletId),
      runCode: cleanCSVField(r[STAGING_COLS.runCode]),
      company: cleanCSVField(r[STAGING_COLS.company]),
      product: cleanCSVField(r[STAGING_COLS.product]),
      format: cleanCSVField(r[STAGING_COLS.format]),
      pickVolume: parseUnits(r[STAGING_COLS.pickQty]),
      location
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
    const [stagingRes, dispatchRes] = await Promise.all([
      fetch(STAGING_CSV),
      fetch(DISPATCH_HISTORY_CSV)
    ]);

    if (!stagingRes.ok || !dispatchRes.ok) {
      throw new Error('Failed to load CSV data.');
    }

    const [stagingText, dispatchText] = await Promise.all([
      stagingRes.text(),
      dispatchRes.text()
    ]);

    loadStagingRows(stagingText);
    loadDispatchHistory(dispatchText);
    showSelectStep();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<p class="status">Failed to load data. Please refresh and try again.</p>`;
  }
}

window.openSelectedCollection = openSelectedCollection;
window.startDispatch = startDispatch;
window.stopDispatch = stopDispatch;
window.confirmScanPallet = confirmScanPallet;
window.startCameraScan = startCameraScan;
window.showSelectStep = showSelectStep;

init();
