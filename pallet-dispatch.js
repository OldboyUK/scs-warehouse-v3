const app = document.getElementById('dispatch-app');
let palletId = '';

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
      <button class="btn btn-primary" onclick="startScan()">📷 Use Camera</button>
    </div>
  `;

  // Keep autofocus (active cell behaviour)
  const input = document.getElementById('palletInput');
  if (input) {
    input.focus();
    if (typeof input.select === 'function') input.select();
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') confirmPallet();
    });
  }
}

function confirmPallet() {
  const input = document.getElementById('palletInput').value.trim();
  if (input.length !== 15 || isNaN(input)) {
    alert('Please enter a valid 15-digit number.');
    return;
  }
  palletId = input;
  showConfirmStep();
}

function showConfirmStep() {
  app.innerHTML = `
    <p>Pallet ID: <strong>${palletId}</strong></p>
    <p>Do you want to dispatch this pallet?</p>
    <div class="actions">
      <button class="btn btn-ghost" onclick="showEnterStep()">No, Go Back</button>
      <button class="btn btn-primary" onclick="submitDispatch()">Yes, Dispatch</button>
    </div>
  `;
}

async function startScan() {
  if (typeof BarcodeDetector === 'undefined') {
    alert('Barcode scanning is not supported in this browser.');
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    await video.play();

    app.innerHTML = `<p>📷 Scanning... Point camera at barcode.</p>`;
    app.appendChild(video);
    video.style.width = '300px';
    video.style.height = '300px';

    const detector = new BarcodeDetector({ formats: ['code_128', 'ean_13'] });

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
        console.error('Barcode detection error:', err);
        stream.getTracks().forEach(t => t.stop());
        alert('Barcode detection failed.');
        showEnterStep();
      }
    };

    scan();
  } catch (err) {
    console.error('getUserMedia error:', err);
    alert('Camera access denied or unavailable.');
  }
}

function formatDateTimeForSheets() {
  // DD/MM/YYYY and HH:MM:SS (London local time)
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return { date, time };
}

function submitDispatch() {
  const { date, time } = formatDateTimeForSheets();

  const url = '/.netlify/functions/dispatch';
  const body = new URLSearchParams();
  body.append('pallet', palletId);
  body.append('date', date);
  body.append('time', time);

  app.innerHTML = `<p class="status">Submitting…</p>`;

  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    .then(r => r.json())
    .then(data => {
      if (data.result === 'ok' || data.result === 'success') {
        app.innerHTML = `
          <p>✅ Pallet <strong>${palletId}</strong> dispatched.</p>
          <div class="actions">
            <button class="btn btn-primary" onclick="showEnterStep()">Dispatch Another</button>
          </div>
        `;
      } else {
        app.innerHTML = `
          <p>❌ Error: ${data.message || 'Unknown error'}</p>
          <div class="actions"><button class="btn btn-ghost" onclick="showEnterStep()">Try Again</button></div>
        `;
      }
    })
    .catch(err => {
      console.error('Network error:', err);
      app.innerHTML = `
        <p>❌ Network error. Please try again.</p>
        <div class="actions"><button class="btn btn-ghost" onclick="showEnterStep()">Back</button></div>
      `;
    });
}

window.startScan = startScan;
window.confirmPallet = confirmPallet;
window.submitDispatch = submitDispatch;
window.showEnterStep = showEnterStep;

showEnterStep();
