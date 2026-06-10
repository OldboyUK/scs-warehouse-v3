const app = document.getElementById('app');
const video = document.getElementById('video');

const PALLETS_CSV =
'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1165333250&single=true&output=csv';

const STOCK_CSV =
'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1879287780&single=true&output=csv';

const SCRIPT_URL =
`${window.location.origin}/.netlify/functions/submit`;

let sourcePallet = '';
let destinationPallet = '';

let selectedRow = null;
let pickedUnits = 0;

const palletConfigs = new Map();
let stockData = [];

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
}

function showStep1() {

  app.innerHTML = `
    <p>Select which pallet that you want to pick from</p>

    <input id="palletInput"
           maxlength="15"
           placeholder="Scan or type pallet ID">

    <div class="actions">

      <button onclick="confirmPallet()">
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

    <div style="white-space:pre-line;">
      ${configs.join('<br><br>')}
    </div>

    <div class="actions">

      <button onclick="showStep1()">
        Change Pallet
      </button>

      <button onclick="showRunSelection()">
        Confirm
      </button>

    </div>
  `;
}

function showRunSelection() {

  const rows =
    stockData.filter(r => r[0] === sourcePallet);

  if (!rows.length) {

    alert('No stock found');

    showStep1();

    return;
  }

  window.currentRows = rows;

  app.innerHTML = `
    <label>Select Item</label>

    <select id="runSelect">

      ${rows.map((r,i)=>
        `<option value="${i}">${r[1]}</option>`
      ).join('')}

    </select>

    <div class="actions">

      <button onclick="confirmItem()">
        Next
      </button>

    </div>
  `;
}

function confirmItem() {

  selectedRow =
    window.currentRows[
      document.getElementById('runSelect').value
    ];

  app.innerHTML = `
    <p>Run Code: ${selectedRow[1]}</p>
    <p>Company: ${selectedRow[2]}</p>
    <p>Product: ${selectedRow[3]}</p>
    <p>Format: ${selectedRow[4]}</p>
    <p>Units Available: ${selectedRow[5]}</p>

    <div class="actions">

      <button onclick="showRunSelection()">
        Back
      </button>

      <button onclick="showQuantityStep()">
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
      max="${selectedRow[5]}"
    >

    <div class="actions">

      <button onclick="submitNegativeMovement()">
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

  const available =
    parseInt(selectedRow[5],10);

  if (
    !pickedUnits ||
    pickedUnits > available
  ) {

    alert('Cannot exceed available units');

    return;
  }

  await submitMovement(
    sourcePallet,
    selectedRow[1],
    -pickedUnits
  );

  showDestinationOptions();
}

function showDestinationOptions() {

  app.innerHTML = `
    <div class="actions">

      <button onclick="showDestinationStep()">
        Add To Another Pallet
      </button>

      <button onclick="finish()">
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

      <button onclick="submitDestination()">
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
    selectedRow[1],
    qty
  );

  finish();
}

async function submitMovement(
  pallet,
  run,
  units
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

  app.innerHTML = `
    <p>
      ✅ Picking completed successfully.
    </p>

    <div class="actions">

      <button onclick="showStep1()">
        Start Again
      </button>

    </div>
  `;
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