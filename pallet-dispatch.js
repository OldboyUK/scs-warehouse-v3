const app = document.getElementById('dispatch-app');
let palletId = '';

// CSV with valid pallets (Column A = Pallet ID, Column B = Description)
const VALID_PALLETS_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1165333250&single=true&output=csv';

let validPallets = new Map(); // palletId → description

// Load valid pallets
function loadValidPallets() {
  fetch(VALID_PALLETS_CSV)
    .then(r => r.text())
    .then(text => {
      const rows = parseCSV(text);
      validPallets.clear();
      for (let i = 1; i < rows.length; i++) {  // skip header
        const id = (rows[i][0] || '').trim();
        const desc = (rows[i][1] || '').trim();
        if (id) validPallets.set(id, desc);
      }
      console.log(`Loaded ${validPallets.size} valid pallets`);
    })
    .catch(err => console.error('Failed to load pallet list:', err));
}

function parseCSV(text) {
  return text.replace(/\r/g, '').split('\n').map(line => 
    line.split(',').map(cell => cell.trim())
  );
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
  const description = validPallets.get(palletId) || "❌ Pallet not found in master list";

  app.innerHTML = `
    <p><strong>Pallet ID:</strong> ${palletId}</p>
    <p><strong>Pallet Configuration:</strong> ${description}</p>
    
    ${!validPallets.has(palletId) ? 
      `<p style="color:#ff6b6b;">This pallet is not in the approved list.</p>` : ''}
    
    <div class="actions">
      <button class="btn btn-danger" onclick="showEnterStep()">Change Pallet</button>
      ${validPallets.has(palletId) ? 
        `<button class="btn btn-success" onclick="submitDispatch()">Confirm & Dispatch</button>` : ''}
    </div>
  `;
}

async function startScan() {
  // ... (keep your existing camera scanning code - unchanged)
  // Just call showConfirmStep() after successful scan
}

// Keep your existing submitDispatch and formatDateTimeForSheets functions

window.startScan = startScan;
window.confirmPallet = confirmPallet;
window.submitDispatch = submitDispatch;
window.showEnterStep = showEnterStep;

loadValidPallets();
showEnterStep();