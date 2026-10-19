var app = document.getElementById('app');

var ACTIVITIES_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRw_L0N6VopQF5xsJ_S2ykuzmdKWF20x93z3wKmbFBn5_1sG-Hj5FwQf54QmtMaEjjSE7rxSoSXLJ0Q/pub?gid=369796982&single=true&output=csv';
var SCRIPT_URL = '/.netlify/functions/submitRiskAssessment';
var OWNERS = [
  'Quality Manager',
  'Warehouse Manager',
  'CEO',
  'Engineer',
  'CEO & Warehouse Manager',
  'Quality Manager & Warehouse Manager',
  'Other',
  'N/A'
];
var STEPS = ['Hazards', 'Actions', 'Review'];

var state = {
  step: 0,
  activity: '',
  hazardName: '',
  hazardDescription: '',
  whoMightBeHarmed: '',
  currentControls: '',
  likelihood: '',
  severity: '',
  actions: [blankAction()],
  activities: [],
  activitiesLoading: true,
  activitiesError: '',
  error: '',
  submitting: false,
  blocked: false,
  result: null,
  submissionId: createSubmissionId()
};

var comboCloser = null;

function blankAction() {
  return { description: '', owner: '', dueDate: '' };
}

function createSubmissionId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) {
    var rand = Math.random() * 16 | 0;
    var value = ch === 'x' ? rand : (rand & 0x3 | 0x8);
    return value.toString(16);
  });
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, function (match) {
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

function activitiesFromCsv(text) {
  var rows = parseCsv(text);
  var list = [];
  var seen = {};
  for (var i = 1; i < rows.length; i++) {
    var value = String(rows[i] && rows[i][0] != null ? rows[i][0] : '').trim();
    if (!value || seen[value]) continue;
    seen[value] = true;
    list.push(value);
  }
  return list;
}

function formatDisplayDate(isoDate) {
  var parts = String(isoDate || '').split('-');
  if (parts.length !== 3) return isoDate || '';
  return parts[2] + '/' + parts[1] + '/' + parts[0];
}

function isBlankAction(action) {
  return !String(action.description || '').trim() &&
    !String(action.owner || '').trim() &&
    !String(action.dueDate || '').trim();
}

function loadActivities() {
  if (document.getElementById('hazardName')) readHazards();
  state.activitiesLoading = true;
  state.activitiesError = '';
  render();
  fetch(ACTIVITIES_CSV)
    .then(function (response) {
      if (!response.ok) throw new Error('Activity list request failed (' + response.status + ').');
      return response.text();
    })
    .then(function (text) {
      if (!text || text.trim().charAt(0) === '<') {
        throw new Error('Activity list did not return spreadsheet data.');
      }
      var list = activitiesFromCsv(text);
      if (!list.length) throw new Error('The activity list was empty.');
      state.activities = list;
      state.activitiesLoading = false;
      state.activitiesError = '';
      render();
    })
    .catch(function (err) {
      state.activitiesLoading = false;
      state.activities = [];
      state.activitiesError = (err && err.message) ? err.message : 'Activities could not be loaded. Check your connection and try again.';
      render();
    });
}

function bannerHtml() {
  if (!state.error) return '';
  return '<p class="hs-banner" role="alert">' + escapeHTML(state.error) + '</p>';
}

function render() {
  if (state.result) {
    renderSuccess();
    return;
  }
  window.scrollTo(0, 0);
  if (state.step === 0) renderHazards();
  else if (state.step === 1) renderActions();
  else renderReview();
}

function renderSuccess() {
  var lines = state.result.actionIds.map(function (id) { return id; }).join('\n');
  var message = 'Hazard ID: ' + state.result.hazardId + '\n\nAction IDs:\n' + lines;
  app.innerHTML = UI.successScreen(
    'Risk assessment saved',
    escapeHTML(message),
    '<a class="btn btn-primary" href="index.html">Back to Health and Safety</a>'
  );
}

function renderHazards() {
  var activityField;
  if (state.activitiesLoading) {
    activityField = '<p class="status" role="status">Loading activities…</p>';
  } else if (state.activitiesError) {
    activityField =
      '<p class="hs-banner" role="alert">' + escapeHTML(state.activitiesError) + '</p>' +
      '<button type="button" class="btn btn-secondary" id="retryActivities">Try again</button>';
  } else {
    activityField =
      '<div id="activity-wrap" class="combo-wrap">' +
        '<input id="activity" placeholder="Type to search…" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + escapeHTML(state.activity) + '" />' +
        '<button id="activity-toggle" type="button" class="combo-toggle" aria-label="Open activities">▾</button>' +
        '<div id="activity-list" class="combo-list" hidden>' +
          state.activities.map(function (name) {
            return '<div class="combo-option" data-value="' + escapeHTML(name) + '">' + escapeHTML(name) + '</div>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  app.innerHTML =
    UI.progressBar(STEPS, 0) +
    bannerHtml() +
    '<p class="hs-intro">Record the hazard, then add the actions that will control it.</p>' +
    '<h2 class="hs-section-title">HAZARDS</h2>' +
    '<label for="activity">Select Activity</label>' +
    activityField +
    '<label for="hazardName">Name of Hazard</label>' +
    '<input id="hazardName" type="text" maxlength="8000" value="' + escapeHTML(state.hazardName) + '" />' +
    '<label for="hazardDescription">Description of Hazard</label>' +
    '<textarea id="hazardDescription" rows="4" maxlength="8000">' + escapeHTML(state.hazardDescription) + '</textarea>' +
    '<label for="whoMightBeHarmed">Who Might Be Harmed and How?</label>' +
    '<textarea id="whoMightBeHarmed" rows="4" maxlength="8000">' + escapeHTML(state.whoMightBeHarmed) + '</textarea>' +
    '<label for="currentControls">Current Control Measures</label>' +
    '<textarea id="currentControls" rows="4" maxlength="8000">' + escapeHTML(state.currentControls) + '</textarea>' +
    '<label for="likelihood">Likelihood</label>' +
    '<select id="likelihood">' + scoreOptions(state.likelihood) + '</select>' +
    '<label for="severity">Severity</label>' +
    '<select id="severity">' + scoreOptions(state.severity) + '</select>' +
    '<div class="actions mt-3">' +
      '<button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>' +
      '<button type="button" class="btn btn-primary" id="nextHazards">Next</button>' +
    '</div>';

  var retry = document.getElementById('retryActivities');
  if (retry) retry.addEventListener('click', loadActivities);
  if (!state.activitiesLoading && !state.activitiesError) wireCombo('activity');
  document.getElementById('cancelBtn').addEventListener('click', cancel);
  document.getElementById('nextHazards').addEventListener('click', function () {
    readHazards();
    var error = validateHazards();
    if (error) {
      state.error = error;
      render();
      return;
    }
    state.error = '';
    state.step = 1;
    render();
  });
}

function scoreOptions(selected) {
  var html = '<option value="">Select</option>';
  for (var n = 1; n <= 5; n++) {
    var value = String(n);
    html += '<option value="' + value + '"' + (String(selected) === value ? ' selected' : '') + '>' + value + '</option>';
  }
  return html;
}

function ownerOptions(selected) {
  var html = '<option value="">Select owner</option>';
  OWNERS.forEach(function (owner) {
    html += '<option value="' + escapeHTML(owner) + '"' + (selected === owner ? ' selected' : '') + '>' + escapeHTML(owner) + '</option>';
  });
  return html;
}

function renderActions() {
  var cards = state.actions.map(function (action, index) {
    var remove = state.actions.length > 1
      ? '<button type="button" class="btn btn-ghost" data-remove="' + index + '">Remove</button>'
      : '';
    return '<div class="hs-action-card">' +
      '<div class="hs-action-head"><h3>Control measure ' + (index + 1) + '</h3>' + remove + '</div>' +
      '<label for="actionDescription-' + index + '">Further Actions to Control the Hazard</label>' +
      '<textarea id="actionDescription-' + index + '" rows="4" maxlength="8000">' + escapeHTML(action.description) + '</textarea>' +
      '<label for="actionOwner-' + index + '">Owner</label>' +
      '<select id="actionOwner-' + index + '">' + ownerOptions(action.owner) + '</select>' +
      '<label for="actionDue-' + index + '">Due Date</label>' +
      '<input id="actionDue-' + index + '" type="date" value="' + escapeHTML(action.dueDate) + '" />' +
    '</div>';
  }).join('');

  app.innerHTML =
    UI.progressBar(STEPS, 1) +
    bannerHtml() +
    '<h2 class="hs-section-title">ACTIONS</h2>' +
    '<p class="hs-intro">Add every further action needed for this hazard. They stay with the same hazard record.</p>' +
    cards +
    '<p class="hs-prompt">Would you like to add another control measure?</p>' +
    '<div class="hs-choice-group">' +
      '<button type="button" class="btn btn-ghost hs-choice-btn" id="addYes">Yes</button>' +
      '<button type="button" class="btn btn-primary hs-choice-btn" id="addNo">No</button>' +
    '</div>' +
    '<div class="actions mt-3">' +
      '<button type="button" class="btn btn-ghost" id="backHazards">Back</button>' +
      '<button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>' +
    '</div>';

  document.getElementById('backHazards').addEventListener('click', function () {
    readActions();
    state.error = '';
    state.step = 0;
    render();
  });
  document.getElementById('cancelBtn').addEventListener('click', cancel);
  Array.prototype.forEach.call(document.querySelectorAll('[data-remove]'), function (button) {
    button.addEventListener('click', function () {
      readActions();
      var index = Number(button.getAttribute('data-remove'));
      if (state.actions.length <= 1) return;
      state.actions.splice(index, 1);
      state.error = '';
      render();
    });
  });
  document.getElementById('addYes').addEventListener('click', function () {
    readActions();
    var error = validateActionList(state.actions, false);
    if (error) {
      state.error = error;
      render();
      return;
    }
    state.actions.push(blankAction());
    state.error = '';
    render();
  });
  document.getElementById('addNo').addEventListener('click', function () {
    readActions();
    var prepared = prepareActions(state.actions);
    if (prepared.error) {
      state.error = prepared.error;
      render();
      return;
    }
    state.actions = prepared.actions;
    state.error = '';
    state.step = 2;
    render();
  });
}

function renderReview() {
  var hazardRows = [
    ['Activity', state.activity],
    ['Name of Hazard', state.hazardName],
    ['Description of Hazard', state.hazardDescription],
    ['Who Might Be Harmed and How?', state.whoMightBeHarmed],
    ['Current Control Measures', state.currentControls],
    ['Likelihood', String(state.likelihood)],
    ['Severity', String(state.severity)]
  ];
  var hazardCard = summaryCard(hazardRows);
  var actionCards = state.actions.map(function (action, index) {
    return '<div class="hs-review-block"><h2>CONTROL MEASURE ' + (index + 1) + '</h2>' +
      summaryCard([
        ['Further Actions to Control the Hazard', action.description],
        ['Owner', action.owner],
        ['Due Date', formatDisplayDate(action.dueDate)]
      ]) +
    '</div>';
  }).join('');

  app.innerHTML =
    UI.progressBar(STEPS, 2) +
    bannerHtml() +
    '<p class="hs-intro">Check the assessment. You can go back and change it before it is saved.</p>' +
    '<div class="hs-review-block"><h2>HAZARDS</h2>' + hazardCard + '</div>' +
    '<div class="hs-review-block"><h2>ACTIONS</h2></div>' +
    actionCards +
    '<div class="actions mt-3">' +
      '<button type="button" class="btn btn-ghost" id="backEdit">Back / Edit</button>' +
      '<button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>' +
      '<button type="button" class="btn btn-success" id="submitBtn"' + (state.submitting || state.blocked ? ' disabled' : '') + '>' +
        (state.submitting ? 'Submitting…' : 'Confirm &amp; Submit') +
      '</button>' +
    '</div>';

  document.getElementById('backEdit').addEventListener('click', function () {
    if (state.submitting) return;
    state.error = '';
    state.step = 1;
    render();
  });
  document.getElementById('cancelBtn').addEventListener('click', function () {
    if (state.submitting) return;
    cancel();
  });
  document.getElementById('submitBtn').addEventListener('click', submitAssessment);
}

function summaryCard(rows) {
  return '<div class="summary-card">' + rows.map(function (row) {
    return '<div class="summary-row"><span class="summary-label">' + escapeHTML(row[0]) +
      '</span><span class="summary-value summary-value-pre">' + escapeHTML(row[1]) + '</span></div>';
  }).join('') + '</div>';
}

function wireCombo(id) {
  var input = document.getElementById(id);
  var toggle = document.getElementById(id + '-toggle');
  var list = document.getElementById(id + '-list');
  var wrap = document.getElementById(id + '-wrap');
  function filter() {
    var query = (input.value || '').trim().toUpperCase();
    Array.prototype.forEach.call(list.children, function (opt) {
      var value = (opt.dataset.value || '').toUpperCase();
      opt.style.display = !query || value.indexOf(query) !== -1 ? '' : 'none';
    });
  }
  function open() { list.hidden = false; filter(); }
  function close() { list.hidden = true; }
  input.addEventListener('input', filter);
  input.addEventListener('focus', open);
  toggle.addEventListener('click', function () { list.hidden ? open() : close(); });
  list.addEventListener('click', function (event) {
    var el = event.target.closest('.combo-option');
    if (!el) return;
    input.value = el.dataset.value || '';
    close();
  });
  if (comboCloser) document.removeEventListener('click', comboCloser, true);
  comboCloser = function (event) {
    if (!wrap.contains(event.target)) close();
  };
  document.addEventListener('click', comboCloser, true);
}

function readHazards() {
  var activity = document.getElementById('activity');
  if (activity) state.activity = activity.value.trim();
  var name = document.getElementById('hazardName');
  if (name) state.hazardName = name.value;
  var description = document.getElementById('hazardDescription');
  if (description) state.hazardDescription = description.value;
  var harmed = document.getElementById('whoMightBeHarmed');
  if (harmed) state.whoMightBeHarmed = harmed.value;
  var controls = document.getElementById('currentControls');
  if (controls) state.currentControls = controls.value;
  var likelihood = document.getElementById('likelihood');
  if (likelihood) state.likelihood = likelihood.value;
  var severity = document.getElementById('severity');
  if (severity) state.severity = severity.value;
}

function readActions() {
  state.actions = state.actions.map(function (action, index) {
    var description = document.getElementById('actionDescription-' + index);
    var owner = document.getElementById('actionOwner-' + index);
    var due = document.getElementById('actionDue-' + index);
    return {
      description: description ? description.value : action.description,
      owner: owner ? owner.value : action.owner,
      dueDate: due ? due.value : action.dueDate
    };
  });
}

function validateHazards() {
  if (state.activitiesLoading) return 'Activities are still loading.';
  if (state.activitiesError) return state.activitiesError;
  state.hazardName = state.hazardName.trim();
  state.hazardDescription = state.hazardDescription.trim();
  state.whoMightBeHarmed = state.whoMightBeHarmed.trim();
  state.currentControls = state.currentControls.trim();
  if (!state.activity || state.activities.indexOf(state.activity) === -1) {
    return 'Select an activity from the list.';
  }
  if (!state.hazardName) return 'Enter a name for the hazard.';
  if (!state.hazardDescription) return 'Enter a description of the hazard.';
  if (!state.whoMightBeHarmed) return 'Enter who might be harmed and how.';
  if (!state.currentControls) return 'Enter the current control measures.';
  if (!/^[1-5]$/.test(String(state.likelihood))) return 'Select a likelihood from 1 to 5.';
  if (!/^[1-5]$/.test(String(state.severity))) return 'Select a severity from 1 to 5.';
  return '';
}

function validateActionList(actions, allowTrailingBlank) {
  var list = actions.slice();
  if (allowTrailingBlank) {
    while (list.length > 1 && isBlankAction(list[list.length - 1])) list.pop();
  }
  if (!list.length || (list.length === 1 && isBlankAction(list[0]))) {
    return 'Add at least one control measure.';
  }
  for (var i = 0; i < list.length; i++) {
    var action = list[i];
    var number = i + 1;
    if (allowTrailingBlank && i === list.length - 1 && isBlankAction(action)) continue;
    if (!String(action.description || '').trim()) return 'Enter the further action for control measure ' + number + '.';
    if (OWNERS.indexOf(action.owner) === -1) return 'Select an owner for control measure ' + number + '.';
    if (!isValidIsoDate(action.dueDate)) return 'Enter a valid due date for control measure ' + number + '.';
  }
  return '';
}

function prepareActions(actions) {
  var list = actions.slice();
  while (list.length > 1 && isBlankAction(list[list.length - 1])) list.pop();
  var error = validateActionList(list, false);
  if (error) return { error: error };
  return {
    actions: list.map(function (action) {
      return {
        description: action.description.trim(),
        owner: action.owner,
        dueDate: action.dueDate
      };
    })
  };
}

function isValidIsoDate(value) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return false;
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  if (year < 1900 || year > 2200) return false;
  var dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() + 1 === month && dt.getUTCDate() === day;
}

function isDirty() {
  if (state.activity || state.hazardName.trim() || state.hazardDescription.trim() ||
      state.whoMightBeHarmed.trim() || state.currentControls.trim() ||
      state.likelihood || state.severity) return true;
  return state.actions.some(function (action) { return !isBlankAction(action); });
}

function cancel() {
  if (state.submitting) return;
  if (isDirty() && !window.confirm('Leave this risk assessment? The answers on this page will be discarded.')) return;
  window.location.href = 'index.html';
}

function submitAssessment() {
  if (state.submitting || state.blocked || state.result) return;
  var hazardError = validateHazards();
  if (hazardError) {
    state.error = hazardError;
    state.step = 0;
    render();
    return;
  }
  var prepared = prepareActions(state.actions);
  if (prepared.error) {
    state.error = prepared.error;
    state.step = 1;
    render();
    return;
  }
  state.actions = prepared.actions;
  state.error = '';
  state.submitting = true;
  render();

  var payload = {
    submissionId: state.submissionId,
    activity: state.activity,
    hazardName: state.hazardName.trim(),
    hazardDescription: state.hazardDescription.trim(),
    whoMightBeHarmed: state.whoMightBeHarmed.trim(),
    currentControls: state.currentControls.trim(),
    likelihood: Number(state.likelihood),
    severity: Number(state.severity),
    actions: state.actions.map(function (action) {
      return {
        description: action.description,
        owner: action.owner,
        dueDate: action.dueDate
      };
    })
  };

  fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(function (response) {
      return response.text().then(function (text) {
        var body = null;
        try { body = JSON.parse(text); } catch (err) { body = null; }
        return { ok: response.ok, body: body, text: text };
      });
    })
    .then(function (result) {
      var body = result.body;
      if (!body || body.result !== 'success' || !body.hazardId || !Array.isArray(body.actionIds) || body.actionIds.length !== payload.actions.length) {
        var message = body && body.message
          ? body.message
          : 'The risk assessment was not saved. Your answers are still here.';
        state.error = message;
        state.blocked = !!(body && (body.partial || body.retryable === false));
        state.result = null;
        return;
      }
      state.result = { hazardId: body.hazardId, actionIds: body.actionIds.slice() };
      state.error = '';
      state.blocked = false;
    })
    .catch(function (err) {
      state.result = null;
      state.error = (err && err.message) ? err.message : 'The risk assessment was not saved. Your answers are still here.';
    })
    .finally(function () {
      state.submitting = false;
      render();
    });
}

loadActivities();
