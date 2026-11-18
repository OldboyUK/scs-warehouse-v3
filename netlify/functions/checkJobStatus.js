const { isMaintenanceId, jsonResponse } = require('./maintenanceCore');
const scriptConfig = require('./scriptConfig');
const { explainScriptPage, readScriptText } = require('./submitFault');

const SHARED_TOKEN = 'J4PAN88';
const FAILURE = 'The job could not be loaded. Try again.';

function isHtml(text) {
  return /^\s*<!DOCTYPE/i.test(text) || /<html[\s>]/i.test(text);
}

function cleanJob(payload) {
  const label = String(payload.label || '').trim();
  const maintenanceId = String(payload.maintenanceId || '').trim().toUpperCase();
  const row = parseInt(payload.row, 10);
  if (!label || label.length > 500) return null;
  if (maintenanceId && !isMaintenanceId(maintenanceId)) return null;
  if (!row || row < 3 || row > 100000) return null;
  return { label: label, maintenanceId: maintenanceId, row: row };
}

function confirmedStatus(text, action) {
  var parsed = null;
  try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
  if (parsed && parsed.result === 'error') return jsonResponse(400, parsed);
  if (action === 'status_jobs' && parsed && parsed.result === 'ok' && Array.isArray(parsed.jobs)) {
    return jsonResponse(200, parsed);
  }
  if (action === 'status_detail' && parsed && parsed.result === 'ok' && parsed.label && Array.isArray(parsed.requestsPhotos) && Array.isArray(parsed.workPhotos)) {
    return jsonResponse(200, parsed);
  }
  if (action === 'status_photo' && parsed && parsed.result === 'ok' && parsed.fileId && parsed.imageBase64 && String(parsed.mimeType || '').indexOf('image/') === 0) {
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
      return jsonResponse(400, { result: 'error', retryable: true, message: 'The job could not be read. Try again.' });
    }

    var action = String(payload.action || '').trim().toLowerCase();
    if (action !== 'status_jobs' && action !== 'status_detail' && action !== 'status_photo') {
      return jsonResponse(400, { result: 'error', retryable: false, message: 'Unknown action.' });
    }

    var job = null;
    if (action === 'status_detail' || action === 'status_photo') {
      job = cleanJob(payload);
      if (!job) return jsonResponse(400, { result: 'error', retryable: true, message: 'Select a maintenance job.' });
    }
    if (action === 'status_photo') {
      const fileId = String(payload.fileId || '').trim();
      const folderKind = String(payload.folderKind || '').trim().toLowerCase();
      const size = String(payload.size || '').trim().toLowerCase() === 'full' ? 'full' : 'thumb';
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(fileId) || (folderKind !== 'requests' && folderKind !== 'work')) {
        return jsonResponse(400, { result: 'error', retryable: true, message: 'That photograph could not be opened.' });
      }
      payload = {
        label: job.label,
        maintenanceId: job.maintenanceId,
        row: String(job.row),
        fileId: fileId,
        folderKind: folderKind,
        size: size
      };
    } else if (job) {
      payload = { label: job.label, maintenanceId: job.maintenanceId, row: String(job.row) };
    }

    const scriptURL = scriptConfig.getMaintenanceScriptUrl();
    if (!scriptURL) {
      return jsonResponse(500, { result: 'error', retryable: false, message: scriptConfig.missingMaintenanceUrlMessage() });
    }

    const body = new URLSearchParams();
    body.append('token', SHARED_TOKEN);
    body.append('action', action);
    if (action === 'status_detail' || action === 'status_photo') {
      body.append('label', payload.label);
      body.append('maintenanceId', payload.maintenanceId || '');
      body.append('row', payload.row);
    }
    if (action === 'status_photo') {
      body.append('fileId', payload.fileId);
      body.append('folderKind', payload.folderKind);
      body.append('size', payload.size);
    }

    const text = await readScriptText(scriptURL, body);
    if (/Script function not found/i.test(text)) {
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: 'The deployed Maintenance web app does not include job status. In Apps Script, open Deploy, then Manage deployments, edit the existing deployment, select New version, and deploy again.'
      });
    }
    if (isHtml(text)) {
      const message = explainScriptPage(text);
      console.error('Maintenance web app returned HTML:', message);
      return jsonResponse(502, { result: 'error', retryable: true, message: message });
    }
    return confirmedStatus(text, action);
  } catch (err) {
    console.error('Maintenance job status error:', err);
    return jsonResponse(500, { result: 'error', retryable: true, message: 'The job could not be loaded. Try again.' });
  }
};
