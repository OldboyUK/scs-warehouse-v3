const {
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

    if (action === 'review_save') {
      const owners = payload.owner ? [String(payload.owner)] : [];
      const validated = validateReview(payload, owners);
      if (!validated.ok) {
        return jsonResponse(400, { result: 'error', retryable: true, message: validated.message });
      }
      payload = validated.value;
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
    return confirmedReview(text, action);
  } catch (err) {
    console.error('Maintenance review error:', err);
    return jsonResponse(500, {
      result: 'error',
      retryable: true,
      message: 'The review was not saved. Your answers are still here.'
    });
  }
};
