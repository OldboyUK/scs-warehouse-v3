const app = document.getElementById('app');

const STAGING_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=332871798&single=true&output=csv';
const DISPATCH_HISTORY_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=848481035&single=true&output=csv';
const STOCK_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1879287780&single=true&output=csv';

const DISPATCH_URL = `${window.location.origin}/.netlify/functions/dispatch`;
const DISPATCH_DOCS_URL = `${window.location.origin}/.netlify/functions/uploadDispatchDocuments`;

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
let palletStock = new Map();
let currentCollection = null;
let dispatchMode = false;
let isSubmitting = false;
let additionalDocs = emptyAdditionalDocs();
let signaturePad = null;

function emptyAdditionalDocs() {
  return {
    photos: [],
    signature: null,
    signatureConfirmed: false,
    signatureUploaded: false,
    signatureFileName: '',
    signatureError: '',
    hasStroke: false,
    isUploading: false
  };
}

function resetAdditionalDocs() {
  additionalDocs = emptyAdditionalDocs();
  signaturePad = null;
}

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

function runKey(run) {
  return String(run || '').trim().toUpperCase();
}

function loadPalletStock(text) {
  palletStock.clear();
  const rowStrings = splitCSVRows(text);
  for (let i = 0; i < rowStrings.length; i++) {
    const r = parseCSVRow(rowStrings[i]);
    const palletId = normalizePalletId(cleanCSVField(r[0]));
    if (!palletId || (i === 0 && /pallet/i.test(palletId))) continue;
    const units = parseUnits(r[6] != null && String(r[6]).trim() !== '' ? r[6] : r[5]);
    if (units <= 0) continue;
    if (!palletStock.has(palletId)) palletStock.set(palletId, []);
    palletStock.get(palletId).push({
      runCode: cleanCSVField(r[1]),
      company: cleanCSVField(r[2]),
      product: cleanCSVField(r[3]),
      format: cleanCSVField(r[4]),
      units
    });
  }
}

function leftoverStockForPallet(palletId) {
  const id = normalizePalletId(palletId);
  const stock = palletStock.get(id) || [];
  const stagedRuns = new Set(
    allStagingRows
      .filter(r => normalizePalletId(r.palletId) === id)
      .map(r => runKey(r.runCode))
      .filter(Boolean)
  );
  if (!stagedRuns.size) return [];
  return stock.filter(line => !stagedRuns.has(runKey(line.runCode)));
}

function formatDispatchBlockedMessage(leftover) {
  const details = leftover.map(line => `${line.runCode} — ${line.units} units remaining.`).join('\n');
  return `Cannot dispatch pallet\nThis pallet still contains stock that has not been picked or transferred.\n${details}\nThis stock must be picked or transferred to another pallet before dispatch.`;
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
  resetAdditionalDocs();

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
  resetAdditionalDocs();
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

  const leftover = leftoverStockForPallet(scannedId);
  if (leftover.length) {
    showDispatchStep(formatDispatchBlockedMessage(leftover), true);
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
    showDispatchStep(err.message || 'Dispatch failed. Please try again.', true);
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
      <button class="btn btn-success" type="button" onclick="showAdditionalDocuments()">Provide Additional Documents</button>
      <button class="btn btn-primary" onclick="showSelectStep()">Dispatch Another Collection</button>
      <button class="btn btn-ghost" onclick="showSelectStep()">Change Collection</button>
    `
  );
}

/* ===== Additional documents (vehicle photos + driver signature) ===== */
function uploadedPhotoCount() {
  return additionalDocs.photos.filter(p => p.uploaded).length;
}

function canFinishAdditionalDocs() {
  return uploadedPhotoCount() > 0 || additionalDocs.signatureUploaded;
}

function extensionFromName(name, mimeType) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  if (m) return '.' + m[1].toLowerCase();
  if (String(mimeType || '').indexOf('png') !== -1) return '.png';
  if (String(mimeType || '').indexOf('webp') !== -1) return '.webp';
  return '.jpg';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
}

function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1920;
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w > max || h > max) {
        const scale = Math.min(max / w, max / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not process the selected image.'));
    };
    img.src = url;
  });
}

async function prepareDispatchImage(file) {
  const maxDirect = 2.5 * 1024 * 1024;
  if (file.size > maxDirect) {
    const dataUrl = await compressImageFile(file);
    return { dataUrl, mimeType: 'image/jpeg', extension: '.jpg' };
  }
  const dataUrl = await readFileAsDataUrl(file);
  return {
    dataUrl,
    mimeType: file.type || 'image/jpeg',
    extension: extensionFromName(file.name, file.type)
  };
}

async function postDispatchDocument(documentKind, image) {
  if (!currentCollection || !currentCollection.id) {
    throw new Error('Missing order reference.');
  }
  const res = await fetch(DISPATCH_DOCS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documentKind,
      reference: currentCollection.id,
      mimeType: image.mimeType,
      extension: image.extension,
      imageBase64: image.dataUrl
    })
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  if (!json || (json.result !== 'ok' && json.result !== 'success')) {
    throw new Error((json && json.message) || 'Upload failed.');
  }
  return json;
}

function vehiclePhotoSectionHTML() {
  const previews = additionalDocs.photos.map((p, i) => {
    const status = p.uploaded
      ? 'Uploaded'
      : (p.error ? 'Upload failed' : (p.uploading ? 'Uploading…' : 'Ready'));
    const statusClass = p.error ? 'dispatch-docs-preview-status is-error' : 'dispatch-docs-preview-status';
    const retry = p.error && !additionalDocs.isUploading
      ? `<button type="button" class="btn btn-ghost dispatch-docs-retry" onclick="retryVehiclePhoto(${i})">Retry upload</button>`
      : '';
    return `
      <div class="dispatch-docs-preview">
        <img src="${p.dataUrl}" alt="Loaded vehicle photo ${i + 1}" />
        <span class="${statusClass}">${escapeHTML(status)}</span>
        ${retry}
      </div>
    `;
  }).join('');

  const takeLabel = additionalDocs.photos.length ? 'Add Another Photo' : 'Take Photo';
  const busy = additionalDocs.isUploading;

  return `
    <h2 class="dispatch-docs-heading">Add Photos of the Loaded Vehicle</h2>
    <label class="btn btn-secondary btn-block" for="vehiclePhotoInput">
      <span class="btn-icon">${UI.ICONS.camera}</span>${takeLabel}
    </label>
    <input id="vehiclePhotoInput" type="file" accept="image/*" capture="environment" hidden ${busy ? 'disabled' : ''} />
    <p id="vehiclePhotoStatus" class="status"></p>
    ${previews ? `<div class="dispatch-docs-previews">${previews}</div>` : ''}
  `;
}

function signatureSectionHTML() {
  if (additionalDocs.signatureUploaded) {
    return `
      <h2 class="dispatch-docs-heading">Capture Driver Signature</h2>
      <p class="status">Driver signature captured</p>
      ${additionalDocs.signature ? `<img class="dispatch-docs-signature-preview" src="${additionalDocs.signature.dataUrl}" alt="Driver signature" />` : ''}
    `;
  }

  if (additionalDocs.signature && (additionalDocs.isUploading || additionalDocs.signatureConfirmed)) {
    const status = additionalDocs.isUploading
      ? '<p class="status">Uploading signature…</p>'
      : (additionalDocs.signatureError
        ? `<p class="status status-error">${escapeHTML(additionalDocs.signatureError)}</p>`
        : '');
    const actions = additionalDocs.isUploading ? '' : `
      <div class="actions actions-stack">
        <button class="btn btn-success" type="button" onclick="confirmDriverSignature()">Try Again</button>
        <button class="btn btn-ghost" type="button" onclick="clearDriverSignature()">Clear Signature</button>
      </div>
    `;
    return `
      <h2 class="dispatch-docs-heading">Capture Driver Signature</h2>
      ${status}
      <img class="dispatch-docs-signature-preview" src="${additionalDocs.signature.dataUrl}" alt="Driver signature" />
      ${actions}
    `;
  }

  const error = additionalDocs.signatureError
    ? `<p class="status status-error">${escapeHTML(additionalDocs.signatureError)}</p>`
    : '';

  return `
    <h2 class="dispatch-docs-heading">Capture Driver Signature</h2>
    <p class="dispatch-docs-pad-hint">Sign here with your finger</p>
    <div class="dispatch-docs-pad-wrap">
      <canvas id="signaturePad" class="dispatch-docs-pad"></canvas>
    </div>
    ${error}
    <div class="actions actions-stack">
      <button class="btn btn-ghost" type="button" onclick="clearDriverSignature()" ${additionalDocs.isUploading ? 'disabled' : ''}>Clear Signature</button>
      <button class="btn btn-success" type="button" onclick="confirmDriverSignature()" ${additionalDocs.isUploading ? 'disabled' : ''}>Confirm Signature</button>
    </div>
  `;
}

function additionalDocsActionsHTML() {
  const canFinish = canFinishAdditionalDocs();
  return `
    <div id="additionalDocsActions" class="actions actions-stack">
      <button class="btn btn-primary" type="button" onclick="finishAdditionalDocuments()" ${canFinish && !additionalDocs.isUploading ? '' : 'disabled'}>Finish</button>
      <button class="btn btn-ghost" type="button" onclick="showCompleteScreen()" ${additionalDocs.isUploading ? 'disabled' : ''}>Back</button>
    </div>
  `;
}

function showAdditionalDocuments() {
  if (!currentCollection) return;
  renderAdditionalDocuments();
}

function renderAdditionalDocuments() {
  if (!currentCollection) return;

  app.innerHTML = `
    <div class="dispatch-docs">
      <h2 class="dispatch-docs-title">Additional Documents</h2>
      ${UI.summaryCard([
        { label: 'Collection ID', value: escapeHTML(currentCollection.id) },
        { label: 'Customer', value: escapeHTML(currentCollection.company || '-') }
      ])}
      <section id="vehiclePhotoSection" class="dispatch-docs-section">
        ${vehiclePhotoSectionHTML()}
      </section>
      <section id="signatureSection" class="dispatch-docs-section">
        ${signatureSectionHTML()}
      </section>
      ${additionalDocsActionsHTML()}
    </div>
  `;

  wireVehiclePhotoInput();
  if (shouldInitSignaturePad()) {
    requestAnimationFrame(() => initSignaturePad());
  }
}

function refreshPhotoSection() {
  const section = document.getElementById('vehiclePhotoSection');
  if (!section) {
    renderAdditionalDocuments();
    return;
  }
  section.innerHTML = vehiclePhotoSectionHTML();
  wireVehiclePhotoInput();
  refreshAdditionalDocsActions();
}

function shouldInitSignaturePad() {
  return !additionalDocs.signatureUploaded && !additionalDocs.signatureConfirmed;
}

function refreshSignatureSection() {
  const section = document.getElementById('signatureSection');
  if (!section) {
    renderAdditionalDocuments();
    return;
  }
  section.innerHTML = signatureSectionHTML();
  if (shouldInitSignaturePad()) {
    requestAnimationFrame(() => initSignaturePad());
  }
  refreshAdditionalDocsActions();
}

function refreshAdditionalDocsActions() {
  const existing = document.getElementById('additionalDocsActions');
  if (!existing) return;
  existing.outerHTML = additionalDocsActionsHTML();
}

function wireVehiclePhotoInput() {
  const input = document.getElementById('vehiclePhotoInput');
  if (!input) return;
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    await handleVehiclePhotoFile(file);
  });
}

async function handleVehiclePhotoFile(file) {
  const status = document.getElementById('vehiclePhotoStatus');
  if (status) status.textContent = 'Preparing photo…';
  try {
    const prepared = await prepareDispatchImage(file);
    additionalDocs.photos.push({
      dataUrl: prepared.dataUrl,
      mimeType: prepared.mimeType,
      extension: prepared.extension,
      uploaded: false,
      uploading: false,
      error: '',
      fileName: ''
    });
    refreshPhotoSection();
    await uploadVehiclePhoto(additionalDocs.photos.length - 1);
  } catch (err) {
    console.error(err);
    if (status) {
      status.textContent = err.message || 'Could not read that image.';
      status.classList.add('status-error');
    } else {
      alert(err.message || 'Could not read that image.');
    }
  }
}

async function uploadVehiclePhoto(index) {
  const photo = additionalDocs.photos[index];
  if (!photo || photo.uploaded || additionalDocs.isUploading) return;

  additionalDocs.isUploading = true;
  photo.uploading = true;
  photo.error = '';
  refreshPhotoSection();

  try {
    const json = await postDispatchDocument('vehicle_photo', photo);
    photo.uploaded = true;
    photo.fileName = json.fileName || '';
  } catch (err) {
    console.error(err);
    photo.error = err.message || 'Upload failed.';
  } finally {
    photo.uploading = false;
    additionalDocs.isUploading = false;
    refreshPhotoSection();
    const next = additionalDocs.photos.findIndex(p => !p.uploaded && !p.uploading && !p.error);
    if (next !== -1) uploadVehiclePhoto(next);
  }
}

function initSignaturePad() {
  const canvas = document.getElementById('signaturePad');
  if (!canvas) return;

  const wrap = canvas.parentElement;
  const cssWidth = Math.max(wrap ? wrap.clientWidth : 0, canvas.clientWidth || 0, 280);
  const cssHeight = 260;
  const dpr = window.devicePixelRatio || 1;

  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 2.75;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  additionalDocs.hasStroke = false;
  let drawing = false;

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    additionalDocs.hasStroke = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  });

  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });

  function stopDraw(e) {
    if (!drawing) return;
    drawing = false;
    if (e && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  }

  canvas.addEventListener('pointerup', stopDraw);
  canvas.addEventListener('pointercancel', stopDraw);
  canvas.addEventListener('pointerleave', stopDraw);

  signaturePad = { canvas, ctx, cssWidth, cssHeight };
}

function clearDriverSignature() {
  if (additionalDocs.signatureUploaded || additionalDocs.isUploading) return;
  additionalDocs.signatureError = '';
  additionalDocs.hasStroke = false;
  additionalDocs.signature = null;
  additionalDocs.signatureConfirmed = false;
  refreshSignatureSection();
}

async function retryVehiclePhoto(index) {
  await uploadVehiclePhoto(index);
}

async function confirmDriverSignature() {
  if (additionalDocs.signatureUploaded || additionalDocs.isUploading) return;

  if (!additionalDocs.signature) {
    if (!signaturePad || !signaturePad.canvas) {
      additionalDocs.signatureError = 'Signature pad is not ready. Please try again.';
      refreshSignatureSection();
      return;
    }
    if (!additionalDocs.hasStroke) {
      additionalDocs.signatureError = 'Please sign before confirming.';
      const err = document.querySelector('#signatureSection .status-error');
      if (err) err.textContent = additionalDocs.signatureError;
      else refreshSignatureSection();
      return;
    }
    additionalDocs.signature = {
      dataUrl: signaturePad.canvas.toDataURL('image/png'),
      mimeType: 'image/png',
      extension: '.png'
    };
  }

  additionalDocs.signatureConfirmed = true;
  additionalDocs.signatureError = '';
  additionalDocs.isUploading = true;
  refreshSignatureSection();

  try {
    const json = await postDispatchDocument('driver_signature', additionalDocs.signature);
    additionalDocs.signatureUploaded = true;
    additionalDocs.signatureFileName = json.fileName || '';
    additionalDocs.isUploading = false;
    refreshSignatureSection();
    showAdditionalDocsConfirmation();
  } catch (err) {
    console.error(err);
    additionalDocs.signatureError = err.message || 'Signature upload failed.';
    additionalDocs.isUploading = false;
    refreshSignatureSection();
  }
}

function finishAdditionalDocuments() {
  if (additionalDocs.isUploading) return;
  if (!canFinishAdditionalDocs()) return;
  showAdditionalDocsConfirmation();
}

function showAdditionalDocsConfirmation() {
  const photos = uploadedPhotoCount();
  const signature = additionalDocs.signatureUploaded ? 'Uploaded' : 'Not provided';
  app.innerHTML = UI.successScreen(
    'Additional Documents Uploaded',
    `Vehicle Photos: ${photos}\nDriver Signature: ${signature}`,
    `<button class="btn btn-primary" type="button" onclick="showSelectStep()">Finish</button>`
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
    const [stagingRes, dispatchRes, stockRes] = await Promise.all([
      fetch(STAGING_CSV),
      fetch(DISPATCH_HISTORY_CSV),
      fetch(STOCK_CSV)
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
window.startDispatch = startDispatch;
window.stopDispatch = stopDispatch;
window.confirmScanPallet = confirmScanPallet;
window.startCameraScan = startCameraScan;
window.showSelectStep = showSelectStep;
window.showCompleteScreen = showCompleteScreen;
window.showAdditionalDocuments = showAdditionalDocuments;
window.clearDriverSignature = clearDriverSignature;
window.confirmDriverSignature = confirmDriverSignature;
window.finishAdditionalDocuments = finishAdditionalDocuments;
window.retryVehiclePhoto = retryVehiclePhoto;

init();
