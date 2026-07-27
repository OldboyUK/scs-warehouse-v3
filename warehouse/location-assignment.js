// location-assignment.js
// Flow: enter/scan pallet -> confirm pallet -> (enter OR scan) location
// Lower bays (10 chars, ends with 1) auto-continue; upper bays (ends with "-") show 2/3/4

const app   = document.getElementById('app');
const video = document.getElementById('video');

const PALLET_CONTENTS_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1165333250&single=true&output=csv';

let palletId = '';
let locationCode = '';
let locationBase = ''; // used when code ends with "-"
let palletContents = new Map();

let stream = null;
let scanning = false;

/* Helpers */
const pad = n => String(n).padStart(2, '0');
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function nowForSheets(){
  const d = new Date();
  return {
    date: `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  };
}
function stopCamera(){
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  if (video) {
    try { video.pause(); } catch {}
    video.srcObject = null;
    video.style.display = 'none';
  }
}
async function startCameraAndDetect(onDetected){
  if (typeof BarcodeDetector === 'undefined') {
    alert('Barcode scanning is not supported in this browser.');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    video.style.display = 'block';
    await video.play();

    const detector = new BarcodeDetector({ formats: ['code_128', 'ean_13'] });
    scanning = true;

    const loop = async () => {
      if (!scanning) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length > 0) {
          scanning = false;
          stopCamera();
          onDetected((codes[0].rawValue || '').trim());
          return;
        }
      } catch (err) {
        console.error('Barcode detection error:', err);
        scanning = false;
        stopCamera();
        alert('Barcode detection failed.');
      }
      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  } catch (err) {
    console.error('getUserMedia error:', err);
    alert('Camera access denied or unavailable.');
    stopCamera();
  }
}

/* CSV parsing (multiline-safe) */
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

async function loadPalletContents() {
  try {
    const response = await fetch(PALLET_CONTENTS_CSV);
    const text = await response.text();
    const rowStrings = splitCSVRows(text);

    palletContents.clear();

    for (let i = 0; i < rowStrings.length; i++) {
      const r = parseCSVRow(rowStrings[i]);
      if (i === 0 && cleanCSVField(r[0]).toUpperCase().includes('PALLET')) continue;

      const id = cleanCSVField(r[0]);
      if (!id) continue;

      palletContents.set(id, cleanCSVField(r[2] || ''));
    }
  } catch (err) {
    console.error('Failed to load pallet contents', err);
  }
}

function isLowerBayLocation(code) {
  const v = (code || '').trim();
  return v.length === 10 && v.endsWith('1');
}

function isUpperBayBase(code) {
  return (code || '').trim().endsWith('-');
}

function acceptLowerBay(code) {
  locationCode = code.trim();
  showConfirmLocation();
}

/* UI Steps */
function showPalletStep(){
  stopCamera();
  app.innerHTML = `
    <label>Enter Pallet Identifier (15-digit code):</label>
    <input id="palletInput" maxlength="15" placeholder="Scan or type 15 digits" />
    <div class="actions mt-3">
      <button class="btn btn-success" onclick="confirmPallet()">Confirm Pallet Barcode</button>
    </div>
    <hr>
    <p class="status">Tip: You can also scan using your camera.</p>
    <div class="actions mt-5">
      ${UI.cameraButton('Use Camera', 'startPalletScan()')}
    </div>
  `;
  const input = document.getElementById('palletInput');
  input.focus(); if (input.select) input.select();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmPallet();
  });
}

function confirmPallet(){
  const inputVal = (document.getElementById('palletInput')?.value || '').trim();
  if (inputVal.length !== 15 || isNaN(inputVal)) {
    alert('Please enter a valid 15-digit number.');
    const input = document.getElementById('palletInput');
    input?.focus(); return;
  }
  palletId = inputVal;
  showConfirmPallet();
}

function showConfirmPallet(){
  stopCamera();
  const found = palletContents.has(palletId);
  const contents = palletContents.get(palletId) || '';

  const displayHTML = found
    ? `<div class="config-block">${escapeHTML(contents)}</div>`
    : `<span class="text-error">Pallet not found in master list</span>`;

  app.innerHTML = `
    <p><strong>Pallet ID:</strong> ${escapeHTML(palletId)}</p>
    <p><strong>Pallet contents:</strong></p>
    ${displayHTML}
    <div class="actions">
      <button class="btn btn-danger" onclick="showPalletStep()">Change Pallet</button>
      ${found ? `<button class="btn btn-success" onclick="showLocationStep()">Confirm Pallet ID</button>` : ''}
    </div>
  `;
}

function startPalletScan(){
  app.innerHTML = UI.scanCard('');
  const frame = app.querySelector('.scan-frame');
  if (frame) frame.appendChild(video);
  else app.appendChild(video);
  startCameraAndDetect(value => {
    if (value.length !== 15 || isNaN(value)) {
      alert('Scanned pallet is not a valid 15-digit number.');
      showPalletStep();
      return;
    }
    palletId = value;
    showConfirmPallet();
  });
}

function showLocationStep(prefill = ''){
  stopCamera();
  app.innerHTML = `
    <p>Pallet ID: <strong>${escapeHTML(palletId)}</strong></p>
    <label for="locationInput">Enter Location Code:</label>
    <input id="locationInput" placeholder="Scan or type location" inputmode="none" autocomplete="off" />

    <div class="actions mt-3">
      <button class="btn btn-danger" onclick="showConfirmPallet()">Back</button>
    </div>

    <div id="bayChooser" class="mt-4 hidden">
      <p>This location ends with “-”. Choose a bay:</p>
      <div class="bay-grid">
        <button class="btn btn-secondary" onclick="chooseBay(2)">2</button>
        <button class="btn btn-secondary" onclick="chooseBay(3)">3</button>
        <button class="btn btn-secondary" onclick="chooseBay(4)">4</button>
      </div>
    </div>

    <hr>
    <div class="actions mt-4">
      ${UI.cameraButton('Use Camera', 'startLocationScan()')}
    </div>

    <p class="status">Tip: Lower bays are scanned automatically. Upper bays ending with “-” will show bay 2 / 3 / 4.</p>
  `;

  ensureBayGridStyle();

  const input = document.getElementById('locationInput');

  input.focus();

  const enableSoftKeyboard = () => {
    if (input.getAttribute('inputmode') !== 'text') {
      input.setAttribute('inputmode', 'text');
      setTimeout(() => input.focus(), 0);
    }
  };
  input.addEventListener('pointerdown', enableSoftKeyboard, { passive: true });

  function handleLocationValue(raw) {
    const v = (raw || '').trim();
    if (isLowerBayLocation(v)) {
      acceptLowerBay(v);
      return true;
    }
    if (isUpperBayBase(v)) {
      locationBase = v;
      showBayPickerInline();
      return true;
    }
    hideBayPickerInline();
    locationBase = '';
    return false;
  }

  input.addEventListener('input', () => {
    handleLocationValue(input.value);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      handleLocationValue(input.value);
    }
  });

  if (prefill) {
    input.value = prefill;
    handleLocationValue(prefill);
  }
}

function ensureBayGridStyle(){
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
  `;
  document.head.appendChild(style);
}

function startLocationScan(){
  app.innerHTML = UI.scanCard('');
  const frame = app.querySelector('.scan-frame');
  if (frame) frame.appendChild(video);
  else app.appendChild(video);
  startCameraAndDetect(val => {
    processLocationInput(val);
  });
}

/* Decide whether we need a bay */
function processLocationInput(val){
  const v = (val || '').trim();
  if (isLowerBayLocation(v)) {
    acceptLowerBay(v);
    return;
  }
  if (isUpperBayBase(v)) {
    locationBase = v;
    showLocationStep(v);
    return;
  }
  alert('Unrecognised location code. Lower bays are 10 characters ending in 1. Upper bays end with “-”.');
  showLocationStep();
}

/* Inline bay picker (on the same page) */
function showBayPickerInline(){
  const chooser = document.getElementById('bayChooser');
  if (chooser) chooser.classList.remove('hidden');
}
function hideBayPickerInline(){
  const chooser = document.getElementById('bayChooser');
  if (chooser) chooser.classList.add('hidden');
}

function chooseBay(n){
  if (!locationBase) {
    const input = document.getElementById('locationInput');
    const v = (input?.value || '').trim();
    if (v.endsWith('-')) locationBase = v;
  }
  if (!locationBase) {
    alert('No base location found. Please scan or type the location ending with “-” again.');
    const input = document.getElementById('locationInput');
    input?.focus();
    return;
  }
  locationCode = `${locationBase}${n}`;
  const input = document.getElementById('locationInput');
  if (input) input.value = locationCode;
  showConfirmLocation();
}

function showConfirmLocation(){
  stopCamera();
  app.innerHTML = `
    <p>Pallet ID: <strong>${escapeHTML(palletId)}</strong></p>
    <p>Location: <strong>${escapeHTML(locationCode)}</strong></p>
    <p>Is this correct?</p>
    <div class="actions">
      <button class="btn btn-danger" onclick="showLocationStep()">Change Location</button>
      <button class="btn btn-success" onclick="submitAssignment()">Confirm & Submit</button>
    </div>
  `;
}

function submitAssignment(){
  const { date, time } = nowForSheets();
  const body = new URLSearchParams();
  body.append('pallet', palletId);
  body.append('location', locationCode);
  body.append('date', date);
  body.append('time', time);

  app.innerHTML = `<p class="status">Submitting…</p>`;

  fetch(`${window.location.origin}/.netlify/functions/assignLocation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  .then(r => r.json())
  .then(data => {
    console.log("Response from Netlify:", data);   // for debugging
    if (data.result === 'ok' || data.result === 'success') {
      app.innerHTML = UI.successScreen(
        'Location assigned',
        `Pallet: <strong>${palletId}</strong><br>Location: <strong>${locationCode}</strong>`,
        `<button class="btn btn-primary" onclick="showPalletStep()">Assign Another</button>`
      );
      palletId = '';
      locationCode = '';
      locationBase = '';
    } else {
      app.innerHTML = UI.errorScreen(
        escapeHTML(data.message || 'Unknown error'),
        `<button class="btn btn-ghost" onclick="showConfirmLocation()">Back</button>`
      );
    }
  })
  .catch(err => {
    console.error("Fetch error:", err);
    app.innerHTML = UI.errorScreen(
      'Network error. Please try again.',
      `<button class="btn btn-ghost" onclick="showConfirmLocation()">Back</button>`
    );
  });
}

/* Expose + Init */
window.showPalletStep = showPalletStep;
window.confirmPallet = confirmPallet;
window.startPalletScan = startPalletScan;
window.showLocationStep = showLocationStep;
window.startLocationScan = startLocationScan;
window.showConfirmLocation = showConfirmLocation;
window.submitAssignment = submitAssignment;
window.chooseBay = chooseBay;

app.innerHTML = '<p class="status">Loading pallet data…</p>';
loadPalletContents().finally(showPalletStep);
