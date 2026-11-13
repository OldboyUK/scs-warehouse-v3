var app = document.getElementById('app');

var CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT9wb05WXLcP4IN6Dce9zaRWtPKpGgHKWsqo4ICB97Mpr3RTx8MMFidwWgSf6ulh_sJNgE_2XxX3N2D/pub?gid=1056635412&single=true&output=csv';
var SCRIPT_URL = '/.netlify/functions/submitFault';
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
  description: '',
  parts: '',
  maintenanceRequest: '',
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
      description: state.description,
      parts: state.parts,
      maintenanceRequest: state.maintenanceRequest
    }));
  } catch (err) {}
}

function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch (err) {}
}

function currentOperator() {
  if (state.reporterMode === 'self') return state.loggedInUser;
  if (state.reporterMode === 'other') return state.otherOperator;
  return '';
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
        (state.submittedOn ? ' on ' + escapeHTML(state.submittedOn) : '') + '.',
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
      '<label class="fault-question" for="description">Please write a description of the fault or unsafe condition <span class="fault-req">Required</span></label>' +
      '<textarea id="description" rows="6" class="' + invalidClass('description') + '"' + describedBy('description') + disabled + '>' + escapeHTML(state.description) + '</textarea>' +
      fieldError('description') +
      '<label class="fault-question" for="parts">Parts requested</label>' +
      '<textarea id="parts" rows="4"' + disabled + '>' + escapeHTML(state.parts) + '</textarea>' +
      '<p class="fault-hint">Leave this blank if no parts are required.</p>' +
      fieldError('parts') +
      '<p class="fault-question" id="requestLabel">Would you like to raise Maintenance request? <span class="fault-req">Required</span></p>' +
      '<div class="fault-choices" role="group" aria-labelledby="requestLabel">' +
        choiceButton('maintenance', 'Yes', 'Yes - Raise Maintenance Request') +
        choiceButton('maintenance', 'No', 'No - Log as Maintenance Completed') +
      '</div>' +
      fieldError('maintenanceRequest') +
      '<p class="fault-question">Upload Photos of Faults</p>' +
      '<button type="button" class="fault-photo" id="photoBtn" disabled aria-disabled="true">' +
        '<span>Upload Photos of Faults</span>' +
        '<span class="fault-wip">Work in Progress</span>' +
      '</button>' +
      '<p class="fault-photo-note">Photo upload is not available yet.</p>' +
      '<div class="actions">' +
        '<button type="submit" class="btn btn-primary btn-block" id="submitBtn"' + disabled + '>' +
          (state.saving ? 'Saving…' : 'Submit Fault Report') +
        '</button>' +
      '</div>' +
      (state.saving ? '<p class="status" role="status">Saving the fault report…</p>' : '') +
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
  bindText('description', 'description');
  bindText('parts', 'parts');
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
  } else if (!currentOperator().trim()) {
    fail(state.reporterMode === 'other' ? 'operator' : 'reporter', 'The reporting operator is missing. Nothing was saved.');
  } else if (state.reporterMode === 'other' && state.lists.operators.indexOf(currentOperator().trim()) === -1) {
    fail('operator', 'Select an operator from the list.');
  }
  if (!state.area.trim()) fail('area', 'Select the operating line or area.');
  else if (state.area === OTHER && !state.areaOther.trim()) fail('areaOther', 'Enter the operating line or area.');
  if (!state.equipment.trim()) fail('equipment', 'Select the machine or equipment.');
  else if (state.equipment === OTHER && !state.equipmentOther.trim()) fail('equipmentOther', 'Enter the machine or equipment.');
  else if (state.area === OTHER && state.equipment !== OTHER) fail('equipment', 'Choose Other and describe the machine or equipment.');
  if (!state.priority) fail('priority', 'Select a priority.');
  if (!state.description.trim()) fail('description', 'Describe the fault or unsafe condition.');
  if (state.maintenanceRequest !== 'Yes' && state.maintenanceRequest !== 'No') {
    fail('maintenanceRequest', 'Choose whether to raise a maintenance request.');
  }
  var names = Object.keys(fields);
  if (!names.length) return null;
  return { message: fields[names[0]], fields: fields };
}

function payload() {
  return {
    submissionId: state.submissionId,
    reporterMode: state.reporterMode,
    operator: currentOperator().trim(),
    area: state.area.trim(),
    areaOther: state.areaOther.trim(),
    equipment: state.equipment.trim(),
    equipmentOther: state.equipmentOther.trim(),
    priority: state.priority.trim(),
    description: state.description.trim(),
    parts: state.parts.trim(),
    maintenanceRequest: state.maintenanceRequest
  };
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
  state.error = '';
  state.fieldErrors = {};
  render();

  try {
    var response = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload())
    });
    var text = await response.text();
    var data = null;
    try { data = JSON.parse(text); } catch (err) { data = null; }
    if (data && data.result === 'success' && /^MA\d{4}$/.test(String(data.maintenanceId || ''))) {
      state.mode = 'success';
      state.maintenanceId = data.maintenanceId;
      state.submittedOn = data.submittedOn || '';
      clearDraft();
    } else {
      state.error = (data && data.message) || 'The fault report was not saved. Your answers are still here.';
    }
  } catch (err) {
    state.error = 'The fault report was not saved. Your answers are still here.';
  }

  state.saving = false;
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
  state.description = '';
  state.parts = '';
  state.maintenanceRequest = '';
  state.error = '';
  state.fieldErrors = {};
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
