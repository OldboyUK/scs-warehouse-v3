const app = document.getElementById('dispatch-app');
let palletId = '';

const VALID_PALLETS_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1165333250&single=true&output=csv';
const STOCK_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1879287780&single=true&output=csv';
const STAGING_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=332871798&single=true&output=csv';

let validPallets = new Map();
let palletStock = new Map();
let stagedRunsByPallet = new Map();

/* =========================
   CSV LOADER (FIXED)
   Handles multiline cells
========================= */
async function loadValidPallets() {
  try {
    const response = await fetch(VALID_PALLETS_CSV);
    const text = await response.text();

    const rows = [];
    let current = '';
    let inQuotes = false;

    // Proper CSV row parsing
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const next = text[i + 1];

      // Handle escaped quotes ("")
      if (char === '"' && inQuotes && next === '"') {
        current += '"';
        i++;
        continue;
      }

      // Toggle quote mode
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }

      // Only split rows when NOT inside quotes
      if ((char === '\n' || char === '\r') && !inQuotes) {

        // Handle Windows CRLF
        if (char === '\r' && next === '\n') {
          i++;
        }

        if (current.trim()) {
          rows.push(current);
        }

        current = '';
      } else {
        current += char;
      }
    }

    // Final row
    if (current.trim()) {
      rows.push(current);
    }

    validPallets.clear();

    // Skip header row
    for (let i = 1; i < rows.length; i++) {

      const firstCommaIndex = rows[i].indexOf(',');
      if (firstCommaIndex === -1) continue;

      const id = rows[i]
        .substring(0, firstCommaIndex)
        .trim()
        .replace(/^"|"$/g, '');

      const description = rows[i]
        .substring(firstCommaIndex + 1)
        .trim()
        .replace(/^"|"$/g, '');

      if (id) {
        if (!validPallets.has(id)) {
          validPallets.set(id, []);
        }

        validPallets.get(id).push(description);
      }
    }

    console.log(`✅ Loaded ${validPallets.size} pallets`);

  } catch (err) {
    console.error("Failed to load pallet list", err);
  }
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function normalizePalletId(id) {
  const s = String(id || '').trim();
  if (/^\d+$/.test(s) && s.length > 0 && s.length < 15) return s.padStart(15, '0');
  return s;
}

function parseUnits(value) {
  const n = parseInt(String(value || '').replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

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

function loadStockRows(text) {
  palletStock.clear();
  const rows = splitCSVRows(text);
  for (let i = 0; i < rows.length; i++) {
    const r = parseCSVRow(rows[i]);
    const id = normalizePalletId(cleanCSVField(r[0]));
    if (!id || (i === 0 && /pallet/i.test(id))) continue;
    const units = parseUnits(r[6] != null && String(r[6]).trim() !== '' ? r[6] : r[5]);
    if (units <= 0) continue;
    if (!palletStock.has(id)) palletStock.set(id, []);
    palletStock.get(id).push({
      runCode: cleanCSVField(r[1]),
      company: cleanCSVField(r[2]),
      product: cleanCSVField(r[3]),
      format: cleanCSVField(r[4]),
      units
    });
  }
}

function loadStagingRuns(text) {
  stagedRunsByPallet.clear();
  const rows = splitCSVRows(text);
  for (let i = 0; i < rows.length; i++) {
    const r = parseCSVRow(rows[i]);
    const id = normalizePalletId(cleanCSVField(r[2]));
    if (!id || (i === 0 && /pallet|collection/i.test(cleanCSVField(r[0])))) continue;
    const run = cleanCSVField(r[3]).toUpperCase();
    if (!run) continue;
    if (!stagedRunsByPallet.has(id)) stagedRunsByPallet.set(id, new Set());
    stagedRunsByPallet.get(id).add(run);
  }
}

function leftoverStockForPallet(id) {
  const pallet = normalizePalletId(id);
  const stock = palletStock.get(pallet) || [];
  const staged = stagedRunsByPallet.get(pallet);
  if (!staged || !staged.size) return [];
  return stock.filter(line => !staged.has(String(line.runCode || '').trim().toUpperCase()));
}

function formatDispatchBlockedMessage(leftover) {
  const details = leftover.map(line => `${line.runCode} — ${line.units} units remaining.`).join('\n');
  return `Cannot dispatch pallet\nThis pallet still contains stock that has not been picked or transferred.\n${details}\nThis stock must be picked or transferred to another pallet before dispatch.`;
}

function showDispatchError(rawMessage) {
  const text = String(rawMessage || 'Unknown error');
  const parts = text.split('\n').filter(Boolean);
  const title = parts[0] === 'Cannot dispatch pallet' ? parts.shift() : '';
  app.innerHTML = UI.errorScreen(
    escapeHTML(parts.join('\n') || text),
    `<button class="btn btn-ghost" onclick="showEnterStep()">Try Again</button>`,
    title ? escapeHTML(title) : undefined
  );
}

async function loadLookupData() {
  try {
    const [stockRes, stagingRes] = await Promise.all([
      fetch(STOCK_CSV),
      fetch(STAGING_CSV)
    ]);
    if (stockRes.ok) loadStockRows(await stockRes.text());
    if (stagingRes.ok) loadStagingRuns(await stagingRes.text());
  } catch (err) {
    console.error('Failed to load stock/staging data', err);
  }
}

function showEnterStep() {
  app.innerHTML = `
    <label>Enter Pallet Identifier (15-digit code):</label>
    <input id="palletInput" maxlength="15" placeholder="Scan or type 15 digits"/>
    
    <div class="actions mt-3">
      <button class="btn btn-success" onclick="confirmPallet()">Confirm Pallet ID</button>
    </div>

    <hr>

    <p class="status">Tip: You can scan with the camera or type manually.</p>

    <div class="actions mt-4">
      ${UI.cameraButton('Use Camera', 'startScan()')}
    </div>
  `;

  const input = document.getElementById('palletInput');

  input.focus();

  if (input.select) {
    input.select();
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      confirmPallet();
    }
  });
}

function confirmPallet() {
  const val = document.getElementById('palletInput').value.trim();

  if (val.length !== 15 || isNaN(val)) {
    alert('Please enter a valid 15-digit number.');
    return;
  }

  palletId = val;
  showConfirmStep();
}

function showConfirmStep() {

  const configs = validPallets.get(palletId) || [];
  const stockLines = palletStock.get(normalizePalletId(palletId)) || [];
  const leftover = leftoverStockForPallet(palletId);

  let displayHTML = '';
  if (stockLines.length) {
    displayHTML = stockLines.map(line => `
      <div class="config-block">
        ${escapeHTML(line.runCode || '-')} — ${escapeHTML(String(line.units))} units
        ${line.product || line.format ? `<br>${escapeHTML([line.product, line.format].filter(Boolean).join(' — '))}` : ''}
      </div>
    `).join('');
  } else if (configs.length) {
    displayHTML = configs.map(line => `<div class="config-block">${escapeHTML(line)}</div>`).join('');
  } else {
    displayHTML = `<span class="text-error">Pallet not found in master list</span>`;
  }

  const leftoverNote = leftover.length
    ? `<p class="status text-error" style="white-space:pre-line">${escapeHTML(formatDispatchBlockedMessage(leftover))}</p>`
    : '';

  const canDispatch = (configs.length || stockLines.length) && !leftover.length;

  app.innerHTML = `
    <p><strong>Pallet ID:</strong> ${escapeHTML(palletId)}</p>

    <p><strong>Pallet Configuration:</strong></p>

    ${displayHTML}
    ${leftoverNote}

    <div class="actions">
      <button class="btn btn-danger" onclick="showEnterStep()">
        Change Pallet
      </button>

      ${canDispatch
        ? `
          <button class="btn btn-success" onclick="submitDispatch()">
            Confirm & Dispatch
          </button>
        `
        : ''
      }
    </div>
  `;
}

async function startScan() {

  if (typeof BarcodeDetector === 'undefined') {
    alert('Barcode scanning is not supported in this browser.');
    return;
  }

  try {

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });

    const video = document.createElement('video');
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    await video.play();

    app.innerHTML = UI.scanCard('');
    const frame = app.querySelector('.scan-frame');

    if (frame) frame.appendChild(video);
    else app.appendChild(video);

    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';

    const detector = new BarcodeDetector({
      formats: ['code_128', 'ean_13']
    });

    const scan = async () => {

      try {

        const barcodes = await detector.detect(video);

        if (barcodes.length > 0) {

          stream.getTracks().forEach(t => t.stop());

          const raw = (barcodes[0].rawValue || '').trim();

          if (raw.length !== 15 || isNaN(raw)) {
            alert('Scanned code is not a valid 15-digit number.');
            showEnterStep();
            return;
          }

          palletId = raw;
          showConfirmStep();

        } else {
          requestAnimationFrame(scan);
        }

      } catch (err) {

        console.error(err);

        stream.getTracks().forEach(t => t.stop());

        alert('Barcode detection failed.');

        showEnterStep();
      }
    };

    scan();

  } catch (err) {
    alert('Camera access denied or unavailable.');
  }
}

function formatDateTimeForSheets() {

  const now = new Date();

  const pad = n => String(n).padStart(2, '0');

  const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;

  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  return { date, time };
}

function submitDispatch() {

  const leftover = leftoverStockForPallet(palletId);
  if (leftover.length) {
    showDispatchError(formatDispatchBlockedMessage(leftover));
    return;
  }

  const { date, time } = formatDateTimeForSheets();

  const url = `${window.location.origin}/.netlify/functions/dispatch`;

  const body = new URLSearchParams();

  body.append('reference', 'No Reference');
  body.append('pallet', palletId);
  body.append('date', date);
  body.append('time', time);

  app.innerHTML = `<p class="status">Submitting…</p>`;

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
    .then(r => r.json())
    .then(data => {

      if (data.result === 'ok' || data.result === 'success') {

        app.innerHTML = UI.successScreen(
          'Pallet dispatched',
          `Pallet <strong>${palletId}</strong> has been dispatched.`,
          `<button class="btn btn-primary" onclick="showEnterStep()">Dispatch Another</button>`
        );

      } else {
        showDispatchError(data.message || 'Unknown error');
      }
    })
    .catch(err => {

      console.error('Network error:', err);

      app.innerHTML = UI.errorScreen(
        'Network error. Please try again.',
        `<button class="btn btn-ghost" onclick="showEnterStep()">Back</button>`
      );
    });
}

window.startScan = startScan;
window.confirmPallet = confirmPallet;
window.submitDispatch = submitDispatch;
window.showEnterStep = showEnterStep;

loadValidPallets();
loadLookupData();
showEnterStep();