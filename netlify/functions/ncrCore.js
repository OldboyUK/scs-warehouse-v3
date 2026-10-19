/**
 * Shared NCR validation and numbering rules.
 * Apps Script in GOOGLE SCRIPTS/Quality.js repeats these rules under the script lock.
 * Keep both copies in step: scripts/test-ncr.js checks the same numbering cases.
 */

var PRIORITIES = ['Low', 'Medium', 'High'];
var PEOPLE = ['Zoe Ibbotson', 'Tom Ebdon', 'Angus Sales'];
var CATEGORIES = [
  'Finished Product',
  'Ingredients',
  'Packaging',
  'Pre-Packaged Liquid',
  'Internal Process or Procedure'
];
var NCR_NUMBER_RE = /^NCR(\d{2})-(\d{3})$/;
var MAX_TEXT = 8000;
var MAX_BATCHES = 30;
var MAX_BATCH_LENGTH = 80;

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

function pad3(n) {
  var text = String(n);
  while (text.length < 3) text = '0' + text;
  return text;
}

function nextNcrNumber(existingIds, date) {
  var parts = londonDateParts(date);
  var yearSuffix = String(parts.year).slice(-2);
  var prefix = 'NCR' + yearSuffix;
  var max = 0;
  var seen = {};
  var ids = existingIds || [];
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i] == null ? '' : ids[i]).trim();
    if (!id) continue;
    seen[id] = true;
    var match = id.match(NCR_NUMBER_RE);
    if (!match || match[1] !== yearSuffix) continue;
    var n = parseInt(match[2], 10);
    if (n > max) max = n;
  }
  if (max >= 999) {
    return { ok: false, message: 'The NCR sequence for ' + parts.year + ' is full. Nothing was saved.' };
  }
  var next = max + 1;
  var candidate = prefix + '-' + pad3(next);
  var guard = 0;
  while (seen[candidate]) {
    next++;
    guard++;
    if (next > 999 || guard > 1000) {
      return { ok: false, message: 'Could not allocate a unique NCR number. Nothing was saved.' };
    }
    candidate = prefix + '-' + pad3(next);
  }
  return { ok: true, ncrNumber: candidate, submittedOn: parts.uk };
}

function isNcrNumber(value) {
  return NCR_NUMBER_RE.test(String(value || '').trim().toUpperCase());
}

function submissionIdOk(id) {
  return /^[A-Za-z0-9-]{8,80}$/.test(String(id || '').trim());
}

function requireChoice(value, options, message) {
  var text = String(value == null ? '' : value).trim();
  if (options.indexOf(text) === -1) return { ok: false, message: message };
  return { ok: true, value: text };
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

function combineBatchNumbers(batches) {
  var list = batches;
  if (typeof list === 'string') {
    var trimmed = list.trim();
    if (!trimmed) list = [];
    else {
      try {
        var parsed = JSON.parse(trimmed);
        list = Array.isArray(parsed) ? parsed : [list];
      } catch (err) {
        list = [list];
      }
    }
  }
  if (!Array.isArray(list)) return { ok: false, message: 'Batch numbers could not be read.' };
  if (list.length > MAX_BATCHES) {
    return { ok: false, message: 'Enter no more than ' + MAX_BATCHES + ' batch numbers.' };
  }
  var cleaned = [];
  for (var i = 0; i < list.length; i++) {
    var value = String(list[i] == null ? '' : list[i]).trim();
    if (!value) continue;
    if (value.length > MAX_BATCH_LENGTH) return { ok: false, message: 'A batch number is too long.' };
    if (value.indexOf(',') !== -1) {
      return { ok: false, message: 'Enter one batch number in each field, without commas.' };
    }
    cleaned.push(value);
  }
  return { ok: true, value: cleaned.join(', '), batches: cleaned };
}

function optionalIsoDate(value, label) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return { ok: true, value: '' };
  var match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { ok: false, message: label + ' must be a valid date.' };
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  if (year < 2000 || year > 2100) return { ok: false, message: label + ' must be a valid date.' };
  var dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return { ok: false, message: label + ' must be a valid date.' };
  }
  var dd = day < 10 ? '0' + day : String(day);
  var mm = month < 10 ? '0' + month : String(month);
  return { ok: true, value: text, uk: dd + '/' + mm + '/' + year };
}

function validateSection1(data) {
  data = data || {};
  var submissionId = String(data.submissionId || '').trim();
  if (!submissionIdOk(submissionId)) {
    return { ok: false, message: 'The report could not be identified. Reload the page and try again. Nothing was saved.' };
  }
  var priority = requireChoice(data.priority, PRIORITIES, 'Select a priority.');
  if (!priority.ok) return priority;
  var reporter = requireChoice(data.reporter, PEOPLE, 'Select the reporter.');
  if (!reporter.ok) return reporter;
  var category = requireChoice(data.category, CATEGORIES, 'Select an issue category.');
  if (!category.ok) return category;
  var batches = combineBatchNumbers(data.batches);
  if (!batches.ok) return batches;
  var description = requireText(data.description, 'Describe the issue.', 'Description of Issue');
  if (!description.ok) return description;
  var involved = optionalText(data.involved, 'Who was involved');
  if (!involved.ok) return involved;
  var happened = optionalText(data.happened, 'What happened');
  if (!happened.ok) return happened;
  var whenOccurred = optionalText(data.whenOccurred, 'When did it take place');
  if (!whenOccurred.ok) return whenOccurred;
  var whereOccurred = optionalText(data.whereOccurred, 'Where did it take place');
  if (!whereOccurred.ok) return whereOccurred;
  var why = optionalText(data.why, 'Why did it happen');
  if (!why.ok) return why;
  var remedial = optionalText(data.remedial, 'Suggested Remedial Actions');
  if (!remedial.ok) return remedial;
  return {
    ok: true,
    value: {
      submissionId: submissionId,
      priority: priority.value,
      reporter: reporter.value,
      category: category.value,
      batches: batches.batches,
      batchNumbers: batches.value,
      description: description.value,
      involved: involved.value,
      happened: happened.value,
      whenOccurred: whenOccurred.value,
      whereOccurred: whereOccurred.value,
      why: why.value,
      remedial: remedial.value
    }
  };
}

function validateSection2(data) {
  data = data || {};
  var ncrNumber = String(data.ncrNumber || '').trim().toUpperCase();
  if (!isNcrNumber(ncrNumber)) {
    return { ok: false, message: 'Enter a valid NCR number, such as NCR26-001.' };
  }
  var findings = optionalText(data.findings, 'Findings of Investigation');
  if (!findings.ok) return findings;
  var correctiveActions = optionalText(data.correctiveActions, 'Corrective Actions');
  if (!correctiveActions.ok) return correctiveActions;
  var correctiveDue = optionalIsoDate(data.correctiveDue, 'Corrective action due date');
  if (!correctiveDue.ok) return correctiveDue;
  var correctiveComplete = optionalIsoDate(data.correctiveComplete, 'Corrective action completed date');
  if (!correctiveComplete.ok) return correctiveComplete;
  var rootCause = optionalText(data.rootCause, 'Root Cause');
  if (!rootCause.ok) return rootCause;
  var preventativeActions = optionalText(data.preventativeActions, 'Preventative Actions');
  if (!preventativeActions.ok) return preventativeActions;
  var preventativeDue = optionalIsoDate(data.preventativeDue, 'Preventative action due date');
  if (!preventativeDue.ok) return preventativeDue;
  var preventativeComplete = optionalIsoDate(data.preventativeComplete, 'Preventative action completed date');
  if (!preventativeComplete.ok) return preventativeComplete;
  var ncrCompleted = optionalIsoDate(data.ncrCompleted, 'NCR completed date');
  if (!ncrCompleted.ok) return ncrCompleted;
  var completedBy = String(data.completedBy == null ? '' : data.completedBy).trim();
  if (completedBy && PEOPLE.indexOf(completedBy) === -1) {
    return { ok: false, message: 'Select the manager who completed the NCR.' };
  }
  return {
    ok: true,
    value: {
      ncrNumber: ncrNumber,
      findings: findings.value,
      correctiveActions: correctiveActions.value,
      correctiveDue: correctiveDue.value,
      correctiveComplete: correctiveComplete.value,
      rootCause: rootCause.value,
      preventativeActions: preventativeActions.value,
      preventativeDue: preventativeDue.value,
      preventativeComplete: preventativeComplete.value,
      ncrCompleted: ncrCompleted.value,
      completedBy: completedBy
    }
  };
}

function jsonResponse(statusCode, body) {
  return { statusCode: statusCode, body: JSON.stringify(body) };
}

function confirmedResult(text, accept, failureMessage) {
  var parsed = null;
  try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
  if (parsed && parsed.result === 'error') return jsonResponse(400, parsed);
  if (parsed && accept(parsed)) return jsonResponse(200, parsed);
  return jsonResponse(502, { result: 'error', retryable: true, message: failureMessage });
}

var fetch = require('node-fetch');
var scriptConfig = require('./scriptConfig');
var SHARED_TOKEN = 'J4PAN88';

async function forwardQuality(action, fields, accept, failureMessage) {
  var scriptURL = scriptConfig.getQualityScriptUrl();
  if (!scriptURL) {
    return jsonResponse(500, { result: 'error', retryable: false, message: scriptConfig.missingQualityUrlMessage() });
  }

  var body = new URLSearchParams();
  body.append('token', SHARED_TOKEN);
  body.append('action', action);
  Object.keys(fields).forEach(function (key) {
    var value = fields[key];
    if (value == null) return;
    body.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  });

  var response = await fetch(scriptURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body
  });
  var text = await response.text();
  if (/Script function not found/i.test(text)) {
    return jsonResponse(502, {
      result: 'error',
      retryable: true,
      message: 'The deployed Quality web app does not include doPost. In Apps Script, open Deploy, then Manage deployments, edit the existing deployment, select New version, and deploy again. QUALITY_SCRIPT_URL must be that deployment’s /exec URL.'
    });
  }
  if (/^\s*<!DOCTYPE/i.test(text) || /<html[\s>]/i.test(text)) {
    return jsonResponse(502, {
      result: 'error',
      retryable: true,
      message: 'The Quality web app returned a web page instead of a saved result. Nothing was confirmed. Check that the deployment is Execute as: Me, Who has access: Anyone, and that QUALITY_SCRIPT_URL is the /exec URL.'
    });
  }
  return confirmedResult(text, accept, failureMessage);
}

module.exports = {
  PRIORITIES: PRIORITIES,
  PEOPLE: PEOPLE,
  CATEGORIES: CATEGORIES,
  NCR_NUMBER_RE: NCR_NUMBER_RE,
  londonDateParts: londonDateParts,
  nextNcrNumber: nextNcrNumber,
  isNcrNumber: isNcrNumber,
  combineBatchNumbers: combineBatchNumbers,
  optionalIsoDate: optionalIsoDate,
  validateSection1: validateSection1,
  validateSection2: validateSection2,
  jsonResponse: jsonResponse,
  confirmedResult: confirmedResult,
  forwardQuality: forwardQuality
};
