// pallet-entry.js
// Flow: enter/scan pallet -> confirm -> pick run (shows ORDER LOG Product/Format) -> units (shows same confirmation) -> confirm & submit

let app = document.getElementById('app');
let palletCode = '';
let runCode = '';
let runCodes = [];

// CSVs
const RUN_CODES_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1875380966&single=true&output=csv';
const ORDER_LOG_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=792145998&single=true&output=csv';

const SCRIPT_URL = '/.netlify/functions/submit';

// ORDER LOG lookup: run -> { product, format }
const orderLog = new Map();

/* ---------- CSV helpers ---------- */
function parseCSV(text){
  const lines = text.replace(/\r/g,'').split('\n').filter(x => x.length);
  const rows = [];
  for (const line of lines){
    const out = []; let cur=''; let inQ=false;
    for (let i=0;i<line.length;i++){
      const ch=line[i];
      if (inQ){
        if (ch === '"'){ if (line[i+1] === '"'){ cur+='"'; i++; } else { inQ=false; } }
        else { cur+=ch; }
      } else {
        if (ch === ','){ out.push(cur); cur=''; }
        else if (ch === '"'){ inQ=true; }
        else { cur+=ch; }
      }
    }
    out.push(cur);
    rows.push(out);
  }
  return rows;
}

/* ---------- Data loaders ---------- */
function loadRunCodes() {
  fetch(RUN_CODES_CSV)
    .then(r => r.text())
    .then(csv => {
      runCodes = csv.trim().split('\n').map(x => x.trim()).filter(Boolean);
      runCodes = Array.from(new Set(runCodes))
        .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    })
    .catch(err => console.error('Run codes CSV error:', err));
}

function loadOrderLog(){
  fetch(ORDER_LOG_CSV)
    .then(r => r.text())
    .then(text => {
      const rows = parseCSV(text);
      for (const row of rows){
        const run = (row[0] || '').trim();   // A
        if (!run) continue;
        const product = (row[3] || '').trim(); // D
        const format  = (row[5] || '').trim(); // F
        orderLog.set(run, { product, format });
      }
    })
    .catch(err => console.error('ORDER LOG CSV error:', err));
}

/* ---------- Step 1: enter/scan pallet ---------- */
function showStep1() {
  app.innerHTML = `
    <label>Enter 15-digit code:</label>
    <input id="codeInput" maxlength="15" />
    <div class="actions mt-3">
      <!-- No Back buttons on this page -->
      <button onclick="confirmCode()">Confirm Manual Entry</button>
    </div>
    <hr>
    <div class="actions">
      <button onclick="startBarcodeScan()">📷 Scan Barcode</button>
    </div>
  `;
}

function confirmCode() {
  const input = document.getElementById('codeInput').value.trim();
  if (input.length !== 15 || isNaN(input)) {
    alert('Please enter a valid 15-digit number.');
    return;
  }
  palletCode = input;
  showConfirmCode();
}

function showConfirmCode() {
  app.innerHTML = `
    <p>You entered: <strong>${palletCode}</strong></p>
    <div class="actions mt-3">
      <button class="btn-ghost" onclick="showStep1()">Back</button>
      <button onclick="showStep2()">Confirm</button>
    </div>
  `;
}

function startBarcodeScan() {
  if (typeof BarcodeDetector === 'undefined') {
    alert('Barcode scanning is not supported in this browser.');
    return;
  }

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(async stream => {
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
            stream.getTracks().forEach(track => track.stop());
            const raw = (barcodes[0].rawValue || '').trim();
            if (raw.length !== 15 || isNaN(raw)) {
              alert("Scanned code is not a valid 15-digit number.");
              showStep1();
            } else {
              palletCode = raw;
              showConfirmCode();
            }
          } else {
            requestAnimationFrame(scan);
          }
        } catch (err) {
          console.error("Barcode detection error:", err);
          stream.getTracks().forEach(track => track.stop());
          alert("Barcode detection failed.");
          showStep1();
        }
      };

      scan();
    })
    .catch(err => {
      alert("Camera access denied or unavailable.");
      console.error("getUserMedia error:", err);
    });
}

/* ---------- Run code selection (with ORDER LOG details) ---------- */
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function findRunCode(value) {
  const v = (value || '').trim().toUpperCase();
  return runCodes.find(c => c.toUpperCase() === v) || null;
}

function showStep2() {
  app.innerHTML = `
    <label>Select run code:</label>

    <div id="runCombo" style="position:relative;">
      <input id="runCodeInput" placeholder="Type to search…" autocomplete="off" style="width:100%; padding-right:42px;">
      <button id="runCodeToggle" type="button" aria-label="Open suggestions"
        style="position:absolute; right:6px; top:6px; height:34px; width:34px; border-radius:10px; border:1px solid var(--card-border); background:rgba(255,255,255,0.08); color:var(--text); cursor:pointer;">▾</button>
      <div id="runCodeList" hidden
        style="position:absolute; z-index:1000; left:0; right:0; margin-top:6px; max-height:240px; overflow:auto; border:1px solid var(--card-border); border-radius:12px; background:rgba(10,15,26,0.95); backdrop-filter: blur(6px); box-shadow: var(--shadow);">
      </div>
    </div>

    <!-- White confirmation text (no heading) -->
    <div id="runDetails" style="margin-top:12px; color:#ffffff;"></div>

    <div class="actions mt-3">
      <button class="btn-ghost" onclick="showConfirmCode()">Back</button>
      <button onclick="confirmRunCode()">Next</button>
    </div>
  `;

  setupRunCodeCombo();
}

function setupRunCodeCombo(){
  const input  = document.getElementById('runCodeInput');
  const toggle = document.getElementById('runCodeToggle');
  const list   = document.getElementById('runCodeList');
  const details = document.getElementById('runDetails');

  let open = false;
  let items = [];
  let highlight = -1;

  function filter(q){
    const query = (q || '').trim().toUpperCase();
    items = runCodes.filter(c => c.toUpperCase().startsWith(query));
    render();
  }

  function render(){
    list.innerHTML = items.map((code, i) =>
      `<div class="combo-option" data-value="${escapeHTML(code)}"
            style="padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.06); cursor:pointer; ${i===items.length-1?'border-bottom:none;':''} ${i===highlight?'background:rgba(255,255,255,0.08);':''}">
        ${escapeHTML(code)}
       </div>`
    ).join('') || `<div style="padding:10px 12px; color:var(--muted);">No matches</div>`;
  }

  function openList(){ if (!open){ list.hidden = false; open = true; } }
  function closeList(){ if (open){ list.hidden = true; open = false; highlight = -1; } }

  function showDetails(val){
    const run = findRunCode(val);
    if (!run){ details.innerHTML = ''; return; }
    const info = orderLog.get(run);
    if (info){
      // Pure white text, relabelled
      details.innerHTML = `
        <div style="border:1px solid var(--card-border);border-radius:12px;padding:10px;background:rgba(255,255,255,0.05);">
          <div>Product: <strong style="color:#fff">${escapeHTML(info.product || '-')}</strong></div>
          <div>Format: <strong style="color:#fff">${escapeHTML(info.format  || '-')}</strong></div>
        </div>`;
    } else {
      details.innerHTML = '';
    }
  }

  function selectValue(val){
    input.value = val;
    closeList();
    showDetails(val);
  }

  // events
  input.addEventListener('input', () => { filter(input.value); openList(); showDetails(input.value); });
  input.addEventListener('focus',  () => { filter(input.value); /* keep closed */ showDetails(input.value); });
  input.addEventListener('keydown', (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { filter(input.value); openList(); }
    if (!open && e.key === 'Enter') { return; }
    if (e.key === 'ArrowDown'){ highlight = Math.min(highlight + 1, items.length - 1); e.preventDefault(); render(); }
    else if (e.key === 'ArrowUp'){ highlight = Math.max(highlight - 1, 0); e.preventDefault(); render(); }
    else if (e.key === 'Enter'){ if (open && highlight >= 0 && items[highlight]){ selectValue(items[highlight]); e.preventDefault(); } }
    else if (e.key === 'Escape'){ closeList(); }
  });
  toggle.addEventListener('click', () => { if (open) closeList(); else { filter(input.value); openList(); } });
  list.addEventListener('click', (e) => { const el = e.target.closest('.combo-option'); if (el) selectValue(el.dataset.value); });
  document.addEventListener('click', (e) => { const combo = document.getElementById('runCombo'); if (combo && !combo.contains(e.target)) closeList(); }, { capture: true });

  // initial
  filter(''); closeList(); showDetails(input.value);
}

function confirmRunCode() {
  const entered = document.getElementById('runCodeInput').value;
  const matched = findRunCode(entered);

  if (!matched) {
    alert('Please choose a valid run code from the list. Start typing and pick a suggestion.');
    return;
  }

  runCode = matched;
  const info = orderLog.get(runCode) || { product: '-', format: '-' };

  // Units page with confirmation block (white text)
  app.innerHTML = `
    <div style="border:1px solid var(--card-border);border-radius:12px;padding:10px;background:rgba(255,255,255,0.05); margin-bottom:8px;">
      <div>Code: <strong style="color:#fff">${escapeHTML(palletCode)}</strong></div>
      <div>Run Code: <strong style="color:#fff">${escapeHTML(runCode)}</strong></div>
      <div>Product: <strong style="color:#fff">${escapeHTML(info.product)}</strong></div>
      <div>Format: <strong style="color:#fff">${escapeHTML(info.format)}</strong></div>
    </div>

    <label>Enter number of units:</label>
    <input id="unitInput" type="number" min="1" />

    <div class="actions mt-3">
      <button class="btn-ghost" onclick="showStep2()">Back</button>
      <button onclick="confirmUnits()">Next</button>
    </div>
  `;
}

/* ---------- Final confirm + submit ---------- */
function confirmUnits() {
  const input = document.getElementById('unitInput').value;
  const units = parseInt(input, 10);

  if (isNaN(units) || units <= 0) {
    alert("Please enter a valid number of units.");
    return;
  }

  const info = orderLog.get(runCode) || { product: '-', format: '-' };

  app.innerHTML = `
    <div style="border:1px solid var(--card-border);border-radius:12px;padding:10px;background:rgba(255,255,255,0.05); margin-bottom:8px;">
      <div>Code: <strong style="color:#fff">${escapeHTML(palletCode)}</strong></div>
      <div>Run Code: <strong style="color:#fff">${escapeHTML(runCode)}</strong></div>
      <div>Product: <strong style="color:#fff">${escapeHTML(info.product)}</strong></div>
      <div>Format: <strong style="color:#fff">${escapeHTML(info.format)}</strong></div>
      <div>Units: <strong style="color:#fff">${units}</strong></div>
    </div>

    <div class="actions mt-3">
      <button class="btn-ghost" onclick="confirmRunCode()">Back</button>
      <button onclick="submitEntry(${units})">Confirm & Submit</button>
    </div>
  `;
}

function submitEntry(units) {
  const body = new URLSearchParams();
  body.append("code", palletCode);
  body.append("run", runCode);
  body.append("units", units);

  fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  .then(res => res.json())
  .then(data => {
    if (data.result === 'success') {
      app.innerHTML = `
        <p>✅ Entry submitted successfully!</p>
        <div class="actions mt-3">
          <button onclick="showStep1()">Add Another</button>
        </div>
      `;
    } else {
      app.innerHTML = `<p>❌ Error: ${data.message || 'Unknown error'}</p>`;
    }
  })
  .catch(err => {
    console.error('Fetch error:', err);
    app.innerHTML = `<p>❌ Network error. Please try again.</p>`;
  });
}

/* Expose */
window.confirmCode = confirmCode;
window.confirmRunCode = confirmRunCode;
window.confirmUnits = confirmUnits;
window.submitEntry = submitEntry;
window.showStep1 = showStep1;
window.showStep2 = showStep2;
window.startBarcodeScan = startBarcodeScan;

/* Init */
loadRunCodes();
loadOrderLog();
showStep1();
