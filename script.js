let app = document.getElementById('app');
let palletCode = '';
let runCode = '';
let runCodes = [];

const ORDER_LOG_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=792145998&single=true&output=csv';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzwQSASOLSssqz7Ksk9AQ7tU9RbbPW2ifuU0SHDAb-g7NZEPT0PzELzHaVNolzikw5b/exec';

function loadRunCodes() {
  fetch(ORDER_LOG_CSV)
    .then(response => response.text())
    .then(csv => {
      runCodes = csv.split('\n').map(row => row.split(',')[0].trim()).filter(code => code);
    });
}

function showStep1() {
  app.innerHTML = `
    <label>Enter 15-digit code:</label>
    <input id="codeInput" maxlength="15" />
    <button onclick="confirmCode()">Next</button>
  `;
}

function confirmCode() {
  const input = document.getElementById('codeInput').value;
  if (input.length !== 15 || isNaN(input)) {
    alert('Please enter a valid 15-digit number.');
    return;
  }
  palletCode = input;
  app.innerHTML = `
    <p>You entered: <strong>${palletCode}</strong></p>
    <button onclick="showStep2()">Confirm</button>
    <button onclick="showStep1()">Back</button>
  `;
}

function showStep2() {
  let options = runCodes.map(code => `<option value="${code}">${code}</option>`).join('');
  app.innerHTML = `
    <label>Select run code:</label>
    <select id="runCodeSelect">${options}</select>
    <button onclick="confirmRunCode()">Next</button>
    <button onclick="showStep1()">Start Over</button>
  `;
}

function confirmRunCode() {
  runCode = document.getElementById('runCodeSelect').value;
  app.innerHTML = `
    <p>Code: <strong>${palletCode}</strong></p>
    <p>Run Code: <strong>${runCode}</strong></p>
    <button onclick="submitEntry()">Confirm & Submit</button>
    <button onclick="showStep2()">Back</button>
  `;
}

function submitEntry() {
  const url = "/.netlify/functions/submit";
  const body = new URLSearchParams();
  body.append("code", palletCode);
  body.append("run", runCode);

  fetch(url, {
    method: 'POST',
    body: body
  })
  .then(res => res.text())
  .then(text => {
    app.innerHTML = `
      <p>✅ Entry submitted successfully!</p>
      <button onclick="showStep1()">Add Another</button>
    `;
  })
  .catch(err => {
    app.innerHTML = `<p>❌ Network error. Please try again.</p>`;
  });
}


// Make functions globally accessible
window.confirmCode = confirmCode;
window.confirmRunCode = confirmRunCode;
window.submitEntry = submitEntry;
window.showStep1 = showStep1;
window.showStep2 = showStep2;

loadRunCodes();
showStep1();
