let app = document.getElementById('app');
let palletCode = '';
let runCode = '';
let runCodes = [];

const RUN_CODES_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1875380966&single=true&output=csv';
const SCRIPT_URL = '/.netlify/functions/submit'; // Updated to Netlify function

function loadRunCodes() {
  fetch(RUN_CODES_CSV)
    .then(response => response.text())
    .then(csv => {
      runCodes = csv
        .trim()
        .split('\n')
        .map(code => code.trim())
        .filter(code => code);              // remove blanks
      // tidy: unique + alpha sort (nice for datalist)
      runCodes = Array.from(new Set(runCodes)).sort((a,b)=>a.localeCompare(b, undefined, {numeric:true}));
      console.log('Loaded run codes:', runCodes);
    });
}

function showStep1() {
  app.innerHTML = `
    <label>Enter 15-digit code:</label>
    <input id="codeInput" maxlength="15" />
    <button onclick="confirmCode()">Next</button>
    <hr>
    <button onclick="startBarcodeScan()">📷 Scan Barcode</button>
  `;
}

function confirmCode() {
  const input = document.getElementById('codeInput').value;
  if (input.length !== 15 || isNaN(input)) {
    alert('Please enter a valid 15-digit number.');
    return;
  }
  palletCode = input;
  showConfirmCode();
}

function showConfirmCode() {
  app.innerHTML = `
    <p>You entered: <strong>${palletCode}</strong></p>
    <button onclick="showStep2()">Confirm</button>
    <button onclick="showStep1()">Back</button>
  `;
}

function startBarcodeScan() {
  if (typeof BarcodeDetector === 'undefined') {
    alert('Barcode scanning is not supported in this browser.');
    return;
  }

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(async stream => {
      const video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();

      app.innerHTML = `<p>📷 Scanning... Point camera at barcode.</p>`;
      app.appendChild(video);
      video.style.width = '300px';
      video.style.height = '300px';

      const detector = new BarcodeDetector({ formats: ['code_128', 'ean_13'] });

      const scan = async () => {
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0) {
            stream.getTracks().forEach(track => track.stop());
            palletCode = barcodes[0].rawValue;
            if (palletCode.length !== 15 || isNaN(palletCode)) {
              alert("Scanned code is not a valid 15-digit number.");
              showStep1();
            } else {
              showConfirmCode();
            }
          } else {
            requestAnimationFrame(scan);
          }
        } catch (err) {
          console.error("Barcode detection error:", err);
          stream.getTracks().forEach(track => track.stop());
          alert("Barcode detection failed.");
          showStep1();
        }
      };

      scan();
    })
    .catch(err => {
      alert("Camera access denied or unavailable.");
      console.error("getUserMedia error:", err);
    });
}

/* ====== NEW: datalist hybrid dropdown for run codes ====== */
function findRunCode(value) {
  const v = (value || '').trim().toUpperCase();
  return runCodes.find(c => c.toUpperCase() === v) || null;
}

function showStep2() {
  const options = runCodes.map(code => `<option value="${code}"></option>`).join('');
  app.innerHTML = `
    <label>Select run code:</label>
    <input id="runCodeInput" list="runCodesList" placeholder="Type to search…" autocomplete="off" />
    <datalist id="runCodesList">${options}</datalist>

    <div class="actions mt-3">
      <button onclick="confirmRunCode()">Next</button>
      <button class="btn-ghost" onclick="showStep1()">Back</button>
    </div>
  `;

  const input = document.getElementById('runCodeInput');
  input.focus();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { confirmRunCode(); }
  });
}

function confirmRunCode() {
  const entered = document.getElementById('runCodeInput').value;
  const matched = findRunCode(entered);

  if (!matched) {
    alert('Please choose a valid run code from the list. Start typing and pick a suggestion.');
    return;
  }

  runCode = matched;

  app.innerHTML = `
    <p>Code: <strong>${palletCode}</strong></p>
    <p>Run Code: <strong>${runCode}</strong></p>
    <label>Enter number of units:</label>
    <input id="unitInput" type="number" min="1" />
    <div class="actions mt-3">
      <button onclick="confirmUnits()">Next</button>
      <button class="btn-ghost" onclick="showStep2()">Back</button>
    </div>
  `;
}
/* ====== /NEW ====== */

function confirmUnits() {
  const input = document.getElementById('unitInput').value;
  const units = parseInt(input);

  if (isNaN(units) || units <= 0) {
    alert("Please enter a valid number of units.");
    return;
  }

  app.innerHTML = `
    <p>Code: <strong>${palletCode}</strong></p>
    <p>Run Code: <strong>${runCode}</strong></p>
    <p>Units: <strong>${units}</strong></p>
    <button onclick="submitEntry(${units})">Confirm & Submit</button>
    <button onclick="confirmRunCode()">Back</button>
  `;
}

function submitEntry(units) {
  const url = "/.netlify/functions/submit";

  const body = new URLSearchParams();
  body.append("code", palletCode);
  body.append("run", runCode);
  body.append("units", units);

  console.log('Sending to Netlify:', { code: palletCode, run: runCode, units: units });

  fetch(url, {
    method: 'POST',
    body: body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })
  .then(res => res.json())
  .then(data => {
    console.log('Netlify response:', data);
    if (data.result === 'success') {
      app.innerHTML = `
        <p>✅ Entry submitted successfully!</p>
        <button onclick="showStep1()">Add Another</button>
      `;
    } else {
      app.innerHTML = `<p>❌ Error: ${data.message}</p>`;
    }
  })
  .catch(err => {
    console.error('Fetch error:', err);
    app.innerHTML = `<p>❌ Network error. Please try again.</p>`;
  });
}

window.confirmCode = confirmCode;
window.confirmRunCode = confirmRunCode;
window.submitEntry = submitEntry;
window.showStep1 = showStep1;
window.showStep2 = showStep2;
window.startBarcodeScan = startBarcodeScan;

loadRunCodes();
showStep1();
