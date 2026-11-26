var app = document.getElementById('app');
var LIST_URL = '/.netlify/functions/adminTaskActions';
var SCRIPT_URL = '/.netlify/functions/submitAdminAction';
var STATUSES = [
  { name: 'Open', color: '#ffcfc9' },
  { name: 'In Progress', color: '#ffe5a0' },
  { name: 'Blocked', color: '#e8eaed' },
  { name: 'Cancelled', color: '#e8eaed' },
  { name: 'Completed', color: '#d4edbc' }
];
var NEUTRAL = '#dfe3e8';

var state = {
  actions: [],
  loading: true,
  loadError: '',
  query: '',
  open: false,
  selectedId: '',
  evidence: '',
  status: '',
  error: '',
  submitting: false,
  blocked: false,
  result: null,
  submissionId: createSubmissionId()
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
  return String(value).replace(/[&<>"']/g, function (match) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match];
  });
}

function statusColor(status) {
  for (var i = 0; i < STATUSES.length; i++) {
    if (STATUSES[i].name === status) return STATUSES[i].color;
  }
  return NEUTRAL;
}

function selectedAction() {
  for (var i = 0; i < state.actions.length; i++) {
    if (state.actions[i].completeActionId === state.selectedId) return state.actions[i];
  }
  return null;
}

function chipStyle(status) {
  return 'background:' + statusColor(status) + ';color:#1a2233';
}

function loadActions() {
  state.loading = true;
  state.loadError = '';
  render();
  fetch(LIST_URL, { cache: 'no-store' })
    .then(function (response) {
      return response.text().then(function (text) {
        var body = null;
        try { body = JSON.parse(text); } catch (err) { body = null; }
        if (!response.ok || !body || body.result !== 'ok' || !Array.isArray(body.actions)) {
          throw new Error((body && body.message) || 'Actions could not be loaded.');
        }
        return body.actions;
      });
    })
    .then(function (actions) {
      state.actions = actions;
      state.loading = false;
      if (state.selectedId && !selectedAction()) state.selectedId = '';
      render();
    })
    .catch(function (err) {
      state.loading = false;
      state.actions = [];
      state.loadError = (err && err.message) ? err.message : 'Actions could not be loaded.';
      render();
    });
}

function render() {
  if (state.result) {
    renderSuccess();
    return;
  }
  var action = selectedAction();
  var banner = state.error ? '<p class="at-banner" role="alert">' + escapeHTML(state.error) + '</p>' : '';
  var listBody = '';
  if (state.loading) listBody = '<p class="status" role="status">Loading actions…</p>';
  else if (state.loadError) {
    listBody = '<p class="at-banner" role="alert">' + escapeHTML(state.loadError) + '</p>' +
      '<button type="button" class="btn btn-secondary" id="retryList">Try again</button>';
  } else if (!state.actions.length) {
    listBody = '<p class="ca-empty">There are no actions to update yet.</p>';
  } else {
    listBody = actionPicker(action);
  }

  app.innerHTML =
    '<h2 class="at-page-title">Complete Actions</h2>' +
    banner +
    '<label id="actionLabel">Select an action</label>' +
    listBody +
    (action ? detailCard(action) + evidenceFields(action) : '') ;

  wireForm(action);
}

function actionPicker(action) {
  var query = state.query.trim().toLowerCase();
  var options = state.actions.filter(function (item) {
    if (!query) return true;
    return (item.label + ' ' + item.statusLabel + ' ' + item.completeActionId).toLowerCase().indexOf(query) !== -1;
  }).map(function (item) {
    return '<button type="button" class="ca-option" role="option" data-id="' + escapeHTML(item.completeActionId) + '" style="' + chipStyle(item.status) + '">' +
      '<span class="ca-option-label">' + escapeHTML(item.label) + '</span>' +
      '<span class="ca-option-status">' + escapeHTML(item.statusLabel || 'No status') + '</span>' +
    '</button>';
  }).join('');
  if (!options) options = '<p class="ca-empty">No actions match that search.</p>';
  var buttonLabel = action ? action.label : 'Select an action';
  var buttonStatus = action ? action.status : '';
  return '<div class="ca-combo">' +
    '<button type="button" class="ca-combo-button" id="actionPicker" aria-haspopup="listbox" aria-expanded="' + (state.open ? 'true' : 'false') + '" style="' + chipStyle(buttonStatus) + '">' +
      escapeHTML(buttonLabel) +
    '</button>' +
    '<div class="ca-combo-panel"' + (state.open ? '' : ' hidden') + '>' +
      '<input id="actionSearch" type="search" placeholder="Type to search…" value="' + escapeHTML(state.query) + '" aria-label="Search actions" />' +
      '<div class="ca-combo-list" role="listbox" aria-labelledby="actionLabel">' + options + '</div>' +
    '</div>' +
  '</div>';
}

function detailCard(action) {
  var history = String(action.evidence || '').trim()
    ? '<h3>Previous evidence</h3><div class="ca-history">' + escapeHTML(action.evidence) + '</div>'
    : '';
  return '<div class="summary-card">' +
    '<div class="summary-row"><span class="summary-label">Selected Action</span><span class="summary-value summary-value-pre">' + escapeHTML(action.label) + '</span></div>' +
    '<div class="summary-row"><span class="summary-label">Complete Action ID</span><span class="summary-value">' + escapeHTML(action.completeActionId) + '</span></div>' +
    '<div class="summary-row"><span class="summary-label">Task Area ID</span><span class="summary-value">' + escapeHTML(action.taskAreaId) + '</span></div>' +
    '<div class="summary-row"><span class="summary-label">Task ID</span><span class="summary-value">' + escapeHTML(action.taskId) + '</span></div>' +
    '<div class="summary-row"><span class="summary-label">Action ID</span><span class="summary-value">' + escapeHTML(action.actionId) + '</span></div>' +
    '<div class="summary-row"><span class="summary-label">Current Status</span><span class="summary-value"><span class="ca-badge" style="' + chipStyle(action.status) + '">' + escapeHTML(action.statusLabel || 'No status') + '</span></span></div>' +
    '<div class="summary-row"><span class="summary-label">Owner</span><span class="summary-value">' + escapeHTML(action.owner || '—') + '</span></div>' +
    '<div class="summary-row"><span class="summary-label">Due Date</span><span class="summary-value">' + escapeHTML(action.dueDate || '—') + '</span></div>' +
  '</div>' + history;
}

function evidenceFields(action) {
  var statuses = STATUSES.map(function (item) {
    var selected = state.status === item.name ? ' is-selected' : '';
    return '<button type="button" class="ca-status' + selected + '" data-status="' + escapeHTML(item.name) + '" style="' + chipStyle(item.name) + '">' + escapeHTML(item.name) + '</button>';
  }).join('');
  return '<label for="evidence">Evidence of Work Carried Out</label>' +
    '<p class="at-hint">Please describe the work carried out, including any relevant details or evidence that will help demonstrate the Action has been addressed.</p>' +
    '<textarea id="evidence" rows="6" maxlength="8000">' + escapeHTML(state.evidence) + '</textarea>' +
    '<p class="at-prompt">Please select the current status of this Action</p>' +
    '<div class="ca-status-row" role="group" aria-label="Action status">' + statuses + '</div>' +
    '<div class="actions">' +
      '<button type="button" class="btn btn-success btn-block" id="submitBtn"' + (state.submitting || state.blocked ? ' disabled' : '') + '>' +
        (state.submitting ? 'Submitting…' : 'Submit Update') +
      '</button>' +
    '</div>';
}

function renderSuccess() {
  var result = state.result;
  app.innerHTML =
    UI.successScreen(
      'Action updated',
      escapeHTML(result.completeActionId + ' is now ' + result.status + '.\nSubmitted ' + result.submittedOn + '.'),
      '<p class="at-prompt">What would you like to do next?</p>' +
      '<a class="btn btn-primary" href="index.html">Return to Admin Tasks</a>' +
      '<button type="button" class="btn btn-secondary" id="anotherBtn">Complete Another Task</button>'
    );
  document.getElementById('anotherBtn').addEventListener('click', function () {
    state.selectedId = '';
    state.evidence = '';
    state.status = '';
    state.error = '';
    state.result = null;
    state.blocked = false;
    state.query = '';
    state.open = false;
    state.submissionId = createSubmissionId();
    loadActions();
  });
}

function readEvidence() {
  var field = document.getElementById('evidence');
  if (field) state.evidence = field.value;
  var search = document.getElementById('actionSearch');
  if (search) state.query = search.value;
}

function wireForm(action) {
  var retry = document.getElementById('retryList');
  if (retry) retry.addEventListener('click', loadActions);
  var picker = document.getElementById('actionPicker');
  if (picker) {
    picker.addEventListener('click', function () {
      readEvidence();
      state.open = !state.open;
      render();
      if (state.open) {
        var search = document.getElementById('actionSearch');
        if (search) search.focus();
      }
    });
  }
  var search = document.getElementById('actionSearch');
  if (search) {
    search.addEventListener('input', function () {
      state.query = search.value;
      state.open = true;
      var evidence = document.getElementById('evidence');
      if (evidence) state.evidence = evidence.value;
      render();
      var next = document.getElementById('actionSearch');
      if (next) {
        next.focus();
        var length = next.value.length;
        next.setSelectionRange(length, length);
      }
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.ca-option'), function (button) {
    button.addEventListener('click', function () {
      readEvidence();
      state.selectedId = button.getAttribute('data-id');
      state.status = '';
      state.open = false;
      state.query = '';
      state.error = '';
      render();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.ca-status'), function (button) {
    button.addEventListener('click', function () {
      readEvidence();
      state.status = button.getAttribute('data-status');
      state.error = '';
      render();
    });
  });
  var submit = document.getElementById('submitBtn');
  if (submit) submit.addEventListener('click', submitUpdate);
  document.removeEventListener('click', closeOnOutside, true);
  if (state.open) document.addEventListener('click', closeOnOutside, true);
}

function closeOnOutside(event) {
  var combo = document.querySelector('.ca-combo');
  if (!combo || combo.contains(event.target)) return;
  document.removeEventListener('click', closeOnOutside, true);
  if (!state.open) return;
  state.open = false;
  render();
}

function submitUpdate() {
  if (state.submitting || state.blocked || state.result) return;
  readEvidence();
  var action = selectedAction();
  if (!action) {
    state.error = 'Select an action from the list.';
    render();
    return;
  }
  if (!String(state.evidence || '').trim()) {
    state.error = 'Enter the evidence of work carried out.';
    render();
    return;
  }
  if (!state.status) {
    state.error = 'Select the current status of this action.';
    render();
    return;
  }
  state.error = '';
  state.submitting = true;
  render();
  var payload = {
    submissionId: state.submissionId,
    completeActionId: action.completeActionId,
    taskAreaId: action.taskAreaId,
    taskId: action.taskId,
    actionId: action.actionId,
    evidence: state.evidence.trim(),
    status: state.status
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
        return body;
      });
    })
    .then(function (body) {
      if (!body || body.result !== 'success' || body.completeActionId !== action.completeActionId) {
        state.error = body && body.message ? body.message : 'The action update was not saved. Your evidence is still here.';
        state.blocked = !!(body && (body.partial || body.retryable === false));
        state.result = null;
        return;
      }
      state.result = {
        completeActionId: body.completeActionId,
        status: body.status,
        submittedOn: body.submittedOn || ''
      };
      state.error = '';
    })
    .catch(function (err) {
      state.result = null;
      state.error = (err && err.message) ? err.message : 'The action update was not saved. Your evidence is still here.';
    })
    .finally(function () {
      state.submitting = false;
      render();
    });
}

loadActions();
