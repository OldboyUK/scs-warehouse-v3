/**
 * Shared validation for Admin Tasks → Create Task.
 * ID allocation and spreadsheet writes live in GOOGLE SCRIPTS/AdminTasks.js.
 * Keep these rules aligned with that script.
 *
 * The owner workbook also contains PIN hashes. Only column C (the staff name)
 * is kept. Hashes are never returned to the browser or stored in a draft.
 */

var TASK_AREAS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTabUIIs_BN-OjPd_ClG7ys-Cjwzi8O2XtBd3byC0IpAA3KBjiufvUurnEZWWuW1t9jFf2tNW_uwAIy/pub?gid=369796982&single=true&output=csv';
var OWNERS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQGQPFKtlsrGvGNCDKR1OuNP6Dh0687pb8EnpRhJmbD0WxMaHqiX6ia_VUoRudMNylVjkLI4YJ0gsj-/pub?gid=559712901&single=true&output=csv';

var MAX_TEXT = 8000;
var MAX_ACTIONS = 100;

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

function taskAreaIdFromValue(value) {
  var text = String(value || '');
  if (text.length < 6) return '';
  var code = text.substring(0, 6);
  if (!/^[A-Za-z0-9]{6}$/.test(code)) return '';
  if (text.length > 6 && /[A-Za-z0-9]/.test(text.charAt(6))) return '';
  return code;
}

function taskAreasFromCsv(text) {
  var rows = parseCsv(text);
  var list = [];
  var seen = {};

  for (var i = 1; i < rows.length; i++) {
    var source = rows[i] || [];
    var label = String(source[1] == null ? '' : source[1]).trim();
    var value = String(source[2] == null ? '' : source[2]).trim();
    if (!label || !value || seen[value]) continue;
    var id = taskAreaIdFromValue(value);
    if (!id) continue;
    seen[value] = true;
    list.push({ label: label, value: value, id: id });
  }

  return list;
}

function ownersFromCsv(text) {
  var rows = parseCsv(text);
  var list = [];
  var seen = {};

  for (var i = 1; i < rows.length; i++) {
    var source = rows[i] || [];
    var name = String(source[2] == null ? '' : source[2]).trim();
    if (!name || seen[name]) continue;
    seen[name] = true;
    list.push(name);
  }

  return list;
}

function parseScore(value) {
  if (typeof value === 'number' && value >= 1 && value <= 5 && Math.floor(value) === value) {
    return value;
  }
  if (typeof value === 'string' && /^[1-5]$/.test(value.trim())) {
    return parseInt(value.trim(), 10);
  }
  return null;
}

function parseDueDate(input) {
  var raw = String(input == null ? '' : input).trim();
  if (!raw) return null;

  var iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  var uk = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  var year;
  var month;
  var day;

  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (uk) {
    day = Number(uk[1]);
    month = Number(uk[2]);
    year = Number(uk[3]);
  } else {
    return null;
  }

  if (year < 1900 || year > 2200) return null;
  var dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() + 1 !== month || dt.getUTCDate() !== day) {
    return null;
  }

  var dd = day < 10 ? '0' + day : String(day);
  var mm = month < 10 ? '0' + month : String(month);
  return dd + '/' + mm + '/' + String(year);
}

function requireText(value, label, max) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return { ok: false, message: label };
  if (text.length > (max || MAX_TEXT)) {
    return { ok: false, message: label + ' is too long.' };
  }
  return { ok: true, value: text };
}

function findTaskArea(areas, taskAreaValue) {
  var wanted = String(taskAreaValue || '');
  var list = areas || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].value === wanted) return list[i];
  }
  return null;
}

function validateSubmission(payload, areas, owners) {
  var data = payload || {};
  var submissionId = String(data.submissionId || '').trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(submissionId)) {
    return { ok: false, message: 'The submission could not be identified. Reload the page and try again.' };
  }

  var taskAreaValue = String(data.taskAreaValue == null ? '' : data.taskAreaValue).trim();
  var area = findTaskArea(areas, taskAreaValue);
  if (!area) return { ok: false, message: 'Select the relevant task area.' };
  if (/[\u0000-\u001F]/.test(taskAreaValue) || taskAreaValue.length > 300) {
    return { ok: false, message: 'Select the relevant task area.' };
  }
  var taskAreaId = taskAreaIdFromValue(area.value);
  if (!taskAreaId || taskAreaId !== area.id) {
    return { ok: false, message: 'The selected task area does not start with a 6-character task area ID.' };
  }

  var title = requireText(data.title, 'Please give this job a title.');
  if (!title.ok) return title;
  var description = requireText(data.description, 'Enter a task description.');
  if (!description.ok) return description;

  if (!Array.isArray(data.actions) || data.actions.length < 1) {
    return { ok: false, message: 'Add at least one action.' };
  }
  if (data.actions.length > MAX_ACTIONS) {
    return { ok: false, message: 'An administrative task can include up to ' + MAX_ACTIONS + ' actions.' };
  }

  var ownerList = owners || [];
  var actions = [];
  for (var i = 0; i < data.actions.length; i++) {
    var source = data.actions[i] || {};
    var labelNo = i + 1;
    var actionText = requireText(source.description, 'Enter the description for Action ' + labelNo + '.');
    if (!actionText.ok) return actionText;
    var owner = String(source.owner == null ? '' : source.owner).trim();
    if (!owner || ownerList.indexOf(owner) === -1) {
      return { ok: false, message: 'Select an owner for Action ' + labelNo + '.' };
    }
    var dueDate = parseDueDate(source.dueDate);
    if (!dueDate) {
      return { ok: false, message: 'Enter a valid due date for Action ' + labelNo + '.' };
    }
    var priority = parseScore(source.priority);
    if (priority == null) {
      return { ok: false, message: 'Select a priority from 1 to 5 for Action ' + labelNo + '.' };
    }
    actions.push({
      description: actionText.value,
      owner: owner,
      dueDate: dueDate,
      priority: priority
    });
  }

  return {
    ok: true,
    value: {
      submissionId: submissionId,
      taskAreaValue: area.value,
      taskAreaLabel: area.label,
      taskAreaId: taskAreaId,
      title: title.value,
      description: description.value,
      actions: actions
    }
  };
}

function readCsv(fetchImpl, url, label) {
  return Promise.resolve()
    .then(function () { return fetchImpl(url); })
    .then(function (response) {
      if (!response || !response.ok) {
        var status = response && response.status ? response.status : 0;
        throw new Error(label + ' request failed (' + status + ').');
      }
      return response.text();
    })
    .then(function (text) {
      if (!text || String(text).replace(/^\uFEFF/, '').trim().charAt(0) === '<') {
        throw new Error(label + ' did not return spreadsheet data.');
      }
      return text;
    });
}

function loadReferenceData(fetchImpl) {
  return Promise.all([
    readCsv(fetchImpl, TASK_AREAS_CSV_URL, 'Task areas'),
    readCsv(fetchImpl, OWNERS_CSV_URL, 'Owners')
  ]).then(function (texts) {
    var taskAreas = taskAreasFromCsv(texts[0]);
    var owners = ownersFromCsv(texts[1]);
    if (!taskAreas.length) throw new Error('The task area list was empty.');
    if (!owners.length) throw new Error('The owner list was empty.');
    return { taskAreas: taskAreas, owners: owners };
  });
}

var ACTION_STATUSES = ['Open', 'In Progress', 'Blocked', 'Cancelled', 'Completed'];
var MAX_EVIDENCE = 8000;

function parseCompleteActionId(value) {
  var match = String(value || '').trim().match(/^([A-Za-z0-9]{6})-(TA\d+)-(AC\d+)$/);
  if (!match) return null;
  return {
    completeActionId: match[1] + '-' + match[2] + '-' + match[3],
    taskAreaId: match[1],
    taskId: match[2],
    actionId: match[3]
  };
}

function evidenceEntry(date, evidence) {
  return String(date) + ' - Work carried out: ' + String(evidence);
}

function appendEvidence(existing, entry) {
  var prior = String(existing == null ? '' : existing).replace(/\s+$/, '');
  if (!prior) return entry;
  return prior + '\n' + entry;
}

function validateActionUpdate(payload) {
  var data = payload || {};
  var submissionId = String(data.submissionId || '').trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(submissionId)) {
    return { ok: false, message: 'The submission could not be identified. Reload the page and try again.' };
  }
  var identity = parseCompleteActionId(data.completeActionId);
  if (!identity) return { ok: false, message: 'Select an action from the list.' };
  var taskAreaId = String(data.taskAreaId || '').trim();
  var taskId = String(data.taskId || '').trim();
  var actionId = String(data.actionId || '').trim();
  if ((taskAreaId && taskAreaId !== identity.taskAreaId) ||
      (taskId && taskId !== identity.taskId) ||
      (actionId && actionId !== identity.actionId)) {
    return { ok: false, message: 'Select an action from the list.' };
  }
  var evidence = String(data.evidence == null ? '' : data.evidence).trim();
  if (!evidence) return { ok: false, message: 'Enter the evidence of work carried out.' };
  if (evidence.length > MAX_EVIDENCE) return { ok: false, message: 'The evidence of work carried out is too long.' };
  var status = String(data.status || '').trim();
  if (ACTION_STATUSES.indexOf(status) === -1) {
    return { ok: false, message: 'Select the current status of this action.' };
  }
  return {
    ok: true,
    value: {
      submissionId: submissionId,
      completeActionId: identity.completeActionId,
      taskAreaId: identity.taskAreaId,
      taskId: identity.taskId,
      actionId: identity.actionId,
      evidence: evidence,
      status: status
    }
  };
}

module.exports = {
  TASK_AREAS_CSV_URL: TASK_AREAS_CSV_URL,
  OWNERS_CSV_URL: OWNERS_CSV_URL,
  MAX_ACTIONS: MAX_ACTIONS,
  ACTION_STATUSES: ACTION_STATUSES,
  parseCsv: parseCsv,
  taskAreaIdFromValue: taskAreaIdFromValue,
  taskAreasFromCsv: taskAreasFromCsv,
  ownersFromCsv: ownersFromCsv,
  parseScore: parseScore,
  parseDueDate: parseDueDate,
  validateSubmission: validateSubmission,
  loadReferenceData: loadReferenceData,
  parseCompleteActionId: parseCompleteActionId,
  evidenceEntry: evidenceEntry,
  appendEvidence: appendEvidence,
  validateActionUpdate: validateActionUpdate
};
