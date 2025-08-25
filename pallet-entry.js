// pallet-entry.js
// Flow: scan/enter pallet -> confirm -> pick run code (shows ORDER LOG D & F) -> units -> confirm & submit
// Buttons: LEFT = Back, RIGHT = Next/Confirm
let app = document.getElementById('app');
let palletCode = '';
let runCode = '';
let runCodes = [];

const RUN_CODES_CSV   = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1875380966&single=true&output=csv';
const ORDER_LOG_CSV   = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=792145998&single=true&output=csv';
const SCRIPT_URL      = '/.netlify/functions/submit'; // Netlify function

// ORDER LOG lookup: run -> { d, f }
const orderLog = new Map();

/* ---------- CSV helpers ---------- */
function parseCSV(text){
  const lines = text.replace(/\r/g,'').split('\n').filter(x => x.length);
  const rows = [];
  for (const line of lines){
    const out = []; let cur=''; let inQ=false;
    for (let i=0;i<line.length;i++){
      const ch = line[i];
      if (inQ){
        if (ch === '"'){ if (line[i+1] === '"'){ cur+='"'; i++; } else { inQ=false; } }
        else { cur += ch; }
      } else {
        if (ch === ','){ out.push(cur); cur=''; }
        else if (ch === '"'){ inQ=true; }
        else { cur += ch; }
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
      runCodes = csv
        .trim()
        .split('\n')
        .map(code => code.trim())
        .filter(Boolean);
      runCodes = Array.from(new Set(runCodes))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    })
    .catch(err => console.error('Run codes CSV error:', err));
}

function loadOrderLog(){
  fetch(ORDER_LOG_CSV)
    .then(r => r.text())
    .then(text => {
      const rows = parseCSV(text);
      for (let i=0;i<rows.length;i++){
        const row = rows[i];
        const run = (row[0] || '').trim();       // col A = run
        if (!run) continue;
        const d = (row[3] || '').trim();         // col D
        const f = (row[5] || '').trim();         // col F
        orderLog.set(run, { d, f });
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
      <button class="btn-ghost" onclick="/* no-op */ void 0" disabled>Back</button>
      <button onclick="confirmCode()">Next</button>
    </div>
    <hr>
    <div class="actions">
      <button class="btn-ghost" onclick="/* no-op */ void 0" disabled>Back</button>
      <button onclick="startBarcodeScan()">📷 Scan Barcode</button>
    </div>
  `;
}

function confirmCode() {
  const input = document.getElementById('codeInput').value;
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
            palletCode = barcodes[0].rawValue;
            if (palletCode.length !== 15 || isNaN(palletCode)) {
              alert("Scanned code is not a valid 15-digit number.");
              showStep1();
            } else {
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

/* ========== Hybrid dropdown (type to filter + click arrow to open) ========== */
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

    <!-- combo container -->
    <div id="runCombo" style="position:relative;">
      <input id="runCodeInput" placeholder="Type to search…" autocomplete="off"
             style="width:100%; padding-right:42px;">
      <button id="runCodeToggle" type="button" aria-label="Open suggestions"
              style="position:absolute; right:6px; top:6px; height:34px; width:34px; border-radius:10px; border:1px solid var(--card-border); background:rgba(255,255,255,0.08); color:var(--text); cursor:pointer;">▾</button>
      <div id="runCodeList" hidden
           style="position:absolute; z-index:1000; left:0; right:0; margin-top:6px; max-height:240px; overflow:auto; border:1px solid var(--card-border); border-radius:12px; background:rgba(10,15,26,0.95); backdrop-filter: blur(6px); box-shadow: var(--shadow);">
      </div>
    </div>

    <!-- ORDER LOG: D & F appear here when a valid run is selected -->
    <div id="runDetails" class="status" style="margin-top:10px;"></div>

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
            style="padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.06); cursor:pointer; ${i===items.length-1?'border-bottom:none;':''} ${i===highlight?'background:rgba(255,255,255,0.08);':''}">${escapeHTML(code)}</div>`
    ).join('') || `<div style="padding:10px 12px; color:var(--muted);">No matches</div>`;
  }

  function openList(){ if (!open){ list.hidden = false; open = true; } }
  function closeList(){ if (open){ list.hidden = true; open = false; highlight = -1; } }

  function maybeShowDetails(val){
    const m = findRunCode(val);
    if (!m){ details.textContent = ''; return; }
    const info = orderLog.get(m);
    if (info){
      // Show D and F (light formatting)
      details.innerHTML = `
        <div style="border:1px solid var(--card-border);border-radius:12px;padding:10px;background:rgba(255,255,255,0.05);">
          <div><strong>Details (from ORDER LOG)</strong></div>
          <div>Column D: <strong>${escapeHTML(info.d || '-')}</strong></div>
          <div>Column F: <strong>${escapeHTML(info.f || '-')}</strong></div>
        </div>
      `;
    } else {
      details.textContent = 'No extra info found for this run.';
    }
  }

  function selectValue(val){
    input.value = val;
    maybeShowDetails(val);   // update details immediately
    closeList();
  }

  // events
  input.addEventListener('input', () => { filter(input.value); openList(); maybeShowDetails(input.value); });
  input.addEventListener('focus',  () => { filter(input.value); /* keep closed */ maybeShowDetails(input.value); });

  input.addEventListener('keydown', (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { filter(input.value); openList(); }
    if (!open && e.key === 'Enter') { return; }

    if (e.key === 'ArrowDown'){ highlight = Math.min((highlight + 1), items.length - 1); e.preventDefault(); render(); }
    else if (e.key === 'ArrowUp'){ highlight = Math.max((highlight - 1), 0); e.preventDefault(); render(); }
    else if (e.key === 'Enter'){
      if (open && highlight >= 0 && items[highlight]){ selectValue(items[highlight]); e.preventDefault(); }
    } else if (e.key === 'Escape'){ closeList(); }
  });

  toggle.addEventListener('click', () => { if (open) closeList(); else { filter(input.value); openList(); } });
  list.addEventListener('click', (e) => { const el = e.target.closest('.combo-option'); if (el) selectValue(el.dataset.value); });
  document.addEventListener('click', (e) => { const combo = document.getElementById('runCombo'); if (combo && !combo.contains(e.target)) closeList(); }, { capture: true });

  // initial
  filter(''); closeList(); maybeShowDetails(input.value);
}

function confirmRunCode() {
  const entered = document.getElementById('runCodeInput').value;
  const matched = findRunCode(entered);

  if (!matched) {
    alert('Please choose a valid run code from the list. Start typing and pick a suggestion.');
    return;
  }

  runCode = matched;

  app.innerHTML = `
    <p>Code: <strong>${palletCode}</strong></p>
    <p>Run Code: <strong>${runCode}</strong></p>
    <label>Enter number of units:</label>
    <input id="unitInput" type="number" min="1" />
    <div class="actions mt-3">
      <button class="btn-ghost" onclick="showStep2()">Back</button>
      <button onclick="confirmUnits()">Next</button>
    </div>
  `;
}
/* ================= End hybrid dropdown =================== */

function confirmUnits() {
  const input = document.getElementById('unitInput').value;
  const units = parseInt(input);

  if (isNaN(units) || units <= 0) {
    alert("Please enter a valid number of units.");
    return;
  }

  app.innerHTML = `
    <p>Code: <strong>${palletCode}</strong></p>
    <p>Run Code: <strong>${runCode}</strong></p>
    <p>Units: <strong>${units}</strong></p>
    <div class="actions mt-3">
      <button class="btn-ghost" onclick="confirmRunCode()">Back</button>
      <button onclick="submitEntry(${units})">Confirm & Submit</button>
    </div>
  `;
}

function submitEntry(units) {
  const url = "/.netlify/functions/submit";

  const body = new URLSearchParams();
  body.append("code", palletCode);
  body.append("run", runCode);
  body.append("units", units);

  fetch(url, {
    method: 'POST',
    body: body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  })
  .then(res => res.json())
  .then(data => {
    if (data.result === 'success') {
      app.innerHTML = `
        <p>✅ Entry submitted successfully!</p>
        <div class="actions mt-3">
          <button class="btn-ghost" onclick="/* no-op */ void 0" disabled>Back</button>
          <button onclick="showStep1()">Add Another</button>
        </div>
      `;
    } else {
      app.innerHTML = `<p>❌ Error: ${data.message}</p>`;
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
window.submitEntry = submitEntry;
window.showStep1 = showStep1;
window.showStep2 = showStep2;
window.startBarcodeScan = startBarcodeScan;

/* Init */
loadRunCodes();
loadOrderLog();
showStep1();
