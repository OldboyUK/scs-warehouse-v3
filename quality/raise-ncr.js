var app = document.getElementById('app');

var PRIORITIES = ['Low', 'Medium', 'High'];
var PEOPLE = ['Zoe Ibbotson', 'Tom Ebdon', 'Angus Sales'];
var CATEGORIES = [
  'Finished Product',
  'Ingredients',
  'Packaging',
  'Pre-Packaged Liquid',
  'Internal Process or Procedure'
];
var NCR_RE = /^NCR\d{2}-\d{3}$/;
var DRAFT_KEY = 'scs_ncr_draft';
var SECTION2_KEY = 'scs_ncr_section2_draft';
var RESUME_KEY = 'scs_ncr_resume';

var state = {
  mode: 'section1',
  submissionId: '',
  ncrNumber: '',
  submittedOn: '',
  saving: false,
  dirty: false,
  leaving: false,
  loading: false,
  error: '',
  notice: '',
  fieldErrors: {},
  priority: '',
  reporter: '',
  category: '',
  batches: [''],
  description: '',
  involved: '',
  happened: '',
  whenOccurred: '',
  whereOccurred: '',
  why: '',
  remedial: '',
  findings: '',
  correctiveActions: '',
  correctiveDue: '',
  correctiveComplete: '',
  rootCause: '',
  preventativeActions: '',
  preventativeDue: '',
  preventativeComplete: '',
  ncrCompleted: '',
  completedBy: '',
  report: null
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

function readJson(key) {
  try {
    var raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function writeJson(key, value) {
  sessionStorage.setItem(key, JSON.stringify(value));
}

function optionsHtml(list, selected, placeholder) {
  var html = '<option value="">' + escapeHTML(placeholder) + '</option>';
  for (var i = 0; i < list.length; i++) {
    html += '<option value="' + escapeHTML(list[i]) + '"' + (list[i] === selected ? ' selected' : '') + '>' + escapeHTML(list[i]) + '</option>';
  }
  return html;
}

function fieldError(name) {
  if (!state.fieldErrors[name]) return '';
  return '<p class="ncr-error" id="' + name + '-error">' + escapeHTML(state.fieldErrors[name]) + '</p>';
}

function invalidClass(name) {
  return state.fieldErrors[name] ? ' ncr-invalid' : '';
}

function describedBy(name) {
  return state.fieldErrors[name] ? ' aria-invalid="true" aria-describedby="' + name + '-error"' : '';
}

function bannerHtml() {
  var html = '';
  if (state.error) html += '<div class="ncr-banner" role="alert">' + escapeHTML(state.error) + '</div>';
  if (state.notice) html += '<div class="ncr-notice" role="status">' + escapeHTML(state.notice) + '</div>';
  return html;
}

function resumeHtml() {
  var resume = readJson(RESUME_KEY);
  if (!resume || !NCR_RE.test(resume.ncrNumber || '')) return '';
  return '<div class="ncr-notice">' +
    '<p style="margin:0 0 12px;">' + escapeHTML(resume.ncrNumber) + ' is saved. Open it to continue the investigation.</p>' +
    '<a class="btn btn-secondary" href="raise-ncr.html?ncr=' + encodeURIComponent(resume.ncrNumber) + '">Continue investigation</a>' +
    '</div>';
}

function render() {
  if (state.mode === 'section2' || state.mode === 'opening') {
    document.title = 'Section 2 — SCS Quality';
  } else {
    document.title = 'Section 1 — SCS Quality';
  }

  if (state.mode === 'success') {
    app.innerHTML = UI.successScreen(
      'Report saved',
      escapeHTML(state.ncrNumber) + ' was saved' + (state.submittedOn ? ' on ' + escapeHTML(state.submittedOn) : '') + '. Section 2 has not been opened.',
      '<a class="btn btn-primary" href="index.html">Back to Quality</a>' +
      '<a class="btn btn-secondary" href="raise-ncr.html?ncr=' + encodeURIComponent(state.ncrNumber) + '">Investigate this NCR</a>'
    );
    return;
  }

  if (state.mode === 'section2-success') {
    app.innerHTML = UI.successScreen(
      'Investigation saved',
      escapeHTML(state.ncrNumber) + ' was updated. You can open it again later and continue.',
      '<a class="btn btn-primary" href="index.html">Back to Quality</a>' +
      '<a class="btn btn-secondary" href="raise-ncr.html?ncr=' + encodeURIComponent(state.ncrNumber) + '">Return to this NCR</a>'
    );
    return;
  }

  if (state.mode === 'opening') {
    app.innerHTML = bannerHtml() +
      '<h2 class="ncr-title">Section 2: Investigation (to be completed by Manager)</h2>' +
      '<p class="ncr-id">' + escapeHTML(state.ncrNumber) + '</p>' +
      '<p class="ncr-intro">Section 1 is saved. Opening the investigation for this NCR.</p>' +
      '<a class="btn btn-primary" href="raise-ncr.html?ncr=' + encodeURIComponent(state.ncrNumber) + '">Open Section 2</a>';
    return;
  }

  if (state.mode === 'section2') {
    app.innerHTML = renderSection2();
    wireSection2();
    return;
  }

  app.innerHTML = renderSection1();
  wireSection1();
}

function renderSection1() {
  var batches = '';
  for (var i = 0; i < state.batches.length; i++) {
    batches += '<div class="ncr-batch-row">' +
      '<input id="batch-' + i + '" data-batch="' + i + '" type="text" value="' + escapeHTML(state.batches[i]) + '" class="' + invalidClass('batch' + i) + '" autocomplete="off"' + (i === 0 ? '' : ' aria-label="Additional batch number"') + describedBy('batch' + i) + ' />' +
      (i > 0 ? '<button type="button" class="btn btn-ghost" data-remove-batch="' + i + '">Remove</button>' : '') +
      '</div>' + fieldError('batch' + i);
  }

  return bannerHtml() + resumeHtml() +
    '<form id="ncrForm" novalidate>' +
      '<section class="ncr-continue">' +
        '<h2 class="ncr-title">Continue an existing NCR</h2>' +
        '<p class="ncr-intro">Enter the NCR number to carry on with Section 2. This does not create a new report.</p>' +
        '<label for="continueNcr">NCR number</label>' +
        '<input id="continueNcr" type="text" inputmode="text" autocapitalize="characters" placeholder="NCR26-001" class="' + invalidClass('continueNcr') + '"' + describedBy('continueNcr') + ' />' +
        fieldError('continueNcr') +
        '<div class="actions"><button type="button" class="btn btn-secondary" id="openExistingBtn">Open NCR</button></div>' +
      '</section>' +
      '<h2 class="ncr-title">Section 1: Raising the Report (to be completed by reporter)</h2>' +
      '<p class="ncr-intro">Priority, reporter, issue category and description are required. The report is saved before Section 2 can open.</p>' +
      '<label for="priority">Select a priority <span class="ncr-req">Required</span></label>' +
      '<select id="priority" class="' + invalidClass('priority') + '"' + describedBy('priority') + '>' + optionsHtml(PRIORITIES, state.priority, 'Select…') + '</select>' +
      fieldError('priority') +
      '<label for="reporter">Reporter <span class="ncr-req">Required</span></label>' +
      '<select id="reporter" class="' + invalidClass('reporter') + '"' + describedBy('reporter') + '>' + optionsHtml(PEOPLE, state.reporter, 'Select…') + '</select>' +
      fieldError('reporter') +
      '<label for="category">Issue Category <span class="ncr-req">Required</span></label>' +
      '<select id="category" class="' + invalidClass('category') + '"' + describedBy('category') + '>' + optionsHtml(CATEGORIES, state.category, 'Select…') + '</select>' +
      fieldError('category') +
      '<label for="batch-0">Batch Numbers</label>' +
      batches +
      '<div class="actions"><button type="button" class="btn btn-secondary" id="addBatchBtn">Add Another</button></div>' +
      '<label for="description">Description of Issue <span class="ncr-req">Required</span></label>' +
      '<textarea id="description" rows="5" class="' + invalidClass('description') + '"' + describedBy('description') + '>' + escapeHTML(state.description) + '</textarea>' +
      fieldError('description') +
      '<label for="involved">Who was involved</label>' +
      '<textarea id="involved" rows="3">' + escapeHTML(state.involved) + '</textarea>' +
      '<label for="happened">What happened</label>' +
      '<textarea id="happened" rows="3">' + escapeHTML(state.happened) + '</textarea>' +
      '<label for="whenOccurred">When did it take place</label>' +
      '<textarea id="whenOccurred" rows="3">' + escapeHTML(state.whenOccurred) + '</textarea>' +
      '<label for="whereOccurred">Where did it take place</label>' +
      '<textarea id="whereOccurred" rows="3">' + escapeHTML(state.whereOccurred) + '</textarea>' +
      '<label for="why">Why did it happen</label>' +
      '<textarea id="why" rows="3">' + escapeHTML(state.why) + '</textarea>' +
      '<label for="remedial">Suggested Remedial Actions</label>' +
      '<textarea id="remedial" rows="4">' + escapeHTML(state.remedial) + '</textarea>' +
      '<p class="ncr-hint">Save and Exit stores the report and returns you to Quality. It does not open Section 2. Save and Proceed stores the report first, then opens Section 2 for the same NCR.</p>' +
      '<div class="actions ncr-actions">' +
        '<button type="button" class="btn btn-secondary" id="saveExitBtn"' + (state.saving ? ' disabled' : '') + '>' + (state.saving ? 'Saving…' : 'Save and Exit') + '</button>' +
        '<button type="button" class="btn btn-primary" id="saveProceedBtn"' + (state.saving ? ' disabled' : '') + '>' + (state.saving ? 'Saving…' : 'Save and Proceed to Section 2') + '</button>' +
      '</div>' +
      (state.saving ? '<p class="status" role="status">Saving the report…</p>' : '') +
    '</form>';
}

function summaryRow(label, value) {
  var shown = value ? escapeHTML(value) : '—';
  return '<div class="summary-row"><span class="summary-label">' + escapeHTML(label) + '</span><span class="summary-value">' + shown + '</span></div>';
}

function renderSection2() {
  if (state.loading) {
    return '<h2 class="ncr-title">Section 2: Investigation (to be completed by Manager)</h2>' +
      '<p class="ncr-id">' + escapeHTML(state.ncrNumber) + '</p>' +
      '<p class="status" role="status">Loading ' + escapeHTML(state.ncrNumber) + '…</p>';
  }
  if (state.error && !state.report) {
    return bannerHtml() +
      '<h2 class="ncr-title">Section 2: Investigation (to be completed by Manager)</h2>' +
      '<p class="ncr-id">' + escapeHTML(state.ncrNumber) + '</p>' +
      '<a class="btn btn-secondary" href="ncrs.html">Back to NCRs</a>';
  }

  var report = state.report || {};
  return bannerHtml() +
    '<form id="ncrForm" novalidate>' +
      '<h2 class="ncr-title">Section 2: Investigation (to be completed by Manager)</h2>' +
      '<p class="ncr-id">' + escapeHTML(state.ncrNumber) + '</p>' +
      '<p class="ncr-intro">Dates can be left blank until the work is done. Saving does not mark the NCR complete, and it does not create a new NCR.</p>' +
      '<div class="summary-card ncr-summary">' +
        summaryRow('Submitted', report.submittedOn) +
        summaryRow('Priority', report.priority) +
        summaryRow('Reporter', report.reporter) +
        summaryRow('Issue Category', report.category) +
        summaryRow('Batch Numbers', report.batchNumbers) +
        summaryRow('Description of Issue', report.description) +
      '</div>' +
      '<label for="findings">Findings of Investigation</label>' +
      '<textarea id="findings" rows="5">' + escapeHTML(state.findings) + '</textarea>' +
      '<fieldset class="ncr-fieldset">' +
        '<legend>Corrective Actions</legend>' +
        '<label for="correctiveActions">Corrective Actions</label>' +
        '<textarea id="correctiveActions" rows="4">' + escapeHTML(state.correctiveActions) + '</textarea>' +
        '<label for="correctiveDue">Due Date</label>' +
        '<input id="correctiveDue" type="date" value="' + escapeHTML(state.correctiveDue) + '" aria-label="Corrective action due date" class="' + invalidClass('correctiveDue') + '"' + describedBy('correctiveDue') + ' />' +
        fieldError('correctiveDue') +
        '<label for="correctiveComplete">Complete</label>' +
        '<input id="correctiveComplete" type="date" value="' + escapeHTML(state.correctiveComplete) + '" aria-label="Corrective action completed date" class="' + invalidClass('correctiveComplete') + '"' + describedBy('correctiveComplete') + ' />' +
        fieldError('correctiveComplete') +
      '</fieldset>' +
      '<label for="rootCause">Root Cause</label>' +
      '<textarea id="rootCause" rows="4">' + escapeHTML(state.rootCause) + '</textarea>' +
      '<fieldset class="ncr-fieldset">' +
        '<legend>Preventative Actions</legend>' +
        '<label for="preventativeActions">Preventative Actions</label>' +
        '<textarea id="preventativeActions" rows="4">' + escapeHTML(state.preventativeActions) + '</textarea>' +
        '<label for="preventativeDue">Due Date</label>' +
        '<input id="preventativeDue" type="date" value="' + escapeHTML(state.preventativeDue) + '" aria-label="Preventative action due date" class="' + invalidClass('preventativeDue') + '"' + describedBy('preventativeDue') + ' />' +
        fieldError('preventativeDue') +
        '<label for="preventativeComplete">Complete</label>' +
        '<input id="preventativeComplete" type="date" value="' + escapeHTML(state.preventativeComplete) + '" aria-label="Preventative action completed date" class="' + invalidClass('preventativeComplete') + '"' + describedBy('preventativeComplete') + ' />' +
        fieldError('preventativeComplete') +
      '</fieldset>' +
      '<label for="ncrCompleted">NCR Completed</label>' +
      '<input id="ncrCompleted" type="date" value="' + escapeHTML(state.ncrCompleted) + '" class="' + invalidClass('ncrCompleted') + '"' + describedBy('ncrCompleted') + ' />' +
      fieldError('ncrCompleted') +
      '<label for="completedBy">Completed By (Manager)</label>' +
      '<select id="completedBy" class="' + invalidClass('completedBy') + '"' + describedBy('completedBy') + '>' + optionsHtml(PEOPLE, state.completedBy, 'Select…') + '</select>' +
      fieldError('completedBy') +
      '<div class="actions ncr-actions">' +
        '<button type="button" class="btn btn-secondary" id="saveExitBtn"' + (state.saving ? ' disabled' : '') + '>' + (state.saving ? 'Saving…' : 'Save and Exit') + '</button>' +
        '<button type="button" class="btn btn-primary" id="saveProgressBtn"' + (state.saving ? ' disabled' : '') + '>' + (state.saving ? 'Saving…' : 'Save progress') + '</button>' +
      '</div>' +
      (state.saving ? '<p class="status" role="status">Saving the investigation…</p>' : '') +
    '</form>';
}

function wireSection1() {
  var form = document.getElementById('ncrForm');
  if (!form) return;
  form.addEventListener('submit', function (event) { event.preventDefault(); });
  form.addEventListener('input', function () {
    state.dirty = true;
    collectSection1();
    persistDraft();
  });
  form.addEventListener('change', function () {
    state.dirty = true;
    collectSection1();
    persistDraft();
  });
  document.getElementById('addBatchBtn').addEventListener('click', addBatch);
  document.getElementById('openExistingBtn').addEventListener('click', openExisting);
  document.getElementById('saveExitBtn').addEventListener('click', function () { saveSection1(false); });
  document.getElementById('saveProceedBtn').addEventListener('click', function () { saveSection1(true); });
  var removeButtons = document.querySelectorAll('[data-remove-batch]');
  for (var i = 0; i < removeButtons.length; i++) {
    removeButtons[i].addEventListener('click', function (event) {
      removeBatch(Number(event.currentTarget.getAttribute('data-remove-batch')));
    });
  }
}

function wireSection2() {
  var form = document.getElementById('ncrForm');
  if (!form) return;
  form.addEventListener('submit', function (event) { event.preventDefault(); });
  form.addEventListener('input', markSection2Dirty);
  form.addEventListener('change', markSection2Dirty);
  var exitBtn = document.getElementById('saveExitBtn');
  var progressBtn = document.getElementById('saveProgressBtn');
  if (exitBtn) exitBtn.addEventListener('click', function () { saveSection2(true); });
  if (progressBtn) progressBtn.addEventListener('click', function () { saveSection2(false); });
}

function markSection2Dirty() {
  state.dirty = true;
  collectSection2();
  writeJson(SECTION2_KEY, section2Draft());
}

function collectSection1() {
  state.priority = valueOf('priority');
  state.reporter = valueOf('reporter');
  state.category = valueOf('category');
  state.description = valueOf('description');
  state.involved = valueOf('involved');
  state.happened = valueOf('happened');
  state.whenOccurred = valueOf('whenOccurred');
  state.whereOccurred = valueOf('whereOccurred');
  state.why = valueOf('why');
  state.remedial = valueOf('remedial');
  var inputs = document.querySelectorAll('[data-batch]');
  var batches = [];
  for (var i = 0; i < inputs.length; i++) batches.push(inputs[i].value);
  state.batches = batches.length ? batches : [''];
}

function collectSection2() {
  state.findings = valueOf('findings');
  state.correctiveActions = valueOf('correctiveActions');
  state.correctiveDue = valueOf('correctiveDue');
  state.correctiveComplete = valueOf('correctiveComplete');
  state.rootCause = valueOf('rootCause');
  state.preventativeActions = valueOf('preventativeActions');
  state.preventativeDue = valueOf('preventativeDue');
  state.preventativeComplete = valueOf('preventativeComplete');
  state.ncrCompleted = valueOf('ncrCompleted');
  state.completedBy = valueOf('completedBy');
}

function valueOf(id) {
  var el = document.getElementById(id);
  return el ? el.value : '';
}

function persistDraft() {
  writeJson(DRAFT_KEY, {
    submissionId: state.submissionId,
    priority: state.priority,
    reporter: state.reporter,
    category: state.category,
    batches: state.batches,
    description: state.description,
    involved: state.involved,
    happened: state.happened,
    whenOccurred: state.whenOccurred,
    whereOccurred: state.whereOccurred,
    why: state.why,
    remedial: state.remedial
  });
}

function section2Draft() {
  return {
    ncrNumber: state.ncrNumber,
    dirty: true,
    findings: state.findings,
    correctiveActions: state.correctiveActions,
    correctiveDue: state.correctiveDue,
    correctiveComplete: state.correctiveComplete,
    rootCause: state.rootCause,
    preventativeActions: state.preventativeActions,
    preventativeDue: state.preventativeDue,
    preventativeComplete: state.preventativeComplete,
    ncrCompleted: state.ncrCompleted,
    completedBy: state.completedBy
  };
}

function applyDraft(draft) {
  state.submissionId = draft.submissionId;
  state.priority = draft.priority || '';
  state.reporter = draft.reporter || '';
  state.category = draft.category || '';
  state.batches = Array.isArray(draft.batches) && draft.batches.length ? draft.batches : [''];
  state.description = draft.description || '';
  state.involved = draft.involved || '';
  state.happened = draft.happened || '';
  state.whenOccurred = draft.whenOccurred || '';
  state.whereOccurred = draft.whereOccurred || '';
  state.why = draft.why || '';
  state.remedial = draft.remedial || '';
}

function validateSection1Client() {
  var errors = {};
  if (PRIORITIES.indexOf(state.priority) === -1) errors.priority = 'Select a priority.';
  if (PEOPLE.indexOf(state.reporter) === -1) errors.reporter = 'Select the reporter.';
  if (CATEGORIES.indexOf(state.category) === -1) errors.category = 'Select an issue category.';
  if (!String(state.description || '').trim()) errors.description = 'Describe the issue.';
  for (var i = 0; i < state.batches.length; i++) {
    if (String(state.batches[i] || '').indexOf(',') !== -1) {
      errors['batch' + i] = 'Enter one batch number in this field, without commas.';
    }
  }
  state.fieldErrors = errors;
  return Object.keys(errors).length === 0;
}

function validateSection2Client() {
  var errors = {};
  var dates = ['correctiveDue', 'correctiveComplete', 'preventativeDue', 'preventativeComplete', 'ncrCompleted'];
  for (var i = 0; i < dates.length; i++) {
    var value = state[dates[i]];
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errors[dates[i]] = 'Enter a valid date.';
  }
  if (state.completedBy && PEOPLE.indexOf(state.completedBy) === -1) {
    errors.completedBy = 'Select the manager who completed the NCR.';
  }
  state.fieldErrors = errors;
  return Object.keys(errors).length === 0;
}

function focusFirstError() {
  var el = document.querySelector('.ncr-invalid');
  if (!el) return;
  if (el.focus) el.focus();
  if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
}

function addBatch() {
  collectSection1();
  if (state.batches.length >= 30) return;
  state.batches.push('');
  state.dirty = true;
  persistDraft();
  render();
  var inputs = document.querySelectorAll('[data-batch]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function removeBatch(index) {
  collectSection1();
  if (index <= 0 || index >= state.batches.length) return;
  state.batches.splice(index, 1);
  state.dirty = true;
  persistDraft();
  render();
}

function openExisting() {
  collectSection1();
  persistDraft();
  var input = document.getElementById('continueNcr');
  var value = String(input ? input.value : '').trim().toUpperCase();
  if (!NCR_RE.test(value)) {
    state.fieldErrors = { continueNcr: 'Enter an NCR number such as NCR26-001.' };
    state.error = '';
    render();
    var again = document.getElementById('continueNcr');
    if (again) {
      again.value = value;
      again.focus();
    }
    return;
  }
  if (state.dirty && !window.confirm('Leave this report? Unsaved answers stay on this device until you save or clear them.')) return;
  state.leaving = true;
  window.location.href = 'raise-ncr.html?ncr=' + encodeURIComponent(value);
}

function section1Payload() {
  return {
    submissionId: state.submissionId,
    priority: state.priority,
    reporter: state.reporter,
    category: state.category,
    batches: state.batches.map(function (batch) { return String(batch || '').trim(); }),
    description: state.description,
    involved: state.involved,
    happened: state.happened,
    whenOccurred: state.whenOccurred,
    whereOccurred: state.whereOccurred,
    why: state.why,
    remedial: state.remedial
  };
}

function section2Payload() {
  return {
    ncrNumber: state.ncrNumber,
    findings: state.findings,
    correctiveActions: state.correctiveActions,
    correctiveDue: state.correctiveDue,
    correctiveComplete: state.correctiveComplete,
    rootCause: state.rootCause,
    preventativeActions: state.preventativeActions,
    preventativeDue: state.preventativeDue,
    preventativeComplete: state.preventativeComplete,
    ncrCompleted: state.ncrCompleted,
    completedBy: state.completedBy
  };
}

async function postJson(url, payload) {
  var response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  var data = null;
  try { data = await response.json(); } catch (err) { data = null; }
  return { response: response, data: data };
}

async function saveSection1(proceed) {
  if (state.saving) return;
  collectSection1();
  persistDraft();
  state.notice = '';
  if (!validateSection1Client()) {
    state.error = 'Complete the required fields before saving.';
    render();
    focusFirstError();
    return;
  }
  state.saving = true;
  state.error = '';
  state.fieldErrors = {};
  render();
  try {
    var result = await postJson('/.netlify/functions/submitNcr', section1Payload());
    var data = result.data;
    if (!data || data.result !== 'success' || !NCR_RE.test(data.ncrNumber || '')) {
      state.saving = false;
      state.error = (data && data.message) || 'The NCR was not saved. Your answers are still here.';
      render();
      return;
    }
    state.ncrNumber = data.ncrNumber;
    state.submittedOn = data.submittedOn || '';
    state.saving = false;
    state.dirty = false;
    state.error = '';
    sessionStorage.removeItem(DRAFT_KEY);
    writeJson(RESUME_KEY, { ncrNumber: data.ncrNumber, submittedOn: state.submittedOn });
    if (proceed) {
      state.mode = 'opening';
      state.leaving = true;
      render();
      window.location.href = 'raise-ncr.html?ncr=' + encodeURIComponent(data.ncrNumber);
      return;
    }
    state.mode = 'success';
    render();
  } catch (err) {
    state.saving = false;
    state.error = 'The NCR was not saved. Check your connection and try again. Your answers are still here.';
    render();
  }
}

async function saveSection2(exitAfter) {
  if (state.saving || !state.report) return;
  collectSection2();
  writeJson(SECTION2_KEY, section2Draft());
  state.notice = '';
  if (!validateSection2Client()) {
    state.error = 'Check the highlighted dates before saving.';
    render();
    focusFirstError();
    return;
  }
  state.saving = true;
  state.error = '';
  state.fieldErrors = {};
  render();
  try {
    var result = await postJson('/.netlify/functions/updateNcr', section2Payload());
    var data = result.data;
    if (!data || data.result !== 'success' || data.ncrNumber !== state.ncrNumber) {
      state.saving = false;
      state.error = (data && data.message) || 'The investigation was not saved. Your answers are still here.';
      render();
      return;
    }
    state.saving = false;
    state.dirty = false;
    state.error = '';
    sessionStorage.removeItem(SECTION2_KEY);
    if (exitAfter) {
      state.leaving = true;
      state.mode = 'section2-success';
      render();
      return;
    }
    state.notice = state.ncrNumber + ' was saved. You can keep working and save again.';
    render();
  } catch (err) {
    state.saving = false;
    state.error = 'The investigation was not saved. Check your connection and try again. Your answers are still here.';
    render();
  }
}

async function loadSection2() {
  state.loading = true;
  state.error = '';
  render();
  try {
    var result = await postJson('/.netlify/functions/getNcr', { ncrNumber: state.ncrNumber });
    var data = result.data;
    if (!data || data.result !== 'success' || data.ncrNumber !== state.ncrNumber) {
      state.loading = false;
      state.report = null;
      state.error = (data && data.message) || 'The NCR could not be loaded. Section 2 was not opened.';
      render();
      return;
    }
    state.report = data;
    state.findings = data.findings || '';
    state.correctiveActions = data.correctiveActions || '';
    state.correctiveDue = data.correctiveDue || '';
    state.correctiveComplete = data.correctiveComplete || '';
    state.rootCause = data.rootCause || '';
    state.preventativeActions = data.preventativeActions || '';
    state.preventativeDue = data.preventativeDue || '';
    state.preventativeComplete = data.preventativeComplete || '';
    state.ncrCompleted = data.ncrCompleted || '';
    state.completedBy = data.completedBy || '';
    var local = readJson(SECTION2_KEY);
    if (local && local.ncrNumber === state.ncrNumber && local.dirty) {
      state.findings = local.findings || '';
      state.correctiveActions = local.correctiveActions || '';
      state.correctiveDue = local.correctiveDue || '';
      state.correctiveComplete = local.correctiveComplete || '';
      state.rootCause = local.rootCause || '';
      state.preventativeActions = local.preventativeActions || '';
      state.preventativeDue = local.preventativeDue || '';
      state.preventativeComplete = local.preventativeComplete || '';
      state.ncrCompleted = local.ncrCompleted || '';
      state.completedBy = local.completedBy || '';
      state.dirty = true;
      state.notice = 'Unsaved investigation details were restored on this device.';
    }
    state.loading = false;
    render();
  } catch (err) {
    state.loading = false;
    state.report = null;
    state.error = 'The NCR could not be loaded. Check your connection and try again. Section 2 was not opened.';
    render();
  }
}

function init() {
  var params = new URLSearchParams(window.location.search);
  var requested = String(params.get('ncr') || '').trim().toUpperCase();
  if (NCR_RE.test(requested)) {
    state.mode = 'section2';
    state.ncrNumber = requested;
    loadSection2();
    return;
  }
  var draft = readJson(DRAFT_KEY);
  if (draft && draft.submissionId) applyDraft(draft);
  else state.submissionId = createSubmissionId();
  persistDraft();
  render();
}

window.addEventListener('beforeunload', function (event) {
  if (!state.dirty || state.leaving) return;
  event.preventDefault();
  event.returnValue = '';
});

document.addEventListener('click', function (event) {
  var link = event.target.closest ? event.target.closest('a') : null;
  if (!link || !state.dirty || state.leaving) return;
  if (!window.confirm('Leave this page? Unsaved answers stay on this device, but they are not in the NCR database until you save.')) {
    event.preventDefault();
  }
});

init();
