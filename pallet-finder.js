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

function parseCSV(text){
  // Simple CSV parser that handles quoted fields
  const lines = text.replace(/\r/g,'').split('\n').filter(x => x.length);
  const rows = [];
  for (const line of lines) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i=0; i<line.length; i++){
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i+1] === '"') { cur += '"'; i++; } // escaped quote
          else { inQ = false; }
        } else {
          cur += ch;
        }
      } else {
        if (ch === ',') { out.push(cur); cur=''; }
        else if (ch === '"') { inQ = true; }
        else { cur += ch; }
      }
    }
    out.push(cur);
    rows.push(out);
  }
  return rows;
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
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  return table;
}
