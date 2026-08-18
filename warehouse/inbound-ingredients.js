const app = document.getElementById('app');
const video = document.getElementById('video');

const CUSTOMERS_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1199565865&single=true&output=csv';
const INGREDIENTS_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=401544146&single=true&output=csv';
const SCRIPT_URL = '/.netlify/functions/submitIngredients';

const UNIT_OPTIONS = ['Kg', 'g', 'L', 'ml'];
const DUTY_OPTIONS = ['Duty Suspended', 'Duty Paid', "Don't Know"];
const SCS_CUSTOMER_NAME = 'Somerset Cider Solutions';
const abvDutyCategories = [
  'Cider Base',
  'Other Base',
  'Spirit',
  'Wine',
  'Preblended',
  'Beer'
];

let palletId = '';
let scsOwned = null;
let customer = '';
let customerCode = '';
let product = '';
let helper = '';
let stockCodeF = '';
let stockCodeG = '';
let selectedProduct = null;
let manualEntry = false;
let lotCode = '';
let abv = '';
let bbe = '';
let unitType = '';
let value = '';
let duty = '';
let comments = '';

let customersList = [];
let ingredientsList = [];
let customersLoaded = false;
let ingredientsLoaded = false;
let customersError = '';
let ingredientsError = '';

let stream = null;
let scanning = false;

function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else { q = false; }
        } else cur += ch;
      } else {
        if (ch === ',') { out.push(cur); cur = ''; }
        else if (ch === '"') { q = true; }
        else cur += ch;
      }
    }
    out.push(cur);
    rows.push(out);
  }
  return rows;
}

function parseCustomers(text) {
  const rows = parseCSV(text);
  const seen = new Map();
  rows.slice(1).forEach(r => {
    const name = (r[1] || '').trim();
    const code = (r[2] || '').trim();
    if (!name || !code) return;
    if (!seen.has(name)) seen.set(name, { customer: name, customerCode: code });
  });
  return Array.from(seen.values())
    .sort((a, b) => a.customer.localeCompare(b.customer, undefined, { numeric: true }));
}

function parseIngredients(text) {
  const rows = parseCSV(text);
  const list = [];
  rows.slice(1).forEach(r => {
    const prod = (r[0] || '').trim();
    const code = (r[2] || '').trim();
    if (!prod || !code) return;
    list.push({
      product: prod,
      customerCode: code,
      helper: (r[3] || '').trim(),
      stockCodeF: (r[5] || '').trim(),
      stockCodeG: (r[4] || '').trim(),
      category: (r[6] || '').trim()
    });
  });
  return list;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function nowForSheets() {
  const d = new Date();
  return {
    date: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  };
}

function getLoggedInUsername() {
  return (typeof SCSAuth !== 'undefined' && SCSAuth.getUsername && SCSAuth.getUsername()) || '';
}

function isValidPalletId(v) {
  return /^\d{15}$/.test(String(v || '').trim());
}

function findScsCustomer() {
  const exact = customersList.find(c => c.customer === SCS_CUSTOMER_NAME);
  if (exact) return exact;
  const target = SCS_CUSTOMER_NAME.toLowerCase();
  return customersList.find(c => c.customer.toLowerCase() === target) || null;
}

function buildStockId(stockCode, lot) {
  return String(stockCode || '') + ' | ' + String(lot || '');
}

function currentGroup() {
  if (manualEntry || !selectedProduct) return '';
  return String(selectedProduct.category || '').trim();
}

function requiresAbvAndDuty() {
  if (manualEntry || !selectedProduct) return false;
  return abvDutyCategories.includes(String(selectedProduct.category || '').trim());
}

function resetProductFields() {
  product = '';
  helper = '';
  stockCodeF = '';
  stockCodeG = '';
  selectedProduct = null;
  manualEntry = false;
  abv = '';
  duty = '';
}

function applyCustomer(match) {
  if (customerCode && customerCode !== match.customerCode) {
    resetProductFields();
  }
  customer = match.customer;
  customerCode = match.customerCode;
}

function scannerReadyFocus(input) {
  if (!input) return;
  input.readOnly = true;
  input.setAttribute('inputmode', 'none');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');
  input.focus({ preventScroll: true });

  const keyHandler = (ev) => {
    const printable = ev.key && ev.key.length === 1;
    const allow = printable || ev.key === 'Enter' || ev.key === 'Tab';
    if (!allow) return;
    input.readOnly = false;
    input.removeAttribute('inputmode');
    if (printable) {
      input.value = (input.value || '') + ev.key;
      const len = input.value.length;
      try { input.setSelectionRange(len, len); } catch (_) {}
    }
    input.removeEventListener('keydown', keyHandler, true);
  };
  input.addEventListener('keydown', keyHandler, true);

  const pointerHandler = () => {
    input.readOnly = false;
    input.removeAttribute('inputmode');
    input.removeEventListener('pointerdown', pointerHandler, true);
  };
  input.addEventListener('pointerdown', pointerHandler, true);
}

function stopCamera() {
  scanning = false;
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  if (video) {
    try { video.pause(); } catch (_) {}
    video.srcObject = null;
    video.style.display = 'none';
  }
}

async function startScan(onValue) {
  if (typeof BarcodeDetector === 'undefined') {
    alert('Barcode scanning is not supported in this browser.');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    video.style.display = 'block';
    await video.play();
    const frame = app.querySelector('.scan-frame');
    if (frame) frame.appendChild(video);
    else app.insertAdjacentElement('beforeend', video);
    const detector = new BarcodeDetector({ formats: ['code_128', 'ean_13'] });
    scanning = true;
    const loop = async () => {
      if (!scanning) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length > 0) {
          scanning = false;
          stopCamera();
          onValue((codes[0].rawValue || '').trim());
          return;
        }
      } catch (err) {
        console.error(err);
        scanning = false;
        stopCamera();
        alert('Barcode detection failed.');
        return;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    alert('Camera access denied or unavailable.');
    stopCamera();
  }
}

function combo(id, placeholder, list, clearable) {
  return `
    <div id="${id}-wrap" class="combo-wrap">
      <input id="${id}" placeholder="${placeholder}" autocomplete="off" autocapitalize="off" spellcheck="false"${clearable ? ' style="padding-right: 92px;"' : ''} />
      ${clearable ? `<button id="${id}-clear" type="button" class="combo-toggle" hidden aria-label="Clear" style="right: 48px;">×</button>` : ''}
      <button id="${id}-toggle" type="button" class="combo-toggle" aria-label="Open suggestions">▾</button>
      <div id="${id}-list" class="combo-list" hidden>
        ${list.map(v => `<div class="combo-option" data-value="${escapeHTML(v)}">${escapeHTML(v)}</div>`).join('')}
      </div>
    </div>
  `;
}

function wireCombo(id, onClear) {
  const input = document.getElementById(id);
  const toggle = document.getElementById(id + '-toggle');
  const clearBtn = document.getElementById(id + '-clear');
  const list = document.getElementById(id + '-list');
  const wrap = document.getElementById(id + '-wrap');
  const filter = () => {
    const q = (input.value || '').trim().toUpperCase();
    Array.from(list.children).forEach(opt => {
      const v = (opt.dataset.value || '').toUpperCase();
      opt.style.display = v.includes(q) ? '' : 'none';
    });
  };
  const open = () => { list.hidden = false; filter(); };
  const close = () => { list.hidden = true; };
  const updateClear = () => {
    if (!clearBtn) return;
    clearBtn.hidden = !(input.value || '').length;
  };
  input.addEventListener('input', () => { filter(); updateClear(); });
  input.addEventListener('focus', open);
  toggle.addEventListener('click', () => list.hidden ? open() : close());
  list.addEventListener('click', e => {
    const el = e.target.closest('.combo-option');
    if (!el) return;
    input.value = el.dataset.value || '';
    updateClear();
    close();
  });
  if (clearBtn) {
    clearBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      input.value = '';
      updateClear();
      filter();
      close();
      input.focus();
      if (typeof onClear === 'function') onClear();
    });
  }
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); }, { capture: true });
  updateClear();
}

function loadLookups() {
  customersLoaded = false;
  ingredientsLoaded = false;
  customersError = '';
  ingredientsError = '';

  fetch(CUSTOMERS_CSV)
    .then(r => r.text())
    .then(t => {
      customersList = parseCustomers(t);
      customersLoaded = true;
    })
    .catch(err => {
      console.error(err);
      customersError = 'Failed to load customers.';
      customersLoaded = true;
    });

  fetch(INGREDIENTS_CSV)
    .then(r => r.text())
    .then(t => {
      ingredientsList = parseIngredients(t);
      ingredientsLoaded = true;
    })
    .catch(err => {
      console.error(err);
      ingredientsError = 'Failed to load ingredients.';
      ingredientsLoaded = true;
    });
}

function productsForCustomer() {
  const code = (customerCode || '').trim();
  return ingredientsList
    .filter(item => item.customerCode === code)
    .sort((a, b) => a.product.localeCompare(b.product, undefined, { numeric: true }));
}

function valueLabelForUnit(unit) {
  if (unit === 'Kg' || unit === 'g') return 'Enter the weight';
  if (unit === 'L' || unit === 'ml') return 'Enter the volume';
  return 'Enter the value';
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function bbeToISO(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function isoToBBE(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function isBbeTodayOrFuture(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return false;
  const y = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  const dt = new Date(y, month - 1, day);
  if (dt.getFullYear() !== y || dt.getMonth() + 1 !== month || dt.getDate() !== day) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dt.setHours(0, 0, 0, 0);
  return dt >= today;
}

function showPallet() {
  stopCamera();
  app.innerHTML = `
    <label for="palletInput">Scan Pallet ID.</label>
    <input id="palletInput" maxlength="15" placeholder="Scan or type 15 digits"
           inputmode="none" autocomplete="off" autocapitalize="off" />
    <div class="actions mt-3">
      <button class="btn btn-success" type="button" onclick="confirmPallet()">Confirm Pallet Barcode</button>
    </div>
    <div class="actions mt-3">
      <button class="btn btn-ghost" type="button" onclick="skipPallet()">Skip Pallet ID</button>
    </div>
    <hr>
    <p class="status">Tip: You can also scan using your camera.</p>
    <div class="actions mt-4">
      ${UI.cameraButton('Use Camera', 'scanPallet()')}
    </div>
  `;
  const input = document.getElementById('palletInput');
  if (palletId && palletId !== 'NO_BARCODE') input.value = palletId;
  scannerReadyFocus(input);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') confirmPallet(); });
}

function confirmPallet() {
  const v = (document.getElementById('palletInput').value || '').trim();
  if (!isValidPalletId(v)) {
    alert('Please enter a valid 15-digit number.');
    return;
  }
  palletId = v;
  showCustomer();
}

function skipPallet() {
  palletId = 'NO_BARCODE';
  showCustomer();
}

function scanPallet() {
  app.innerHTML = UI.scanCard('') + `
    <div class="actions mt-3">
      <button class="btn btn-ghost" type="button" onclick="showPallet()">Back</button>
    </div>
  `;
  startScan(raw => {
    if (!isValidPalletId(raw)) {
      alert('Scanned code is not a valid 15-digit number.');
      showPallet();
      return;
    }
    palletId = raw;
    showCustomer();
  });
}

function showCustomer() {
  stopCamera();
  if (!customersLoaded) {
    app.innerHTML = `<p class="status">Loading customers…</p>`;
    const wait = setInterval(() => {
      if (!customersLoaded) return;
      clearInterval(wait);
      showCustomer();
    }, 150);
    return;
  }

  if (customersError) {
    app.innerHTML = `
      <p class="status">${escapeHTML(customersError)}</p>
      <div class="actions mt-3">
        <button class="btn btn-ghost" type="button" onclick="showPallet()">Back</button>
        <button class="btn btn-primary" type="button" onclick="retryCustomers()">Try Again</button>
      </div>
    `;
    return;
  }

  const names = customersList.map(c => c.customer);
  const yesClass = scsOwned === true ? 'btn-primary' : 'btn-secondary';
  const noClass = scsOwned === false ? 'btn-primary' : 'btn-secondary';
  let followOn = `
    <div class="actions mt-3">
      <button class="btn btn-ghost" type="button" onclick="showPallet()">Back</button>
    </div>
  `;
  if (scsOwned === true) {
    followOn = `
      <p>Customer: <strong>${escapeHTML(customer || SCS_CUSTOMER_NAME)}</strong></p>
      <div class="actions mt-3">
        <button class="btn btn-ghost" type="button" onclick="showPallet()">Back</button>
        <button class="btn btn-primary" type="button" onclick="showProduct()">Next</button>
      </div>
    `;
  } else if (scsOwned === false) {
    followOn = `
      <label>Select Customer.</label>
      ${combo('customerCombo', 'Type to search…', names, true)}
      <div class="actions mt-3">
        <button class="btn btn-ghost" type="button" onclick="showPallet()">Back</button>
        <button class="btn btn-primary" type="button" onclick="confirmCustomer()">Next</button>
      </div>
    `;
  }

  app.innerHTML = `
    <p>Pallet ID: <strong>${escapeHTML(palletId)}</strong></p>
    <label>Is this an SCS owned product?</label>
    <div class="actions mt-3">
      <button class="btn ${yesClass}" type="button" onclick="chooseScsOwned(true)">Yes</button>
      <button class="btn ${noClass}" type="button" onclick="chooseScsOwned(false)">No</button>
    </div>
    ${followOn}
  `;

  if (scsOwned === false) {
    wireCombo('customerCombo', () => {
      customer = '';
      customerCode = '';
    });
    if (customer) document.getElementById('customerCombo').value = customer;
    const clearBtn = document.getElementById('customerCombo-clear');
    if (clearBtn) clearBtn.hidden = !(document.getElementById('customerCombo').value || '').length;
  }
}

function chooseScsOwned(isScs) {
  if (isScs) {
    const match = findScsCustomer();
    if (!match) {
      alert('Could not find Somerset Cider Solutions in the customer list.');
      return;
    }
    scsOwned = true;
    applyCustomer(match);
    showProduct();
    return;
  }

  scsOwned = false;
  if (customer === SCS_CUSTOMER_NAME) {
    customer = '';
    customerCode = '';
    resetProductFields();
  }
  showCustomer();
}

function retryCustomers() {
  customersLoaded = false;
  customersError = '';
  showCustomer();
  fetch(CUSTOMERS_CSV)
    .then(r => r.text())
    .then(t => {
      customersList = parseCustomers(t);
      customersLoaded = true;
      showCustomer();
    })
    .catch(err => {
      console.error(err);
      customersError = 'Failed to load customers.';
      customersLoaded = true;
      showCustomer();
    });
}

function confirmCustomer() {
  const val = (document.getElementById('customerCombo').value || '').trim();
  if (!val) {
    alert('Please choose a customer from the list.');
    return;
  }
  const match = customersList.find(c => c.customer === val);
  if (!match) {
    alert('Please choose a customer from the list.');
    return;
  }
  applyCustomer(match);
  showProduct();
}

function showProduct() {
  if (!ingredientsLoaded) {
    app.innerHTML = `<p class="status">Loading ingredients…</p>`;
    const wait = setInterval(() => {
      if (!ingredientsLoaded) return;
      clearInterval(wait);
      showProduct();
    }, 150);
    return;
  }

  if (ingredientsError) {
    app.innerHTML = `
      <p class="status">${escapeHTML(ingredientsError)}</p>
      <div class="actions mt-3">
        <button class="btn btn-ghost" type="button" onclick="showCustomer()">Back</button>
        <button class="btn btn-primary" type="button" onclick="retryIngredients()">Try Again</button>
      </div>
      <div class="actions mt-3">
        <button class="btn btn-secondary" type="button" onclick="showManualProduct()">Manually add ingredient</button>
      </div>
    `;
    return;
  }

  const matches = productsForCustomer();
  const names = matches.map(p => p.product);
  app.innerHTML = `
    <p>Customer: <strong>${escapeHTML(customer)}</strong></p>
    <label>Select Ingredient.</label>
    ${combo('productCombo', names.length ? 'Type to search…' : 'No listed ingredients for this customer', names)}
    <div class="actions mt-3">
      <button class="btn btn-ghost" type="button" onclick="showCustomer()">Back</button>
      <button class="btn btn-primary" type="button" onclick="confirmProduct()">Next</button>
    </div>
    <div class="actions mt-3">
      <button class="btn btn-secondary" type="button" onclick="showManualProduct()">Manually add ingredient</button>
    </div>
  `;
  wireCombo('productCombo');
  if (product && !manualEntry) document.getElementById('productCombo').value = product;
}

function retryIngredients() {
  ingredientsLoaded = false;
  ingredientsError = '';
  showProduct();
  fetch(INGREDIENTS_CSV)
    .then(r => r.text())
    .then(t => {
      ingredientsList = parseIngredients(t);
      ingredientsLoaded = true;
      showProduct();
    })
    .catch(err => {
      console.error(err);
      ingredientsError = 'Failed to load ingredients.';
      ingredientsLoaded = true;
      showProduct();
    });
}

function confirmProduct() {
  const val = (document.getElementById('productCombo').value || '').trim();
  if (!val) {
    alert('Please choose an ingredient from the list.');
    return;
  }
  const match = productsForCustomer().find(p => p.product === val);
  if (!match) {
    alert('Please choose an ingredient from the list.');
    return;
  }
  selectedProduct = match;
  product = match.product;
  helper = match.helper;
  stockCodeF = match.stockCodeF;
  stockCodeG = match.stockCodeG;
  manualEntry = false;
  if (!requiresAbvAndDuty()) {
    abv = '';
    duty = '';
  }
  showDetails();
}

function showManualProduct() {
  const keepName = manualEntry ? product : '';
  manualEntry = true;
  selectedProduct = null;
  helper = '';
  stockCodeF = '';
  stockCodeG = '';
  abv = '';
  duty = '';
  app.innerHTML = `
    <label for="manualProduct">Enter ingredient name:</label>
    <input id="manualProduct" autocomplete="off" autocapitalize="off" spellcheck="false" />
    <div class="actions mt-3">
      <button class="btn btn-ghost" type="button" onclick="cancelManualProduct()">Back</button>
      <button class="btn btn-primary" type="button" onclick="confirmManualProduct()">Next</button>
    </div>
  `;
  const input = document.getElementById('manualProduct');
  if (keepName) input.value = keepName;
  input.focus();
}

function cancelManualProduct() {
  manualEntry = false;
  showProduct();
}

function confirmManualProduct() {
  const val = (document.getElementById('manualProduct').value || '').trim();
  if (!val) {
    alert('Please enter an ingredient name.');
    return;
  }
  product = val;
  helper = '';
  stockCodeF = '';
  stockCodeG = '';
  selectedProduct = null;
  manualEntry = true;
  abv = '';
  duty = '';
  showDetails();
}

function showDetails() {
  const showAbvDuty = requiresAbvAndDuty();
  const productInfo = (!manualEntry && selectedProduct) ? UI.summaryCard([
    { label: 'Stock Code', value: escapeHTML(stockCodeF || '-') },
    { label: 'Group', value: escapeHTML(currentGroup() || '-') }
  ]) : '';

  app.innerHTML = `
    <p>Ingredient: <strong>${escapeHTML(product)}</strong>${manualEntry ? ' <span class="status">(manually entered)</span>' : ''}</p>
    ${productInfo}
    ${showAbvDuty ? `
      <label for="abvInput">Enter ABV</label>
      <input id="abvInput" type="number" min="0" max="100" step="any" inputmode="decimal" />
    ` : ''}
    <label for="lotCodeInput">Enter Lot Code</label>
    <input id="lotCodeInput" autocomplete="off" autocapitalize="off" spellcheck="false" />
    <label for="bbeInput">Enter BBE</label>
    <input id="bbeInput" type="date" min="${todayISO()}" />
    <div style="display:flex; gap:12px; align-items:flex-end;">
      <div style="flex:1; min-width:0;">
        <label for="unitTypeSelect">Unit Type</label>
        <select id="unitTypeSelect">
          <option value="">-- Choose a unit --</option>
          ${UNIT_OPTIONS.map(opt => `<option value="${escapeHTML(opt)}">${escapeHTML(opt)}</option>`).join('')}
        </select>
      </div>
      <div style="flex:1; min-width:0;">
        <label id="valueLabel" for="valueInput">${valueLabelForUnit(unitType)}</label>
        <input id="valueInput" type="number" step="any" min="0" inputmode="decimal" />
      </div>
    </div>
    ${showAbvDuty ? `
      <label for="dutySelect">Current Duty Status</label>
      <select id="dutySelect">
        <option value="">-- Choose status --</option>
        ${DUTY_OPTIONS.map(opt => `<option value="${escapeHTML(opt)}">${escapeHTML(opt)}</option>`).join('')}
      </select>
    ` : ''}
    <label for="commentsInput" style="color: var(--muted); font-weight: 500;">Comments (optional)</label>
    <input id="commentsInput" autocomplete="off" placeholder="Optional" style="background: var(--card);" />
    <div class="actions mt-3">
      <button class="btn btn-ghost" type="button" onclick="${manualEntry ? 'showManualProduct()' : 'showProduct()'}">Back</button>
      <button class="btn btn-primary" type="button" onclick="confirmDetails()">Next</button>
    </div>
  `;

  if (showAbvDuty && abv !== '') document.getElementById('abvInput').value = abv;
  if (lotCode) document.getElementById('lotCodeInput').value = lotCode;
  const bbeISO = bbeToISO(bbe);
  if (bbeISO) document.getElementById('bbeInput').value = bbeISO;
  const select = document.getElementById('unitTypeSelect');
  const label = document.getElementById('valueLabel');
  if (unitType) select.value = unitType;
  if (value !== '') document.getElementById('valueInput').value = value;
  select.addEventListener('change', () => {
    label.textContent = valueLabelForUnit(select.value);
  });
  if (showAbvDuty && duty) document.getElementById('dutySelect').value = duty;
  if (comments) document.getElementById('commentsInput').value = comments;
}

function confirmDetails() {
  const showAbvDuty = requiresAbvAndDuty();
  const lotRaw = (document.getElementById('lotCodeInput').value || '').trim();
  const bbeISO = (document.getElementById('bbeInput').value || '').trim();
  const unit = (document.getElementById('unitTypeSelect').value || '').trim();
  const valueRaw = (document.getElementById('valueInput').value || '').trim();
  const valueNum = Number(valueRaw);

  if (showAbvDuty) {
    const abvRaw = (document.getElementById('abvInput').value || '').trim();
    const abvNum = Number(abvRaw);
    if (abvRaw === '' || Number.isNaN(abvNum) || abvNum < 0 || abvNum > 100) {
      alert('Please enter an ABV between 0 and 100.');
      return;
    }
    const dutyVal = (document.getElementById('dutySelect').value || '').trim();
    if (!DUTY_OPTIONS.includes(dutyVal)) {
      alert('Please choose a duty status.');
      return;
    }
    abv = String(abvNum);
    duty = dutyVal;
  } else {
    abv = '';
    duty = '';
  }

  if (!lotRaw) {
    alert('Please enter a lot code.');
    return;
  }
  if (!isBbeTodayOrFuture(bbeISO)) {
    alert('Please enter a BBE date of today or later.');
    return;
  }
  if (!UNIT_OPTIONS.includes(unit)) {
    alert('Please choose a unit type.');
    return;
  }
  if (valueRaw === '' || Number.isNaN(valueNum) || valueNum <= 0) {
    alert('Please enter a valid quantity greater than zero.');
    return;
  }

  lotCode = lotRaw;
  bbe = isoToBBE(bbeISO);
  unitType = unit;
  value = String(valueNum);
  comments = (document.getElementById('commentsInput').value || '').trim();
  showSummary();
}

function summaryRowHtml(label, value) {
  return `
    <div class="summary-row">
      <span class="summary-label">${label}</span>
      <span class="summary-value">${value}</span>
    </div>
  `;
}

function summaryPairHtml(left, right) {
  return `
    <div class="summary-pair">
      <div style="flex:1; min-width:0;">${summaryRowHtml(left.label, left.value)}</div>
      <div style="flex:1; min-width:0;">${summaryRowHtml(right.label, right.value)}</div>
    </div>
  `;
}

function showSummary() {
  const showAbvDuty = requiresAbvAndDuty();
  let body = '';
  body += summaryRowHtml('Pallet ID', escapeHTML(palletId));
  body += summaryRowHtml('Customer', escapeHTML(customer));
  body += summaryRowHtml('Product', escapeHTML(product));
  if (!manualEntry && currentGroup()) {
    body += summaryRowHtml('Group', escapeHTML(currentGroup()));
  }
  body += summaryPairHtml(
    { label: 'Stock Code', value: escapeHTML((manualEntry ? '' : stockCodeF) || '-') },
    { label: 'Lot Code', value: escapeHTML(lotCode) }
  );
  if (showAbvDuty) body += summaryRowHtml('ABV', escapeHTML(abv));
  body += summaryRowHtml('BBE', escapeHTML(bbe));
  body += summaryPairHtml(
    { label: 'Unit Type', value: escapeHTML(unitType) },
    { label: 'Value', value: escapeHTML(value) }
  );
  if (showAbvDuty) body += summaryRowHtml('Current Duty Status', escapeHTML(duty));
  if (comments) body += summaryRowHtml('Comments', escapeHTML(comments));

  app.innerHTML = `
    <div class="summary-card">${body}</div>
    <div class="actions mt-3">
      <button class="btn btn-ghost" type="button" onclick="showDetails()">Back</button>
      <button class="btn btn-success" type="button" onclick="submitEntry()">Confirm & Submit</button>
    </div>
  `;
}

function submitEntry() {
  const username = getLoggedInUsername();
  if (!username) {
    alert('You must be signed in to submit.');
    return;
  }

  const { date, time } = nowForSheets();
  const body = new URLSearchParams();
  body.append('pallet', palletId);
  body.append('customer', customer);
  body.append('customerCode', customerCode);
  body.append('product', product);
  body.append('helper', helper);
  body.append('stockCodeF', stockCodeF);
  body.append('group', currentGroup());
  body.append('lotCode', lotCode);
  body.append('abv', abv);
  body.append('bbe', bbe);
  body.append('unitType', unitType);
  body.append('value', value);
  body.append('duty', duty);
  body.append('comments', comments);
  body.append('username', username);
  body.append('date', date);
  body.append('time', time);
  body.append('manualEntry', manualEntry ? 'true' : 'false');

  app.innerHTML = `<p class="status">Submitting…</p>`;

  fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
    .then(async r => {
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) {}
      if (!r.ok || !json || (json.result !== 'ok' && json.result !== 'success')) {
        throw new Error('submit-failed');
      }
      showSuccess();
    })
    .catch(err => {
      console.error(err);
      app.innerHTML = UI.errorScreen(
        'Please try again.',
        `<button class="btn btn-ghost" type="button" onclick="showSummary()">Back</button>
         <button class="btn btn-primary" type="button" onclick="submitEntry()">Try Again</button>`,
        'Submission failed.'
      );
    });
}

function showSuccess() {
  app.innerHTML = UI.successScreen(
    'Entry submitted successfully.',
    'Would you like to provide any accompanying paperwork',
    `<button class="btn btn-ghost" type="button" onclick="goHome()">No</button>
     <button class="btn btn-primary" type="button" onclick="showPaperworkSoon()">Yes</button>`
  );
}

function goHome() {
  window.location.href = 'index.html';
}

function showPaperworkSoon() {
  app.innerHTML = `
    <p class="status">This feature has not yet been added. This will be added in a future update</p>
  `;
}

window.showPallet = showPallet;
window.confirmPallet = confirmPallet;
window.skipPallet = skipPallet;
window.scanPallet = scanPallet;
window.showCustomer = showCustomer;
window.chooseScsOwned = chooseScsOwned;
window.retryCustomers = retryCustomers;
window.confirmCustomer = confirmCustomer;
window.showProduct = showProduct;
window.retryIngredients = retryIngredients;
window.confirmProduct = confirmProduct;
window.showManualProduct = showManualProduct;
window.cancelManualProduct = cancelManualProduct;
window.confirmManualProduct = confirmManualProduct;
window.showDetails = showDetails;
window.confirmDetails = confirmDetails;
window.showSummary = showSummary;
window.submitEntry = submitEntry;
window.goHome = goHome;
window.showPaperworkSoon = showPaperworkSoon;

loadLookups();
showPallet();
