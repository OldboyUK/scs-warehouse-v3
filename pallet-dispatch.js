const app = document.getElementById('dispatch-app');
let palletId = '';

// CSV with valid pallets
const VALID_PALLETS_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1165333250&single=true&output=csv';

let validPallets = new Map(); // palletId → array of descriptions

function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  return lines.map(line => line.split(',').map(cell => cell.trim().replace(/^"|"$/g, '')));
}

function loadValidPallets() {
  fetch(VALID_PALLETS_CSV)
    .then(r => r.text())
    .then(text => {
      const rows = parseCSV(text);
      validPallets.clear();
      for (let i = 1; i < rows.length; i++) {
        const id = (rows[i][0] || '').trim();
        const desc = (rows[i][1] || '').trim();
        if (id) {
          if (!validPallets.has(id)) validPallets.set(id, []);
          validPallets.get(id).push(desc);
        }
      }
      console.log(`Loaded ${validPallets.size} valid pallets`);
    })
    .catch(err => console.error('Failed to load pallet list:', err));
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
      <button class="btn btn-primary" onclick="startScan()">📷 Use Camera</button>
    </div>
  `;

  const input = document.getElementById('palletInput');
  if (input) {
    input.focus();
    input.select();
    input.addEventListener('keydown', e => { if (e.key === 'Enter') confirmPallet(); });
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
  const descriptions = validPallets.get(palletId) || [];

  let configHTML = descriptions.length 
    ? descriptions.map(d => `<div>${d}</div>`).join('') 
    : `<span style="color:#ff6b6b;">❌ Pallet not found in master list</span>`;

  app.innerHTML = `
    <p><strong>Pallet ID:</strong> ${palletId}</p>
    <p><strong>Pallet Configuration:</strong></p>
    <div style="margin-left: 12px; line-height: 1.4;">${configHTML}</div>
    
    <div class="actions">
      <button class="btn btn-danger" onclick="showEnterStep()">Change Pallet</button>
      ${descriptions.length ? `<button class="btn btn-success" onclick="submitDispatch()">Confirm & Dispatch</button>` : ''}
    </div>
  `;
}

async function startScan() {
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
  const { date, time } = formatDateTimeForSheets();

  const url = `${window.location.origin}/.netlify/functions/dispatch`;
  const body = new URLSearchParams();
  body.append('pallet', palletId);
  body.append('date', date);
  body.append('time', time);

  app.innerHTML = `<p class="status">Submitting…</p>`;

  fetch(url, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, 
    body 
  })
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

loadValidPallets();
showEnterStep();