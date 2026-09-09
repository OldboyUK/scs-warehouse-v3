const app = document.getElementById('app');
const successOverlay = document.getElementById('successOverlay');
const successOkBtn = document.getElementById('successOkBtn');

const SCRIPT_URL = '/.netlify/functions/submitHourlyHours';

let workedToday = true;

function renderForm() {
  const username = SCSAuth.getUsername() || 'User';

  app.innerHTML =
    '<p class="hr-welcome">Welcome <span>' + HRUtils.escapeHTML(username) + '</span></p>' +
    '<p class="hr-intro">Please record your hours here if you\'re paid on an hourly rate (not on a salary).</p>' +
    '<form id="recordHoursForm" class="hr-form-card" novalidate>' +
      '<section class="hr-form-section">' +
        '<div class="hr-hours-row">' +
          '<div>' +
            '<label for="startTimeInput">Start Time</label>' +
            '<input id="startTimeInput" type="time" step="900" required />' +
          '</div>' +
          '<div>' +
            '<label for="finishTimeInput">Finish Time</label>' +
            '<input id="finishTimeInput" type="time" step="900" required />' +
          '</div>' +
        '</div>' +
      '</section>' +
      '<section class="hr-form-section">' +
        '<label for="breakInput">Break Taken</label>' +
        '<select id="breakInput">' +
          HRUtils.BREAK_OPTIONS.map(function (value) {
            return '<option value="' + value + '"' + (value === 30 ? ' selected' : '') + '>' + value + ' Minutes</option>';
          }).join('') +
        '</select>' +
      '</section>' +
      '<section class="hr-form-section">' +
        '<h2 class="hr-form-section-title">Date Worked</h2>' +
        '<label>Were these hours worked today?</label>' +
        '<div class="hr-choice-group">' +
          '<button type="button" class="btn btn-ghost hr-choice-btn is-selected" id="workedTodayYes">Yes</button>' +
          '<button type="button" class="btn btn-ghost hr-choice-btn" id="workedTodayNo">No</button>' +
        '</div>' +
        '<div id="dateFieldWrap" class="hr-date-field" hidden>' +
          '<label for="dateInput">Select date</label>' +
          '<input id="dateInput" type="date" max="' + HRUtils.formatTodayISO() + '" />' +
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
  const form = document.getElementById('recordHoursForm');
  const startTimeInput = document.getElementById('startTimeInput');
  const finishTimeInput = document.getElementById('finishTimeInput');
  const workedTodayYes = document.getElementById('workedTodayYes');
  const workedTodayNo = document.getElementById('workedTodayNo');
  const dateFieldWrap = document.getElementById('dateFieldWrap');
  const dateInput = document.getElementById('dateInput');

  HRUtils.wireQuarterHourTimeInput(startTimeInput);
  HRUtils.wireQuarterHourTimeInput(finishTimeInput);
  HRUtils.wireDatePickerOnly(dateInput);

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
      dateInput.value = HRUtils.formatTodayISO();
    }
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submitForm();
  });
}

function submitForm() {
  const startTime = HRUtils.normalizeQuarterHourTime(document.getElementById('startTimeInput').value);
  const finishTime = HRUtils.normalizeQuarterHourTime(document.getElementById('finishTimeInput').value);
  const breakValue = parseInt(document.getElementById('breakInput').value, 10);
  const comments = (document.getElementById('commentsInput').value || '').trim();
  const submitBtn = document.getElementById('submitBtn');

  if (!startTime) {
    alert('Please select a start time.');
    return;
  }

  if (!finishTime) {
    alert('Please select a finish time.');
    return;
  }

  if (!HRUtils.isValidQuarterHourTime(startTime)) {
    alert('Start time must use 15 minute increments (for example 09:00 or 09:15).');
    return;
  }

  if (!HRUtils.isValidQuarterHourTime(finishTime)) {
    alert('Finish time must use 15 minute increments (for example 17:00 or 17:30).');
    return;
  }

  if (HRUtils.BREAK_OPTIONS.indexOf(breakValue) === -1) {
    alert('Please choose a valid break duration.');
    return;
  }

  let isoDate = HRUtils.formatTodayISO();
  if (!workedToday) {
    isoDate = (document.getElementById('dateInput').value || '').trim();
    if (!isoDate) {
      alert('Please select the date worked.');
      return;
    }
  }

  const totalHours = HRUtils.calculateTotalHours(isoDate, startTime, finishTime, breakValue);
  const deviceInfo = HRUtils.getDeviceInfo();
  const username = SCSAuth.getUsername() || '';

  const body = new URLSearchParams();
  body.append('username', username);
  body.append('dateWorked', HRUtils.formatDisplayDate(isoDate));
  body.append('startTime', startTime);
  body.append('breakMinutes', String(breakValue));
  body.append('finishTime', finishTime);
  body.append('totalHours', totalHours);
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
