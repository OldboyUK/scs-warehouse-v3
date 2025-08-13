// location-assignment.js (uses BarcodeDetector + getUserMedia like Pallet Entry)

let app = document.getElementById('app');
let palletCode = '';
let locationCode = '';
let stream = null;
const ENDPOINT = '/.netlify/functions/assignLocation'; // Netlify function

function $(id){ return document.getElementById(id); }

function stopCamera() {
  try { stream && stream.getTracks().forEach(t => t.stop()); } catch {}
  const v = $('video');
  if (v) v.style.display = 'none';
}

function show(html) {
  app.innerHTML = html;
}

function showStep1() {
  stopCamera();
  show(`
    <label>Enter or scan <b>Pallet ID</b>:</label>
    <input id="palletInput" placeholder="Type Pallet ID" />
    <button onclick="confirmPallet()">Next</button>
    <hr>
    <button onclick="startScan('pallet')">📷 Scan Pallet Barcode</button>
  `);
}

function confirmPallet() {
  const val = ($('palletInput').value || '').trim();
  if (!val) { alert('Please enter a pallet ID.'); return; }
  palletCode = val;
  showStep2();
}

function showStep2() {
  stopCamera();
  show(`
    <p>Pallet: <strong>${palletCode}</strong></p>
    <label>Enter or scan <b>Location ID</b>:</label>
    <input id="locationInput" placeholder="Type Location ID" />
    <button onclick="confirmLocation()">Next</button>
    <hr>
    <button onclick="startScan('location')">📷 Scan Location Barcode</button>
    <button onclick="showStep1()">Back</button>
  `);
}

function confirmLocation() {
  const val = ($('locationInput').value || '').trim();
  if (!val) { alert('Please enter a location ID.'); return; }
  if (val.endsWith('-')) {
    locationCode = val;
    askForShelf();
  } else {
    locationCode = val;
    submitAssignment();
  }
}

function askForShelf() {
  stopCamera();
  show(`
    <p>Location code: <strong>${locationCode}</strong></p>
    <p>This location requires a shelf. Tap 2, 3, or 4 to complete it.</p>
    <div style="display:flex;gap:10px;justify-content:center;">
      <button onclick="addShelf(2)">2</button>
      <button onclick="addShelf(3)">3</button>
      <button onclick="addShelf(4)">4</button>
    </div>
    <p><button onclick="showStep2()">Back</button></p>
  `);
}

function addShelf(num) {
  locationCode = locationCode + String(num);
  submitAssignment();
}

async function startScan(which) {
  // Use same approach as Pallet Entry
  if (typeof BarcodeDetector === 'undefined') {
    alert('Barcode scanning is not supported in this browser.');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = $('video');
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    await video.play();
    video.style.display = 'block';

    const formats = ['code_128','ean_13','upc_a','upc_e','code_39','code_93','qr_code']; // broad support
    const detector = new BarcodeDetector({ formats });

    const loop = async () => {
      try {
        const barcodes = await detector.detect(video);
        if (barcodes && barcodes.length > 0) {
          stopCamera();
          const value = (barcodes[0].rawValue || '').trim();

          if (which === 'pallet') {
            palletCode = value;
            showStep2();
          } else {
            if (value.endsWith('-')) { locationCode = value; askForShelf(); }
            else { locationCode = value; submitAssignment(); }
          }
          return; // stop loop
        }
      } catch (e) {
        console.error('Barcode detection error:', e);
        // keep looping; detection can be intermittent
      }
      requestAnimationFrame(loop);
    };
    loop();
  } catch (e) {
    console.error('getUserMedia error:', e);
    alert('Camera access blocked. Click the site lock icon → allow Camera, then reload.');
  }
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
    let payload = null;
    try { payload = JSON.parse(text); } catch {}

    if (res.ok && payload && payload.result === 'success') {
      show(`
        <p>✅ Location assigned successfully!</p>
        <p>Pallet: <strong>${palletCode}</strong></p>
        <p>Location: <strong>${locationCode}</strong></p>
        <button onclick="showStep1()">Assign Another</button>
      `);
    } else {
      const msg = (payload && payload.message) || text || 'Unknown error';
      show(`
        <p>❌ Error assigning location.</p>
        <pre style="text-align:left;white-space:pre-wrap;border:1px solid #ddd;padding:8px;">${msg}</pre>
        <button onclick="showStep2()">Try Again</button>
      `);
    }
  })
  .catch(err => {
    console.error('Fetch error:', err);
    show(`
      <p>❌ Network error: ${err && err.message ? err.message : err}</p>
      <button onclick="showStep2()">Try Again</button>
    `);
  });
}

window.showStep1 = showStep1;
window.confirmPallet = confirmPallet;
window.confirmLocation = confirmLocation;
window.startScan = startScan;
window.addShelf = addShelf;

showStep1();
