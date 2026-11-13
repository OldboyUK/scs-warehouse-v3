/**
 * Shared fault-report validation and maintenance ID rules.
 * Apps Script in GOOGLE SCRIPTS/Maintenance.js repeats these rules under the script lock.
 * Keep both copies in step: scripts/test-maintenance.js checks the same cases.
 *
 * Dropdown values come from the published "Drop Downs" sheet (columns A–C).
 * Column D of that sheet is not used. Priority options are fixed in this file.
 */

var DROPDOWNS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT9wb05WXLcP4IN6Dce9zaRWtPKpGgHKWsqo4ICB97Mpr3RTx8MMFidwWgSf6ulh_sJNgE_2XxX3N2D/pub?gid=1056635412&single=true&output=csv';
var SSID_MAINTENANCE = '1k0y2ieC4Sg5gYNOFLgcCxLNMUjImCdZNOJTBPg-V-KE';
var SHEET_SUBMISSIONS = 'Submission Log';
var OTHER = 'Other';
var PRIORITY_OPTIONS = [
  { value: 'High Priority', label: 'High Priority - Urgent Risk to Safety of People or Food' },
  { value: 'Medium Priority', label: 'Medium Priority - A condition which must be addressed as it is likely to worsen, but does not pose an immediate risk' },
  { value: 'Low Priority', label: 'Low Priority - A condition which must be improved, but is not urgent' },
  { value: 'Stock Request', label: 'Stock Request - Used for requesting spare parts' },
  { value: 'Unsure', label: 'Unsure - Please Allocate the Priority for Me' }
];
var MAINTENANCE_ID_RE = /^MA(\d{4})$/;
var MAX_TEXT = 8000;
var MAX_NAME = 200;

function londonDateParts(date) {
  var fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  var parts = fmt.formatToParts(date);
  var map = {};
  for (var i = 0; i < parts.length; i++) map[parts[i].type] = parts[i].value;
  return {
    year: map.year,
    uk: map.day + '/' + map.month + '/' + map.year
  };
}

function pad4(n) {
  var text = String(n);
  while (text.length < 4) text = '0' + text;
  return text;
}

function nextMaintenanceId(existingIds) {
  var max = 0;
  var seen = {};
  var ids = existingIds || [];
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i] == null ? '' : ids[i]).trim().toUpperCase();
    if (!id) continue;
    seen[id] = true;
    var match = id.match(MAINTENANCE_ID_RE);
    if (!match) continue;
    var n = parseInt(match[1], 10);
    if (n > max) max = n;
  }
  if (max >= 9999) {
    return { ok: false, message: 'The maintenance ID sequence is full. Nothing was saved.' };
  }
  var next = max + 1;
  var candidate = 'MA' + pad4(next);
  var guard = 0;
  while (seen[candidate]) {
    next++;
    guard++;
    if (next > 9999 || guard > 10000) {
      return { ok: false, message: 'Could not allocate a unique maintenance ID. Nothing was saved.' };
    }
    candidate = 'MA' + pad4(next);
  }
  return { ok: true, maintenanceId: candidate };
}

function isMaintenanceId(value) {
  return MAINTENANCE_ID_RE.test(String(value || '').trim().toUpperCase());
}

function canonicalPriority(value) {
  var text = String(value == null ? '' : value).trim();
  for (var i = 0; i < PRIORITY_OPTIONS.length; i++) {
    if (text === PRIORITY_OPTIONS[i].value || text === PRIORITY_OPTIONS[i].label) {
      return PRIORITY_OPTIONS[i].value;
    }
  }
  return '';
}

function submissionIdOk(id) {
  return /^[A-Za-z0-9-]{8,80}$/.test(String(id || '').trim());
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

function requireText(value, emptyMessage, label) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return { ok: false, message: emptyMessage };
  if (text.length > MAX_TEXT) return { ok: false, message: label + ' is too long.' };
  return { ok: true, value: text };
}

function optionalText(value, label) {
  var text = String(value == null ? '' : value).trim();
  if (text.length > MAX_TEXT) return { ok: false, message: label + ' is too long.' };
  return { ok: true, value: text };
}

function namedText(value, emptyMessage, label) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return { ok: false, message: emptyMessage };
  if (text.length > MAX_NAME) return { ok: false, message: label + ' is too long.' };
  return { ok: true, value: text };
}

function reportPeople(data, lists) {
  var mode = String(data.reporterMode || '').trim().toLowerCase();
  if (mode !== 'self' && mode !== 'other') {
    return { ok: false, message: 'Choose Self or Another Operator.' };
  }
  var user = namedText(data.user, 'The signed-in user is missing. Nothing was saved.', 'The user name');
  if (!user.ok) return user;
  var reporter = '';
  if (mode === 'other') {
    var chosen = namedText(data.reporter, 'Select an operator from the list.', 'The reporter name');
    if (!chosen.ok) return chosen;
    if (lists.operators.indexOf(chosen.value) === -1) {
      return { ok: false, message: 'Select an operator from the list.' };
    }
    if (chosen.value !== user.value) reporter = chosen.value;
  }
  return { ok: true, reporterMode: mode, user: user.value, reporter: reporter };
}

function validateFault(data, lists) {
  data = data || {};
  lists = lists || { operators: [], areas: [], equipmentByArea: {} };
  var submissionId = String(data.submissionId || '').trim();
  if (!submissionIdOk(submissionId)) {
    return { ok: false, message: 'The report could not be identified. Reload the page and try again. Nothing was saved.' };
  }

  var people = reportPeople(data, lists);
  if (!people.ok) return people;

  var areaChoice = String(data.area || '').trim();
  var lineArea;
  if (!areaChoice) return { ok: false, message: 'Select the operating line or area.' };
  if (areaChoice === OTHER) {
    var areaOther = namedText(data.areaOther, 'Enter the operating line or area.', 'The operating line or area');
    if (!areaOther.ok) return areaOther;
    lineArea = areaOther.value;
  } else if (lists.areas.indexOf(areaChoice) === -1) {
    return { ok: false, message: 'Select an operating line or area from the list.' };
  } else {
    lineArea = areaChoice;
  }

  var equipmentChoice = String(data.equipment || '').trim();
  var equipment;
  if (!equipmentChoice) return { ok: false, message: 'Select the machine or equipment.' };
  if (equipmentChoice === OTHER) {
    var equipmentOther = namedText(data.equipmentOther, 'Enter the machine or equipment.', 'The machine or equipment');
    if (!equipmentOther.ok) return equipmentOther;
    equipment = equipmentOther.value;
  } else if (areaChoice === OTHER) {
    return { ok: false, message: 'Choose Other and describe the machine or equipment.' };
  } else {
    var machines = lists.equipmentByArea[areaChoice] || [];
    if (machines.indexOf(equipmentChoice) === -1) {
      return { ok: false, message: 'Select a machine or piece of equipment for that line or area.' };
    }
    equipment = equipmentChoice;
  }

  var priority = canonicalPriority(data.priority);
  if (!priority) return { ok: false, message: 'Select a priority.' };

  var description = requireText(data.description, 'Describe the fault or unsafe condition.', 'Description of the fault');
  if (!description.ok) return description;
  var parts = optionalText(data.parts, 'Parts requested');
  if (!parts.ok) return parts;

  var maintenanceRequest = String(data.maintenanceRequest || '').trim();
  if (maintenanceRequest !== 'Yes' && maintenanceRequest !== 'No') {
    return { ok: false, message: 'Choose whether to raise a maintenance request.' };
  }

  return {
    ok: true,
    value: {
      submissionId: submissionId,
      reporterMode: people.reporterMode,
      user: people.user,
      reporter: people.reporter,
      lineArea: lineArea,
      equipment: equipment,
      priority: priority,
      description: description.value,
      parts: parts.value,
      maintenanceRequest: maintenanceRequest
    }
  };
}

function jsonResponse(statusCode, body) {
  return { statusCode: statusCode, body: JSON.stringify(body) };
}

module.exports = {
  DROPDOWNS_CSV_URL: DROPDOWNS_CSV_URL,
  SSID_MAINTENANCE: SSID_MAINTENANCE,
  SHEET_SUBMISSIONS: SHEET_SUBMISSIONS,
  OTHER: OTHER,
  PRIORITY_OPTIONS: PRIORITY_OPTIONS,
  MAINTENANCE_ID_RE: MAINTENANCE_ID_RE,
  londonDateParts: londonDateParts,
  nextMaintenanceId: nextMaintenanceId,
  isMaintenanceId: isMaintenanceId,
  canonicalPriority: canonicalPriority,
  parseCsv: parseCsv,
  listsFromCsv: listsFromCsv,
  validateFault: validateFault,
  jsonResponse: jsonResponse
};
