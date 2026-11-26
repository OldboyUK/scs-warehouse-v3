const fetch = require('node-fetch');
const { getAdminTasksScriptUrl, missingAdminTasksUrlMessage } = require('./scriptConfig');
const { loadReferenceData, validateSubmission } = require('./adminTaskCore');

const SHARED_TOKEN = 'J4PAN88';

function jsonResponse(statusCode, body) {
  return { statusCode: statusCode, body: JSON.stringify(body) };
}

function confirmedProxyResult(text) {
  var parsed = null;
  try { parsed = JSON.parse(text); } catch (err) { parsed = null; }

  if (parsed && parsed.result === 'success' && parsed.taskAreaId && parsed.taskId && Array.isArray(parsed.actionIds)) {
    return jsonResponse(200, parsed);
  }
  if (parsed && parsed.result === 'error') {
    return jsonResponse(400, parsed);
  }

  return jsonResponse(502, {
    result: 'error',
    retryable: true,
    message: 'The server did not confirm that the administrative task was saved. Your answers are still here. Submit again to retry. If the first attempt did save, you will see the original task ID instead of a duplicate.'
  });
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

    let reference;
    try {
      reference = await loadReferenceData(fetch);
    } catch (err) {
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: 'Task areas or owners could not be loaded, so the task was not saved. ' + (err.message || 'Try again.')
      });
    }

    const validated = validateSubmission(payload, reference.taskAreas, reference.owners);
    if (!validated.ok) {
      return jsonResponse(400, { result: 'error', retryable: true, message: validated.message });
    }

    const body = new URLSearchParams();
    body.append('token', SHARED_TOKEN);
    body.append('action', 'admin_task_submit');
    body.append('submissionId', validated.value.submissionId);
    body.append('taskAreaValue', validated.value.taskAreaValue);
    body.append('title', validated.value.title);
    body.append('description', validated.value.description);
    body.append('actions', JSON.stringify(validated.value.actions));

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
        message: 'The deployed Admin Tasks web app does not include doPost. In Apps Script, open Deploy, then Manage deployments, edit the existing deployment, select New version, and deploy again. ADMIN_TASKS_SCRIPT_URL must be that deployment’s /exec URL.'
      });
    }
    if (/^\s*<!DOCTYPE/i.test(text) || /<html[\s>]/i.test(text)) {
      console.error('Admin Tasks script returned HTML:', text.slice(0, 300));
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: 'The Admin Tasks web app returned a web page instead of a result. Check that the deployment is Execute as: Me, Who has access: Anyone, and that ADMIN_TASKS_SCRIPT_URL is the /exec URL from that deployment, not the /dev URL.'
      });
    }

    return confirmedProxyResult(text);
  } catch (err) {
    console.error('Admin task submit error:', err);
    return jsonResponse(500, {
      result: 'error',
      retryable: true,
      message: 'The administrative task was not saved. Try again.'
    });
  }
};
