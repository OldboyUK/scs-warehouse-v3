var app = document.getElementById('app');

var LISTS_URL = '/.netlify/functions/adminTaskLists';
var SCRIPT_URL = '/.netlify/functions/submitAdminTask';
var STEPS = ['Task', 'Actions', 'Review'];
var PAGE_TITLES = ['Add Administrative Task', 'Add Actions', 'Review Administrative Task'];
var PRIORITY_LABELS = {
  '1': '1 — Lowest',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5 — Highest'
};

var storage = null;
try {
  var probe = window.localStorage;
  probe.setItem('__scs_at__', '1');
  probe.removeItem('__scs_at__');
  storage = probe;
} catch (err) {
  storage = null;
}

var savedDraft = storage ? AdminTaskDraft.read(storage) : null;
var state = AdminTaskDraft.blankState();
state.areas = [];
state.owners = [];
state.listsLoading = true;
state.listsError = '';
state.error = '';
state.submitting = false;
state.blocked = false;
state.result = null;
state.recovery = savedDraft ? 'prompt' : '';

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, function (match) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match];
  });
}

function formatDisplayDate(isoDate) {
  var parts = String(isoDate || '').split('-');
  if (parts.length !== 3) return isoDate || '';
  return parts[2] + '/' + parts[1] + '/' + parts[0];
}

function priorityLabel(value) {
  return PRIORITY_LABELS[String(value)] || String(value || '');
}

function selectedArea() {
  for (var i = 0; i < state.areas.length; i++) {
    if (state.areas[i].value === state.taskAreaValue) return state.areas[i];
  }
  return null;
}

function areaLabel() {
  var area = selectedArea();
  return area ? area.label : state.taskAreaValue;
}

function areaId() {
  var area = selectedArea();
  return area ? area.id : '';
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

function persist() {
  if (!storage || state.recovery || state.result) return;
  AdminTaskDraft.write(storage, state);
}

function setPageTitle(title) {
  document.title = title + ' — SCS Admin Tasks';
  var heading = document.getElementById('pageTitle');
  if (heading) heading.textContent = title;
}

function bannerHtml() {
  if (!state.error) return '';
  return '<p class="at-banner" role="alert">' + escapeHTML(state.error) + '</p>';
}

function readTask() {
  var area = document.getElementById('taskArea');
  if (area) state.taskAreaValue = area.value;
  var title = document.getElementById('taskTitle');
  if (title) state.title = title.value;
  var description = document.getElementById('taskDescription');
  if (description) state.description = description.value;
}

function readActions() {
  state.actions = state.actions.map(function (action, index) {
    var description = document.getElementById('actionDescription-' + index);
    var owner = document.getElementById('actionOwner-' + index);
    var due = document.getElementById('actionDue-' + index);
    var priority = document.getElementById('actionPriority-' + index);
    return {
      description: description ? description.value : action.description,
      owner: owner ? owner.value : action.owner,
      dueDate: due ? due.value : action.dueDate,
      priority: priority ? priority.value : action.priority
    };
  });
}

function readCurrent() {
  if (document.getElementById('taskTitle')) readTask();
  if (document.getElementById('actionDescription-0')) readActions();
}

function validateTask() {
  if (state.listsLoading) return 'Task areas are still loading.';
  if (state.listsError) return state.listsError;
  state.title = String(state.title || '').trim();
  state.description = String(state.description || '').trim();
  if (!selectedArea()) return 'Select the relevant task area.';
  if (!state.title) return 'Please give this job a title.';
  if (!state.description) return 'Enter a task description.';
  return '';
}

function validateActions() {
  if (state.listsLoading) return 'Owners are still loading.';
  if (state.listsError) return state.listsError;
  if (!state.actions.length) return 'Add at least one action.';
  for (var i = 0; i < state.actions.length; i++) {
    var action = state.actions[i];
    var number = i + 1;
    action.description = String(action.description || '').trim();
    if (!action.description) return 'Enter the description for Action ' + number + '.';
    if (state.owners.indexOf(action.owner) === -1) return 'Select an owner for Action ' + number + '.';
    if (!isValidIsoDate(action.dueDate)) return 'Enter a valid due date for Action ' + number + '.';
    if (!/^[1-5]$/.test(String(action.priority))) return 'Select a priority from 1 to 5 for Action ' + number + '.';
  }
  return '';
}

function loadLists() {
  state.listsLoading = true;
  state.listsError = '';
  render();
  fetch(LISTS_URL, { cache: 'no-store' })
    .then(function (response) {
      return response.text().then(function (text) {
        var body = null;
        try { body = JSON.parse(text); } catch (err) { body = null; }
        if (!response.ok || !body || body.result !== 'ok' || !Array.isArray(body.taskAreas) || !Array.isArray(body.owners)) {
          throw new Error((body && body.message) || 'Task areas or owners could not be loaded.');
        }
        return body;
      });
    })
    .then(function (body) {
      state.areas = body.taskAreas;
      state.owners = body.owners;
      state.listsLoading = false;
      state.listsError = '';
      render();
    })
    .catch(function (err) {
      state.listsLoading = false;
      state.areas = [];
      state.owners = [];
      state.listsError = (err && err.message) ? err.message : 'Task areas or owners could not be loaded. Check your connection and try again.';
      render();
    });
}

function render() {
  if (state.result) {
    renderSuccess();
    return;
  }
  if (state.recovery) {
    renderRecovery();
    return;
  }
  window.scrollTo(0, 0);
  setPageTitle(PAGE_TITLES[state.step] || PAGE_TITLES[0]);
  if (state.step === 0) renderTask();
  else if (state.step === 1) renderActions();
  else renderReview();
}

function renderRecovery() {
  setPageTitle('Add Administrative Task');
  var confirming = state.recovery === 'confirm';
  var message = confirming
    ? 'Discard the unfinished task? The answers saved on this device will be removed.'
    : 'You have an unfinished Administrative Task. Would you like to continue where you left off?';
  var actions = confirming
    ? '<button type="button" class="btn btn-danger" id="confirmDiscard">Discard and start new</button>' +
      '<button type="button" class="btn btn-ghost" id="backToPrompt">Go back</button>'
    : '<button type="button" class="btn btn-primary" id="continueDraft">Continue</button>' +
      '<button type="button" class="btn btn-ghost" id="startNew">Start New Task</button>';

  app.innerHTML =
    '<section class="at-recovery" role="dialog" aria-labelledby="recoveryTitle">' +
      '<h2 class="at-page-title" id="recoveryTitle">Unfinished task</h2>' +
      '<p>' + escapeHTML(message) + '</p>' +
      '<div class="at-choice-group">' + actions + '</div>' +
    '</section>';

  var continueBtn = document.getElementById('continueDraft');
  if (continueBtn) continueBtn.addEventListener('click', continueDraft);
  var startNew = document.getElementById('startNew');
  if (startNew) {
    startNew.addEventListener('click', function () {
      if (AdminTaskDraft.recoveryChoice('start-new', false) !== 'confirm') return;
      state.recovery = 'confirm';
      render();
    });
  }
  var discard = document.getElementById('confirmDiscard');
  if (discard) discard.addEventListener('click', discardDraft);
  var back = document.getElementById('backToPrompt');
  if (back) {
    back.addEventListener('click', function () {
      state.recovery = 'prompt';
      render();
    });
  }
}

function continueDraft() {
  if (!savedDraft || AdminTaskDraft.recoveryChoice('continue', false) !== 'continue') return;
  state.step = savedDraft.step;
  state.taskAreaValue = savedDraft.taskAreaValue;
  state.title = savedDraft.title;
  state.description = savedDraft.description;
  state.actions = savedDraft.actions.map(function (action) {
    return {
      description: action.description,
      owner: action.owner,
      dueDate: action.dueDate,
      priority: action.priority
    };
  });
  state.submissionId = savedDraft.submissionId;
  state.recovery = '';
  state.error = '';
  render();
}

function discardDraft() {
  if (AdminTaskDraft.recoveryChoice('start-new', true) !== 'discard') return;
  AdminTaskDraft.clear(storage);
  savedDraft = null;
  var fresh = AdminTaskDraft.blankState();
  state.step = fresh.step;
  state.taskAreaValue = fresh.taskAreaValue;
  state.title = fresh.title;
  state.description = fresh.description;
  state.actions = fresh.actions;
  state.submissionId = fresh.submissionId;
  state.recovery = '';
  state.error = '';
  state.result = null;
  render();
}

function renderTask() {
  var areaField;
  if (state.listsLoading) {
    areaField = '<p class="status" role="status">Loading task areas…</p>';
  } else if (state.listsError) {
    areaField =
      '<p class="at-banner" role="alert">' + escapeHTML(state.listsError) + '</p>' +
      '<button type="button" class="btn btn-secondary" id="retryLists">Try again</button>';
  } else {
    var options = '<option value="">Select</option>';
    var known = false;
    state.areas.forEach(function (area) {
      var selected = area.value === state.taskAreaValue;
      if (selected) known = true;
      options += '<option value="' + escapeHTML(area.value) + '"' + (selected ? ' selected' : '') + '>' + escapeHTML(area.label) + '</option>';
    });
    if (state.taskAreaValue && !known) {
      options += '<option value="' + escapeHTML(state.taskAreaValue) + '" selected>' + escapeHTML(state.taskAreaValue) + '</option>';
    }
    areaField = '<select id="taskArea">' + options + '</select>';
  }

  app.innerHTML =
    UI.progressBar(STEPS, 0) +
    '<h2 class="at-page-title">Add Administrative Task</h2>' +
    bannerHtml() +
    '<label for="taskArea">Select the relevant task area</label>' +
    areaField +
    '<label for="taskTitle">Please give this job a title</label>' +
    '<p class="at-hint">This will be used in conjunction with the Admin Task ID to help identify the correct job later.</p>' +
    '<input id="taskTitle" type="text" maxlength="8000" value="' + escapeHTML(state.title) + '" />' +
    '<label for="taskDescription">Task Description</label>' +
    '<textarea id="taskDescription" rows="5" maxlength="8000">' + escapeHTML(state.description) + '</textarea>' +
    '<div class="actions at-nav">' +
      '<button type="button" class="btn btn-primary" id="nextTask">Next</button>' +
    '</div>';

  var retry = document.getElementById('retryLists');
  if (retry) retry.addEventListener('click', loadLists);
  document.getElementById('nextTask').addEventListener('click', function () {
    readTask();
    var error = validateTask();
    if (error) {
      state.error = error;
      persist();
      render();
      return;
    }
    state.error = '';
    state.step = 1;
    persist();
    render();
  });
}

function ownerOptions(selected) {
  var html = '<option value="">Select owner</option>';
  state.owners.forEach(function (owner) {
    html += '<option value="' + escapeHTML(owner) + '"' + (selected === owner ? ' selected' : '') + '>' + escapeHTML(owner) + '</option>';
  });
  if (selected && state.owners.indexOf(selected) === -1) {
    html += '<option value="' + escapeHTML(selected) + '" selected>' + escapeHTML(selected) + '</option>';
  }
  return html;
}

function priorityOptions(selected) {
  var html = '<option value="">Select</option>';
  ['1', '2', '3', '4', '5'].forEach(function (value) {
    html += '<option value="' + value + '"' + (String(selected) === value ? ' selected' : '') + '>' + escapeHTML(PRIORITY_LABELS[value]) + '</option>';
  });
  return html;
}

function renderActions() {
  var cards = state.actions.map(function (action, index) {
    var remove = state.actions.length > 1
      ? '<button type="button" class="btn btn-ghost" data-remove="' + index + '">Remove</button>'
      : '';
    var number = index + 1;
    return '<section class="at-action-card">' +
      '<div class="at-action-head"><h3>Action ' + number + '</h3>' + remove + '</div>' +
      '<label for="actionDescription-' + index + '">Action ' + number + '</label>' +
      '<textarea id="actionDescription-' + index + '" rows="4" maxlength="8000">' + escapeHTML(action.description) + '</textarea>' +
      '<label for="actionOwner-' + index + '">Owner</label>' +
      '<select id="actionOwner-' + index + '">' + ownerOptions(action.owner) + '</select>' +
      '<label for="actionDue-' + index + '">Due Date</label>' +
      '<input id="actionDue-' + index + '" type="date" value="' + escapeHTML(action.dueDate) + '" />' +
      '<label for="actionPriority-' + index + '">Priority Level (1–5)</label>' +
      '<p class="at-hint">1 is the lowest priority and 5 is the highest.</p>' +
      '<select id="actionPriority-' + index + '">' + priorityOptions(action.priority) + '</select>' +
    '</section>';
  }).join('');

  var ownerNotice = '';
  if (state.listsLoading) ownerNotice = '<p class="status" role="status">Loading owners…</p>';
  else if (state.listsError) {
    ownerNotice =
      '<p class="at-banner" role="alert">' + escapeHTML(state.listsError) + '</p>' +
      '<button type="button" class="btn btn-secondary" id="retryLists">Try again</button>';
  }

  app.innerHTML =
    UI.progressBar(STEPS, 1) +
    '<h2 class="at-page-title">Add Actions</h2>' +
    bannerHtml() +
    '<p class="at-intro">Please record any actions required to resolve this job below.</p>' +
    ownerNotice +
    cards +
    '<p class="at-prompt">Add Another Task?</p>' +
    '<div class="at-choice-group">' +
      '<button type="button" class="btn btn-ghost at-choice-btn" id="addYes">Yes</button>' +
      '<button type="button" class="btn btn-secondary at-choice-btn" id="addNo">No</button>' +
    '</div>' +
    '<div class="actions at-nav">' +
      '<button type="button" class="btn btn-ghost" id="backTask">Back</button>' +
      '<button type="button" class="btn btn-primary" id="nextActions">Next</button>' +
    '</div>';

  var retry = document.getElementById('retryLists');
  if (retry) retry.addEventListener('click', loadLists);
  document.getElementById('backTask').addEventListener('click', function () {
    readActions();
    state.error = '';
    state.step = 0;
    persist();
    render();
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-remove]'), function (button) {
    button.addEventListener('click', function () {
      readActions();
      var index = Number(button.getAttribute('data-remove'));
      if (state.actions.length <= 1) return;
      state.actions.splice(index, 1);
      state.error = '';
      persist();
      render();
    });
  });
  document.getElementById('addYes').addEventListener('click', function () {
    readActions();
    var error = validateActions();
    if (error) {
      state.error = error;
      persist();
      render();
      return;
    }
    state.actions.push(AdminTaskDraft.blankAction());
    state.error = '';
    persist();
    render();
  });
  document.getElementById('addNo').addEventListener('click', goToReview);
  document.getElementById('nextActions').addEventListener('click', goToReview);
}

function goToReview() {
  readActions();
  var error = validateActions();
  if (error) {
    state.error = error;
    persist();
    render();
    return;
  }
  state.error = '';
  state.step = 2;
  persist();
  render();
}

function summaryCard(rows) {
  return '<div class="summary-card">' + rows.map(function (row) {
    return '<div class="summary-row"><span class="summary-label">' + escapeHTML(row[0]) +
      '</span><span class="summary-value summary-value-pre">' + escapeHTML(row[1]) + '</span></div>';
  }).join('') + '</div>';
}

function renderReview() {
  var taskCard = summaryCard([
    ['Task Area', areaLabel()],
    ['Task Area ID', areaId()],
    ['Task Title', state.title],
    ['Task Description', state.description]
  ]);
  var actionCards = state.actions.map(function (action, index) {
    return '<div class="at-review-block"><h2>ACTION ' + (index + 1) + '</h2>' +
      summaryCard([
        ['Action number', String(index + 1)],
        ['Action Description', action.description],
        ['Owner', action.owner],
        ['Due Date', formatDisplayDate(action.dueDate)],
        ['Priority Level', priorityLabel(action.priority)]
      ]) +
    '</div>';
  }).join('');

  app.innerHTML =
    UI.progressBar(STEPS, 2) +
    '<h2 class="at-page-title">Review Administrative Task</h2>' +
    bannerHtml() +
    '<p class="at-intro">Check the task and every action before it is saved.</p>' +
    '<div class="at-review-block"><h2>TASK</h2>' + taskCard + '</div>' +
    '<div class="at-review-block"><h2>ACTIONS</h2></div>' +
    actionCards +
    '<div class="actions at-nav">' +
      '<button type="button" class="btn btn-ghost" id="backActions">Back</button>' +
      '<button type="button" class="btn btn-ghost" id="editTask">Edit task details</button>' +
    '</div>' +
    '<div class="actions">' +
      '<button type="button" class="btn btn-success btn-block" id="submitBtn"' + (state.submitting || state.blocked ? ' disabled' : '') + '>' +
        (state.submitting ? 'Submitting…' : 'Submit Task') +
      '</button>' +
    '</div>';

  document.getElementById('backActions').addEventListener('click', function () {
    if (state.submitting) return;
    state.error = '';
    state.step = 1;
    persist();
    render();
  });
  document.getElementById('editTask').addEventListener('click', function () {
    if (state.submitting) return;
    state.error = '';
    state.step = 0;
    persist();
    render();
  });
  document.getElementById('submitBtn').addEventListener('click', submitTask);
}

function renderSuccess() {
  var result = state.result;
  var lines = (result.completeActionIds || []).join('\n');
  var message =
    'Task Area ID: ' + result.taskAreaId + '\n' +
    'Task ID: ' + result.taskId + '\n' +
    'Complete task ID: ' + result.completeTaskId + '\n\n' +
    'Action IDs:\n' + (result.actionIds || []).join('\n') + '\n\n' +
    'Complete action IDs:\n' + lines;
  setPageTitle('Review Administrative Task');
  app.innerHTML = UI.successScreen(
    'Administrative task saved',
    escapeHTML(message),
    '<a class="btn btn-primary" href="index.html">Back to Admin Tasks</a>' +
    '<a class="btn btn-secondary" href="create-task.html">Create another task</a>'
  );
}

function submitTask() {
  if (state.submitting || state.blocked || state.result) return;
  var taskError = validateTask();
  if (taskError) {
    state.error = taskError;
    state.step = 0;
    persist();
    render();
    return;
  }
  var actionError = validateActions();
  if (actionError) {
    state.error = actionError;
    state.step = 1;
    persist();
    render();
    return;
  }

  state.error = '';
  state.submitting = true;
  persist();
  render();

  var payload = {
    submissionId: state.submissionId,
    taskAreaValue: state.taskAreaValue,
    title: state.title.trim(),
    description: state.description.trim(),
    actions: state.actions.map(function (action) {
      return {
        description: action.description,
        owner: action.owner,
        dueDate: action.dueDate,
        priority: Number(action.priority)
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
        return { body: body };
      });
    })
    .then(function (result) {
      var body = result.body;
      if (!body || body.result !== 'success' || !body.taskAreaId || !body.taskId || !Array.isArray(body.actionIds) || body.actionIds.length !== payload.actions.length) {
        state.error = body && body.message
          ? body.message
          : 'The administrative task was not saved. Your answers are still here.';
        state.blocked = !!(body && (body.partial || body.retryable === false));
        state.result = null;
        return;
      }
      state.result = {
        taskAreaId: body.taskAreaId,
        taskId: body.taskId,
        actionIds: body.actionIds.slice(),
        completeTaskId: body.completeTaskId || (body.taskAreaId + '-' + body.taskId),
        completeActionIds: Array.isArray(body.completeActionIds) ? body.completeActionIds.slice() : body.actionIds.map(function (id) {
          return body.taskAreaId + '-' + body.taskId + '-' + id;
        })
      };
      state.error = '';
      state.blocked = false;
      AdminTaskDraft.clear(storage);
      savedDraft = null;
    })
    .catch(function (err) {
      state.result = null;
      state.error = (err && err.message) ? err.message : 'The administrative task was not saved. Your answers are still here.';
    })
    .finally(function () {
      state.submitting = false;
      render();
    });
}

app.addEventListener('input', function () {
  readCurrent();
  persist();
});
app.addEventListener('change', function () {
  readCurrent();
  persist();
});

loadLists();
