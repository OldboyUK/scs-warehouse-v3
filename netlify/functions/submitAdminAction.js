const fetch = require('node-fetch');
const { getAdminTasksScriptUrl, missingAdminTasksUrlMessage } = require('./scriptConfig');
const { validateActionUpdate } = require('./adminTaskCore');

const SHARED_TOKEN = 'J4PAN88';

function jsonResponse(statusCode, body) {
  return { statusCode: statusCode, body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { result: 'error', message: 'Method Not Allowed' });
    }

    const scriptURL = getAdminTasksScriptUrl();
    if (!scriptURL) {
      return jsonResponse(500, { result: 'error', retryable: false, message: missingAdminTasksUrlMessage() });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '');
    } catch (err) {
      return jsonResponse(400, { result: 'error', retryable: true, message: 'The submission could not be read.' });
    }

    const validated = validateActionUpdate(payload);
    if (!validated.ok) {
      return jsonResponse(400, { result: 'error', retryable: true, message: validated.message });
    }

    const body = new URLSearchParams();
    body.append('token', SHARED_TOKEN);
    body.append('action', 'admin_action_update');
    body.append('submissionId', validated.value.submissionId);
    body.append('completeActionId', validated.value.completeActionId);
    body.append('taskAreaId', validated.value.taskAreaId);
    body.append('taskId', validated.value.taskId);
    body.append('actionId', validated.value.actionId);
    body.append('evidence', validated.value.evidence);
    body.append('status', validated.value.status);

    const response = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const text = await response.text();
    if (/Script function not found/i.test(text)) {
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: 'The deployed Admin Tasks web app does not include this update. Deploy a new version of AdminTasks.js and try again.'
      });
    }
    if (/^\s*<!DOCTYPE/i.test(text) || /<html[\s>]/i.test(text)) {
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: 'The Admin Tasks web app returned a web page instead of a result. Check ADMIN_TASKS_SCRIPT_URL and try again.'
      });
    }

    let parsed = null;
    try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
    if (parsed && parsed.result === 'success' && parsed.completeActionId && parsed.status) {
      return jsonResponse(200, parsed);
    }
    if (parsed && parsed.result === 'error') {
      return jsonResponse(400, parsed);
    }
    return jsonResponse(502, {
      result: 'error',
      retryable: true,
      message: 'The server did not confirm that the action was updated. Your evidence is still here. Submit again to retry.'
    });
  } catch (err) {
    console.error('Admin action update error:', err);
    return jsonResponse(500, {
      result: 'error',
      retryable: true,
      message: 'The action update was not saved. Try again.'
    });
  }
};
