const app = document.getElementById('app');
const successOverlay = document.getElementById('successOverlay');
const successOkBtn = document.getElementById('successOkBtn');

const SCRIPT_URL = '/.netlify/functions/submitOvertime';
const MINUTE_OPTIONS = [0, 15, 30, 45];

let workedToday = true;
let entryType = 'overtime';

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, function (match) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match];
  });
}

function formatTodayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function formatDisplayDate(isoDate) {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return parts[2] + '/' + parts[1] + '/' + parts[0];
}

function formatHoursWorked(hours, minutes, isDeduction) {
  const h = Math.abs(parseInt(hours, 10));
  const m = Math.abs(parseInt(minutes, 10));
  if (isNaN(h) || isNaN(m)) return '';
  const prefix = isDeduction ? '-' : '';
  return prefix + h + ':' + String(m).padStart(2, '0');
}

function getDeviceInfo() {
  const ua = navigator.userAgent || '';
  let deviceType = 'Desktop';
  if (/Mobi|Android/i.test(ua) && !/Tablet|iPad/i.test(ua)) deviceType = 'Phone';
  else if (/Tablet|iPad/i.test(ua)) deviceType = 'Tablet';

  let browser = 'Unknown';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';

  let os = 'Unknown';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  return {
    browserModel: ua,
    os: os,
    browser: browser,
    deviceType: deviceType
  };
}

function renderForm() {
  const username = SCSAuth.getUsername() || 'User';

  app.innerHTML =
    '<p class="hr-welcome">Welcome <span>' + escapeHTML(username) + '</span></p>' +
    '<p class="hr-intro">Please use this page to record any overtime worked.</p>' +
    '<div class="hr-guidance">' +
      '<p>Please enter your overtime worked or time to deduct.</p>' +
      '<p>Please round down to the nearest 15 minutes.</p>' +
      '<p>If you arrived late or left early, choose Deduction and enter the time as a positive value.</p>' +
    '</div>' +
    '<form id="overtimeForm" class="hr-form-card" novalidate>' +
      '<section class="hr-form-section">' +
        '<h2 class="hr-form-section-title">Hours Entry</h2>' +
        '<label>Overtime or Deduction?</label>' +
        '<div class="hr-choice-group">' +
          '<button type="button" class="btn btn-ghost hr-choice-btn is-selected" id="entryTypeOvertime">Overtime</button>' +
          '<button type="button" class="btn btn-ghost hr-choice-btn" id="entryTypeDeduction">Deduction</button>' +
        '</div>' +
        '<div class="hr-hours-row">' +
          '<div>' +
            '<label for="hoursInput">Hours</label>' +
            '<input id="hoursInput" type="number" min="0" step="1" inputmode="numeric" value="0" />' +
          '</div>' +
          '<div>' +
            '<label for="minutesInput">Minutes</label>' +
            '<select id="minutesInput">' +
              MINUTE_OPTIONS.map(function (value) {
                return '<option value="' + value + '">' + value + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
        '</div>' +
      '</section>' +
      '<section class="hr-form-section">' +
        '<h2 class="hr-form-section-title">Date</h2>' +
        '<label>Was this worked today?</label>' +
        '<div class="hr-choice-group">' +
          '<button type="button" class="btn btn-ghost hr-choice-btn is-selected" id="workedTodayYes" data-value="yes">Yes</button>' +
          '<button type="button" class="btn btn-ghost hr-choice-btn" id="workedTodayNo" data-value="no">No</button>' +
        '</div>' +
        '<div id="dateFieldWrap" class="hr-date-field" hidden>' +
          '<label for="dateInput">Select date</label>' +
          '<input id="dateInput" type="date" max="' + formatTodayISO() + '" />' +
        '</div>' +
      '</section>' +
      '<section class="hr-form-section">' +
        '<h2 class="hr-form-section-title">Comments</h2>' +
        '<label for="commentsInput">Would you like to leave any comments?</label>' +
        '<textarea id="commentsInput" class="hr-comments" rows="5" placeholder="Optional"></textarea>' +
      '</section>' +
      '<div class="actions mt-3">' +
        '<a href="index.html" class="btn btn-ghost">Back</a>' +
        '<button type="submit" class="btn btn-primary" id="submitBtn">Submit Hours</button>' +
      '</div>' +
    '</form>';

  wireForm();
}

function wireForm() {
  const form = document.getElementById('overtimeForm');
  const entryTypeOvertime = document.getElementById('entryTypeOvertime');
  const entryTypeDeduction = document.getElementById('entryTypeDeduction');
  const hoursInput = document.getElementById('hoursInput');
  const workedTodayYes = document.getElementById('workedTodayYes');
  const workedTodayNo = document.getElementById('workedTodayNo');
  const dateFieldWrap = document.getElementById('dateFieldWrap');
  const dateInput = document.getElementById('dateInput');

  entryTypeOvertime.addEventListener('click', function () {
    entryType = 'overtime';
    entryTypeOvertime.classList.add('is-selected');
    entryTypeDeduction.classList.remove('is-selected');
  });

  entryTypeDeduction.addEventListener('click', function () {
    entryType = 'deduction';
    entryTypeDeduction.classList.add('is-selected');
    entryTypeOvertime.classList.remove('is-selected');
  });

  hoursInput.addEventListener('input', function () {
    const value = parseInt(hoursInput.value, 10);
    if (!isNaN(value) && value < 0) {
      hoursInput.value = '0';
    }
  });

  workedTodayYes.addEventListener('click', function () {
    workedToday = true;
    workedTodayYes.classList.add('is-selected');
    workedTodayNo.classList.remove('is-selected');
    dateFieldWrap.hidden = true;
  });

  workedTodayNo.addEventListener('click', function () {
    workedToday = false;
    workedTodayNo.classList.add('is-selected');
    workedTodayYes.classList.remove('is-selected');
    dateFieldWrap.hidden = false;
    if (!dateInput.value) {
      dateInput.value = formatTodayISO();
    }
  });

  dateInput.addEventListener('keydown', function (event) {
    event.preventDefault();
  });

  dateInput.addEventListener('paste', function (event) {
    event.preventDefault();
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submitForm();
  });
}

function submitForm() {
  const hoursValue = (document.getElementById('hoursInput').value || '').trim();
  const minutesValue = (document.getElementById('minutesInput').value || '').trim();
  const comments = (document.getElementById('commentsInput').value || '').trim();
  const submitBtn = document.getElementById('submitBtn');

  const hours = parseInt(hoursValue, 10);
  const minutes = parseInt(minutesValue, 10);
  const isDeduction = entryType === 'deduction';

  if (isNaN(hours) || hours < 0) {
    alert('Please enter a valid number of hours (0 or greater).');
    return;
  }

  if (MINUTE_OPTIONS.indexOf(minutes) === -1) {
    alert('Minutes must be 0, 15, 30, or 45.');
    return;
  }

  if (hours === 0 && minutes === 0) {
    alert('Please enter some time to record.');
    return;
  }

  let isoDate = formatTodayISO();
  if (!workedToday) {
    isoDate = (document.getElementById('dateInput').value || '').trim();
    if (!isoDate) {
      alert('Please select the date worked.');
      return;
    }
  }

  const hoursWorked = formatHoursWorked(hours, minutes, isDeduction);
  const deviceInfo = getDeviceInfo();
  const username = SCSAuth.getUsername() || '';

  const body = new URLSearchParams();
  body.append('username', username);
  body.append('dateWorked', formatDisplayDate(isoDate));
  body.append('hoursWorked', hoursWorked);
  body.append('comments', comments);
  body.append('browserModel', deviceInfo.browserModel);
  body.append('os', deviceInfo.os);
  body.append('browser', deviceInfo.browser);
  body.append('deviceType', deviceInfo.deviceType);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';

  fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body
  })
    .then(async function (response) {
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) {}
      if (!response.ok) {
        throw new Error(json && json.message ? json.message : text);
      }
      if (!json || json.result !== 'success') {
        throw new Error(json && json.message ? json.message : text);
      }
      successOverlay.hidden = false;
    })
    .catch(function (err) {
      console.error(err);
      alert(err.message || 'Something went wrong. Please try again.');
    })
    .finally(function () {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Hours';
    });
}

successOkBtn.addEventListener('click', function () {
  window.location.href = 'index.html';
});

successOverlay.addEventListener('click', function (event) {
  if (event.target === successOverlay) {
    window.location.href = 'index.html';
  }
});

renderForm();
