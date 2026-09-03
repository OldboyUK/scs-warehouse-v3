// pallet-finder.js — Inquiry: Bay → Pallet → Stock hierarchy

const BAY_STATUS_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1942654487&single=true&output=csv';
const PALLET_FINDER_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=214796097&single=true&output=csv';
const STOCK_COUNT_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1879287780&single=true&output=csv';

const UNASSIGNED_ID = 'UNASSIGNED';

const statusEl = document.getElementById('status');
const wrap = document.getElementById('inquiryList');
const searchInput = document.getElementById('searchInput');

/** @type {{ id: string, activeStatus: string, pallets: object[], isVirtual?: boolean }[]} */
let locations = [];

init();

async function init() {
  try {
    statusEl.textContent = 'Loading bay, pallet and stock data…';
    const [bayText, palletText, stockText] = await Promise.all([
      fetchText(BAY_STATUS_CSV),
      fetchText(PALLET_FINDER_CSV),
      fetchText(STOCK_COUNT_CSV)
    ]);

    locations = buildHierarchy(
      parseCSV(bayText),
      parseCSV(palletText),
      parseCSV(stockText)
    );

    renderLocations(locations);
    setupSearch();

    const bayCount = locations.filter(l => !l.isVirtual).length;
    const palletCount = locations.reduce((n, l) => n + l.pallets.length, 0);
    statusEl.textContent = `${bayCount} bays · ${palletCount} pallets`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Failed to load inquiry data.';
    statusEl.classList.add('status-error');
  }
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows.filter(r => r.length > 1 || (r[0] || '') !== '');
}

function cell(row, index) {
  return String(row[index] ?? '').trim();
}

function isHeaderRow(row, needle) {
  return needle.test(cell(row, 0));
}

function isUnassignedLocation(location) {
  const loc = String(location || '').trim();
  if (!loc) return true;
  return /^unassigned$/i.test(loc);
}

function buildHierarchy(bayRows, palletRows, stockRows) {
  const stockByPallet = new Map();
  for (let i = 0; i < stockRows.length; i++) {
    const row = stockRows[i];
    if (i === 0 && isHeaderRow(row, /pallet/i)) continue;
    const palletId = cell(row, 0);
    if (!palletId) continue;

    const line = {
      runCode: cell(row, 1),
      company: cell(row, 2),
      product: cell(row, 3),
      format: cell(row, 4),
      units: cell(row, 5),
      category: cell(row, 11), // Column L
      unitType: cell(row, 12)  // Column M
    };

    if (!stockByPallet.has(palletId)) stockByPallet.set(palletId, []);
    stockByPallet.get(palletId).push(line);
  }

  const palletsByLocation = new Map();
  const unassignedPallets = [];
  const seenPalletIds = new Set();

  for (let i = 0; i < palletRows.length; i++) {
    const row = palletRows[i];
    if (i === 0 && isHeaderRow(row, /pallet/i)) continue;

    const palletId = cell(row, 0);
    if (!palletId) continue;

    // Latest assignment wins if a pallet appears more than once
    if (seenPalletIds.has(palletId)) {
      for (const list of palletsByLocation.values()) {
        const idx = list.findIndex(p => p.id === palletId);
        if (idx >= 0) list.splice(idx, 1);
      }
      const uIdx = unassignedPallets.findIndex(p => p.id === palletId);
      if (uIdx >= 0) unassignedPallets.splice(uIdx, 1);
    }
    seenPalletIds.add(palletId);

    const location = cell(row, 1);
    const pallet = {
      id: palletId,
      location,
      stock: stockByPallet.get(palletId) || []
    };

    if (isUnassignedLocation(location)) {
      unassignedPallets.push(pallet);
    } else {
      if (!palletsByLocation.has(location)) palletsByLocation.set(location, []);
      palletsByLocation.get(location).push(pallet);
    }
  }

  const list = [];
  const knownBayIds = new Set();

  for (let i = 0; i < bayRows.length; i++) {
    const row = bayRows[i];
    if (i === 0 && isHeaderRow(row, /location/i)) continue;

    const id = cell(row, 0);
    if (!id) continue;

    knownBayIds.add(id);
    list.push({
      id,
      activeStatus: cell(row, 1),
      pallets: palletsByLocation.get(id) || [],
      isVirtual: false
    });
  }

  // Keep pallets visible when LOCATION is not in BAY STATUS (do not hide the gap).
  for (const [id, pallets] of palletsByLocation.entries()) {
    if (knownBayIds.has(id) || !pallets.length) continue;
    list.push({
      id,
      activeStatus: '',
      pallets,
      isVirtual: false,
      notInBayStatus: true
    });
  }

  list.push({
    id: UNASSIGNED_ID,
    activeStatus: '',
    pallets: unassignedPallets,
    isVirtual: true
  });

  return list;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function palletCountLabel(count) {
  if (count === 0) return 'EMPTY';
  if (count === 1) return '1 PALLET';
  return `${count} PALLETS`;
}

function getCategoryColor(category) {
  switch ((category || '').trim().toLowerCase()) {
    case 'finished product':
      return '#FFB000';

    case 'packaging':
      return '#63D8FF';

    case 'ingredients':
      return '#6EE7B7';

    default:
      return '#9AA4C1';
  }
}

function isActiveTrue(status) {
  return String(status || '').trim().toUpperCase() === 'TRUE';
}

function mismatchNote(location) {
  if (location.isVirtual) return '';
  if (location.notInBayStatus) {
    return 'Location has pallets but is missing from BAY STATUS';
  }
  const active = isActiveTrue(location.activeStatus);
  const occupied = location.pallets.length > 0;
  if (active && !occupied) {
    return 'Status says active, but no pallets assigned';
  }
  if (!active && occupied) {
    return 'Status says inactive, but pallets are assigned';
  }
  return '';
}

function stockSearchText(line) {
  return [line.runCode, line.company, line.product, line.format, line.units, line.category, line.unitType]
    .join(' ')
    .toLowerCase();
}

function palletCategory(pallet) {
  const seen = [];
  for (const line of pallet.stock || []) {
    const category = (line.category || '').trim();
    if (category && !seen.includes(category)) seen.push(category);
  }
  return seen[0] || '';
}

function palletMatches(pallet, q) {
  if (!q) return true;
  if (pallet.id.toLowerCase().includes(q)) return true;
  return pallet.stock.some(line => stockSearchText(line).includes(q));
}

function locationMatches(location, q) {
  if (!q) return true;
  if (location.id.toLowerCase().includes(q)) return true;
  return location.pallets.some(p => palletMatches(p, q));
}

function renderLocations(list, query = '') {
  const q = (query || '').trim().toLowerCase();
  wrap.innerHTML = '';

  const fragment = document.createDocumentFragment();
  let visible = 0;

  for (const location of list) {
    if (!locationMatches(location, q)) continue;
    visible += 1;
    fragment.appendChild(renderBay(location, q));
  }

  if (!visible) {
    const empty = document.createElement('p');
    empty.className = 'inquiry-empty';
    empty.textContent = q ? 'No matching bays, pallets or stock.' : 'No locations found.';
    wrap.appendChild(empty);
    return;
  }

  wrap.appendChild(fragment);
}

function renderBay(location, q) {
  const details = document.createElement('details');
  details.className = 'inquiry-bay';
  if (location.pallets.length === 0) details.classList.add('is-empty');
  if (location.isVirtual) details.classList.add('is-unassigned');
  if (q) details.open = true;

  const summary = document.createElement('summary');
  summary.className = 'inquiry-bay-summary';

  const left = document.createElement('span');
  left.className = 'inquiry-bay-id';
  left.textContent = location.id;

  const right = document.createElement('span');
  right.className = 'inquiry-bay-meta';
  right.textContent = palletCountLabel(location.pallets.length);

  summary.appendChild(left);
  summary.appendChild(right);
  details.appendChild(summary);

  const note = mismatchNote(location);
  if (note) {
    const warn = document.createElement('p');
    warn.className = 'inquiry-mismatch';
    warn.textContent = note;
    details.appendChild(warn);
  }

  const body = document.createElement('div');
  body.className = 'inquiry-bay-body';

  if (location.pallets.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'inquiry-bay-empty';
    empty.textContent = location.isVirtual
      ? 'No unassigned pallets.'
      : 'No pallets in this bay.';
    body.appendChild(empty);
  } else {
    for (const pallet of location.pallets) {
      if (q && !location.id.toLowerCase().includes(q) && !palletMatches(pallet, q)) {
        continue;
      }
      body.appendChild(renderPallet(pallet, q));
    }
  }

  details.appendChild(body);
  return details;
}

function formatQuantityLabel(quantity, unitType) {
  const qty = quantity || '—';
  const label = (unitType || '').trim();
  return label ? `${qty} ${label}` : qty;
}

function renderStockLine(line, q) {
  const item = document.createElement('li');
  item.className = 'inquiry-stock-line';
  if (q && stockSearchText(line).includes(q)) item.classList.add('is-match');

  const company = escapeHTML(line.company || '—');
  const product = escapeHTML(line.product || '—');
  const format = escapeHTML(line.format || '—');
  const qtyText = escapeHTML(formatQuantityLabel(line.units, line.unitType));
  const run = line.runCode
    ? `<span class="inquiry-stock-run">${escapeHTML(line.runCode)}</span>`
    : '';

  item.innerHTML =
    `<span class="inquiry-stock-main">` +
      `<span class="inquiry-stock-pair">${company} · ${product}</span>` +
      `<span class="inquiry-stock-sep" aria-hidden="true"> · </span>` +
      `<span class="inquiry-stock-pair">${format} · ${qtyText}</span>` +
    `</span>${run}`;
  return item;
}

function renderPallet(pallet, q) {
  const card = document.createElement('section');
  card.className = 'inquiry-pallet';
  if (q && palletMatches(pallet, q)) card.classList.add('is-match');

  const header = document.createElement('div');
  header.className = 'inquiry-item-header';

  const heading = document.createElement('h3');
  heading.className = 'inquiry-pallet-id';
  heading.textContent = pallet.id;
  header.appendChild(heading);

  const category = palletCategory(pallet);
  if (category) {
    const categoryEl = document.createElement('span');
    categoryEl.className = 'inquiry-category';
    categoryEl.textContent = category;
    categoryEl.style.color = getCategoryColor(category);
    header.appendChild(categoryEl);
  }

  card.appendChild(header);

  if (!pallet.stock.length) {
    const empty = document.createElement('p');
    empty.className = 'inquiry-stock-empty';
    empty.textContent = 'No stock lines on this pallet.';
    card.appendChild(empty);
    return card;
  }

  const list = document.createElement('ul');
  list.className = 'inquiry-stock-list';

  // Show all stock when the pallet/bay is the match; when only stock fields
  // matched, still show every line so the full pallet context remains visible.
  for (const line of pallet.stock) {
    list.appendChild(renderStockLine(line, q));
  }

  card.appendChild(list);
  return card;
}

function setupSearch() {
  if (!searchInput) return;
  searchInput.addEventListener('input', () => {
    renderLocations(locations, searchInput.value);
  });
}
