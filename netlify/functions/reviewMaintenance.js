const fetch = require('node-fetch');
const {
  DROPDOWNS_CSV_URL,
  listsFromCsv,
  validateReview,
  isMaintenanceId,
  jsonResponse
} = require('./maintenanceCore');
const scriptConfig = require('./scriptConfig');
const { explainScriptPage, readScriptText } = require('./submitFault');

const SHARED_TOKEN = 'J4PAN88';
const FAILURE = 'The server did not confirm that the review was saved. Your answers are still here. Try again.';

function isHtml(text) {
  return /^\s*<!DOCTYPE/i.test(text) || /<html[\s>]/i.test(text);
}

async function loadOwners() {
  const csvResponse = await fetch(DROPDOWNS_CSV_URL, { timeout: 20000 });
  if (!csvResponse.ok) throw new Error('Dropdown list request failed (' + csvResponse.status + ').');
  const csvText = await csvResponse.text();
  if (!csvText || csvText.trim().charAt(0) === '<') throw new Error('Dropdown list did not return spreadsheet data.');
  const lists = listsFromCsv(csvText);
  if (!lists.operators.length) throw new Error('The owner list was empty.');
  return lists.operators;
}

function confirmedReview(text, action) {
  var parsed = null;
  try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
  if (parsed && parsed.result === 'error') return jsonResponse(400, parsed);
  if (action === 'review_lists' && parsed && parsed.result === 'ok' && Array.isArray(parsed.requests) && Array.isArray(parsed.owners)) {
    return jsonResponse(200, parsed);
  }
  if (action === 'review_save' && parsed && parsed.result === 'success' && isMaintenanceId(parsed.maintenanceId)) {
    return jsonResponse(200, parsed);
  }
  return jsonResponse(502, { result: 'error', retryable: true, message: FAILURE });
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { result: 'error', message: 'Method Not Allowed' });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '');
    } catch (err) {
      return jsonResponse(400, {
        result: 'error',
        retryable: true,
        message: 'The review could not be read. Your answers are still here.'
      });
    }

    var action = String(payload.action || '').trim().toLowerCase();
    if (action !== 'review_lists' && action !== 'review_save') {
      return jsonResponse(400, { result: 'error', retryable: false, message: 'Unknown action.' });
    }

    let owners = [];
    try {
      owners = await loadOwners();
    } catch (err) {
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: action === 'review_save'
          ? 'The owner list could not be loaded, so the review was not saved. Your answers are still here.'
          : 'The owner list could not be loaded.'
      });
    }

    if (action === 'review_save') {
      const validated = validateReview(payload, owners);
      if (!validated.ok) {
        return jsonResponse(400, { result: 'error', retryable: true, message: validated.message });
      }
      payload = {
        submissionId: validated.value.submissionId,
        user: validated.value.user,
        label: validated.value.label,
        maintenanceId: validated.value.maintenanceId,
        owner: validated.value.owner,
        department: String(payload.department || '').trim(),
        departmentOther: String(payload.departmentOther || '').trim(),
        dueDate: validated.value.dueDate,
        permit: validated.value.permit,
        assessment: validated.value.assessment
      };
    }

    const scriptURL = scriptConfig.getMaintenanceScriptUrl();
    if (!scriptURL) {
      return jsonResponse(500, { result: 'error', retryable: false, message: scriptConfig.missingMaintenanceUrlMessage() });
    }

    const body = new URLSearchParams();
    body.append('token', SHARED_TOKEN);
    body.append('action', action);
    if (action === 'review_save') {
      body.append('submissionId', payload.submissionId);
      body.append('user', payload.user);
      body.append('label', payload.label);
      body.append('maintenanceId', payload.maintenanceId);
      body.append('owner', payload.owner);
      body.append('department', payload.department);
      body.append('departmentOther', payload.departmentOther || '');
      body.append('dueDate', payload.dueDate);
      body.append('permit', payload.permit);
      body.append('assessment', payload.assessment);
    }

    const text = await readScriptText(scriptURL, body);
    if (/Script function not found/i.test(text)) {
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: 'The deployed Maintenance web app does not include this review action. In Apps Script, open Deploy, then Manage deployments, edit the existing deployment, select New version, and deploy again.'
      });
    }
    if (isHtml(text)) {
      const message = explainScriptPage(text);
      console.error('Maintenance web app returned HTML:', message);
      return jsonResponse(502, { result: 'error', retryable: true, message: message });
    }
    const confirmed = confirmedReview(text, action);
    if (action === 'review_lists' && confirmed.statusCode === 200) {
      const listed = JSON.parse(confirmed.body);
      listed.owners = owners;
      return jsonResponse(200, listed);
    }
    return confirmed;
  } catch (err) {
    console.error('Maintenance review error:', err);
    return jsonResponse(500, {
      result: 'error',
      retryable: true,
      message: 'The review was not saved. Your answers are still here.'
    });
  }
};
