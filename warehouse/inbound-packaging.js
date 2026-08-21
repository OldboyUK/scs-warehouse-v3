const app = document.getElementById('app');
const video = document.getElementById('video');

const CUSTOMERS_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1199565865&single=true&output=csv';
const PACKAGING_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=120813966&single=true&output=csv';
const SCRIPT_URL = '/.netlify/functions/submitPackaging';

const UNIT_OPTIONS = ['Units', 'Box(es)', 'Bundle', 'Full Pallet'];
const FULL_PALLET = 'Full Pallet';
const SCS_CUSTOMER_NAME = 'Somerset Cider Solutions';

let palletId = '';
let scsOwned = null;
let customer = '';
let customerCode = '';
let productType = '';
let size = '';
let colour = '';
let type = '';
let selectedPackaging = null;
let unitType = '';
let value = '';
let comments = '';

let customersList = [];
let packagingList = [];
let customersLoaded = false;
let packagingLoaded = false;
let customersError = '';
let packagingError = '';

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

function parsePackaging(text) {
  const rows = parseCSV(text);
  const list = [];
  rows.slice(1).forEach(r => {
    const prodType = (r[2] || '').trim();
    const sizeVal = (r[3] || '').trim();
    const colourVal = (r[4] || '').trim();
    const typeVal = (r[5] || '').trim();
    if (!prodType) return;
    list.push({
      productType: prodType,
      size: sizeVal,
      colour: colourVal,
      type: typeVal
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

function uniqueInOrder(values) {
  const seen = new Set();
  const out = [];
  values.forEach(v => {
    const val = String(v || '').trim();
    if (!val || seen.has(val)) return;
    seen.add(val);
    out.push(val);
  });
  return out;
}

function packagingMatches(filters) {
  return packagingList.filter(row => {
    if (filters.productType && row.productType !== filters.productType) return false;
    if (filters.size && row.size !== filters.size) return false;
    if (filters.colour && row.colour !== filters.colour) return false;
    if (filters.type && row.type !== filters.type) return false;
    return true;
  });
}

function uniqueField(field, filters) {
  return uniqueInOrder(packagingMatches(filters).map(row => row[field]));
}

function sizeOptions() {
  return uniqueField('size', { productType });
}

function colourOptions() {
  const filters = { productType };
  if (size) filters.size = size;
  return uniqueField('colour', filters);
}

function typeOptions() {
  const filters = { productType };
  if (size) filters.size = size;
  if (colour) filters.colour = colour;
  return uniqueField('type', filters);
}

function goAfterProductType() {
  if (sizeOptions().length) {
    showSize();
    return;
  }
  size = '';
  goAfterSize();
}

function goAfterSize() {
  if (colourOptions().length) {
    showColour();
    return;
  }
  colour = '';
  goAfterColour();
}

function goAfterColour() {
  if (typeOptions().length) {
    showType();
    return;
  }
  type = '';
  finishPackagingSelection();
}

function goBackFromColour() {
  if (sizeOptions().length) showSize();
  else showProductType();
}

function goBackFromType() {
  if (colourOptions().length) showColour();
  else if (sizeOptions().length) showSize();
  else showProductType();
}

function goBackFromDetails() {
  if (typeOptions().length) showType();
  else if (colourOptions().length) showColour();
  else if (sizeOptions().length) showSize();
  else showProductType();
}

function finishPackagingSelection() {
  selectedPackaging = {
    productType,
    size,
    colour,
    type
  };
  showDetails();
}

function resetPackagingFields() {
  productType = '';
  size = '';
  colour = '';
  type = '';
  selectedPackaging = null;
  unitType = '';
  value = '';
  comments = '';
}

function applyCustomer(match) {
  if (customerCode && customerCode !== match.customerCode) {
    resetPackagingFields();
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
  packagingLoaded = false;
  customersError = '';
  packagingError = '';

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

  fetch(PACKAGING_CSV)
    .then(r => r.text())
    .then(t => {
      packagingList = parsePackaging(t);
      packagingLoaded = true;
    })
    .catch(err => {
      console.error(err);
      packagingError = 'Failed to load packaging options.';
      packagingLoaded = true;
    });
}

function applyUnitTypeState(select, valueInput) {
  if (!select || !valueInput) return;
  if (select.value === FULL_PALLET) {
    valueInput.value = '1';
    valueInput.disabled = true;
    valueInput.style.background = 'var(--card)';
  } else {
    valueInput.disabled = false;
    valueInput.style.background = '';
  }
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
        <button class="btn btn-primary" type="button" onclick="showProductType()">Next</button>
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
    <label>Is this an SCS owned packaging?</label>
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
    showProductType();
    return;
  }

  scsOwned = false;
  if (customer === SCS_CUSTOMER_NAME) {
    customer = '';
    customerCode = '';
    resetPackagingFields();
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
  showProductType();
}

function waitForPackaging(thenFn, backFn) {
  if (!packagingLoaded) {
    app.innerHTML = `<p class="status">Loading packaging options…</p>`;
    const wait = setInterval(() => {
      if (!packagingLoaded) return;
      clearInterval(wait);
      thenFn();
    }, 150);
    return true;
  }

  if (packagingError) {
    app.innerHTML = `
      <p class="status">${escapeHTML(packagingError)}</p>
      <div class="actions mt-3">
        <button class="btn btn-ghost" type="button" onclick="${backFn}">Back</button>
        <button class="btn btn-primary" type="button" onclick="retryPackaging()">Try Again</button>
      </div>
    `;
    return true;
  }

  return false;
}

function retryPackaging() {
  packagingLoaded = false;
  packagingError = '';
  showProductType();
  fetch(PACKAGING_CSV)
    .then(r => r.text())
    .then(t => {
      packagingList = parsePackaging(t);
      packagingLoaded = true;
      showProductType();
    })
    .catch(err => {
      console.error(err);
      packagingError = 'Failed to load packaging options.';
      packagingLoaded = true;
      showProductType();
    });
}

function showSelectPage(config) {
  const options = config.options;
  const placeholder = options.length ? 'Type to search…' : config.emptyPlaceholder;
  app.innerHTML = `
    <p>Customer: <strong>${escapeHTML(customer)}</strong></p>
    ${config.contextHtml || ''}
    <label>${config.label}</label>
    ${combo(config.comboId, placeholder, options)}
    <div class="actions mt-3">
      <button class="btn btn-ghost" type="button" onclick="${config.back}">Back</button>
      <button class="btn btn-primary" type="button" onclick="${config.next}">Next</button>
    </div>
  `;
  wireCombo(config.comboId);
  if (config.current && options.includes(config.current)) {
    document.getElementById(config.comboId).value = config.current;
  }
}

function confirmSelectValue(comboId, options, fieldLabel) {
  const val = (document.getElementById(comboId).value || '').trim();
  if (!val || !options.includes(val)) {
    alert('Please choose a ' + fieldLabel + ' from the list.');
    return '';
  }
  return val;
}

function showProductType() {
  if (waitForPackaging(showProductType, 'showCustomer()')) return;
  const options = uniqueField('productType', {});
  showSelectPage({
    label: 'Select Product Type',
    comboId: 'productTypeCombo',
    options,
    current: productType,
    emptyPlaceholder: 'No packaging types available',
    back: 'showCustomer()',
    next: 'confirmProductType()'
  });
}

function confirmProductType() {
  const options = uniqueField('productType', {});
  const val = confirmSelectValue('productTypeCombo', options, 'product type');
  if (!val) return;
  if (val !== productType) {
    productType = val;
    size = '';
    colour = '';
    type = '';
    selectedPackaging = null;
  }
  goAfterProductType();
}

function showSize() {
  if (waitForPackaging(showSize, 'showProductType()')) return;
  const options = sizeOptions();
  if (!options.length) {
    size = '';
    goAfterSize();
    return;
  }
  if (size && !options.includes(size)) {
    size = '';
    colour = '';
    type = '';
    selectedPackaging = null;
  }
  showSelectPage({
    label: 'Select Size',
    comboId: 'sizeCombo',
    options,
    current: size,
    emptyPlaceholder: 'No sizes available for this product type',
    contextHtml: `<p>Product Type: <strong>${escapeHTML(productType)}</strong></p>`,
    back: 'showProductType()',
    next: 'confirmSize()'
  });
}

function confirmSize() {
  const options = sizeOptions();
  const val = confirmSelectValue('sizeCombo', options, 'size');
  if (!val) return;
  if (val !== size) {
    size = val;
    colour = '';
    type = '';
    selectedPackaging = null;
  }
  goAfterSize();
}

function showColour() {
  if (waitForPackaging(showColour, 'goBackFromColour()')) return;
  const options = colourOptions();
  if (!options.length) {
    colour = '';
    goAfterColour();
    return;
  }
  if (colour && !options.includes(colour)) {
    colour = '';
    type = '';
    selectedPackaging = null;
  }
  showSelectPage({
    label: 'Select Colour',
    comboId: 'colourCombo',
    options,
    current: colour,
    emptyPlaceholder: 'No colours available for this selection',
    contextHtml: `<p>Product Type: <strong>${escapeHTML(productType)}</strong></p>
      ${size ? `<p>Size: <strong>${escapeHTML(size)}</strong></p>` : ''}`,
    back: 'goBackFromColour()',
    next: 'confirmColour()'
  });
}

function confirmColour() {
  const options = colourOptions();
  const val = confirmSelectValue('colourCombo', options, 'colour');
  if (!val) return;
  if (val !== colour) {
    colour = val;
    type = '';
    selectedPackaging = null;
  }
  goAfterColour();
}

function showType() {
  if (waitForPackaging(showType, 'goBackFromType()')) return;
  const options = typeOptions();
  if (!options.length) {
    type = '';
    finishPackagingSelection();
    return;
  }
  if (type && !options.includes(type)) {
    type = '';
    selectedPackaging = null;
  }
  showSelectPage({
    label: 'Select Type',
    comboId: 'typeCombo',
    options,
    current: type,
    emptyPlaceholder: 'No types available for this selection',
    contextHtml: `<p>Product Type: <strong>${escapeHTML(productType)}</strong></p>
      ${size ? `<p>Size: <strong>${escapeHTML(size)}</strong></p>` : ''}
      ${colour ? `<p>Colour: <strong>${escapeHTML(colour)}</strong></p>` : ''}`,
    back: 'goBackFromType()',
    next: 'confirmType()'
  });
}

function confirmType() {
  const options = typeOptions();
  const val = confirmSelectValue('typeCombo', options, 'type');
  if (!val) return;
  type = val;
  const matches = packagingMatches({
    productType,
    ...(size ? { size } : {}),
    ...(colour ? { colour } : {}),
    type
  });
  if (!matches.length) {
    alert('That packaging combination is not available. Please choose again.');
    return;
  }
  finishPackagingSelection();
}

function showDetails() {
  const packingBits = [productType, size, colour, type].filter(Boolean);
  app.innerHTML = `
    <p>Packaging: <strong>${escapeHTML(packingBits.join(' · '))}</strong></p>
    <div style="display:flex; gap:12px; align-items:flex-end;">
      <div style="flex:1; min-width:0;">
        <label for="unitTypeSelect">Please enter the unit type</label>
        <select id="unitTypeSelect">
          <option value="">-- Choose a unit --</option>
          ${UNIT_OPTIONS.map(opt => `<option value="${escapeHTML(opt)}">${escapeHTML(opt)}</option>`).join('')}
        </select>
      </div>
      <div style="flex:1; min-width:0;">
        <label for="valueInput">Enter the quantity</label>
        <input id="valueInput" type="number" step="any" min="0" inputmode="decimal" />
      </div>
    </div>
    <label for="commentsInput" style="color: var(--muted); font-weight: 500;">Comments (optional)</label>
    <input id="commentsInput" autocomplete="off" placeholder="Optional" style="background: var(--card);" />
    <div class="actions mt-3">
      <button class="btn btn-ghost" type="button" onclick="goBackFromDetails()">Back</button>
      <button class="btn btn-primary" type="button" onclick="confirmDetails()">Next</button>
    </div>
  `;

  const select = document.getElementById('unitTypeSelect');
  const valueInput = document.getElementById('valueInput');
  if (unitType) select.value = unitType;
  if (value !== '') valueInput.value = value;
  applyUnitTypeState(select, valueInput);
  select.addEventListener('change', () => applyUnitTypeState(select, valueInput));
  if (comments) document.getElementById('commentsInput').value = comments;
}

function confirmDetails() {
  const unit = (document.getElementById('unitTypeSelect').value || '').trim();
  const valueRaw = (document.getElementById('valueInput').value || '').trim();
  const valueNum = Number(valueRaw);

  if (!UNIT_OPTIONS.includes(unit)) {
    alert('Please choose a unit type.');
    return;
  }
  if (unit === FULL_PALLET) {
    unitType = unit;
    value = '1';
  } else {
    if (valueRaw === '' || Number.isNaN(valueNum) || valueNum <= 0) {
      alert('Please enter a valid quantity greater than zero.');
      return;
    }
    unitType = unit;
    value = String(valueNum);
  }
  comments = (document.getElementById('commentsInput').value || '').trim();
  showSummary();
}

function summaryRowHtml(label, valueHtml) {
  return `
    <div class="summary-row">
      <span class="summary-label">${label}</span>
      <span class="summary-value">${valueHtml}</span>
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
  const username = getLoggedInUsername();
  const { date, time } = nowForSheets();
  let body = '';
  body += summaryRowHtml('Pallet ID', escapeHTML(palletId));
  body += summaryRowHtml('Customer', escapeHTML(customer));
  body += summaryRowHtml('Customer Code', escapeHTML(customerCode));
  body += summaryRowHtml('Product Type', escapeHTML(productType));
  if (size) body += summaryRowHtml('Size', escapeHTML(size));
  if (colour) body += summaryRowHtml('Colour', escapeHTML(colour));
  if (type) body += summaryRowHtml('Type', escapeHTML(type));
  body += summaryPairHtml(
    { label: 'Unit Type', value: escapeHTML(unitType) },
    { label: 'Value', value: escapeHTML(value) }
  );
  if (comments) body += summaryRowHtml('Comments', escapeHTML(comments));
  if (username) body += summaryRowHtml('User', escapeHTML(username));
  body += summaryRowHtml('Date', escapeHTML(date));
  body += summaryRowHtml('Time', escapeHTML(time));

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
  body.append('productType', productType);
  body.append('size', size);
  body.append('colour', colour);
  body.append('type', type);
  body.append('unitType', unitType);
  body.append('value', value);
  body.append('comments', comments);
  body.append('username', username);
  body.append('date', date);
  body.append('time', time);

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
window.showProductType = showProductType;
window.confirmProductType = confirmProductType;
window.retryPackaging = retryPackaging;
window.showSize = showSize;
window.confirmSize = confirmSize;
window.goBackFromColour = goBackFromColour;
window.showColour = showColour;
window.confirmColour = confirmColour;
window.goBackFromType = goBackFromType;
window.showType = showType;
window.confirmType = confirmType;
window.goBackFromDetails = goBackFromDetails;
window.showDetails = showDetails;
window.confirmDetails = confirmDetails;
window.showSummary = showSummary;
window.submitEntry = submitEntry;
window.goHome = goHome;
window.showPaperworkSoon = showPaperworkSoon;

loadLookups();
showPallet();
