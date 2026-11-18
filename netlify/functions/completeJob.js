const {
  validateComplete,
  isMaintenanceId,
  jsonResponse
} = require('./maintenanceCore');
const scriptConfig = require('./scriptConfig');
const { explainScriptPage, readScriptText } = require('./submitFault');

const SHARED_TOKEN = 'J4PAN88';
const FAILURE = 'The server did not confirm that the job was saved. Your answers are still here. Try again.';

function isHtml(text) {
  return /^\s*<!DOCTYPE/i.test(text) || /<html[\s>]/i.test(text);
}

function labelMatches(label, maintenanceId) {
  var text = String(label || '').trim();
  var prefix = maintenanceId + ' | ';
  return text.indexOf(prefix) === 0 && text.slice(prefix.length).trim() !== '';
}

function confirmedComplete(text, action) {
  var parsed = null;
  try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
  if (parsed && parsed.result === 'error') return jsonResponse(400, parsed);
  if (action === 'complete_jobs' && parsed && parsed.result === 'ok' && Array.isArray(parsed.requests)) {
    return jsonResponse(200, parsed);
  }
  if (action === 'complete_detail' && parsed && parsed.result === 'ok' && isMaintenanceId(parsed.maintenanceId) && Array.isArray(parsed.orders) && parsed.completion) {
    return jsonResponse(200, parsed);
  }
  if (action === 'complete_prepare' && parsed && parsed.result === 'pending' && isMaintenanceId(parsed.maintenanceId)) {
    return jsonResponse(200, parsed);
  }
  if ((action === 'complete_prepare' || action === 'complete_commit') && parsed && parsed.result === 'success' && isMaintenanceId(parsed.maintenanceId) && parsed.folderUrl) {
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
        message: 'The job update could not be read. Your answers are still here.'
      });
    }

    var action = String(payload.action || '').trim().toLowerCase();
    if (action !== 'complete_jobs' && action !== 'complete_detail' && action !== 'complete_prepare' && action !== 'complete_commit') {
      return jsonResponse(400, { result: 'error', retryable: false, message: 'Unknown action.' });
    }

    if (action === 'complete_detail') {
      const maintenanceId = String(payload.maintenanceId || '').trim().toUpperCase();
      const label = String(payload.label || '').trim();
      if (!isMaintenanceId(maintenanceId) || !labelMatches(label, maintenanceId)) {
        return jsonResponse(400, { result: 'error', retryable: true, message: 'Select a maintenance job.' });
      }
      payload = { maintenanceId: maintenanceId, label: label };
    }

    if (action === 'complete_prepare' || action === 'complete_commit') {
      const validated = validateComplete(payload);
      if (!validated.ok) return jsonResponse(400, { result: 'error', retryable: true, message: validated.message });
      payload = validated.value;
    }

    const scriptURL = scriptConfig.getMaintenanceScriptUrl();
    if (!scriptURL) {
      return jsonResponse(500, { result: 'error', retryable: false, message: scriptConfig.missingMaintenanceUrlMessage() });
    }

    const body = new URLSearchParams();
    body.append('token', SHARED_TOKEN);
    body.append('action', action);
    if (action === 'complete_detail') {
      body.append('maintenanceId', payload.maintenanceId);
      body.append('label', payload.label);
    }
    if (action === 'complete_prepare' || action === 'complete_commit') {
      body.append('submissionId', payload.submissionId);
      body.append('label', payload.label);
      body.append('maintenanceId', payload.maintenanceId);
      body.append('permit', payload.permit || '');
      body.append('workUndertaken', payload.workUndertaken || '');
      body.append('workOutstanding', payload.workOutstanding || '');
      body.append('completed', payload.completed);
      body.append('outcome', payload.outcome === 'Close Job' ? 'Close Job' : 'Other');
      body.append('outcomeOther', payload.outcome === 'Close Job' ? '' : payload.outcome);
      body.append('photoNames', JSON.stringify(payload.photoNames || []));
    }

    const text = await readScriptText(scriptURL, body);
    if (/Script function not found/i.test(text)) {
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: 'The deployed Maintenance web app does not include this completion action. In Apps Script, open Deploy, then Manage deployments, edit the existing deployment, select New version, and deploy again.'
      });
    }
    if (isHtml(text)) {
      const message = explainScriptPage(text);
      console.error('Maintenance web app returned HTML:', message);
      return jsonResponse(502, { result: 'error', retryable: true, message: message });
    }
    return confirmedComplete(text, action);
  } catch (err) {
    console.error('Maintenance complete job error:', err);
    return jsonResponse(500, {
      result: 'error',
      retryable: true,
      message: 'The job was not saved. Your answers are still here.'
    });
  }
};
