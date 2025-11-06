// goods-in-3p.js (MERGED)
// - Format is asked BEFORE Units
// - Packing Format is a fixed dropdown list
// - Duty Status is a fixed dropdown of 3 options
// - BBE entered as DDMMYYYY; converted to DD/MM/YYYY when submitting
// - ABV auto-fills for listed products using col E from PRODUCT DATABASE (3P)
//   keyed by col A "Company | Product"

// === BASIC WIRING ===
const app   = document.getElementById('app');
const video = document.getElementById('video');

// === CONFIG: paste your published CSV URLs ===
// PRODUCTS (3P): column A must be "Company | Product"
const PRODUCTS_3P_CSV   = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=60083586&single=true&output=csv';
// CUSTOMERS (SCS & 3P): column A company names
const CUSTOMERS_CSV     = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=2137345148&single=true&output=csv';
// PRODUCT DATABASE (3P): column A "Company | Product", column E ABV
const PRODUCT_DB_3P_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1881254286&single=true&output=csv';
// Netlify function to relay to Apps Script
const SCRIPT_URL        = '/.netlify/functions/submit3p';

// === Fixed dropdowns ===
const FORMAT_OPTIONS = [
  '12 x 330ml',
  '12 x 500ml',
  '1.5L Bib',
  '3L Bib',
  '3L Corner Bib',
  '5L Bib',
  '10L Bib',
  '20L Bib',
  '1.5L Pouch',
  '2.25L Pouch',
  '3L Pouch',
  '5L Pouch',
  '12L One-Way',
  '20L One-Way',
  '30L One-Way',
  '30L Keg',
  '50L Keg',
  '50cl Bottle',
  '70cl Bottle',
  '6 x 70cl',
  '12 x 750ml',
  'Bulk',
  'IBC / Arlington',
  'Jerrycan or Drum'
];

const DUTY_OPTIONS = [
  'Duty already paid',
  'Duty Suspended',
  "Don't know"
];

// === State ===
let palletId = '';
let listedItem = '';   // "Company | Product" helper
let company = '';
let product = '';
let abv = '';          // auto-filled for listed; manual for non-listed
let units = 0;
let format = '';
let duty = '';
let bbe = '';          // stored raw as DDMMYYYY (8 digits)

// For Same Loadout
let lastLoadout = null; // { listedItem, company, product, abv, units, format, duty }

// === Data ===
let productsList = [];   // from PRODUCTS (3P) col A
let customersList = [];  // from CUSTOMERS col A
let abvByHelper = new Map(); // PRODUCT DATABASE (3P): key col A "Company | Product", val col E ABV

// === CSV helpers ===
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
function pad(n){ return String(n).padStart(2,'0'); }
function nowForSheets(){
  const d = new Date();
  return {
    date: `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  };
}
function bbeWithSlashes(raw8){
  // Converts "DDMMYYYY" -> "DD/MM/YYYY"
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(String(raw8||'').trim());
  return m ? `${m[1]}/${m[2]}/${m[3]}` : '';
}

// === Lookups ===
function loadLookups(){
  // PRODUCTS (3P)
  if (PRODUCTS_3P_CSV && PRODUCTS_3P_CSV.startsWith('http')){
    fetch(PRODUCTS_3P_CSV).then(r=>r.text()).then(text=>{
      const rows = parseCSV(text);
      productsList = rows.map(r => (r[0]||'').trim()).filter(Boolean);
      productsList = Array.from(new Set(productsList))
        .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    }).catch(console.error);
  }
  // CUSTOMERS
  if (CUSTOMERS_CSV && CUSTOMERS_CSV.startsWith('http')){
    fetch(CUSTOMERS_CSV).then(r=>r.text()).then(text=>{
      const rows = parseCSV(text);
      customersList = rows.map(r => (r[0]||'').trim()).filter(Boolean);
      customersList = Array.from(new Set(customersList))
        .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    }).catch(console.error);
  }
  // PRODUCT DATABASE (3P): col A helper, col E ABV
  if (PRODUCT_DB_3P_CSV && PRODUCT_DB_3P_CSV.startsWith('http')){
    fetch(PRODUCT_DB_3P_CSV).then(r=>r.text()).then(text=>{
      const rows = parseCSV(text);
      abvByHelper.clear();
      for (const r of rows){
        const helper = (r[0] || '').trim();
        const abvVal = (r[4] || '').toString().trim(); // column E index 4
        if (helper) abvByHelper.set(helper, abvVal);
      }
    }).catch(console.error);
  }
}

// === Camera scan utility ===
async function startScan(onValue){
  if (typeof BarcodeDetector === 'undefined'){
    alert('Barcode scanning is not supported in this browser.');
    return;
  }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    video.style.display='block';
    await video.play();

    app.insertAdjacentElement('beforeend', video);

    const detector = new BarcodeDetector({ formats: ['code_128','ean_13'] });
    const loop = async ()=>{
      try{
        const codes = await detector.detect(video);
        if (codes.length > 0){
          stream.getTracks().forEach(t=>t.stop());
          video.style.display='none';
          const raw = (codes[0].rawValue || '').trim();
          onValue(raw);
          return;
        }
      }catch(err){
        console.error('Barcode detection error:', err);
        stream.getTracks().forEach(t=>t.stop());
        video.style.display='none';
        alert('Barcode detection failed.');
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }catch(err){
    console.error('getUserMedia error:', err);
    alert('Camera access denied or unavailable.');
  }
}

// === UI helpers ===
function confirmationBlock(){
  return `
    <div style="border:1px solid var(--card-border);border-radius:12px;padding:10px;background:rgba(255,255,255,0.05); margin-bottom:8px;">
      <div>Pallet ID: <strong style="color:#fff">${escapeHTML(palletId)}</strong></div>
      ${listedItem
        ? `<div>Product: <strong style="color:#fff">${escapeHTML(listedItem)}</strong></div>`
        : `
          <div>Company: <strong style="color:#fff">${escapeHTML(company || '-')}</strong></div>
          <div>Product: <strong style="color:#fff">${escapeHTML(product || '-')}</strong></div>
        `}
      <div>ABV: <strong style="color:#fff">${escapeHTML(abv || '-')}</strong></div>
      <div>Packing Format: <strong style="color:#fff">${escapeHTML(format || '-')}</strong></div>
      <div>Units on Pallet: <strong style="color:#fff">${escapeHTML(String(units||''))}</strong></div>
      <div>Best Before: <strong style="color:#fff">${escapeHTML(bbeWithSlashes(bbe) || '-' )}</strong></div>
      <div>Current Duty Status: <strong style="color:#fff">${escapeHTML(duty || '-')}</strong></div>
    </div>
  `;
}
function textInputRow(id, label, attrs=''){
  return `
    <label for="${id}">${label}</label>
    <input id="${id}" ${attrs} />
  `;
}
function combo(id, placeholder, list){
  return `
    <div id="${id}-wrap" style="position:relative;">
      <input id="${id}" placeholder="${placeholder}" autocomplete="off" style="width:100%; padding-right:42px;">
      <button id="${id}-toggle" type="button" aria-label="Open suggestions"
        style="position:absolute; right:6px; top:6px; height:34px; width:34px; border-radius:10px; border:1px solid var(--card-border); background:rgba(255,255,255,0.08); color:var(--text); cursor:pointer;">▾</button>
      <div id="${id}-list" hidden
        style="position:absolute; z-index:1000; left:0; right:0; margin-top:6px; max-height:240px; overflow:auto; border:1px solid var(--card-border); border-radius:12px; background:rgba(10,15,26,0.95); backdrop-filter: blur(6px); box-shadow: var(--shadow);">
        ${list.map(v => `<div class="combo-option" data-value="${escapeHTML(v)}" style="padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.06); cursor:pointer;">${escapeHTML(v)}</div>`).join('')}
      </div>
    </div>
  `;
}
function wireCombo(id){
  const input  = document.getElementById(id);
  const toggle = document.getElementById(id+'-toggle');
  const list   = document.getElementById(id+'-list');
  const wrap   = document.getElementById(id+'-wrap');

  const filter = ()=>{
    const q = (input.value||'').trim().toUpperCase();
    Array.from(list.children).forEach(opt=>{
      const v = (opt.dataset.value||'').toUpperCase();
      opt.style.display = v.includes(q) ? '' : 'none';
    });
  };
  const open = ()=>{ list.hidden=false; filter(); };
  const close= ()=>{ list.hidden=true; };

  input.addEventListener('input', filter);
  input.addEventListener('focus', open);
  toggle.addEventListener('click', ()=> list.hidden ? open() : close());
  list.addEventListener('click', e=>{
    const el = e.target.closest('.combo-option');
    if (!el) return;
    input.value = el.dataset.value || '';
    close();
  });
  document.addEventListener('click', e=>{ if (!wrap.contains(e.target)) close(); }, {capture:true});
}

// === Steps ===
function showStep1(){
  app.innerHTML = `
    <label>Enter Pallet Identifier (15-digit code):</label>
    <input id="palletInput" maxlength="15" placeholder="Scan or type 15 digits" />
    <div class="actions mt-3">
      <button class="btn btn-success" onclick="confirmPallet()">Confirm Pallet Barcode</button>
    </div>
    <hr>
    <p class="status">Tip: You can also scan using your camera.</p>
    <div class="actions mt-4">
      <button class="btn btn-primary" onclick="scanPallet()">📷 Use Camera</button>
    </div>
  `;
  const input = document.getElementById('palletInput');
  input.focus(); input.addEventListener('keydown', e=>{ if(e.key==='Enter') confirmPallet(); });
}

function confirmPallet(){
  const v = (document.getElementById('palletInput').value||'').trim();
  if (v.length!==15 || isNaN(v)){ alert('Please enter a valid 15-digit number.'); return; }
  palletId = v;
  showPathChooser();
}
function scanPallet(){
  app.innerHTML = `<p>📷 Scanning... Point camera at barcode.</p>`;
  startScan(raw=>{
    if (raw.length!==15 || isNaN(raw)){ alert('Scanned code is not a valid 15-digit number.'); showStep1(); return; }
    palletId = raw; showPathChooser();
  });
}

function showPathChooser(){
  app.innerHTML = `
    <p>Pallet ID: <strong>${escapeHTML(palletId)}</strong></p>
    <label>Select Product (from PRODUCTS 3P):</label>
    ${combo('productCombo','Type to search…', productsList)}
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showStep1()">Back</button>
      <button class="btn btn-primary" onclick="chooseListed()">Next</button>
    </div>
    <hr class="mt-4">
    <div class="actions">
      <button class="btn btn-secondary" onclick="startManual()">Enter product not listed above</button>
    </div>
  `;
  wireCombo('productCombo');
}

function chooseListed(){
  const val = (document.getElementById('productCombo').value || '').trim();
  if (!val){ alert('Please choose a product from the list.'); return; }
  listedItem = val;

  // Split helper into company/product
  const parts = listedItem.split('|').map(s=>s.trim());
  company = parts[0] || '';
  product = parts[1] || '';

  // Auto-fill ABV from PRODUCT DATABASE (3P)
  abv = abvByHelper.get(listedItem) || '';

  // Next: Format (dropdown) BEFORE Units
  showFormat();
}

function startManual(){
  listedItem = '';
  company = '';
  product = '';
  abv = '';
  app.innerHTML = `
    <p>Pallet ID: <strong>${escapeHTML(palletId)}</strong></p>
    <label>Name of product owner:</label>
    ${combo('ownerCombo','Type company name', customersList)}
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showPathChooser()">Back</button>
      <button class="btn btn-primary" onclick="confirmOwner()">Next</button>
    </div>
  `;
  wireCombo('ownerCombo');
}
function confirmOwner(){
  const val = (document.getElementById('ownerCombo').value || '').trim();
  if (!val){ alert('Please choose or type a company name.'); return; }
  company = val;
  showManualProductName();
}
function showManualProductName(){
  app.innerHTML = `
    <p>Owner: <strong>${escapeHTML(company)}</strong></p>
    ${textInputRow('prodName','Enter Product Name:','placeholder="Type product name"')}
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="startManual()">Back</button>
      <button class="btn btn-primary" onclick="confirmManualProductName()">Next</button>
    </div>
  `;
  document.getElementById('prodName').focus();
}
function confirmManualProductName(){
  const val = (document.getElementById('prodName').value||'').trim();
  if (!val){ alert('Please enter a product name.'); return; }
  product = val;
  showManualABV();
}
function showManualABV(){
  app.innerHTML = `
    <p>Owner: <strong>${escapeHTML(company)}</strong></p>
    <p>Product: <strong>${escapeHTML(product)}</strong></p>
    ${textInputRow('abvInput','Enter ABV (e.g. 4.5):','type="number" step="0.1" min="0" max="100"')}
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showManualProductName()">Back</button>
      <button class="btn btn-primary" onclick="confirmManualABV()">Next</button>
    </div>
  `;
  document.getElementById('abvInput').focus();
}
function confirmManualABV(){
  const v = (document.getElementById('abvInput').value||'').trim();
  if (!v || isNaN(v) || Number(v) < 0){ alert('Please enter a valid ABV.'); return; }
  abv = v;
  showFormat();
}

// === Format BEFORE Units ===
function showFormat(){
  app.innerHTML = `
    <label for="formatSelect">Select Packing Format:</label>
    <select id="formatSelect">
      <option value="">-- Choose a format --</option>
      ${FORMAT_OPTIONS.map(opt => `<option value="${escapeHTML(opt)}">${escapeHTML(opt)}</option>`).join('')}
    </select>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="${listedItem ? 'showPathChooser()' : 'showManualABV()'}">Back</button>
      <button class="btn btn-primary" onclick="confirmFormat()">Next</button>
    </div>
  `;
  document.getElementById('formatSelect').focus();
}
function confirmFormat(){
  const sel = document.getElementById('formatSelect');
  const v = (sel && sel.value) ? sel.value.trim() : '';
  if (!v){ alert('Please choose a packing format.'); return; }
  format = v;
  showUnits();
}

function showUnits(){
  app.innerHTML = `
    ${textInputRow('unitsInput','Enter Number of units per pallet:','type="number" min="1"')}
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showFormat()">Back</button>
      <button class="btn btn-primary" onclick="confirmUnits()">Next</button>
    </div>
  `;
  document.getElementById('unitsInput').focus();
}
function confirmUnits(){
  const u = parseInt((document.getElementById('unitsInput').value||'').trim(), 10);
  if (isNaN(u) || u <= 0){ alert('Please enter a valid number of units.'); return; }
  units = u;
  showDuty();
}

// === Duty dropdown ===
function showDuty(){
  app.innerHTML = `
    <label for="dutySelect">Current Duty Status:</label>
    <select id="dutySelect">
      <option value="">-- Choose status --</option>
      ${DUTY_OPTIONS.map(opt => `<option value="${escapeHTML(opt)}">${escapeHTML(opt)}</option>`).join('')}
    </select>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showUnits()">Back</button>
      <button class="btn btn-primary" onclick="confirmDuty()">Next</button>
    </div>
  `;
  document.getElementById('dutySelect').focus();
}
function confirmDuty(){
  const sel = document.getElementById('dutySelect');
  const v = (sel && sel.value) ? sel.value.trim() : '';
  if (!v){ alert('Please choose a duty status.'); return; }
  duty = v;
  showBBE();
}

// === BBE expects DDMMYYYY (8 digits) ===
function showBBE(){
  app.innerHTML = `
    ${textInputRow('bbeInput','Best Before Date (DDMMYYYY):','placeholder="DDMMYYYY" inputmode="numeric" maxlength="8"')}
    <div class="status">Enter 8 digits, e.g. 01062026 for 01/06/2026.</div>
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showDuty()">Back</button>
      <button class="btn btn-primary" onclick="confirmBBE()">Next</button>
    </div>
  `;
  document.getElementById('bbeInput').focus();
}
function confirmBBE(){
  const v = (document.getElementById('bbeInput').value||'').trim();
  if (!/^\d{8}$/.test(v)){ alert('Please enter the date as 8 digits: DDMMYYYY'); return; }
  bbe = v; // store raw 8 digits
  showConfirm();
}

function showConfirm(){
  app.innerHTML = `
    ${confirmationBlock()}
    <div class="actions mt-3">
      <button class="btn btn-ghost" onclick="showBBE()">Back</button>
      <button class="btn btn-success" onclick="submit3P()">Confirm & Submit</button>
    </div>
  `;
}

function submit3P(){
  const { date, time } = nowForSheets();
  const helper = listedItem || `${company} | ${product}`;
  const bbeOut = bbeWithSlashes(bbe); // DDMMYYYY -> DD/MM/YYYY

  const body = new URLSearchParams();
  body.append('pallet', palletId);       // A
  body.append('units', String(units));   // B
  body.append('date', date);             // (GAS uses server time for C/D)
  body.append('time', time);
  body.append('helper', helper);         // E
  body.append('company', company);       // F
  body.append('product', product);       // G
  body.append('format', format);         // H
  body.append('abv', abv);               // I
  body.append('bbe', bbeOut);            // J
  body.append('duty', duty);             // K

  app.innerHTML = `<p class="status">Submitting…</p>`;

  fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type':'application/x-www-form-urlencoded' },
    body
  })
  .then(r => r.json())
  .then(data => {
    if (data.result === 'ok' || data.result === 'success'){
      lastLoadout = { listedItem, company, product, abv, units, format, duty };

      app.innerHTML = `
        <p>✅ Entry submitted Successfully!</p>
        <div class="actions mt-3">
          <button class="btn btn-primary" onclick="resetAll()">Add Another</button>
          <button class="btn btn-success" onclick="sameLoadout()">Add Another – Same Loadout</button>
        </div>
      `;
    } else {
      app.innerHTML = `
        <p>❌ Error: ${escapeHTML(data.message || 'Unknown error')}</p>
        <div class="actions mt-3"><button class="btn btn-ghost" onclick="showConfirm()">Back</button></div>
      `;
    }
  })
  .catch(err => {
    console.error(err);
    app.innerHTML = `
      <p>❌ Network error. Please try again.</p>
      <div class="actions mt-3"><button class="btn btn-ghost" onclick="showConfirm()">Back</button></div>
    `;
  });
}

function resetAll(){
  palletId = ''; listedItem=''; company=''; product=''; abv=''; units=0; format=''; duty=''; bbe='';
  showStep1();
}
function sameLoadout(){
  if (!lastLoadout){ resetAll(); return; }
  listedItem = lastLoadout.listedItem;
  company    = lastLoadout.company;
  product    = lastLoadout.product;
  abv        = lastLoadout.abv;
  units      = lastLoadout.units;
  format     = lastLoadout.format;
  duty       = lastLoadout.duty;

  app.innerHTML = `
    <label>Enter Pallet Identifier (15-digit code):</label>
    <input id="samePallet" maxlength="15" placeholder="Scan or type 15 digits"/>
    <div class="actions mt-3">
      <button class="btn btn-success" onclick="confirmSamePallet()">Confirm Manual Entry</button>
    </div>
    <hr>
    <div class="actions">
      <button class="btn btn-primary" onclick="scanSame()">📷 Scan Barcode</button>
    </div>
    <p class="status">This reuses the last owner/product/ABV/format/units/duty.</p>
  `;
  document.getElementById('samePallet').focus();
}
function confirmSamePallet(){
  const v = (document.getElementById('samePallet').value||'').trim();
  if (v.length!==15 || isNaN(v)){ alert('Please enter a valid 15-digit number.'); return; }
  palletId = v; showConfirm();
}
function scanSame(){
  app.innerHTML = `<p>📷 Scanning... Point camera at barcode.</p>`;
  startScan(raw=>{
    if (raw.length!==15 || isNaN(raw)){ alert('Scanned code is not a valid 15-digit number.'); sameLoadout(); return; }
    palletId = raw; showConfirm();
  });
}

// Expose for onclick
window.confirmPallet = confirmPallet;
window.scanPallet    = scanPallet;
window.chooseListed  = chooseListed;
window.startManual   = startManual;
window.confirmOwner  = confirmOwner;
window.confirmManualProductName = confirmManualProductName;
window.confirmManualABV = confirmManualABV;
window.confirmUnits  = confirmUnits;
window.confirmFormat = confirmFormat;
window.confirmDuty   = confirmDuty;
window.confirmBBE    = confirmBBE;
window.submit3P      = submit3P;
window.resetAll      = resetAll;
window.sameLoadout   = sameLoadout;
window.confirmSamePallet = confirmSamePallet;
window.scanSame      = scanSame;

// Init
loadLookups();
showStep1();
