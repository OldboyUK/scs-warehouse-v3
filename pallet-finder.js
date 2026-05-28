// pallet-finder.js
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1942654487&single=true&output=csv';

const statusEl = document.getElementById('status');
const wrap = document.getElementById('tableWrap');

fetch(CSV_URL)
  .then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  })
  .then(text => {
    const rows = parseCSV(text);
    if (!rows.length) {
      statusEl.textContent = 'No data found.';
      return;
    }
    const table = buildTable(rows);
    wrap.innerHTML = '';
    wrap.appendChild(table);
    statusEl.textContent = `Loaded ${rows.length - 1} rows.`;
  })
  .catch(err => {
    console.error(err);
    statusEl.textContent = 'Failed to load table.';
  });

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    // Escaped quotes
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    }

    // Toggle quote mode
    else if (char === '"') {
      inQuotes = !inQuotes;
    }

    // Column separator
    else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    }

    // Row separator
    else if ((char === '\n' || char === '\r') && !inQuotes) {

      // Handle Windows CRLF
      if (char === '\r' && next === '\n') {
        i++;
      }

      row.push(cell);
      rows.push(row);

      row = [];
      cell = '';
    }

    // Normal text
    else {
      cell += char;
    }
  }

  // Final row
  row.push(cell);
  rows.push(row);

  return rows.filter(r => r.length > 1 || r[0] !== '');
}

function buildTable(rows){
  const table = document.createElement('table');

  const thead = document.createElement('thead');
  const thr = document.createElement('tr');
  rows[0].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    thr.appendChild(th);
  });
  thead.appendChild(thr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let r=1; r<rows.length; r++){
    const tr = document.createElement('tr');
    rows[r].forEach(cell => {
      const td = document.createElement('td');
      td.textContent = cell;
      td.style.whiteSpace = 'pre-line';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  return table;
}
