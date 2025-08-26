// location-assignment.js
// Flow: enter/scan pallet -> confirm pallet -> (enter OR scan) location
// If location ends with "-", ask for bay (2/3/4) -> confirm location -> submit

const app   = document.getElementById('app');
const video = document.getElementById('video');

let palletId = '';
let locationCode = '';
let locationBase = ''; // used when code ends with "-"

let stream = null;
let scanning = false;

/* Helpers */
const pad = n => String(n).padStart(2, '0');
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

/* UI Steps */
function showPalletStep(){
  stopCamera();
  app.innerHTML = `
    <label>Enter Pallet Identifier (15-digit code):</label>
    <input id="palletInput" maxlength="15" placeholder="Scan or type 15 digits" />
    <div class="actions">
      <button class="btn btn-primary" onclick="confirmPallet()">Next</button>
      <button class="btn btn-ghost" onclick="startPalletScan()">📷 Scan Pallet</button>
    </div>
    <p class="status">Tip: Use the camera or type manually.</p>
  `;
  document.getElementById('palletInput').focus();
}

function confirmPallet(){
  const input = (document.getElementById('palletInput')?.value || '').trim();
  if (input.length !== 15 || isNaN(input)) {
    alert('Please enter a valid 15-digit number.');
    return;
  }
  palletId = input;
  showConfirmPallet();
}

function showConfirmPallet(){
  stopCamera();
  app.innerHTML = `
    <p>Pallet ID: <strong>${palletId}</strong></p>
    <div class="actions">
      <button class="btn btn-danger" onclick="showPalletStep()">Change Pallet</button>
      <button class="btn btn-success" onclick="showLocationStep()">Scan/Enter Location</button>
    </div>
  `;
}

function startPalletScan(){
  app.innerHTML = `<p>📷 Scanning pallet… Point camera at pallet barcode.</p>`;
  app.appendChild(video);
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

function showLocationStep(){
  stopCamera();
  app.innerHTML = `
    <p>Pallet ID: <strong>${palletId}</strong></p>
    <label>Enter Location Code:</label>
    <input id="locationInput" placeholder="Scan or type location" />
    <div class="actions">
      <button class="btn btn-danger" onclick="showConfirmPallet()">Back</button>
      <button class="btn btn-success" onclick="startLocationScan()">📷 Scan Location</button>
    </div>
    <p class="status">Or type a code and press <strong>Enter</strong> to continue.</p>
  `;

  const input = document.getElementById('locationInput');
  input.focus();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const val = (input.value || '').trim();
      if (!val) { alert('Please enter a location code.'); return; }
      processLocationInput(val);
    }
  }, { once: true });
}

function startLocationScan(){
  app.innerHTML = `<p>📷 Scanning location… Point camera at location barcode.</p>`;
  app.appendChild(video);
  startCameraAndDetect(val => {
    processLocationInput(val);
  });
}

/* Decide whether we need a bay */
function processLocationInput(val){
  const v = (val || '').trim();

  if (v.endsWith('-')) {
    locationBase = v; // keep the trailing "-" so we can append 2/3/4
    showBayPicker();
    return;
  }

  // Full code
  locationCode = v;
  showConfirmLocation();
}

/* Bay picker (2/3/4) – force single row */
function showBayPicker(){
  stopCamera();
  app.innerHTML = `
    <p>Pallet ID: <strong>${palletId}</strong></p>
    <p>Location: <strong>${locationBase}</strong></p>
    <p>Select bay to complete this location:</p>

    <!-- one line row -->
    <div class="actions" style="justify-content:center; gap:12px; flex-wrap:nowrap;">
      <button class="btn btn-primary" style="flex:0 0 auto; min-width:90px;" onclick="chooseBay(2)">2</button>
      <button class="btn btn-primary" style="flex:0 0 auto; min-width:90px;" onclick="chooseBay(3)">3</button>
      <button class="btn btn-primary" style="flex:0 0 auto; min-width:90px;" onclick="chooseBay(4)">4</button>
    </div>

    <div class="actions">
      <button class="btn btn-danger" onclick="startLocationScan()">Re-scan Location</button>
      <button class="btn btn-ghost" onclick="showLocationStep()">Back</button>
    </div>
  `;
}

function chooseBay(n){
  locationCode = `${locationBase}${n}`;
  showConfirmLocation();
}

function showConfirmLocation(){
  stopCamera();
  app.innerHTML = `
    <p>Pallet ID: <strong>${palletId}</strong></p>
    <p>Location: <strong>${locationCode}</strong></p>
    <p>Is this correct?</p>
    <div class="actions">
      <button class="btn btn-danger" onclick="startLocationScan()">Re-scan Location</button>
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

  fetch('/.netlify/functions/assignLocation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  .then(r => r.json())
  .then(data => {
    if (data.result === 'ok' || data.result === 'success') {
      app.innerHTML = `
        <p>✅ Location assigned.</p>
        <p>Pallet: <strong>${palletId}</strong><br>Location: <strong>${locationCode}</strong></p>
        <div class="actions">
          <button class="btn btn-primary" onclick="showPalletStep()">Assign Another</button>
        </div>
      `;
      palletId = '';
      locationCode = '';
      locationBase = '';
    } else {
      app.innerHTML = `
        <p>❌ Error: ${data.message || 'Unknown error'}</p>
        <div class="actions">
          <button class="btn btn-ghost" onclick="showConfirmLocation()">Back</button>
        </div>
      `;
    }
  })
  .catch(err => {
    console.error(err);
    app.innerHTML = `
      <p>❌ Network error. Please try again.</p>
      <div class="actions">
        <button class="btn btn-ghost" onclick="showConfirmLocation()">Back</button>
      </div>
    `;
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
window.chooseBay = chooseBay; // for 2/3/4 buttons

showPalletStep();
