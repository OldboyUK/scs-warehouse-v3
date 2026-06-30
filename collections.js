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

function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  const rows = [];
  for (const line of lines) {
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
    rows.push(out);
  }
  return rows;
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
    config: r.palletConfig,
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
      <td style="white-space:pre-line;">${escapeHTML(p.config || '-')}</td>
      <td>${escapeHTML(p.location || '-')}</td>
    </tr>
  `).join('');

  return `
    <div style="overflow-x:auto; margin-top:16px;">
      <table style="width:100%; border-collapse:collapse; font-size:0.95em;">
        <thead>
          <tr style="border-bottom:1px solid var(--card-border); text-align:left;">
            <th style="padding:10px 8px;">Status</th>
            <th style="padding:10px 8px;">Pallet ID</th>
            <th style="padding:10px 8px;">Pallet Configuration</th>
            <th style="padding:10px 8px;">Location</th>
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
  return `
    <div style="border:1px solid var(--card-border);border-radius:12px;padding:12px;background:rgba(255,255,255,0.05);">
      <div><strong>Collection ID:</strong> ${escapeHTML(collection.id)}</div>
      <div><strong>Customer:</strong> ${escapeHTML(collection.customer || '-')}</div>
      <div><strong>Progress:</strong> ${escapeHTML(progressText(collection))}</div>
    </div>
  `;
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

  const msgClass = isError ? 'color:#ff6b6b;' : 'color:var(--muted);';

  app.innerHTML = `
    ${summaryHTML(currentCollection)}
    ${tableHTML(currentCollection)}
    <div id="dispatchMessage" class="status" style="${msgClass}">${message ? escapeHTML(message) : 'Scan or enter a pallet barcode.'}</div>
    <label for="palletInput">Pallet Identifier (15-digit code):</label>
    <input id="palletInput" maxlength="15" placeholder="Scan or type 15 digits" />
    <div class="actions mt-3">
      <button class="btn btn-success" onclick="confirmScanPallet()">Confirm Pallet</button>
      <button class="btn btn-primary" onclick="startCameraScan()">Use Camera</button>
    </div>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="stopDispatch()">Back to Collection</button>
    </div>
  `;

  const input = document.getElementById('palletInput');
  input.focus();
  if (input.select) input.select();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmScanPallet();
  });
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
      <p class="status">Scanning… Point camera at barcode.</p>
    `;
    app.appendChild(video);
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

  app.innerHTML = `
    <div style="border:1px solid var(--card-border);border-radius:12px;padding:16px;background:rgba(255,255,255,0.05);">
      <h2 style="margin:0 0 12px;">Collection Complete</h2>
      <div><strong>Collection ID:</strong> ${escapeHTML(currentCollection.id)}</div>
      <div><strong>Customer:</strong> ${escapeHTML(currentCollection.customer || '-')}</div>
      <div><strong>Total pallets dispatched:</strong> ${total}</div>
    </div>
    <div class="actions mt-3">
      <a href="Index.html" class="btn btn-primary">Return to Main Menu</a>
    </div>
  `;
}

function loadCollectionRows(text) {
  const rows = parseCSV(text);
  allCollectionRows = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const collectionId = (r[0] || '').trim();
    const palletId = (r[1] || '').trim();
    if (!collectionId || !palletId) continue;
    if (i === 0 && collectionId.toUpperCase() === 'COLLECTION ID') continue;

    allCollectionRows.push({
      collectionId,
      palletId,
      customer: (r[2] || '').trim(),
      palletConfig: (r[3] || '').trim(),
      location: (r[5] || '').trim()
    });
  }
}

function loadDispatchHistory(text) {
  const rows = parseCSV(text);
  dispatchedPalletIds.clear();

  for (let i = 0; i < rows.length; i++) {
    const palletId = (rows[i][0] || '').trim();
    if (!palletId) continue;
    if (i === 0 && palletId.toUpperCase() === 'PALLET ID') continue;
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
