var app = document.getElementById('app');

var CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT9wb05WXLcP4IN6Dce9zaRWtPKpGgHKWsqo4ICB97Mpr3RTx8MMFidwWgSf6ulh_sJNgE_2XxX3N2D/pub?gid=1056635412&single=true&output=csv';
var SCRIPT_URL = '/.netlify/functions/submitFault';
var PHOTO_URL = '/.netlify/functions/uploadFaultPhoto';
var MAX_PHOTOS = 10;
var DRAFT_KEY = 'scs_fault_report_draft';
var OTHER = 'Other';
var PRIORITIES = [
  { value: 'High Priority', label: 'High Priority - Urgent Risk to Safety of People or Food' },
  { value: 'Medium Priority', label: 'Medium Priority - A condition which must be addressed as it is likely to worsen, but does not pose an immediate risk' },
  { value: 'Low Priority', label: 'Low Priority - A condition which must be improved, but is not urgent' },
  { value: 'Stock Request', label: 'Stock Request - Used for requesting spare parts' },
  { value: 'Unsure', label: 'Unsure - Please Allocate the Priority for Me' }
];

var state = {
  mode: 'form',
  submissionId: '',
  loggedInUser: (window.SCSAuth && SCSAuth.getUsername()) || '',
  reporterMode: '',
  otherOperator: '',
  area: '',
  areaOther: '',
  equipment: '',
  equipmentOther: '',
  priority: '',
  title: '',
  description: '',
  parts: '',
  maintenanceRequest: '',
  photos: [],
  photoSeq: 0,
  progress: '',
  lists: { operators: [], areas: [], equipmentByArea: {} },
  listsLoading: true,
  listsError: '',
  saving: false,
  error: '',
  fieldErrors: {},
  maintenanceId: '',
  submittedOn: ''
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

function parseCsv(text) {
  var input = String(text || '').replace(/^\uFEFF/, '');
  var rows = [];
  var row = [];
  var cur = '';
  var inQuotes = false;
  for (var i = 0; i < input.length; i++) {
    var ch = input.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (input.charAt(i + 1) === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (ch !== '\r') {
      cur += ch;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function listsFromCsv(text) {
  var rows = parseCsv(text);
  var operators = [];
  var areas = [];
  var equipmentByArea = {};
  var seenOperators = {};
  var seenAreas = {};
  var seenEquipment = {};
  for (var i = 1; i < rows.length; i++) {
    var record = rows[i] || [];
    var operator = String(record[0] == null ? '' : record[0]).trim();
    var area = String(record[1] == null ? '' : record[1]).trim();
    var equipment = String(record[2] == null ? '' : record[2]).trim();
    if (operator && !seenOperators[operator]) {
      seenOperators[operator] = true;
      operators.push(operator);
    }
    if (area && !seenAreas[area]) {
      seenAreas[area] = true;
      areas.push(area);
    }
    if (area && equipment) {
      var key = area + '\n' + equipment;
      if (!seenEquipment[key]) {
        seenEquipment[key] = true;
        if (!equipmentByArea[area]) equipmentByArea[area] = [];
        equipmentByArea[area].push(equipment);
      }
    }
  }
  return { operators: operators, areas: areas, equipmentByArea: equipmentByArea };
}

function restoreDraft() {
  state.submissionId = createSubmissionId();
  try {
    var raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    var draft = JSON.parse(raw);
    if (!draft || typeof draft !== 'object') return;
    if (draft.submissionId) state.submissionId = String(draft.submissionId);
    state.reporterMode = draft.reporterMode === 'self' || draft.reporterMode === 'other' ? draft.reporterMode : '';
    state.otherOperator = String(draft.otherOperator || '');
    state.area = String(draft.area || '');
    state.areaOther = String(draft.areaOther || '');
    state.equipment = String(draft.equipment || '');
    state.equipmentOther = String(draft.equipmentOther || '');
    state.priority = String(draft.priority || '');
    state.title = String(draft.title || '');
    state.description = String(draft.description || '');
    state.parts = String(draft.parts || '');
    state.maintenanceRequest = draft.maintenanceRequest === 'Yes' || draft.maintenanceRequest === 'No' ? draft.maintenanceRequest : '';
  } catch (err) {}
}

function persist() {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      submissionId: state.submissionId,
      reporterMode: state.reporterMode,
      otherOperator: state.otherOperator,
      area: state.area,
      areaOther: state.areaOther,
      equipment: state.equipment,
      equipmentOther: state.equipmentOther,
      priority: state.priority,
      title: state.title,
      description: state.description,
      parts: state.parts,
      maintenanceRequest: state.maintenanceRequest
    }));
  } catch (err) {}
}

function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch (err) {}
}

function equipmentChoices() {
  if (!state.area) return [];
  if (state.area === OTHER) return [OTHER];
  var list = (state.lists.equipmentByArea[state.area] || []).slice();
  if (list.indexOf(OTHER) === -1) list.push(OTHER);
  return list;
}

function areaChoices() {
  var list = state.lists.areas.slice();
  if (list.indexOf(OTHER) === -1) list.push(OTHER);
  return list;
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

function optionsHtml(list, selected, placeholder) {
  var html = '<option value="">' + escapeHTML(placeholder) + '</option>';
  for (var i = 0; i < list.length; i++) {
    html += '<option value="' + escapeHTML(list[i]) + '"' + (list[i] === selected ? ' selected' : '') + '>' + escapeHTML(list[i]) + '</option>';
  }
  return html;
}

function bannerHtml() {
  if (!state.error) return '';
  return '<div class="fault-banner" role="alert">' + escapeHTML(state.error) + '</div>';
}

function render() {
  if (state.mode === 'success') {
    app.innerHTML = UI.successScreen(
      'Fault report saved',
      '<span class="fault-id">' + escapeHTML(state.maintenanceId) + '</span> was saved' +
        (state.submittedOn ? ' on ' + escapeHTML(state.submittedOn) : '') +
        '. Its Drive folder is ready' +
        (state.photos.length ? ' and the photographs are in the Requests folder.' : '.'),
      '<a class="btn btn-primary" href="index.html">Back to Maintenance</a>' +
      '<button type="button" class="btn btn-secondary" id="anotherBtn">Submit another report</button>'
    );
    document.getElementById('anotherBtn').addEventListener('click', startAnother);
    return;
  }

  if (state.listsLoading) {
    app.innerHTML = '<p class="fault-intro">Please use this form for reporting faults or an unsafe condition with the machines or equipment</p>' +
      '<p class="status" role="status">Loading lines and equipment…</p>';
    return;
  }

  if (state.listsError) {
    app.innerHTML = bannerHtml() +
      '<p class="fault-intro">Please use this form for reporting faults or an unsafe condition with the machines or equipment</p>' +
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
  var operatorBlock = '';
  if (state.reporterMode === 'self') {
    operatorBlock = state.loggedInUser
      ? '<p class="fault-identity" id="reportingAs">Reporting as <strong>' + escapeHTML(state.loggedInUser) + '</strong></p>'
      : '<p class="fault-error" id="reporter-error">Your sign-in could not be read. Sign in again.</p>';
  } else if (state.reporterMode === 'other') {
    operatorBlock = '<label for="operator">Operator <span class="fault-req">Required</span></label>' +
      '<select id="operator" class="' + invalidClass('operator') + '"' + describedBy('operator') + disabled + '>' +
      optionsHtml(state.lists.operators, state.otherOperator, 'Select an operator…') +
      '</select>' + fieldError('operator');
  }

  var areaOther = '';
  if (state.area === OTHER) {
    areaOther = '<label for="areaOther">Operating line or area <span class="fault-req">Required</span></label>' +
      '<input id="areaOther" type="text" value="' + escapeHTML(state.areaOther) + '" class="' + invalidClass('areaOther') + '"' + describedBy('areaOther') + disabled + ' autocomplete="off" />' +
      fieldError('areaOther');
  }

  var equipmentDisabled = state.saving || !state.area;
  var equipmentOther = '';
  if (state.equipment === OTHER) {
    equipmentOther = '<label for="equipmentOther">Machine or equipment <span class="fault-req">Required</span></label>' +
      '<input id="equipmentOther" type="text" value="' + escapeHTML(state.equipmentOther) + '" class="' + invalidClass('equipmentOther') + '"' + describedBy('equipmentOther') + disabled + ' autocomplete="off" />' +
      fieldError('equipmentOther');
  }

  var priorityOptions = '<option value="">Select…</option>';
  for (var i = 0; i < PRIORITIES.length; i++) {
    var item = PRIORITIES[i];
    priorityOptions += '<option value="' + escapeHTML(item.value) + '"' + (state.priority === item.value ? ' selected' : '') + '>' + escapeHTML(item.label) + '</option>';
  }

  return bannerHtml() +
    '<form id="faultForm" novalidate>' +
      '<p class="fault-intro">Please use this form for reporting faults or an unsafe condition with the machines or equipment</p>' +
      '<p class="fault-question" id="reporterLabel">Are you reporting this on behalf of yourself or another operator? <span class="fault-req">Required</span></p>' +
      '<div class="fault-choices" role="group" aria-labelledby="reporterLabel">' +
        choiceButton('reporter', 'self', 'Self') +
        choiceButton('reporter', 'other', 'Another Operator') +
      '</div>' +
      fieldError('reporter') +
      operatorBlock +
      '<label class="fault-question" for="area">Please select the operating line or area where the machine or equipment can be found <span class="fault-req">Required</span></label>' +
      '<select id="area" class="' + invalidClass('area') + '"' + describedBy('area') + disabled + '>' +
        optionsHtml(areaChoices(), state.area, 'Select…') +
      '</select>' +
      fieldError('area') +
      areaOther +
      '<label class="fault-question" for="equipment">Please select the Machine or piece of equipment that is faulty or in an unsafe condition. <span class="fault-req">Required</span></label>' +
      '<select id="equipment" class="' + invalidClass('equipment') + '"' + describedBy('equipment') + (equipmentDisabled ? ' disabled' : '') + '>' +
        optionsHtml(equipmentChoices(), state.equipment, state.area ? 'Select…' : 'Select a line or area first') +
      '</select>' +
      fieldError('equipment') +
      equipmentOther +
      '<label class="fault-question" for="priority">Please select a priority <span class="fault-req">Required</span></label>' +
      '<select id="priority" class="' + invalidClass('priority') + '"' + describedBy('priority') + disabled + '>' + priorityOptions + '</select>' +
      fieldError('priority') +
      '<label class="fault-question" for="title">Please write a descriptive title for the fault or unsafe condition. This will be used to later in conjunction with Maintenance ID to quickly identify the job. <span class="fault-req">Required</span></label>' +
      '<input id="title" type="text" maxlength="200" value="' + escapeHTML(state.title) + '" class="' + invalidClass('title') + '"' + describedBy('title') + disabled + ' autocomplete="off" />' +
      fieldError('title') +
      '<label class="fault-question" for="description">Please write a description of the fault or unsafe condition <span class="fault-req">Required</span></label>' +
      '<textarea id="description" rows="6" class="' + invalidClass('description') + '"' + describedBy('description') + disabled + '>' + escapeHTML(state.description) + '</textarea>' +
      fieldError('description') +
      '<label class="fault-question" for="parts">Parts requested</label>' +
      '<textarea id="parts" rows="4"' + disabled + '>' + escapeHTML(state.parts) + '</textarea>' +
      '<p class="fault-hint">Leave this blank if no parts are required.</p>' +
      fieldError('parts') +
      '<p class="fault-question" id="requestLabel">Would you like to mark the job as completed or raise a maintenance request <span class="fault-req">Required</span></p>' +
      '<div class="fault-choices" role="group" aria-labelledby="requestLabel">' +
        choiceButton('maintenance', 'Yes', 'Raise Maintenance Request') +
        choiceButton('maintenance', 'No', 'Mark job as completed') +
      '</div>' +
      fieldError('maintenanceRequest') +
      '<p class="fault-question" id="photoLabel">Photographs of the fault or unsafe condition</p>' +
      '<div class="fault-photos">' + photoCards() + '</div>' +
      '<input id="photoInput" class="fault-photo-input" type="file" accept="image/*" multiple tabindex="-1"' + disabled + ' />' +
      '<button type="button" class="btn fault-photo" id="photoBtn"' + disabled + '>Add photographs</button>' +
      '<p class="fault-photo-note">You can add more than one. They are saved in this job’s Requests folder. The job folder is created even when there are no photographs.</p>' +
      fieldError('photos') +
      '<div class="actions">' +
        '<button type="submit" class="btn btn-primary btn-block" id="submitBtn"' + disabled + '>' +
          (state.saving ? 'Saving…' : 'Submit Fault Report') +
        '</button>' +
      '</div>' +
      (state.saving ? '<p class="status" role="status">' + escapeHTML(state.progress || 'Saving the fault report…') + '</p>' : '') +
    '</form>';
}

function choiceButton(group, value, label) {
  var pressed = group === 'reporter' ? state.reporterMode === value : state.maintenanceRequest === value;
  return '<button type="button" class="btn fault-choice" data-' + group + '="' + value + '" aria-pressed="' + (pressed ? 'true' : 'false') + '"' +
    (state.saving ? ' disabled' : '') + '>' + escapeHTML(label) + '</button>';
}

function wire() {
  var form = document.getElementById('faultForm');
  if (!form) return;
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submitReport();
  });

  var reporterButtons = form.querySelectorAll('[data-reporter]');
  for (var i = 0; i < reporterButtons.length; i++) {
    reporterButtons[i].addEventListener('click', function (event) {
      if (state.saving) return;
      state.reporterMode = event.currentTarget.getAttribute('data-reporter');
      delete state.fieldErrors.reporter;
      state.error = '';
      persist();
      render();
    });
  }

  var requestButtons = form.querySelectorAll('[data-maintenance]');
  for (var j = 0; j < requestButtons.length; j++) {
    requestButtons[j].addEventListener('click', function (event) {
      if (state.saving) return;
      state.maintenanceRequest = event.currentTarget.getAttribute('data-maintenance');
      delete state.fieldErrors.maintenanceRequest;
      state.error = '';
      persist();
      render();
    });
  }

  var area = document.getElementById('area');
  if (area) {
    area.addEventListener('change', function () {
      var next = area.value;
      if (next !== state.area) {
        state.equipment = '';
        state.equipmentOther = '';
      }
      state.area = next;
      delete state.fieldErrors.area;
      delete state.fieldErrors.equipment;
      state.error = '';
      persist();
      render();
    });
  }

  var equipment = document.getElementById('equipment');
  if (equipment) {
    equipment.addEventListener('change', function () {
      state.equipment = equipment.value;
      if (state.equipment !== OTHER) state.equipmentOther = '';
      delete state.fieldErrors.equipment;
      state.error = '';
      persist();
      render();
    });
  }

  bindSelect('operator', 'otherOperator');
  bindSelect('priority', 'priority');
  bindText('areaOther', 'areaOther');
  bindText('equipmentOther', 'equipmentOther');
  bindText('title', 'title');
  bindText('description', 'description');
  bindText('parts', 'parts');

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
}

function bindSelect(id, key) {
  var el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', function () {
    state[key] = el.value;
    delete state.fieldErrors[key === 'otherOperator' ? 'operator' : key];
    state.error = '';
    persist();
  });
}

function bindText(id, key) {
  var el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', function () {
    state[key] = el.value;
    delete state.fieldErrors[key];
    el.classList.remove('fault-invalid');
    var error = document.getElementById(key + '-error');
    if (error) error.remove();
    persist();
  });
}

function collect() {
  readValue('areaOther', 'areaOther');
  readValue('equipmentOther', 'equipmentOther');
  readValue('title', 'title');
  readValue('description', 'description');
  readValue('parts', 'parts');
  readValue('operator', 'otherOperator');
  readValue('priority', 'priority');
  readValue('area', 'area');
  readValue('equipment', 'equipment');
}

function readValue(id, key) {
  var el = document.getElementById(id);
  if (el) state[key] = el.value;
}

function clientError() {
  var fields = {};
  function fail(name, message) {
    if (!fields[name]) fields[name] = message;
  }
  if (state.reporterMode !== 'self' && state.reporterMode !== 'other') {
    fail('reporter', 'Choose Self or Another Operator.');
  } else if (!state.loggedInUser.trim()) {
    fail('reporter', 'The signed-in user is missing. Nothing was saved.');
  } else if (state.reporterMode === 'other' && state.lists.operators.indexOf(state.otherOperator.trim()) === -1) {
    fail('operator', 'Select an operator from the list.');
  }
  if (!state.area.trim()) fail('area', 'Select the operating line or area.');
  else if (state.area === OTHER && !state.areaOther.trim()) fail('areaOther', 'Enter the operating line or area.');
  if (!state.equipment.trim()) fail('equipment', 'Select the machine or equipment.');
  else if (state.equipment === OTHER && !state.equipmentOther.trim()) fail('equipmentOther', 'Enter the machine or equipment.');
  else if (state.area === OTHER && state.equipment !== OTHER) fail('equipment', 'Choose Other and describe the machine or equipment.');
  if (!state.priority) fail('priority', 'Select a priority.');
  if (!state.title.trim()) fail('title', 'Enter a short title for the fault or unsafe condition.');
  if (!state.description.trim()) fail('description', 'Describe the fault or unsafe condition.');
  if (state.photos.length > MAX_PHOTOS) fail('photos', 'You can attach up to 10 photographs.');
  if (state.maintenanceRequest !== 'Yes' && state.maintenanceRequest !== 'No') {
    fail('maintenanceRequest', 'Choose whether to mark the job as completed or raise a maintenance request.');
  }
  var names = Object.keys(fields);
  if (!names.length) return null;
  return { message: fields[names[0]], fields: fields };
}

function payload() {
  return {
    submissionId: state.submissionId,
    reporterMode: state.reporterMode,
    user: state.loggedInUser.trim(),
    reporter: state.reporterMode === 'other' ? state.otherOperator.trim() : '',
    area: state.area.trim(),
    areaOther: state.areaOther.trim(),
    equipment: state.equipment.trim(),
    equipmentOther: state.equipmentOther.trim(),
    priority: state.priority.trim(),
    title: state.title.trim(),
    description: state.description.trim(),
    parts: state.parts.trim(),
    maintenanceRequest: state.maintenanceRequest,
    photoNames: state.photos.map(function (photo) { return photo.fileName; })
  };
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

function nextPhotoName() {
  state.photoSeq += 1;
  var n = String(state.photoSeq);
  if (n.length < 2) n = '0' + n;
  return 'fault-' + n + '.jpg';
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

async function postJson(url, body) {
  var response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  var text = await response.text();
  try { return JSON.parse(text); } catch (err) { return null; }
}

async function submitReport() {
  if (state.saving || state.mode === 'success') return;
  collect();
  persist();
  var problem = clientError();
  if (problem) {
    state.error = problem.message;
    state.fieldErrors = problem.fields;
    render();
    var invalid = document.querySelector('.fault-invalid, .fault-choice');
    if (state.fieldErrors.reporter || state.fieldErrors.maintenanceRequest) {
      var group = document.querySelector('.fault-banner');
      if (group && group.focus) group.setAttribute('tabindex', '-1');
    }
    if (invalid && invalid.focus && invalid.classList.contains('fault-invalid')) invalid.focus();
    return;
  }

  state.saving = true;
  state.progress = state.photos.length ? 'Creating the job folder…' : 'Saving the fault report…';
  state.error = '';
  state.fieldErrors = {};
  render();

  try {
    var prepared = await postJson(SCRIPT_URL, payload());
    if (prepared && prepared.result === 'pending' && /^MA\d{4}$/.test(String(prepared.maintenanceId || ''))) {
      var uploadedAll = true;
      for (var i = 0; i < state.photos.length; i++) {
        state.progress = 'Uploading photograph ' + (i + 1) + ' of ' + state.photos.length + '…';
        render();
        var uploaded = await postJson(PHOTO_URL, {
          submissionId: state.submissionId,
          fileName: state.photos[i].fileName,
          imageBase64: state.photos[i].dataUrl
        });
        if (!uploaded || uploaded.result !== 'ok') {
          state.error = (uploaded && uploaded.message) || 'The photograph was not uploaded. Your answers are still here.';
          uploadedAll = false;
          break;
        }
      }
      if (uploadedAll) {
        state.progress = 'Saving the fault report…';
        render();
        var done = await postJson(SCRIPT_URL, Object.assign(payload(), { action: 'fault_commit' }));
        if (done && done.result === 'success' && /^MA\d{4}$/.test(String(done.maintenanceId || ''))) {
          state.mode = 'success';
          state.maintenanceId = done.maintenanceId;
          state.submittedOn = done.submittedOn || '';
          clearDraft();
        } else {
          state.error = (done && done.message) || 'The fault report was not saved. Your answers are still here.';
        }
      }
    } else if (prepared && prepared.result === 'success' && /^MA\d{4}$/.test(String(prepared.maintenanceId || ''))) {
      state.mode = 'success';
      state.maintenanceId = prepared.maintenanceId;
      state.submittedOn = prepared.submittedOn || '';
      clearDraft();
    } else {
      state.error = (prepared && prepared.message) || 'The fault report was not saved. Your answers are still here.';
    }
  } catch (err) {
    state.error = 'The fault report was not saved. Your answers are still here.';
  }

  state.saving = false;
  state.progress = '';
  render();
}

function startAnother() {
  state.mode = 'form';
  state.submissionId = createSubmissionId();
  state.reporterMode = '';
  state.otherOperator = '';
  state.area = '';
  state.areaOther = '';
  state.equipment = '';
  state.equipmentOther = '';
  state.priority = '';
  state.title = '';
  state.description = '';
  state.parts = '';
  state.maintenanceRequest = '';
  state.error = '';
  state.fieldErrors = {};
  state.photos = [];
  state.photoSeq = 0;
  state.progress = '';
  state.maintenanceId = '';
  state.submittedOn = '';
  state.saving = false;
  clearDraft();
  persist();
  render();
}

function loadLists() {
  state.listsLoading = true;
  state.listsError = '';
  render();
  fetch(CSV_URL)
    .then(function (response) {
      if (!response.ok) throw new Error('List request failed');
      return response.text();
    })
    .then(function (text) {
      if (!text || text.trim().charAt(0) === '<') throw new Error('List did not return spreadsheet data');
      var lists = listsFromCsv(text);
      if (!lists.operators.length || !lists.areas.length) throw new Error('The dropdown list was empty');
      state.lists = lists;
      state.listsLoading = false;
      render();
    })
    .catch(function () {
      state.listsLoading = false;
      state.listsError = 'The line and equipment lists could not be loaded. Nothing can be saved until they load.';
      render();
    });
}

restoreDraft();
loadLists();
