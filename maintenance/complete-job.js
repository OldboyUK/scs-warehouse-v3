var app = document.getElementById('app');

var SCRIPT_URL = '/.netlify/functions/completeJob';
var PHOTO_URL = '/.netlify/functions/completeJobPhoto';
var DRAFT_KEY = 'scs_complete_job_draft';
var MAX_PHOTOS = 10;

var state = {
  requests: [],
  label: '',
  orders: [],
  permit: '',
  workUndertaken: '',
  workOutstanding: '',
  completed: '',
  outcome: '',
  outcomeOther: '',
  photos: [],
  photoSeq: 0,
  submissionId: '',
  mode: 'form',
  folderUrl: '',
  listsLoading: true,
  listsError: '',
  detailLoading: false,
  detailError: '',
  saving: false,
  progress: '',
  error: '',
  fieldErrors: {}
};

var openParts = {};
var detailToken = 0;
var loadedLabel = '';

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
    state.permit = String(draft.permit || '');
    state.workUndertaken = String(draft.workUndertaken || '');
    state.workOutstanding = String(draft.workOutstanding || '');
    state.completed = draft.completed === 'Yes' || draft.completed === 'No' ? draft.completed : '';
    state.outcome = draft.outcome === 'Close Job' || draft.outcome === 'Other' ? draft.outcome : '';
    state.outcomeOther = String(draft.outcomeOther || '');
    loadedLabel = state.label;
  } catch (err) {}
}

function persist() {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      submissionId: state.submissionId,
      label: state.label,
      permit: state.permit,
      workUndertaken: state.workUndertaken,
      workOutstanding: state.workOutstanding,
      completed: state.completed,
      outcome: state.outcome,
      outcomeOther: state.outcomeOther
    }));
  } catch (err) {}
}

function bannerHtml() {
  if (!state.error) return '';
  return '<div class="fault-banner" role="alert">' + escapeHTML(state.error) + '</div>';
}

function fieldError(key) {
  if (!state.fieldErrors[key]) return '';
  return '<p class="fault-error" id="' + key + '-error">' + escapeHTML(state.fieldErrors[key]) + '</p>';
}

function invalidClass(key) {
  return state.fieldErrors[key] ? ' fault-invalid' : '';
}

function describedBy(key) {
  return state.fieldErrors[key] ? ' aria-invalid="true" aria-describedby="' + key + '-error"' : '';
}

function statusTone(status) {
  if (status === 'As Described') return 'parts-status-ok';
  if (status === 'Purchased Wrong Item' || status === 'Received Wrong Item') return 'parts-status-warn';
  if (status === 'Arrived Broken') return 'parts-status-bad';
  return '';
}

function receiptRecorded(order) {
  return !!(String(order.status || '').trim() || String(order.dateArrived || '').trim() || String(order.receivedBy || '').trim() || String(order.checkedBy || '').trim());
}

function isCollapsed(order) {
  if (Object.prototype.hasOwnProperty.call(openParts, order.partId)) return !openParts[order.partId];
  return receiptRecorded(order);
}

function choiceButton(group, value, label) {
  var pressed = state[group] === value;
  return '<button type="button" class="btn fault-choice" data-' + group + '="' + escapeHTML(value) + '" aria-pressed="' + (pressed ? 'true' : 'false') + '"' +
    (state.saving || state.detailLoading ? ' disabled' : '') + '>' + escapeHTML(label || value) + '</button>';
}

function render() {
  if (state.mode === 'success') {
    renderSuccess();
    return;
  }
  if (state.listsLoading) {
    app.innerHTML = '<p class="status" role="status">Loading maintenance jobs…</p>';
    return;
  }
  if (state.listsError) {
    app.innerHTML = bannerHtml() +
      '<p class="fault-intro">' + escapeHTML(state.listsError) + '</p>' +
      '<div class="actions"><button type="button" class="btn btn-primary" id="retryLists">Try again</button></div>';
    document.getElementById('retryLists').addEventListener('click', loadJobs);
    return;
  }
  app.innerHTML = renderForm();
  wire();
}

function renderForm() {
  var disabled = state.saving || state.detailLoading ? ' disabled' : '';
  var options = '<option value="">Select a maintenance job…</option>';
  var known = false;
  for (var i = 0; i < state.requests.length; i++) {
    var request = state.requests[i];
    if (request.label === state.label) known = true;
    options += '<option value="' + escapeHTML(request.label) + '"' + (request.label === state.label ? ' selected' : '') + '>' + escapeHTML(request.label) + '</option>';
  }
  if (state.label && !known) options += '<option value="' + escapeHTML(state.label) + '" selected>' + escapeHTML(state.label) + '</option>';
  var selected = selectedRequest();
  var selectedLine = '';
  if (selected && selected.duplicate) {
    selectedLine = '<p class="fault-error" id="request-error">That job appears more than once, so it cannot be updated.</p>';
  } else if (selected) {
    selectedLine = '<p class="review-count">This update is for <strong>' + escapeHTML(selected.label) + '</strong>. It does not create a new maintenance ID.</p>';
  }
  var outcomeOther = '';
  if (state.outcome === 'Other') {
    outcomeOther = '<label class="fault-question" for="outcomeOther">Explain the other outcome <span class="fault-req">Required</span></label>' +
      '<input id="outcomeOther" type="text" maxlength="8000" value="' + escapeHTML(state.outcomeOther) + '" class="' + invalidClass('outcomeOther') + '"' + describedBy('outcomeOther') + disabled + ' />' +
      fieldError('outcomeOther');
  }
  return bannerHtml() +
    '<form id="completeForm" novalidate>' +
      '<p class="fault-intro">Record the work on an existing maintenance job. This does not create a new maintenance ID and does not change the parts already ordered.</p>' +
      '<label class="fault-question" for="request">Please select job <span class="fault-req">Required</span></label>' +
      '<select id="request" class="' + invalidClass('request') + '"' + describedBy('request') + disabled + '>' + options + '</select>' +
      fieldError('request') +
      selectedLine +
      renderOrders() +
      '<label class="fault-question" for="permit">Please enter the Permit to Work number</label>' +
      '<input id="permit" type="text" maxlength="200" value="' + escapeHTML(state.permit) + '" class="' + invalidClass('permit') + '"' + describedBy('permit') + disabled + ' autocomplete="off" />' +
      fieldError('permit') +
      '<label class="fault-question" for="workUndertaken">Work Undertaken</label>' +
      '<textarea id="workUndertaken" rows="8" class="' + invalidClass('workUndertaken') + '"' + describedBy('workUndertaken') + disabled + '>' + escapeHTML(state.workUndertaken) + '</textarea>' +
      fieldError('workUndertaken') +
      '<label class="fault-question" for="workOutstanding">Work Outstanding</label>' +
      '<textarea id="workOutstanding" rows="8" class="' + invalidClass('workOutstanding') + '"' + describedBy('workOutstanding') + disabled + '>' + escapeHTML(state.workOutstanding) + '</textarea>' +
      '<p class="fault-hint">A job can still be closed when work is outstanding.</p>' +
      fieldError('workOutstanding') +
      '<p class="fault-question" id="completedLabel">Has the job been completed? <span class="fault-req">Required</span></p>' +
      '<div class="fault-choices" role="group" aria-labelledby="completedLabel">' +
        choiceButton('completed', 'Yes') +
        choiceButton('completed', 'No') +
      '</div>' +
      fieldError('completed') +
      '<p class="fault-question" id="outcomeLabel">Close Job / Other <span class="fault-req">Required</span></p>' +
      '<div class="fault-choices" role="group" aria-labelledby="outcomeLabel">' +
        choiceButton('outcome', 'Close Job') +
        choiceButton('outcome', 'Other') +
      '</div>' +
      fieldError('outcome') +
      outcomeOther +
      '<p class="fault-question" id="photoLabel">Add Photos</p>' +
      '<div class="fault-photos">' + photoCards() + '</div>' +
      '<input id="photoInput" class="fault-photo-input" type="file" accept="image/*" multiple tabindex="-1"' + disabled + ' />' +
      '<button type="button" class="btn fault-photo" id="photoBtn"' + disabled + '>Add Photos</button>' +
      '<p class="fault-photo-note">Photographs of the work undertaken. They are saved in this job’s Work Undertaken folder.</p>' +
      fieldError('photos') +
      '<div class="actions">' +
        '<button type="submit" class="btn btn-primary btn-block" id="submitBtn"' + disabled + '>' +
          (state.saving ? 'Saving…' : 'Save job') +
        '</button>' +
      '</div>' +
      (state.progress ? '<p class="status" role="status">' + escapeHTML(state.progress) + '</p>' : '') +
    '</form>';
}

function renderOrders() {
  var html = '<section class="parts-orders"><h2>Ordered Parts</h2>';
  if (!state.label) {
    return html + '<p class="fault-hint">Select a job to see the parts ordered for it.</p></section>';
  }
  if (state.detailLoading && !state.orders.length) {
    return html + '<p class="status" role="status">Loading ordered parts…</p></section>';
  }
  if (state.detailError) {
    return html + '<p class="fault-error">' + escapeHTML(state.detailError) + '</p>' +
      '<button type="button" class="btn btn-secondary" id="retryDetail">Try again</button></section>';
  }
  if (!state.orders.length) {
    return html + '<p class="fault-hint">No parts have been recorded against this maintenance job yet.</p></section>';
  }
  for (var i = 0; i < state.orders.length; i++) html += renderOrder(state.orders[i]);
  return html + '</section>';
}

function renderOrder(order) {
  var tone = statusTone(order.status);
  var disabled = state.saving ? ' disabled' : '';
  if (isCollapsed(order)) {
    return '<article class="parts-card parts-collapsed ' + tone + '">' +
      '<div class="parts-card-head">' +
        '<div>' +
          '<h3>' + escapeHTML(order.partId) + '</h3>' +
          '<p class="parts-summary">' + escapeHTML(order.name || 'Unnamed part') +
            (order.status ? ' · ' + escapeHTML(order.status) : '') +
          '</p>' +
        '</div>' +
        '<button type="button" class="btn btn-secondary parts-expand" data-expand="' + escapeHTML(order.partId) + '"' + disabled + '>Show</button>' +
      '</div>' +
      '</article>';
  }
  var ordered = order.dateOrderedUk || '';
  var arrived = order.dateArrivedUk || '';
  return '<article class="parts-card ' + tone + '">' +
    '<div class="parts-card-head"><h3>' + escapeHTML(order.partId) + '</h3>' +
      '<button type="button" class="btn btn-secondary parts-expand" data-collapse="' + escapeHTML(order.partId) + '"' + disabled + '>Hide</button>' +
    '</div>' +
    '<p class="parts-meta"><strong>' + escapeHTML(order.name || 'Unnamed part') + '</strong><br />' +
      'Purchaser: ' + escapeHTML(order.purchaser || '—') + '<br />' +
      'Supplier: ' + escapeHTML(order.supplier || '—') +
      (ordered ? '<br />Date ordered: ' + escapeHTML(ordered) : '') +
      (arrived ? '<br />Date arrived: ' + escapeHTML(arrived) : '') +
      (order.receivedBy ? '<br />Received by: ' + escapeHTML(order.receivedBy) : '') +
      (order.checkedBy ? '<br />Checked by: ' + escapeHTML(order.checkedBy) : '') +
      (order.status ? '<br />Receipt status: ' + escapeHTML(order.status) : '') +
    '</p>' +
    '</article>';
}

function photoCards() {
  var html = '';
  for (var i = 0; i < state.photos.length; i++) {
    var photo = state.photos[i];
    html += '<figure class="fault-photo-card">' +
      '<img src="' + escapeHTML(photo.dataUrl) + '" alt="Selected photograph ' + (i + 1) + '" />' +
      '<figcaption>' + escapeHTML(photo.fileName) + '</figcaption>' +
      '<button type="button" class="btn fault-photo-remove" data-remove-photo="' + escapeHTML(photo.id) + '"' + (state.saving ? ' disabled' : '') + '>Remove</button>' +
      '</figure>';
  }
  return html;
}

function renderSuccess() {
  var photoNote = state.photos.length
    ? ' The photographs are in the Work Undertaken folder.'
    : '';
  app.innerHTML = UI.successScreen(
    'Job updated',
    'Updated <span class="fault-id">' + escapeHTML(state.label || idFromLabel(state.label)) + '</span>.' + escapeHTML(photoNote),
    '<a class="btn btn-primary" href="index.html">Back to Maintenance</a>' +
    '<button type="button" class="btn btn-secondary" id="anotherBtn">Complete another job</button>'
  );
  document.getElementById('anotherBtn').addEventListener('click', startAnother);
}

function wire() {
  var form = document.getElementById('completeForm');
  if (!form) return;
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submitJob();
  });
  document.getElementById('request').addEventListener('change', function (event) {
    if (state.saving) return;
    var nextLabel = event.target.value;
    if (nextLabel !== state.label) {
      state.permit = '';
      state.workUndertaken = '';
      state.workOutstanding = '';
      state.completed = '';
      state.outcome = '';
      state.outcomeOther = '';
      loadedLabel = '';
    }
    state.label = nextLabel;
    delete state.fieldErrors.request;
    state.error = '';
    openParts = {};
    persist();
    render();
    loadDetail();
  });
  bindText('permit', 'permit');
  bindText('workUndertaken', 'workUndertaken');
  bindText('workOutstanding', 'workOutstanding');
  bindText('outcomeOther', 'outcomeOther');
  bindChoice('completed');
  bindChoice('outcome');
  var retry = document.getElementById('retryDetail');
  if (retry) retry.addEventListener('click', loadDetail);
  var photoBtn = document.getElementById('photoBtn');
  var photoInput = document.getElementById('photoInput');
  if (photoBtn && photoInput) {
    photoBtn.addEventListener('click', function () {
      if (!state.saving) photoInput.click();
    });
    photoInput.addEventListener('change', function () {
      addPhotos(photoInput.files);
      photoInput.value = '';
    });
  }
  var removeButtons = form.querySelectorAll('[data-remove-photo]');
  for (var r = 0; r < removeButtons.length; r++) {
    removeButtons[r].addEventListener('click', function (event) {
      if (state.saving) return;
      removePhoto(event.currentTarget.getAttribute('data-remove-photo'));
    });
  }
  var expanders = form.querySelectorAll('[data-expand]');
  for (var x = 0; x < expanders.length; x++) {
    expanders[x].addEventListener('click', function (event) {
      if (state.saving) return;
      openParts[event.currentTarget.getAttribute('data-expand')] = true;
      render();
    });
  }
  var hiders = form.querySelectorAll('[data-collapse]');
  for (var h = 0; h < hiders.length; h++) {
    hiders[h].addEventListener('click', function (event) {
      if (state.saving) return;
      openParts[event.currentTarget.getAttribute('data-collapse')] = false;
      render();
    });
  }
}

function bindText(id, key) {
  var el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', function () {
    if (state.saving) return;
    state[key] = el.value;
    delete state.fieldErrors[key];
    state.error = '';
    persist();
  });
}

function bindChoice(group) {
  var buttons = document.querySelectorAll('[data-' + group + ']');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', function (event) {
      if (state.saving || state.detailLoading) return;
      state[group] = event.currentTarget.getAttribute('data-' + group);
      delete state.fieldErrors[group];
      if (group === 'outcome') delete state.fieldErrors.outcomeOther;
      state.error = '';
      persist();
      render();
    });
  }
}

function readFields() {
  ['permit', 'workUndertaken', 'workOutstanding', 'outcomeOther'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) state[id] = el.value;
  });
}

function applyCompletion(completion) {
  completion = completion || {};
  state.permit = String(completion.permit || '');
  state.workUndertaken = String(completion.workUndertaken || '');
  state.workOutstanding = String(completion.workOutstanding || '');
  state.completed = completion.completed === 'Yes' || completion.completed === 'No' ? completion.completed : '';
  state.outcome = completion.outcome === 'Close Job' || completion.outcome === 'Other' ? completion.outcome : '';
  state.outcomeOther = String(completion.outcomeOther || '');
}

function clientError() {
  var fields = {};
  function fail(name, message) {
    if (!fields[name]) fields[name] = message;
  }
  var selected = selectedRequest();
  if (!state.label || !idFromLabel(state.label)) fail('request', 'Select a maintenance job.');
  else if (!selected) fail('request', 'Select a maintenance job from the list.');
  else if (selected.duplicate) fail('request', 'That job appears more than once, so it cannot be updated.');
  if (state.permit.trim().length > 200) fail('permit', 'The permit number is too long.');
  if (state.completed !== 'Yes' && state.completed !== 'No') fail('completed', 'Choose whether the job has been completed.');
  if (state.outcome !== 'Close Job' && state.outcome !== 'Other') fail('outcome', 'Choose Close Job or Other.');
  else if (state.outcome === 'Other' && !state.outcomeOther.trim()) fail('outcomeOther', 'Explain the other outcome.');
  if (state.photos.length > MAX_PHOTOS) fail('photos', 'You can attach up to 10 photographs.');
  var names = Object.keys(fields);
  if (!names.length) return null;
  return { message: fields[names[0]], fields: fields };
}

function payload() {
  return {
    action: 'complete_prepare',
    submissionId: state.submissionId,
    label: state.label,
    maintenanceId: idFromLabel(state.label),
    permit: state.permit.trim(),
    workUndertaken: state.workUndertaken,
    workOutstanding: state.workOutstanding,
    completed: state.completed,
    outcome: state.outcome,
    outcomeOther: state.outcomeOther,
    photoNames: state.photos.map(function (photo) { return photo.fileName; })
  };
}

async function postJson(url, body) {
  var response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  var text = await response.text();
  try { return JSON.parse(text); } catch (err) { return null; }
}

async function submitJob() {
  if (state.saving || state.mode === 'success' || state.detailLoading) return;
  readFields();
  persist();
  var problem = clientError();
  if (problem) {
    state.error = problem.message;
    state.fieldErrors = problem.fields;
    state.progress = '';
    render();
    var invalid = document.querySelector('.fault-invalid');
    if (invalid && invalid.focus) invalid.focus();
    return;
  }
  var body = payload();
  state.saving = true;
  state.progress = state.photos.length ? 'Preparing the work folder…' : 'Saving the job…';
  state.error = '';
  state.fieldErrors = {};
  render();
  try {
    var prepared = await postJson(SCRIPT_URL, body);
    if (!prepared || (prepared.result !== 'pending' && prepared.result !== 'success')) {
      throw new Error((prepared && prepared.message) || 'The job was not saved. Your answers are still here.');
    }
    if (prepared.result === 'pending') {
      for (var i = 0; i < state.photos.length; i++) {
        state.progress = 'Uploading photograph ' + (i + 1) + ' of ' + state.photos.length + '…';
        render();
        var uploaded = await postJson(PHOTO_URL, {
          submissionId: state.submissionId,
          fileName: state.photos[i].fileName,
          imageBase64: state.photos[i].dataUrl
        });
        if (!uploaded || uploaded.result !== 'ok') {
          throw new Error((uploaded && uploaded.message) || 'The photograph was not uploaded. Your answers are still here.');
        }
      }
      state.progress = 'Saving the job…';
      render();
      var committed = await postJson(SCRIPT_URL, Object.assign({}, body, { action: 'complete_commit' }));
      if (!committed || committed.result !== 'success') {
        throw new Error((committed && committed.message) || 'The job was not saved. Your answers are still here.');
      }
      prepared = committed;
    }
    state.folderUrl = prepared.folderUrl || '';
    state.mode = 'success';
    state.saving = false;
    state.progress = '';
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (err) {}
    render();
  } catch (err) {
    state.saving = false;
    state.progress = '';
    state.error = err && err.message ? err.message : 'The job was not saved. Your answers are still here.';
    render();
  }
}

function nextPhotoName() {
  state.photoSeq += 1;
  var n = String(state.photoSeq);
  if (n.length < 2) n = '0' + n;
  return 'work-' + n + '.jpg';
}

function removePhoto(id) {
  var kept = [];
  for (var i = 0; i < state.photos.length; i++) {
    if (state.photos[i].id !== id) kept.push(state.photos[i]);
  }
  state.photos = kept;
  delete state.fieldErrors.photos;
  state.error = '';
  render();
}

function compressImageFile(file) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var max = 1920;
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      if (w > max || h > max) {
        var scale = Math.min(max / w, max / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error('Could not process the selected image.'));
    };
    img.src = url;
  });
}

async function addPhotos(fileList) {
  var files = [];
  for (var i = 0; fileList && i < fileList.length; i++) files.push(fileList[i]);
  if (!files.length || state.saving) return;
  var room = MAX_PHOTOS - state.photos.length;
  if (room <= 0) {
    state.error = 'You can attach up to 10 photographs.';
    render();
    return;
  }
  if (files.length > room) {
    state.error = 'You can attach up to 10 photographs. Extra photographs were not added.';
    files = files.slice(0, room);
  } else {
    state.error = '';
  }
  for (var n = 0; n < files.length; n++) {
    try {
      var dataUrl = await compressImageFile(files[n]);
      var name = nextPhotoName();
      state.photos.push({ id: name, fileName: name, dataUrl: dataUrl });
    } catch (err) {
      state.error = 'A photograph could not be prepared. Use a JPEG or PNG. Your other answers are still here.';
    }
  }
  delete state.fieldErrors.photos;
  render();
}

async function loadJobs() {
  state.listsLoading = true;
  state.listsError = '';
  state.error = '';
  render();
  try {
    var body = await postJson(SCRIPT_URL, { action: 'complete_jobs' });
    if (!body || body.result !== 'ok' || !Array.isArray(body.requests)) {
      throw new Error((body && body.message) || 'The maintenance jobs could not be loaded.');
    }
    state.requests = body.requests;
    state.listsLoading = false;
    render();
    if (state.label) loadDetail();
  } catch (err) {
    state.listsLoading = false;
    state.listsError = err && err.message ? err.message : 'The maintenance jobs could not be loaded.';
    state.error = state.listsError;
    render();
  }
}

async function loadDetail() {
  var request = selectedRequest();
  var token = ++detailToken;
  if (!request || request.duplicate || !idFromLabel(request.label)) {
    state.orders = [];
    state.detailLoading = false;
    state.detailError = '';
    if (request && request.duplicate) state.detailError = 'That job appears more than once, so its parts were not loaded.';
    render();
    return;
  }
  var keepDraft = loadedLabel === request.label;
  state.detailLoading = true;
  state.detailError = '';
  render();
  try {
    var body = await postJson(SCRIPT_URL, {
      action: 'complete_detail',
      label: request.label,
      maintenanceId: idFromLabel(request.label)
    });
    if (token !== detailToken) return;
    if (!body || body.result !== 'ok' || !Array.isArray(body.orders)) {
      throw new Error((body && body.message) || 'The job could not be loaded.');
    }
    state.orders = body.orders;
    state.detailLoading = false;
    if (!keepDraft) {
      applyCompletion(body.completion);
      loadedLabel = request.label;
      persist();
    }
    render();
  } catch (err) {
    if (token !== detailToken) return;
    state.detailLoading = false;
    state.orders = [];
    state.detailError = err && err.message ? err.message : 'The job could not be loaded.';
    render();
  }
}

function startAnother() {
  state.mode = 'form';
  state.submissionId = createSubmissionId();
  state.label = '';
  state.orders = [];
  state.permit = '';
  state.workUndertaken = '';
  state.workOutstanding = '';
  state.completed = '';
  state.outcome = '';
  state.outcomeOther = '';
  state.photos = [];
  state.photoSeq = 0;
  state.folderUrl = '';
  state.error = '';
  state.fieldErrors = {};
  state.progress = '';
  state.detailError = '';
  openParts = {};
  loadedLabel = '';
  persist();
  render();
}

restoreDraft();
loadJobs();
