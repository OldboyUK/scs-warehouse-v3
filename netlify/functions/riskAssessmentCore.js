/**
 * Shared validation for Create Risk Assessment.
 * ID allocation and spreadsheet writes live in GOOGLE SCRIPTS/HealthSafety.js.
 * Keep these rules aligned with that script.
 */

var ACTIVITIES_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRw_L0N6VopQF5xsJ_S2ykuzmdKWF20x93z3wKmbFBn5_1sG-Hj5FwQf54QmtMaEjjSE7rxSoSXLJ0Q/pub?gid=369796982&single=true&output=csv';

var RISK_OWNERS = [
  'Quality Manager',
  'Warehouse Manager',
  'CEO',
  'Engineer',
  'CEO & Warehouse Manager',
  'Quality Manager & Warehouse Manager',
  'Other',
  'N/A'
];

var MAX_TEXT = 8000;
var MAX_ACTIONS = 50;

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
    var value = String(rows[i] && rows[i][2] != null ? rows[i][2] : '').trim();
    if (!value || seen[value]) continue;
    seen[value] = true;
    list.push(value);
  }

  return list;
}

function activityCodeFromSelection(activity) {
  var value = String(activity || '');
  if (value.length < 6) return '';
  var code = value.substring(0, 6);
  if (!/^[A-Za-z0-9]{6}$/.test(code)) return '';
  if (value.length > 6 && /[A-Za-z0-9]/.test(value.charAt(6))) return '';
  return code;
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

function validateSubmission(payload, activities) {
  var data = payload || {};
  var submissionId = String(data.submissionId || '').trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(submissionId)) {
    return { ok: false, message: 'The submission could not be identified. Reload the page and try again.' };
  }

  var activity = String(data.activity == null ? '' : data.activity).trim();
  if (!activity || !activities || activities.indexOf(activity) === -1) {
    return { ok: false, message: 'Select an activity from the list.' };
  }
  if (/[\u0000-\u001F]/.test(activity) || activity.length > 300) {
    return {
      ok: false,
      message: 'This activity cannot be used as a hazard ID prefix because it contains a line break or is too long. The activity name has not been changed.'
    };
  }
  var activityCode = activityCodeFromSelection(activity);
  if (!activityCode) {
    return { ok: false, message: 'The selected activity does not start with a 6-character activity code.' };
  }

  var hazardName = requireText(data.hazardName, 'Enter a name for the hazard.');
  if (!hazardName.ok) return hazardName;
  var hazardDescription = requireText(data.hazardDescription, 'Enter a description of the hazard.');
  if (!hazardDescription.ok) return hazardDescription;
  var whoMightBeHarmed = requireText(data.whoMightBeHarmed, 'Enter who might be harmed and how.');
  if (!whoMightBeHarmed.ok) return whoMightBeHarmed;
  var currentControls = requireText(data.currentControls, 'Enter the current control measures.');
  if (!currentControls.ok) return currentControls;

  var likelihood = parseScore(data.likelihood);
  if (likelihood == null) return { ok: false, message: 'Select a likelihood from 1 to 5.' };
  var severity = parseScore(data.severity);
  if (severity == null) return { ok: false, message: 'Select a severity from 1 to 5.' };

  if (!Array.isArray(data.actions) || data.actions.length < 1) {
    return { ok: false, message: 'Add at least one control measure.' };
  }
  if (data.actions.length > MAX_ACTIONS) {
    return { ok: false, message: 'A risk assessment can include up to ' + MAX_ACTIONS + ' control measures.' };
  }

  var actions = [];
  for (var i = 0; i < data.actions.length; i++) {
    var source = data.actions[i] || {};
    var labelNo = i + 1;
    var description = requireText(source.description, 'Enter the further action for control measure ' + labelNo + '.');
    if (!description.ok) return description;
    var owner = String(source.owner == null ? '' : source.owner).trim();
    if (RISK_OWNERS.indexOf(owner) === -1) {
      return { ok: false, message: 'Select an owner for control measure ' + labelNo + '.' };
    }
    var dueDate = parseDueDate(source.dueDate);
    if (!dueDate) {
      return { ok: false, message: 'Enter a valid due date for control measure ' + labelNo + '.' };
    }
    actions.push({
      description: description.value,
      owner: owner,
      dueDate: dueDate
    });
  }

  return {
    ok: true,
    value: {
      submissionId: submissionId,
      activity: activity,
      activityCode: activityCode,
      hazardName: hazardName.value,
      hazardDescription: hazardDescription.value,
      whoMightBeHarmed: whoMightBeHarmed.value,
      currentControls: currentControls.value,
      likelihood: likelihood,
      severity: severity,
      actions: actions
    }
  };
}

module.exports = {
  ACTIVITIES_CSV_URL: ACTIVITIES_CSV_URL,
  RISK_OWNERS: RISK_OWNERS,
  MAX_ACTIONS: MAX_ACTIONS,
  parseCsv: parseCsv,
  activitiesFromCsv: activitiesFromCsv,
  activityCodeFromSelection: activityCodeFromSelection,
  parseScore: parseScore,
  parseDueDate: parseDueDate,
  validateSubmission: validateSubmission
};
