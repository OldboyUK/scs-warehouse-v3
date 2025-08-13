let app = document.getElementById('app');
let palletCode = '';
let locationCode = '';

const SCRIPT_URL = "/.netlify/functions/assignLocation"; // You'll create this Netlify function

function showStep1() {
  app.innerHTML = `
    <label>Enter or scan Pallet ID:</label>
    <input id="palletInput" maxlength="15" />
    <button onclick="confirmPallet()">Next</button>
    <hr>
    <button onclick="startBarcodeScan('pallet')">📷 Scan Pallet Barcode</button>
  `;
}

function confirmPallet() {
  const input = document.getElementById('palletInput').value.trim();
  if (!input) {
    alert("Please enter a pallet ID.");
    return;
  }
  palletCode = input;
  showStep2();
}

function showStep2() {
  app.innerHTML = `
    <label>Enter or scan Location ID:</label>
    <input id="locationInput" />
    <button onclick="confirmLocation()">Next</button>
    <hr>
    <button onclick="startBarcodeScan('location')">📷 Scan Location Barcode</button>
    <button onclick="showStep1()">Back</button>
  `;
}

function confirmLocation() {
  let loc = document.getElementById('locationInput').value.trim();
  if (!loc) {
    alert("Please enter a location ID.");
    return;
  }

  // If it ends with a dash, ask for shelf number
  if (loc.endsWith('-')) {
    locationCode = loc;
    askForShelf();
  } else {
    locationCode = loc;
    submitAssignment();
  }
}

function askForShelf() {
  app.innerHTML = `
    <p>Location code: <strong>${locationCode}</strong></p>
    <p>Select shelf number:</p>
    <button onclick="addShelf(2)">2</button>
    <button onclick="addShelf(3)">3</button>
    <button onclick="addShelf(4)">4</button>
  `;
}

function addShelf(num) {
  locationCode = locationCode + num;
  submitAssignment();
}

function startBarcodeScan(type) {
  if (typeof BarcodeDetector === 'undefined') {
    alert('Barcode scanning not supported in this browser.');
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
            const scanned = barcodes[0].rawValue.trim();
            if (type === 'pallet') {
              palletCode = scanned;
              showStep2();
            } else if (type === 'location') {
              if (scanned.endsWith('-')) {
                locationCode = scanned;
                askForShelf();
              } else {
                locationCode = scanned;
                submitAssignment();
              }
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

function submitAssignment() {
  const date = new Date();
  const formattedDate = date.toLocaleDateString('en-GB');
  const formattedTime = date.toLocaleTimeString('en-GB');

  const body = new URLSearchParams();
  body.append("pallet", palletCode);
  body.append("location", locationCode);
  body.append("date", formattedDate);
  body.append("time", formattedTime);

  fetch(SCRIPT_URL, {
    method: 'POST',
    body: body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })
  .then(res => res.json())
  .then(data => {
    if (data.result === 'success') {
      app.innerHTML = `
        <p>✅ Location assigned successfully!</p>
        <button onclick="showStep1()">Assign Another</button>
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

window.showStep1 = showStep1;
window.confirmPallet = confirmPallet;
window.confirmLocation = confirmLocation;
window.startBarcodeScan = startBarcodeScan;
window.addShelf = addShelf;

showStep1();
