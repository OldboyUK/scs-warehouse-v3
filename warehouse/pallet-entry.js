// pallet-entry.js
// Flow: enter/scan pallet -> confirm -> pick run (shows Product/Format via ORDER LOG) -> units (shows same confirmation) -> confirm & submit
// After submit: choose Add Another OR Add Another – Same Loadout (reuses last run + units)

let app = document.getElementById('app');
let palletCode = '';
let runCode = '';
let runCodes = [];
let lastLoadout = null; // { runCode, product, format, units }

const PROGRESS_STEPS = ['Scan', 'Run Code', 'Units', 'Submit'];

// CSVs
const RUN_CODES_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1199565865&single=true&output=csv';
const ORDER_LOG_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=792145998&single=true&output=csv';
const SCRIPT_URL = `${window.location.origin}/.netlify/functions/submit`;

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
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

/* ---------- Data loaders ---------- */
function loadRunCodes() {
  fetch(RUN_CODES_CSV)
    .then(r => r.text())
    .then(csv => {
      // A2:A — skip header row, take column A only
      const rows = parseCSV(csv);
      runCodes = rows.slice(1).map(row => String(row[0] || '').trim()).filter(Boolean);
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
        const run = (row[0] || '').trim();     // A
        if (!run) continue;
        const product = (row[3] || '').trim(); // D
        const format  = (row[5] || '').trim(); // F
        orderLog.set(run, { product, format });
      }
    })
    .catch(err => console.error('ORDER LOG CSV error:', err));
}

/* ---------- Shared helpers ---------- */
function findRunCode(value) {
  const v = (value || '').trim().toUpperCase();
  return runCodes.find(c => c.toUpperCase() === v) || null;
}

function normalizeRunCodeSearch(value) {
  return String(value || '').toUpperCase().replace(/-/g, '');
}

function runCodeSearchRank(code, query) {
  const normalizedCode = normalizeRunCodeSearch(code);
  const normalizedQuery = normalizeRunCodeSearch(query);
  if (!normalizedQuery) return 0;
  if (normalizedCode === normalizedQuery) return 0;
  if (normalizedCode.startsWith(normalizedQuery)) return 1;
  if (normalizedCode.includes(normalizedQuery)) return 2;
  return -1;
}

function filterRunCodes(query) {
  const normalizedQuery = normalizeRunCodeSearch(query);
  if (!normalizedQuery) {
    return runCodes.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  return runCodes
    .map(code => ({ code, rank: runCodeSearchRank(code, query) }))
    .filter(item => item.rank >= 0)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.code.localeCompare(b.code, undefined, { numeric: true });
    })
    .map(item => item.code);
}
function confirmationBlock({code, run, product, format, units}) {
  const rows = [
    { label: 'Code', value: escapeHTML(code) },
    { label: 'Run Code', value: escapeHTML(run) },
    { label: 'Product', value: escapeHTML(product || '-') },
    { label: 'Format', value: escapeHTML(format || '-') }
  ];
  if (typeof units === 'number') {
    rows.push({ label: 'Units', value: String(units) });
  }
  return UI.summaryCard(rows);
}

/* ---------- Step 1: enter/scan pallet ---------- */
function showStep1() {
  app.innerHTML = `
    ${UI.progressBar(PROGRESS_STEPS, 0)}
    <label>Enter 15-digit code:</label>
    <input id="codeInput" maxlength="15" />
    <div class="actions mt-3">
      <button class="btn btn-success" onclick="confirmCode()">Confirm Pallet Barcode</button>
    </div>
    <hr>
    <p class="status">Tip: You can also scan using your camera.</p>
    <div class="actions mt-5">
      ${UI.cameraButton('Use Camera', 'startBarcodeScan()')}
    </div>
  `;

  // Keep autofocus behaviour
  const input = document.getElementById('codeInput');
  if (input) {
    input.focus();
    if (typeof input.select === 'function') input.select();
  }
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
    ${UI.progressBar(PROGRESS_STEPS, 0)}
    <p>You entered: <strong>${palletCode}</strong></p>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showStep1()">Back</button>
      <button class="btn btn-primary" onclick="showStep2()">Confirm</button>
    </div>
  `;
}
function startBarcodeScan() {
  if (typeof BarcodeDetector === 'undefined') { alert('Barcode scanning is not supported in this browser.'); return; }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(async stream => {
      const video = document.createElement('video');
      video.srcObject = stream; video.setAttribute('playsinline', 'true');
      await video.play();
      app.innerHTML = UI.progressBar(PROGRESS_STEPS, 0) + UI.scanCard('');
      const frame = app.querySelector('.scan-frame');
      if (frame) frame.appendChild(video);
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'cover';
      const detector = new BarcodeDetector({ formats: ['code_128','ean_13'] });
      const scan = async () => {
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0) {
            stream.getTracks().forEach(t=>t.stop());
            const raw = (barcodes[0].rawValue || '').trim();
            if (raw.length !== 15 || isNaN(raw)) { alert('Scanned code is not a valid 15-digit number.'); showStep1(); }
            else { palletCode = raw; showConfirmCode(); }
          } else { requestAnimationFrame(scan); }
        } catch (err) { console.error(err); stream.getTracks().forEach(t=>t.stop()); alert('Barcode detection failed.'); showStep1(); }
      };
      scan();
    })
    .catch(err => { alert("Camera access denied or unavailable."); console.error(err); });
}

/* ---------- Step 2: run code selection (with ORDER LOG details) ---------- */
function showStep2() {
  app.innerHTML = `
    ${UI.progressBar(PROGRESS_STEPS, 1)}
    <label>Select run code:</label>

    <div id="runCodeInput-wrap" class="combo-wrap">
      <input id="runCodeInput" placeholder="Type to search…" autocomplete="off">
      <button id="runCodeInput-toggle" type="button" class="combo-toggle" aria-label="Open suggestions">▾</button>
      <div id="runCodeInput-list" class="combo-list" hidden></div>
    </div>

    <div id="runDetails" class="mt-3"></div>

    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showConfirmCode()">Back</button>
      <button class="btn btn-primary" onclick="confirmRunCode()">Next</button>
    </div>
  `;
  setupRunCodeCombo();
}
function setupRunCodeCombo(){
  const input  = document.getElementById('runCodeInput');
  const toggle = document.getElementById('runCodeInput-toggle');
  const list   = document.getElementById('runCodeInput-list');
  const details= document.getElementById('runDetails');
  let open=false, items=[], highlight=-1;

  function filter(q){ items = filterRunCodes(q); render(); }
  function render(){
    list.innerHTML = items.map((code,i)=>`
      <div class="combo-option${i===highlight?' is-highlight':''}" data-value="${escapeHTML(code)}">
        ${escapeHTML(code)}
      </div>`).join('') || `<div class="status">No matches</div>`;
  }
  function openList(){ if(!open){ list.hidden=false; open=true; } }
  function closeList(){ if(open){ list.hidden=true; open=false; highlight=-1; } }
  function showDetails(val){
    const run = findRunCode(val); if (!run){ details.innerHTML=''; return; }
    const info = orderLog.get(run);
    if (info){
      details.innerHTML = UI.summaryCard([
        { label: 'Product', value: escapeHTML(info.product || '-') },
        { label: 'Format', value: escapeHTML(info.format || '-') }
      ]);
    } else { details.innerHTML=''; }
  }
  function selectValue(val){ input.value=val; closeList(); showDetails(val); }
  input.addEventListener('input', ()=>{ filter(input.value); openList(); showDetails(input.value); });
  input.addEventListener('focus', ()=>{ filter(input.value); showDetails(input.value); });
  input.addEventListener('keydown', e=>{
    if(!open && (e.key==='ArrowDown'||e.key==='ArrowUp')){ filter(input.value); openList(); }
    if(!open && e.key==='Enter'){ return; }
    if(e.key==='ArrowDown'){ highlight=Math.min(highlight+1, items.length-1); e.preventDefault(); render(); }
    else if(e.key==='ArrowUp'){ highlight=Math.max(highlight-1, 0); e.preventDefault(); render(); }
    else if(e.key==='Enter'){ if(open && highlight>=0 && items[highlight]){ selectValue(items[highlight]); e.preventDefault(); } }
    else if(e.key==='Escape'){ closeList(); }
  });
  toggle.addEventListener('click', ()=>{ if(open) closeList(); else { filter(input.value); openList(); } });
  list.addEventListener('click', e=>{ const el=e.target.closest('.combo-option[data-value]'); if(el) selectValue(el.dataset.value); });
  document.addEventListener('click', e=>{ const combo=document.getElementById('runCodeInput-wrap'); if (combo && !combo.contains(e.target)) closeList(); }, {capture:true});
  filter(''); closeList(); showDetails(input.value);
}
function confirmRunCode() {
  const entered = document.getElementById('runCodeInput').value;
  const matched = findRunCode(entered);
  if (!matched) { alert('Please choose a valid run code from the list.'); return; }
  runCode = matched;
  const info = orderLog.get(runCode) || { product:'-', format:'-' };
  // Units page with confirmation block
  app.innerHTML = `
    ${UI.progressBar(PROGRESS_STEPS, 2)}
    ${confirmationBlock({code:palletCode, run:runCode, product:info.product, format:info.format})}
    <label>Enter number of units:</label>
    <input id="unitInput" type="number" min="1" />
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showStep2()">Back</button>
      <button class="btn btn-primary" onclick="confirmUnits()">Next</button>
    </div>
  `;
}

/* ---------- Final confirm + submit ---------- */
function confirmUnits() {
  const input = document.getElementById('unitInput').value;
  const units = parseInt(input, 10);
  if (isNaN(units) || units <= 0) { alert("Please enter a valid number of units."); return; }

  const info = orderLog.get(runCode) || { product:'-', format:'-' };
  app.innerHTML = `
    ${UI.progressBar(PROGRESS_STEPS, 3)}
    ${confirmationBlock({code:palletCode, run:runCode, product:info.product, format:info.format, units})}
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="confirmRunCode()">Back</button>
      <button class="btn btn-success" onclick="submitEntry(${units})">Confirm & Submit</button>
    </div>
  `;
}

function submitEntry(units, isSameLoadout = false) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const date = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const body = new URLSearchParams();
  body.append("code", palletCode);
  body.append("run", runCode);
  body.append("units", units);
  body.append("date", date);
  body.append("time", time);

  fetch(SCRIPT_URL, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, 
    body 
  })
    .then(res => res.json())
    .then(data => {
      if (data.result === 'success') {
        const info = orderLog.get(runCode) || { product: '-', format: '-' };
        lastLoadout = { runCode, product: info.product, format: info.format, units };
        showPostSubmitOptions();
      } else {
        app.innerHTML = UI.errorScreen(
          escapeHTML(data.message || 'Unknown error'),
          `<button class="btn btn-ghost" onclick="${isSameLoadout ? 'showSameLoadoutStep1()' : 'showStep1()'}">Back</button>`
        );
      }
    })
    .catch(err => {
      console.error('Fetch error:', err);
      app.innerHTML = UI.errorScreen(
        'Network error. Please try again.',
        `<button class="btn btn-ghost" onclick="${isSameLoadout ? 'showSameLoadoutStep1()' : 'showStep1()'}">Back</button>`
      );
    });
}

/* ---------- Post-submit screen (two options) ---------- */
function showPostSubmitOptions(){
  app.innerHTML = UI.successScreen(
    'Entry submitted successfully!',
    '',
    `<button class="btn btn-primary" onclick="showStep1()">Add Another</button>
     <button class="btn btn-success" onclick="showSameLoadoutStep1()">Add Another – Same Loadout</button>`
  );
}

/* ---------- Same Loadout mini-flow ---------- */
function showSameLoadoutStep1(){
  if (!lastLoadout){ showStep1(); return; } // safety
  app.innerHTML = `
    <label>Enter 15-digit code:</label>
    <input id="sameCodeInput" maxlength="15" />
    <div class="actions mt-3">
      <button class="btn btn-success" onclick="confirmSameCodeManual()">Confirm Manual Entry</button>
    </div>
    <hr>
    <div class="actions">
      ${UI.cameraButton('Scan Barcode', 'startSameLoadoutScan()')}
    </div>
    <p class="status">This will reuse the last Run Code and Units.</p>
  `;
}
function confirmSameCodeManual(){
  const input = document.getElementById('sameCodeInput').value.trim();
  if (input.length !== 15 || isNaN(input)){ alert('Please enter a valid 15-digit number.'); return; }
  palletCode = input;
  showSameLoadoutConfirm();
}
function startSameLoadoutScan(){
  if (typeof BarcodeDetector === 'undefined') { alert('Barcode scanning is not supported in this browser.'); return; }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(async stream => {
      const video = document.createElement('video');
      video.srcObject = stream; video.setAttribute('playsinline','true'); await video.play();
      app.innerHTML = UI.scanCard('');
      const frame = app.querySelector('.scan-frame');
      if (frame) frame.appendChild(video);
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'cover';
      const detector = new BarcodeDetector({ formats:['code_128','ean_13'] });
      const scan = async () => {
        try{
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0){
            stream.getTracks().forEach(t=>t.stop());
            const raw = (barcodes[0].rawValue || '').trim();
            if (raw.length !== 15 || isNaN(raw)){ alert('Scanned code is not a valid 15-digit number.'); showSameLoadoutStep1(); }
            else { palletCode = raw; showSameLoadoutConfirm(); }
          } else { requestAnimationFrame(scan); }
        } catch(err){ console.error(err); stream.getTracks().forEach(t=>t.stop()); alert('Barcode detection failed.'); showSameLoadoutStep1(); }
      };
      scan();
    })
    .catch(err => { alert('Camera access denied or unavailable.'); console.error(err); });
}
function showSameLoadoutConfirm(){
  const info = orderLog.get(lastLoadout.runCode) || { product:lastLoadout.product, format:lastLoadout.format };
  app.innerHTML = `
    ${confirmationBlock({code:palletCode, run:lastLoadout.runCode, product:info.product, format:info.format, units:lastLoadout.units})}
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showSameLoadoutStep1()">Back</button>
      <button class="btn btn-success" onclick="submitEntry(${lastLoadout.units}, true)">Confirm & Submit</button>
    </div>
  `;
}

/* Expose */
window.confirmCode = confirmCode;
window.confirmRunCode = confirmRunCode;
window.confirmUnits = confirmUnits;
window.submitEntry = submitEntry;
window.showStep1 = showStep1;
window.showStep2 = showStep2;
window.startBarcodeScan = startBarcodeScan;
window.showSameLoadoutStep1 = showSameLoadoutStep1;
window.startSameLoadoutScan = startSameLoadoutScan;
window.confirmSameCodeManual = confirmSameCodeManual;

/* Init */
loadRunCodes();
loadOrderLog();
showStep1();
