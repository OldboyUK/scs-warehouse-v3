const app = document.getElementById('app');

const COLLECTIONS_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1420200114&single=true&output=csv';
const DISPATCH_HISTORY_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=848481035&single=true&output=csv';
const DISPATCH_URL = `${window.location.origin}/.netlify/functions/dispatch`;

let allCollectionRows = [];
let dispatchedPalletIds = new Set();
let currentCollection = null;
let dispatchMode = false;

/* =========================
   CSV parsing (multiline-safe)
   Same approach as pallet-dispatch.js
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
  return cleanCSVField(fields[0]).toUpperCase() === headerLabel;
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

function getUniqueCollectionIds() {
  const ids = new Set();
  for (const row of allCollectionRows) {
    if (row.collectionId) ids.add(row.collectionId);
  }
  return Array.from(ids).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function isMobileView() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function palletConfigForDisplay(pallet) {
  const desktop = pallet.configDesktop || '';
  const mobile = pallet.configMobile || '';
  if (isMobileView()) return mobile || desktop;
  return desktop || mobile;
}

function applyDispatchStatus(pallets) {
  for (const p of pallets) {
    p.dispatched = dispatchedPalletIds.has(p.palletId);
  }
}

function buildCollection(collectionId) {
  const rows = allCollectionRows.filter(r => r.collectionId === collectionId);
  if (!rows.length) return null;

  const pallets = rows.map(r => ({
    palletId: r.palletId,
    configDesktop: r.configDesktop,
    configMobile: r.configMobile,
    location: r.location,
    dispatched: false
  }));

  applyDispatchStatus(pallets);

  return {
    id: collectionId,
    customer: rows[0].customer || '',
    pallets
  };
}

function progressText(collection) {
  const total = collection.pallets.length;
  const done = collection.pallets.filter(p => p.dispatched).length;
  return `${done} / ${total} dispatched`;
}

function isCollectionComplete(collection) {
  return collection.pallets.length > 0 && collection.pallets.every(p => p.dispatched);
}

function tableHTML(collection) {
  const rows = collection.pallets.map(p => `
    <tr>
      <td>${p.dispatched ? 'Dispatched' : 'Pending'}</td>
      <td>${escapeHTML(p.palletId)}</td>
      <td class="pre-line">${escapeHTML(palletConfigForDisplay(p) || '-')}</td>
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
    { label: 'Customer', value: escapeHTML(collection.customer || '-') },
    { label: 'Progress', value: escapeHTML(progressText(collection)) }
  ]);
}

function showLoading(message) {
  app.innerHTML = `<p class="status">${escapeHTML(message || 'Loading…')}</p>`;
}

function showSelectStep() {
  dispatchMode = false;
  currentCollection = null;

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

  dispatchMode = false;
  showOverviewStep();
}

function showOverviewStep() {
  if (!currentCollection) return;

  app.innerHTML = `
    ${summaryHTML(currentCollection)}
    ${tableHTML(currentCollection)}
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showSelectStep()">Change Collection</button>
      <button class="btn btn-success" onclick="startDispatch()">Start Dispatch</button>
    </div>
  `;
}

function startDispatch() {
  if (!currentCollection || isCollectionComplete(currentCollection)) {
    showCompleteScreen();
    return;
  }
  dispatchMode = true;
  showDispatchStep();
}

function showDispatchStep(message, isError) {
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
      <button class="btn btn-ghost" onclick="stopDispatch()">Back to Collection</button>
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

  /* Defer focus until presentation enhancements have moved the input */
  setTimeout(focusPalletInput, 0);
  setTimeout(focusPalletInput, 120);
}

function stopDispatch() {
  dispatchMode = false;
  showOverviewStep();
}

function confirmScanPallet() {
  const val = (document.getElementById('palletInput').value || '').trim();
  if (val.length !== 15 || isNaN(val)) {
    showDispatchStep('Please enter a valid 15-digit number.', true);
    return;
  }
  processPalletScan(val);
}

function processPalletScan(palletId) {
  if (!currentCollection) return;

  const pallet = currentCollection.pallets.find(p => p.palletId === palletId);
  if (!pallet) {
    showDispatchStep('This pallet is not part of this Collection.', true);
    return;
  }
  if (pallet.dispatched) {
    showDispatchStep('This pallet has already been dispatched.', true);
    return;
  }

  submitDispatch(palletId);
}

async function startCameraScan() {
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
      ${summaryHTML(currentCollection)}
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
          const raw = (barcodes[0].rawValue || '').trim();
          if (raw.length !== 15 || isNaN(raw)) {
            showDispatchStep('Scanned code is not a valid 15-digit number.', true);
            return;
          }
          processPalletScan(raw);
          return;
        }
        requestAnimationFrame(scan);
      } catch (err) {
        console.error(err);
        stream.getTracks().forEach(t => t.stop());
        showDispatchStep('Barcode detection failed.', true);
      }
    };

    scan();
  } catch (err) {
    alert('Camera access denied or unavailable.');
  }
}

function submitDispatch(palletId) {
  const { date, time } = formatDateTimeForSheets();
  const body = new URLSearchParams();
  body.append('pallet', palletId);
  body.append('date', date);
  body.append('time', time);

  app.innerHTML = `
    ${summaryHTML(currentCollection)}
    ${tableHTML(currentCollection)}
    <p class="status">Submitting dispatch for ${escapeHTML(palletId)}…</p>
  `;

  fetch(DISPATCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
    .then(r => r.json())
    .then(data => {
      if (data.result !== 'ok' && data.result !== 'success') {
        showDispatchStep(data.message || 'Dispatch failed.', true);
        return;
      }

      dispatchedPalletIds.add(palletId);
      const pallet = currentCollection.pallets.find(p => p.palletId === palletId);
      if (pallet) pallet.dispatched = true;

      if (isCollectionComplete(currentCollection)) {
        showCompleteScreen();
        return;
      }

      showDispatchStep(`Pallet ${palletId} dispatched.`, false);
    })
    .catch(err => {
      console.error(err);
      showDispatchStep('Network error. Please try again.', true);
    });
}

function showCompleteScreen() {
  if (!currentCollection) return;
  dispatchMode = false;

  const total = currentCollection.pallets.length;

  app.innerHTML = UI.successScreen(
    'Collection Complete',
    UI.summaryCard([
      { label: 'Collection ID', value: escapeHTML(currentCollection.id) },
      { label: 'Customer', value: escapeHTML(currentCollection.customer || '-') },
      { label: 'Total pallets dispatched', value: String(total) }
    ]),
    `<a href="Index.html" class="btn btn-primary">Return to Main Menu</a>`
  );
}

function loadCollectionRows(text) {
  const rowStrings = splitCSVRows(text);
  allCollectionRows = [];

  for (let i = 0; i < rowStrings.length; i++) {
    const r = parseCSVRow(rowStrings[i]);
    if (i === 0 && isHeaderRow(r, 'COLLECTION ID')) continue;

    const collectionId = cleanCSVField(r[0]);
    const palletId = cleanCSVField(r[1]);
    if (!collectionId || !palletId) continue;

    allCollectionRows.push({
      collectionId,
      palletId,
      customer: cleanCSVField(r[2]),
      configDesktop: cleanCSVField(r[3]),
      configMobile: cleanCSVField(r[4]),
      dispatchStatus: cleanCSVField(r[5]),
      location: cleanCSVField(r[6])
    });
  }
}

function loadDispatchHistory(text) {
  const rowStrings = splitCSVRows(text);
  dispatchedPalletIds.clear();

  for (let i = 0; i < rowStrings.length; i++) {
    const r = parseCSVRow(rowStrings[i]);
    if (i === 0 && isHeaderRow(r, 'PALLET ID')) continue;

    const palletId = cleanCSVField(r[0]);
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
window.startDispatch = startDispatch;
window.stopDispatch = stopDispatch;
window.confirmScanPallet = confirmScanPallet;
window.startCameraScan = startCameraScan;
window.showSelectStep = showSelectStep;

init();
