const app = document.getElementById('app');

const CUSTOMERS_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1199565865&single=true&output=csv';
const SCRIPT_URL = '/.netlify/functions/addThirdPartyProduct';

const LIQUID_TYPE_OPTIONS = [
  'Cider',
  'Sparkling Cider',
  'Other',
  'Spirits',
  'Beer',
  'Wine',
  'Low-Alc',
  'Soft Drinks'
];

let customersList = [];

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

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function combo(id, placeholder, list) {
  return `
    <div id="${id}-wrap" class="combo-wrap">
      <input id="${id}" placeholder="${placeholder}" autocomplete="off" autocapitalize="off" spellcheck="false" />
      <button id="${id}-toggle" type="button" class="combo-toggle" aria-label="Open suggestions">&#9662;</button>
      <div id="${id}-list" class="combo-list" hidden>
        ${list.map(v => `<div class="combo-option" data-value="${escapeHTML(v)}">${escapeHTML(v)}</div>`).join('')}
      </div>
    </div>
  `;
}

function wireCombo(id) {
  const input = document.getElementById(id);
  const toggle = document.getElementById(id + '-toggle');
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
  input.addEventListener('input', filter);
  input.addEventListener('focus', open);
  toggle.addEventListener('click', () => list.hidden ? open() : close());
  list.addEventListener('click', e => {
    const el = e.target.closest('.combo-option');
    if (!el) return;
    input.value = el.dataset.value || '';
    close();
  });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); }, { capture: true });
}

function loadCustomers() {
  fetch(CUSTOMERS_CSV)
    .then(r => r.text())
    .then(t => {
      // B2:B — skip header row, take column B only
      const rows = parseCSV(t);
      customersList = Array.from(new Set(rows.slice(1).map(r => (r[1] || '').trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      showForm();
    })
    .catch(err => {
      console.error(err);
      app.innerHTML = '<p class="status">Failed to load customer list.</p>';
    });
}

function showForm() {
  app.innerHTML = `
    <label for="customerCombo">Customer:</label>
    ${combo('customerCombo', 'Type to search…', customersList)}

    <label for="productName">Product Name:</label>
    <input id="productName" autocomplete="off" autocapitalize="off" spellcheck="false" />

    <label for="recipeIteration">Recipe Iteration:</label>
    <input id="recipeIteration" type="number" min="1" step="1" value="1" />

    <label for="liquidType">Liquid Type:</label>
    <select id="liquidType">
      <option value="">-- Choose liquid type --</option>
      ${LIQUID_TYPE_OPTIONS.map(opt => `<option value="${escapeHTML(opt)}">${escapeHTML(opt)}</option>`).join('')}
    </select>

    <label for="abv">ABV:</label>
    <input id="abv" type="number" min="0" max="100" step="0.1" />

    <div class="actions mt-3">
      <a href="advanced-options.html" class="btn btn-ghost">Back</a>
      <button class="btn btn-success" type="button" onclick="submitForm()">Submit</button>
    </div>
  `;
  wireCombo('customerCombo');
}

function submitForm() {
  const customer = (document.getElementById('customerCombo').value || '').trim();
  const productName = (document.getElementById('productName').value || '').trim();
  const recipeIteration = (document.getElementById('recipeIteration').value || '').trim();
  const liquidType = (document.getElementById('liquidType').value || '').trim();
  const abv = (document.getElementById('abv').value || '').trim();

  if (!customer) { alert('Please choose a customer.'); return; }
  if (!productName) { alert('Please enter a product name.'); return; }
  const recipeNum = parseInt(recipeIteration, 10);
  if (isNaN(recipeNum) || recipeNum < 1) { alert('Please enter a valid recipe iteration (1 or greater).'); return; }
  if (!liquidType) { alert('Please choose a liquid type.'); return; }
  const abvNum = parseFloat(abv);
  if (isNaN(abvNum) || abvNum < 0 || abvNum > 100) { alert('Please enter a valid ABV between 0 and 100.'); return; }

  const body = new URLSearchParams();
  body.append('customer', customer);
  body.append('productName', productName);
  body.append('recipeIteration', String(recipeNum));
  body.append('liquidType', liquidType);
  body.append('abv', String(abvNum));

  app.innerHTML = '<p class="status">Submitting…</p>';

  fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
    .then(async r => {
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) {}
      if (!r.ok) throw new Error(`Netlify returned ${r.status} — ${text}`);
      if (!json || (json.result !== 'ok' && json.result !== 'success')) {
        throw new Error(json && json.message ? json.message : text);
      }
      app.innerHTML = UI.successScreen(
        'Entry submitted successfully',
        '',
        `<a href="add-third-party-product.html" class="btn btn-primary">Add Another</a>
         <a href="advanced-options.html" class="btn btn-ghost">Back to Advanced Options</a>`
      );
    })
    .catch(err => {
      console.error(err);
      app.innerHTML = UI.errorScreen(
        escapeHTML(String(err.message || err)),
        `<button class="btn btn-ghost" onclick="showForm()">Back</button>`
      );
    });
}

window.submitForm = submitForm;
window.showForm = showForm;

loadCustomers();
