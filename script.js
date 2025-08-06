let app = document.getElementById('app');
let palletCode = '';
let runCode = '';
let runCodes = [];

const RUN_CODES_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGuxb9U0N7OF1Vjf4HTtaWho9VYTGaFShUB0YnGr9MluOYKRbhatjzMob4FUH0ttBJhbpH6t6ZmoGB/pub?gid=1875380966&single=true&output=csv';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzZXDShnEST3Dm4AoMibsS6FwUZB98iZ2lURh-sP_iUGZVG8q2E9OKD9BvvK33kCvUp/exec';

function loadRunCodes() {
  fetch(RUN_CODES_CSV)
    .then(response => response.text())
    .then(csv => {
      runCodes = csv.trim().split('\n').map(code => code.trim()).filter(code => code);
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
    <label>Enter number of units:</label>
    <input id="unitInput" type="number" min="1" />
    <button onclick="confirmUnits()">Next</button>
    <button onclick="showStep2()">Back</button>
  `;
}

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

  fetch(url, {
    method: 'POST',
    body: body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    }
  })
  .then(res => res.json())
  .then(data => {
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
