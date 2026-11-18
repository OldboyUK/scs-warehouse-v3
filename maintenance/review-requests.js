var app = document.getElementById('app');

var SCRIPT_URL = '/.netlify/functions/reviewMaintenance';
var DRAFT_KEY = 'scs_review_request_draft';
var DEPARTMENTS = ['Quality', 'Engineering', 'Logistics', 'Management'];
var OTHER = 'Other';

var state = {
  mode: 'form',
  submissionId: '',
  loggedInUser: (window.SCSAuth && SCSAuth.getUsername()) || '',
  requests: [],
  owners: [],
  label: '',
  owner: '',
  department: '',
  departmentOther: '',
  dueDate: '',
  permit: '',
  assessment: '',
  listsLoading: true,
  listsError: '',
  saving: false,
  error: '',
  fieldErrors: {},
  maintenanceId: '',
  dueOn: '',
  partsChoice: ''
};

function createSubmissionId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) {
    var rand = Math.random() * 16 | 0;
    var value = ch === 'x' ? rand : (rand & 0x3 | 0x8);
    return value.toString(16);
  });
}

function escapeHTML(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (match) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match];
  });
}

function idFromLabel(label) {
  var text = String(label || '').trim();
  var cut = text.indexOf(' | ');
  if (cut < 0) return '';
  var id = text.slice(0, cut).trim().toUpperCase();
  if (!/^MA\d{4}$/.test(id)) return '';
  if (!text.slice(cut + 3).trim()) return '';
  return id;
}

function ukDate(iso) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!match) return '';
  return match[3] + '/' + match[2] + '/' + match[1];
}

function selectedRequest() {
  for (var i = 0; i < state.requests.length; i++) {
    if (state.requests[i].label === state.label) return state.requests[i];
  }
  return null;
}

function restoreDraft() {
  state.submissionId = createSubmissionId();
  try {
    var raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    var draft = JSON.parse(raw);
    if (!draft || typeof draft !== 'object') return;
    if (draft.submissionId) state.submissionId = String(draft.submissionId);
    state.label = String(draft.label || '');
    state.owner = String(draft.owner || '');
    state.department = DEPARTMENTS.indexOf(draft.department) === -1 && draft.department !== OTHER ? '' : String(draft.department || '');
    state.departmentOther = String(draft.departmentOther || '');
    state.dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(draft.dueDate || '')) ? String(draft.dueDate) : '';
    state.permit = draft.permit === 'Yes' || draft.permit === 'No' ? draft.permit : '';
    state.assessment = String(draft.assessment || '');
  } catch (err) {}
}

function persist() {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      submissionId: state.submissionId,
      label: state.label,
      owner: state.owner,
      department: state.department,
      departmentOther: state.departmentOther,
      dueDate: state.dueDate,
      permit: state.permit,
      assessment: state.assessment
    }));
  } catch (err) {}
}

function fieldError(name) {
  if (!state.fieldErrors[name]) return '';
  return '<p class="fault-error" id="' + name + '-error">' + escapeHTML(state.fieldErrors[name]) + '</p>';
}

function invalidClass(name) {
  return state.fieldErrors[name] ? ' fault-invalid' : '';
}

function describedBy(name) {
  return state.fieldErrors[name] ? ' aria-invalid="true" aria-describedby="' + name + '-error"' : '';
}

function bannerHtml() {
  if (!state.error) return '';
  return '<div class="fault-banner" role="alert">' + escapeHTML(state.error) + '</div>';
}

function choiceButton(value, label) {
  var pressed = state.permit === value;
  return '<button type="button" class="btn fault-choice" data-permit="' + value + '" aria-pressed="' + (pressed ? 'true' : 'false') + '"' +
    (state.saving ? ' disabled' : '') + '>' + escapeHTML(label) + '</button>';
}

function render() {
  if (state.mode === 'success') {
    renderSuccess();
    return;
  }
  if (state.listsLoading) {
    app.innerHTML = '<p class="fault-intro">Review an existing maintenance request. This does not create a new maintenance ID.</p>' +
      '<p class="status" role="status">Loading maintenance requests…</p>';
    return;
  }
  if (state.listsError) {
    app.innerHTML = bannerHtml() +
      '<p class="fault-intro">Review an existing maintenance request. This does not create a new maintenance ID.</p>' +
      '<p class="fault-error">' + escapeHTML(state.listsError) + '</p>' +
      '<div class="actions"><button type="button" class="btn btn-primary" id="retryLists">Try again</button></div>';
    document.getElementById('retryLists').addEventListener('click', loadLists);
    return;
  }
  app.innerHTML = renderForm();
  wire();
  var banner = document.querySelector('.fault-banner');
  if (banner && banner.scrollIntoView) banner.scrollIntoView({ block: 'start' });
}

function renderForm() {
  var disabled = state.saving ? ' disabled' : '';
  var selected = selectedRequest();
  var options = '<option value="">Select a maintenance request…</option>';
  for (var i = 0; i < state.requests.length; i++) {
    options += '<option value="' + escapeHTML(state.requests[i].label) + '"' +
      (state.requests[i].label === state.label ? ' selected' : '') + '>' +
      escapeHTML(state.requests[i].label) + '</option>';
  }
  var owners = '<option value="">Select an owner…</option>';
  for (var o = 0; o < state.owners.length; o++) {
    owners += '<option value="' + escapeHTML(state.owners[o]) + '"' +
      (state.owners[o] === state.owner ? ' selected' : '') + '>' +
      escapeHTML(state.owners[o]) + '</option>';
  }
  var departmentChoices = DEPARTMENTS.concat([OTHER]);
  var departments = '<option value="">Select a department…</option>';
  for (var d = 0; d < departmentChoices.length; d++) {
    departments += '<option value="' + departmentChoices[d] + '"' +
      (state.department === departmentChoices[d] ? ' selected' : '') + '>' +
      departmentChoices[d] + '</option>';
  }
  var departmentOther = state.department === OTHER
    ? '<label for="departmentOther">Department <span class="fault-req">Required</span></label>' +
      '<input id="departmentOther" type="text" maxlength="200" value="' + escapeHTML(state.departmentOther) + '" class="' + invalidClass('departmentOther') + '"' + describedBy('departmentOther') + disabled + ' autocomplete="off" />' +
      fieldError('departmentOther')
    : '';
  var selectedLine = selected
    ? '<p class="review-selected">This will update <strong>' + escapeHTML(selected.label) + '</strong>.</p>'
    : '';
  var shownDate = ukDate(state.dueDate);
  return bannerHtml() +
    '<form id="reviewForm" novalidate>' +
      '<p class="fault-intro">Review an existing maintenance request. This does not create a new maintenance ID.</p>' +
      '<label class="fault-question" for="request">Select a maintenance request <span class="fault-req">Required</span></label>' +
      '<select id="request" class="' + invalidClass('request') + '"' + describedBy('request') + disabled + '>' + options + '</select>' +
      fieldError('request') +
      selectedLine +
      (state.loggedInUser
        ? '<p class="fault-identity">Signed in as <strong>' + escapeHTML(state.loggedInUser) + '</strong></p>'
        : '<p class="fault-error" id="user-error">Your sign-in could not be read. Sign in again.</p>') +
      '<label class="fault-question" for="owner">Please assign an owner to this job <span class="fault-req">Required</span></label>' +
      '<select id="owner" class="' + invalidClass('owner') + '"' + describedBy('owner') + disabled + '>' + owners + '</select>' +
      fieldError('owner') +
      '<label class="fault-question" for="department">Please assign a department <span class="fault-req">Required</span></label>' +
      '<select id="department" class="' + invalidClass('department') + '"' + describedBy('department') + disabled + '>' + departments + '</select>' +
      fieldError('department') +
      departmentOther +
      '<label class="fault-question" for="dueDate">Please enter a due date <span class="fault-req">Required</span></label>' +
      '<input id="dueDate" type="date" value="' + escapeHTML(state.dueDate) + '" class="' + invalidClass('dueDate') + '"' + describedBy('dueDate') + disabled + ' />' +
      (shownDate ? '<p class="review-count">Saved as ' + escapeHTML(shownDate) + '</p>' : '<p class="fault-hint">Saved as DD/MM/YYYY.</p>') +
      fieldError('dueDate') +
      '<p class="fault-question" id="permitLabel">Is a permit to work required? <span class="fault-req">Required</span></p>' +
      '<div class="fault-choices" role="group" aria-labelledby="permitLabel">' +
        choiceButton('Yes', 'Yes') +
        choiceButton('No', 'No') +
      '</div>' +
      fieldError('permit') +
      '<label class="fault-question" for="assessment">Assessing the task, is there any impact to Food Safety or Health and Safety that has not been considered? <span class="fault-req">Required</span></label>' +
      '<textarea id="assessment" rows="8" class="' + invalidClass('assessment') + '"' + describedBy('assessment') + disabled + '>' + escapeHTML(state.assessment) + '</textarea>' +
      fieldError('assessment') +
      '<div class="actions">' +
        '<button type="submit" class="btn btn-primary btn-block" id="submitBtn"' + disabled + '>' +
          (state.saving ? 'Saving…' : 'Submit') +
        '</button>' +
      '</div>' +
      (state.saving ? '<p class="status" role="status">Saving the review…</p>' : '') +
    '</form>';
}

function renderSuccess() {
  var note = '';
  if (state.partsChoice === 'later') {
    note = '<p class="review-note" role="status">You can order parts later. Nothing else was saved.</p>';
  }
  app.innerHTML = UI.successScreen(
    'Review saved',
    'Updated <span class="fault-id">' + escapeHTML(state.label || state.maintenanceId) + '</span>. The due date saved is ' + escapeHTML(state.dueOn) + '.',
    '<p class="fault-question" id="partsLabel">Would you like to order parts now or later?</p>' +
    '<div class="fault-choices" role="group" aria-labelledby="partsLabel">' +
      '<button type="button" class="btn fault-choice" id="partsNow" aria-pressed="' + (state.partsChoice === 'now' ? 'true' : 'false') + '">Order Parts Now</button>' +
      '<button type="button" class="btn fault-choice" id="partsLater" aria-pressed="' + (state.partsChoice === 'later' ? 'true' : 'false') + '">Order Parts Later</button>' +
    '</div>' +
    note +
    '<a class="btn btn-primary" href="index.html">Back to Maintenance</a>' +
    '<button type="button" class="btn btn-secondary" id="anotherBtn">Review another request</button>'
  );
  document.getElementById('partsNow').addEventListener('click', function () {
    var id = String(state.maintenanceId || '');
    if (!/^MA\d{4}$/.test(id)) return;
    window.location.href = 'order-parts.html?job=' + encodeURIComponent(id);
  });
  document.getElementById('partsLater').addEventListener('click', function () {
    state.partsChoice = 'later';
    renderSuccess();
  });
  document.getElementById('anotherBtn').addEventListener('click', startAnother);
}

function wire() {
  var form = document.getElementById('reviewForm');
  if (!form) return;
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submitReview();
  });
  document.getElementById('request').addEventListener('change', function (event) {
    if (state.saving) return;
    state.label = event.target.value;
    delete state.fieldErrors.request;
    state.error = '';
    persist();
    render();
  });
  document.getElementById('owner').addEventListener('change', function (event) {
    if (state.saving) return;
    state.owner = event.target.value;
    delete state.fieldErrors.owner;
    state.error = '';
    persist();
  });
  document.getElementById('department').addEventListener('change', function (event) {
    if (state.saving) return;
    state.department = event.target.value;
    delete state.fieldErrors.department;
    delete state.fieldErrors.departmentOther;
    state.error = '';
    persist();
    render();
  });
  var departmentOther = document.getElementById('departmentOther');
  if (departmentOther) {
    departmentOther.addEventListener('input', function (event) {
      if (state.saving) return;
      state.departmentOther = event.target.value;
      delete state.fieldErrors.departmentOther;
      state.error = '';
      persist();
    });
  }
  document.getElementById('dueDate').addEventListener('change', function (event) {
    if (state.saving) return;
    state.dueDate = event.target.value;
    delete state.fieldErrors.dueDate;
    state.error = '';
    persist();
    render();
  });
  var permitButtons = form.querySelectorAll('[data-permit]');
  for (var i = 0; i < permitButtons.length; i++) {
    permitButtons[i].addEventListener('click', function (event) {
      if (state.saving) return;
      state.permit = event.currentTarget.getAttribute('data-permit');
      delete state.fieldErrors.permit;
      state.error = '';
      persist();
      render();
    });
  }
  document.getElementById('assessment').addEventListener('input', function (event) {
    if (state.saving) return;
    state.assessment = event.target.value;
    delete state.fieldErrors.assessment;
    state.error = '';
    persist();
  });
}

function validateForm() {
  var errors = {};
  var request = selectedRequest();
  if (!state.label || !request) errors.request = 'Select a maintenance request.';
  else if (request.duplicate) errors.request = 'That maintenance request appears more than once, so it cannot be updated.';
  else if (!request.maintenanceId || request.maintenanceId !== idFromLabel(request.label)) {
    errors.request = 'That request no longer matches its maintenance ID, so it cannot be updated.';
  }
  if (!state.loggedInUser) errors.user = 'Your sign-in could not be read. Sign in again.';
  if (!state.owner || state.owners.indexOf(state.owner) === -1) errors.owner = 'Select an owner for this job.';
  if (DEPARTMENTS.indexOf(state.department) === -1 && state.department !== OTHER) errors.department = 'Select a department.';
  if (state.department === OTHER && !String(state.departmentOther || '').trim()) errors.departmentOther = 'Enter the department.';
  if (!state.dueDate || !ukDate(state.dueDate)) errors.dueDate = 'Enter a due date.';
  if (state.permit !== 'Yes' && state.permit !== 'No') errors.permit = 'Choose whether a permit to work is required.';
  if (!String(state.assessment || '').trim()) errors.assessment = 'Assess the impact to Food Safety or Health and Safety.';
  return errors;
}

function readFailure(response) {
  return response.json().catch(function () { return {}; }).then(function (body) {
    var message = body && body.message ? body.message : 'The review was not saved. Your answers are still here.';
    var error = new Error(message);
    error.keepAnswers = true;
    throw error;
  });
}

function submitReview() {
  if (state.saving || state.mode === 'success') return;
  var errors = validateForm();
  state.fieldErrors = errors;
  if (Object.keys(errors).length) {
    state.error = 'Complete the required answers. Nothing was saved.';
    render();
    return;
  }
  var request = selectedRequest();
  state.saving = true;
  state.error = '';
  render();
  var payload = {
    action: 'review_save',
    submissionId: state.submissionId,
    user: state.loggedInUser,
    label: request.label,
    maintenanceId: request.maintenanceId,
    owner: state.owner,
    department: state.department,
    departmentOther: state.department === OTHER ? state.departmentOther : '',
    dueDate: state.dueDate,
    permit: state.permit,
    assessment: state.assessment
  };
  fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function (response) {
    if (!response.ok) return readFailure(response);
    return response.json();
  }).then(function (body) {
    if (!body || body.result !== 'success' || body.maintenanceId !== request.maintenanceId) {
      var error = new Error((body && body.message) || 'The review was not saved. Your answers are still here.');
      error.keepAnswers = true;
      throw error;
    }
    state.mode = 'success';
    state.maintenanceId = body.maintenanceId;
    state.label = body.label || request.label;
    state.dueOn = body.dueOn || ukDate(state.dueDate);
    state.saving = false;
    state.partsChoice = '';
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (err) {}
    render();
  }).catch(function (err) {
    state.saving = false;
    state.mode = 'form';
    state.error = err && err.message ? err.message : 'The review was not saved. Your answers are still here.';
    render();
  });
}

function startAnother() {
  state.mode = 'form';
  state.submissionId = createSubmissionId();
  state.label = '';
  state.owner = '';
  state.department = '';
  state.departmentOther = '';
  state.dueDate = '';
  state.permit = '';
  state.assessment = '';
  state.error = '';
  state.fieldErrors = {};
  state.maintenanceId = '';
  state.dueOn = '';
  state.partsChoice = '';
  state.saving = false;
  persist();
  render();
}

function loadLists() {
  state.listsLoading = true;
  state.listsError = '';
  state.error = '';
  render();
  fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'review_lists' })
  }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      if (!response.ok || !body || body.result !== 'ok' || !Array.isArray(body.requests) || !Array.isArray(body.owners)) {
        throw new Error((body && body.message) || 'The maintenance requests could not be loaded.');
      }
      return body;
    });
  }).then(function (body) {
    state.requests = body.requests;
    state.owners = body.owners;
    if (state.label && !selectedRequest()) state.label = '';
    if (state.owner && state.owners.indexOf(state.owner) === -1) state.owner = '';
    state.listsLoading = false;
    render();
  }).catch(function (err) {
    state.listsLoading = false;
    state.listsError = err && err.message ? err.message : 'The maintenance requests could not be loaded.';
    render();
  });
}

restoreDraft();
loadLists();
