// location-assignment.js

let app = document.getElementById('app');
let palletCode = '';
let locationCode = '';
let scanningType = null; // 'pallet' | 'location'
let codeReader = null;
let selectedDeviceId = null;

const VIDEO_ID = 'preview';
const ENDPOINT = '/.netlify/functions/assignLocation'; // Netlify function we built

function el(id) { return document.getElementById(id); }

function show(msgHtml) { app.innerHTML = msgHtml; }

function showStep1() {
  show(`
    <label>Enter or scan <b>Pallet ID</b>:</label>
    <input id="palletInput" placeholder="Type Pallet ID" />
    <button onclick="confirmPallet()">Next</button>
    <hr>
    <button onclick="startScan('pallet')">📷 Scan Pallet Barcode</button>
  `);
  stopScan();
}

function confirmPallet() {
  const input = (el('palletInput').value || '').trim();
  if (!input) { alert('Please enter a pallet ID.'); return; }
  palletCode = input;
  showStep2();
}

function showStep2() {
  show(`
    <p>Pallet: <strong>${palletCode}</strong></p>
    <label>Enter or scan <b>Location ID</b>:</label>
    <input id="locationInput" placeholder="Type Location ID" />
    <button onclick="confirmLocation()">Next</button>
    <hr>
    <button onclick="startScan('location')">📷 Scan Location Barcode</button>
    <button onclick="showStep1()">Back</button>
  `);
  stopScan();
}

function confirmLocation() {
  let loc = (el('locationInput').value || '').trim();
  if (!loc) { alert('Please enter a location ID.'); return; }
  if (loc.endsWith('-')) {
    locationCode = loc;
    askForShelf();
  } else {
    locationCode = loc;
    submitAssignment();
  }
}

function askForShelf() {
  show(`
    <p>Location code: <strong>${locationCode}</strong></p>
    <p>Select shelf number:</p>
    <div style="display:flex;gap:10px;justify-content:center;">
      <button onclick="addShelf(2)">2</button>
      <button onclick="addShelf(3)">3</button>
      <button onclick="addShelf(4)">4</button>
    </div>
    <p><button onclick="showStep2()">Back</button></p>
  `);
  stopScan();
}

function addShelf(num) {
  locationCode = locationCode + String(num);
  submitAssignment();
}

async function startScan(type) {
  scanningType = type;
  try {
    // 1) Explicit permission prompt
    const tempStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    tempStream.getTracks().forEach(t => t.stop());

    // 2) Init ZXing reader
    if (!codeReader) codeReader = new ZXing.BrowserMultiFormatReader();

    // 3) Pick camera
    const devices = await ZXing.BrowserCodeReader.listVideoInputDevices();
    if (!devices.length) {
      alert('No camera found.');
      return;
    }
    const backCam = devices.find(d => /back|rear|environment/i.test(d.label));
    selectedDeviceId = (backCam || devices[0]).deviceId;

    // 4) Show video
    const vid = document.getElementById('preview');
    vid.style.display = 'block';
    vid.setAttribute('playsinline', 'true'); // iOS fix

    // 5) Start decode
    await codeReader.decodeFromVideoDevice(selectedDeviceId, 'preview', (result) => {
      if (result) {
        const value = (result.getText() || '').trim();
        stopScan();
        if (scanningType === 'pallet') {
          palletCode = value;
          showStep2();
        } else if (scanningType === 'location') {
          if (value.endsWith('-')) { locationCode = value; askForShelf(); }
          else { locationCode = value; submitAssignment(); }
        }
      }
    });
  } catch (e) {
    console.error('Camera/scan error:', e);
    alert('Camera permission blocked. Click the lock icon in the address bar and set Camera → Allow, then try again.');
  }
}


function stopScan() {
  try {
    if (codeReader) {
      codeReader.reset();
    }
  } catch {}
  const vid = el(VIDEO_ID);
  if (vid) vid.style.display = 'none';
}

function submitAssignment() {
  const now = new Date();
  const date = now.toLocaleDateString('en-GB');
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const form = new URLSearchParams();
  form.append('pallet', palletCode);
  form.append('location', locationCode);
  form.append('date', date);
  form.append('time', time);

  show(`
    <p>Pallet: <strong>${palletCode}</strong></p>
    <p>Location: <strong>${locationCode}</strong></p>
    <p>Submitting…</p>
  `);

  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form
  })
    .then(async res => {
      const text = await res.text();
      // try JSON first
      let payload;
      try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

      if (res.ok && payload && (payload.result === 'success' || payload.result === 'ok')) {
        show(`
          <p>✅ Location assigned successfully!</p>
          <p>Pallet: <strong>${palletCode}</strong></p>
          <p>Location: <strong>${locationCode}</strong></p>
          <button onclick="showStep1()">Assign Another</button>
        `);
      } else {
        const msg = (payload && payload.message) || text || 'Unknown error';
        show(`
          <p>❌ Error: ${msg}</p>
          <pre style="text-align:left;white-space:pre-wrap;">${text}</pre>
          <button onclick="showStep1()">Try Again</button>
        `);
      }
    })
    .catch(err => {
      console.error('Fetch error:', err);
      show(`
        <p>❌ Network error: ${err && err.message ? err.message : err}</p>
        <button onclick="showStep1()">Try Again</button>
      `);
    });
}

// Expose to window (for inline onclick handlers)
window.showStep1 = showStep1;
window.confirmPallet = confirmPallet;
window.confirmLocation = confirmLocation;
window.startScan = startScan;
window.addShelf = addShelf;

// init
showStep1();
