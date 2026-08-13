const app = document.getElementById('app');
const video = document.getElementById('video');

const PALLETS_CSV =
'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1165333250&single=true&output=csv';

const STOCK_CSV =
'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1879287780&single=true&output=csv';

const PICKING_CSV =
'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=810040978&single=true&output=csv';

const SCRIPT_URL =
`${window.location.origin}/.netlify/functions/submit`;

const PICKING_COLS = {
  collectionRef: 0,
  pickRef: 1,
  palletId: 2,
  runCode: 3,
  company: 4,
  product: 5,
  format: 6,
  totalUnits: 7,
  pickQty: 8,
  location: 9,
  pickStatus: 10
};

const STOCK_COLS = {
  palletId: 0,
  runCode: 1,
  company: 2,
  product: 3,
  format: 4,
  units: 5
};

let sourcePallet = '';
let destinationPallet = '';

let selectedRow = null;
let pickRef = '';
let runCode = '';
let company = '';
let product = '';
let format = '';
let unitsAvailable = 0;
let pickedUnits = 0;

const palletConfigs = new Map();
let stockData = [];
let pickingData = [];

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
    }

    else if (char === '"') {
      inQuotes = !inQuotes;
    }

    else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    }

    else if ((char === '\n' || char === '\r') && !inQuotes) {

      if (char === '\r' && next === '\n') {
        i++;
      }

      row.push(cell);
      rows.push(row);

      row = [];
      cell = '';
    }

    else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);

  return rows;
}

function cell(row, index) {
  return String((row && row[index]) || '').trim();
}

function isHeaderRow(row, label) {
  return cell(row, 0).toUpperCase().replace(/\s+/g, ' ').includes(label);
}

function fieldsFromPickingRow(row) {
  return {
    pickRef: cell(row, PICKING_COLS.pickRef),
    runCode: cell(row, PICKING_COLS.runCode),
    company: cell(row, PICKING_COLS.company),
    product: cell(row, PICKING_COLS.product),
    format: cell(row, PICKING_COLS.format),
    unitsAvailable: parseInt(cell(row, PICKING_COLS.totalUnits), 10) || 0,
    label: cell(row, PICKING_COLS.pickRef)
      ? `${cell(row, PICKING_COLS.runCode)} (${cell(row, PICKING_COLS.pickRef)})`
      : cell(row, PICKING_COLS.runCode)
  };
}

function fieldsFromStockRow(row) {
  return {
    pickRef: '',
    runCode: cell(row, STOCK_COLS.runCode),
    company: cell(row, STOCK_COLS.company),
    product: cell(row, STOCK_COLS.product),
    format: cell(row, STOCK_COLS.format),
    unitsAvailable: parseInt(cell(row, STOCK_COLS.units), 10) || 0,
    label: cell(row, STOCK_COLS.runCode)
  };
}

function applySelectedFields(fields) {
  pickRef = fields.pickRef || '';
  runCode = fields.runCode || '';
  company = fields.company || '';
  product = fields.product || '';
  format = fields.format || '';
  unitsAvailable = fields.unitsAvailable || 0;
}

async function loadData() {

  const palletText = await fetch(PALLETS_CSV).then(r => r.text());

  const palletRows = parseCSV(palletText);

  palletConfigs.clear();

  for (let i = 1; i < palletRows.length; i++) {

    const pallet = palletRows[i][0];

    const config = palletRows[i][2];

    if (!pallet) continue;

    if (!palletConfigs.has(pallet)) {
      palletConfigs.set(pallet, []);
    }

    palletConfigs.get(pallet).push(config);
  }

  const stockText = await fetch(STOCK_CSV).then(r => r.text());
  stockData = parseCSV(stockText);

  pickingData = [];
  try {
    const pickingText = await fetch(PICKING_CSV).then(r => r.text());
    pickingData = parseCSV(pickingText).filter((row, i) => {
      if (i === 0 && isHeaderRow(row, 'COLLECTION')) return false;
      return !!cell(row, PICKING_COLS.palletId);
    });
  } catch (err) {
    pickingData = [];
  }
}

function showStep1() {

  pickRef = '';
  runCode = '';
  company = '';
  product = '';
  format = '';
  unitsAvailable = 0;
  selectedRow = null;
  pickedUnits = 0;

  app.innerHTML = `
    <p>Select which pallet that you want to pick from</p>

    <input id="palletInput"
           maxlength="15"
           placeholder="Scan or type pallet ID">

    <div class="actions">

      <button class="btn btn-primary" onclick="confirmPallet()">
        Confirm Pallet
      </button>

    </div>
  `;
}

function confirmPallet() {

  const val =
    document.getElementById('palletInput')
      .value.trim();

  if (val.length !== 15 || isNaN(val)) {

    alert('Invalid pallet ID');

    return;
  }

  sourcePallet = val;

  showVerifyPallet();
}

function showVerifyPallet() {

  const configs =
    palletConfigs.get(sourcePallet) || [];

  app.innerHTML = `
    <p>
      <strong>${sourcePallet}</strong>
    </p>

    <div class="config-block">
      ${configs.join('<br><br>')}
    </div>

    <div class="actions">

      <button class="btn btn-ghost" onclick="showStep1()">
        Change Pallet
      </button>

      <button class="btn btn-primary" onclick="showRunSelection()">
        Confirm
      </button>

    </div>
  `;
}

function rowsForSourcePallet() {
  const pickingRows = pickingData
    .filter(r => cell(r, PICKING_COLS.palletId) === sourcePallet)
    .map(row => ({
      row,
      fields: fieldsFromPickingRow(row)
    }));

  const pickingRuns = new Set(pickingRows.map(e => e.fields.runCode));

  const stockRows = stockData
    .filter(r => cell(r, STOCK_COLS.palletId) === sourcePallet)
    .filter(r => !pickingRuns.has(cell(r, STOCK_COLS.runCode)))
    .map(row => ({
      row,
      fields: fieldsFromStockRow(row)
    }));

  return pickingRows.concat(stockRows);
}

function showRunSelection() {

  const rows = rowsForSourcePallet();

  if (!rows.length) {

    alert('No stock found');

    showStep1();

    return;
  }

  window.currentRows = rows;

  app.innerHTML = `
    <label>Select Item</label>

    <select id="runSelect">

      ${rows.map((entry,i)=>
        `<option value="${i}">${entry.fields.label}</option>`
      ).join('')}

    </select>

    <div class="actions">

      <button class="btn btn-primary" onclick="confirmItem()">
        Next
      </button>

    </div>
  `;
}

function confirmItem() {

  const entry =
    window.currentRows[
      document.getElementById('runSelect').value
    ];

  selectedRow = entry.row;
  applySelectedFields(entry.fields);

  app.innerHTML = `
    <p>Run Code: ${runCode}</p>
    <p>Company: ${company}</p>
    <p>Product: ${product}</p>
    <p>Format: ${format}</p>
    <p>Units Available: ${unitsAvailable}</p>

    <div class="actions">

      <button class="btn btn-ghost" onclick="showRunSelection()">
        Back
      </button>

      <button class="btn btn-primary" onclick="showQuantityStep()">
        Correct
      </button>

    </div>
  `;
}

function showQuantityStep() {

  app.innerHTML = `
    <p>How many units would you like to pick?</p>

    <input
      id="qty"
      type="number"
      min="1"
      max="${unitsAvailable}"
    >

    <div class="actions">

      <button class="btn btn-success" onclick="submitNegativeMovement()">
        Confirm
      </button>

    </div>
  `;
}

async function submitNegativeMovement() {

  pickedUnits =
    parseInt(
      document.getElementById('qty').value,
      10
    );

  const available = unitsAvailable;

  if (
    !pickedUnits ||
    pickedUnits > available
  ) {

    alert('Cannot exceed available units');

    return;
  }

  await submitMovement(
    sourcePallet,
    runCode,
    -pickedUnits,
    pickRef
  );

  showDestinationOptions();
}

function showDestinationOptions() {

  app.innerHTML = `
    <div class="actions">

      <button class="btn btn-primary" onclick="showDestinationStep()">
        Add To Another Pallet
      </button>

      <button class="btn btn-ghost" onclick="finish()">
        Add Later
      </button>

    </div>
  `;
}

function showDestinationStep() {

  app.innerHTML = `
    <input
      id="destination"
      maxlength="15"
      placeholder="Destination pallet"
    >

    <input
      id="destQty"
      type="number"
      value="${pickedUnits}"
    >

    <div class="actions">

      <button class="btn btn-success" onclick="submitDestination()">
        Confirm
      </button>

    </div>
  `;
}

async function submitDestination() {

  destinationPallet =
    document.getElementById('destination')
      .value.trim();

  if (
    destinationPallet === sourcePallet
  ) {

    alert(
      'Destination pallet cannot equal source pallet'
    );

    return;
  }

  const qty =
    parseInt(
      document.getElementById('destQty').value,
      10
    );

  await submitMovement(
    destinationPallet,
    runCode,
    qty,
    pickRef
  );

  finish();
}

async function submitMovement(
  pallet,
  run,
  units,
  movementPickRef
) {

  const now = new Date();

  const pad =
    n => String(n).padStart(2,'0');

  const date =
    `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`;

  const time =
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const body =
    new URLSearchParams();

  body.append('code', pallet);
  body.append('run', run);
  body.append('units', units);
  body.append('pickRef', movementPickRef || '');
  body.append('date', date);
  body.append('time', time);

  const response =
    await fetch(SCRIPT_URL,{
      method:'POST',
      headers:{
        'Content-Type':'application/x-www-form-urlencoded'
      },
      body
    });

  const result =
    await response.json();

  if (
    result.result !== 'success'
  ) {

    throw new Error(
      result.message || 'Submission failed'
    );
  }
}

function finish() {

  app.innerHTML = UI.successScreen(
    'Transfer completed successfully',
    '',
    `<button class="btn btn-primary" onclick="showStep1()">Start Again</button>`
  );
}

window.confirmPallet = confirmPallet;
window.confirmItem = confirmItem;
window.showRunSelection = showRunSelection;
window.showQuantityStep = showQuantityStep;
window.submitNegativeMovement = submitNegativeMovement;
window.showDestinationStep = showDestinationStep;
window.submitDestination = submitDestination;
window.showStep1 = showStep1;

loadData().then(showStep1);
