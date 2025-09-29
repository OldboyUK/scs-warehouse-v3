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
    <div class="actions mt-3">
      <button class="btn btn-success" onclick="confirmPallet()">Confirm Pallet Barcode</button>
    </div>
    <hr>
    <p class="status">Tip: You can also scan using your camera.</p>
    <div class="actions mt-5">
      <button class="btn btn-primary" onclick="startPalletScan()">📷 Use Camera</button>
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

    <div class="actions mt-3">
      <button class="btn btn-success" id="confirmLocationBtn">Confirm Entry</button>
      <button class="btn btn-danger" onclick="showConfirmPallet()">Back</button>
    </div>

    <div id="bayChooser" class="mt-4" style="display:none">
      <p>This location ends with “-”. Choose a bay:</p>
      <div class="actions" style="justify-content:center; gap:12px; flex-wrap:nowrap;">
        <button class="btn btn-secondary" onclick="chooseBay(2)">2</button>
        <button class="btn btn-secondary" onclick="chooseBay(3)">3</button>
        <button class="btn btn-secondary" onclick="chooseBay(4)">4</button>
      </div>
    </div>

    <hr>
    <div class="actions mt-4">
      <button class="btn btn-primary" onclick="startLocationScan()">📷 Use Camera</button>
    </div>

    <p class="status">Tip: If the location ends with “-”, you’ll be asked to choose 2 / 3 / 4.</p>
  `;

  const input = document.getElementById('locationInput');
  const confirmBtn = document.getElementById('confirmLocationBtn');

  // Active-cell behaviour
  input.focus(); if (input.select) input.select();

  // HID scanner / typing: as soon as trailing '-' appears, prompt for bay
  input.addEventListener('input', () => {
    const v = (input.value || '').trim();
    if (v.endsWith('-')) {
      locationBase = v; // keep trailing '-'
      showBayPickerInline(); // reveal chooser inline on this page
    } else {
      hideBayPickerInline();
    }
  });

  // Enter submits (uses same logic as clicking Confirm Entry)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      confirmBtn.click();
    }
  });

  // Confirm Entry button
  confirmBtn.addEventListener('click', () => {
    const val = (input.value || '').trim();
    if (!val) { alert('Please enter a location code.'); input.focus(); return; }
    processLocationInput(val);
  });
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
    showBayPicker();  // full-page picker flow
    return;
  }

  // Full code
  locationCode = v;
  showConfirmLocation();
}

/* Inline bay picker (on the same page) */
function showBayPickerInline(){
  const chooser = document.getElementById('bayChooser');
  if (chooser) chooser.style.display = '';
}
function hideBayPickerInline(){
  const chooser = document.getElementById('bayChooser');
  if (chooser) chooser.style.display = 'none';
}

/* Full-page bay picker (used after camera scan or manual confirm) */
function showBayPicker(){
  stopCamera();
  app.innerHTML = `
    <p>Pallet ID: <strong>${palletId}</strong></p>
    <p>Location: <strong>${locationBase}</strong></p>
    <p>Select bay to complete this location:</p>

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
  // If inline picker was used and user clicks one of the inline buttons,
  // locationBase will already be set (with trailing '-').
  if (!locationBase) {
    // Fallback: try to read from the input in case user typed it there
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
  // If we are on the inline page, reflect it in the field for clarity
  const input = document.getElementById('locationInput');
  if (input) input.value = locationCode;

  showConfirmLocation();
}

function showConfirmLocation(){
  stopCamera();
  app.innerHTML = `
    <p>Pallet ID: <strong>${palletId}</strong></p>
    <p>Location: <strong>${locationCode}</strong></p>
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
