const {
  readScriptText,
  explainScriptPage
} = require('./submitFault');
const scriptConfig = require('./scriptConfig');
const { jsonResponse, isMaintenanceId } = require('./maintenanceCore');

const SHARED_TOKEN = 'J4PAN88';
const MAX_BASE64_CHARS = 5500000;

function isHtml(text) {
  return /^\s*<!DOCTYPE/i.test(text) || /<html[\s>]/i.test(text);
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { result: 'error', message: 'Method Not Allowed' });
    }
    const scriptURL = scriptConfig.getMaintenanceScriptUrl();
    if (!scriptURL) {
      return jsonResponse(500, { result: 'error', retryable: false, message: scriptConfig.missingMaintenanceUrlMessage() });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '');
    } catch (err) {
      return jsonResponse(400, { result: 'error', retryable: true, message: 'The photograph could not be read. Your answers are still here.' });
    }

    const submissionId = String(payload.submissionId || '').trim();
    const fileName = String(payload.fileName || '').trim().toLowerCase();
    let imageBase64 = payload.imageBase64 == null ? '' : String(payload.imageBase64);
    const prefix = imageBase64.indexOf('base64,');
    if (prefix !== -1) imageBase64 = imageBase64.substring(prefix + 7);
    imageBase64 = imageBase64.replace(/\s/g, '');

    if (!submissionId) {
      return jsonResponse(400, { result: 'error', retryable: true, message: 'The job could not be identified. Your answers are still here.' });
    }
    if (!/^work-\d{2}\.(jpg|jpeg|png|webp)$/.test(fileName)) {
      return jsonResponse(400, { result: 'error', retryable: true, message: 'That photograph could not be accepted. Your answers are still here.' });
    }
    if (!imageBase64) {
      return jsonResponse(400, { result: 'error', retryable: true, message: 'The photograph was empty. Your answers are still here.' });
    }
    if (imageBase64.length > MAX_BASE64_CHARS) {
      return jsonResponse(400, { result: 'error', retryable: true, message: 'A photograph is too large. Remove it and take it again. Your answers are still here.' });
    }

    const text = await readScriptText(scriptURL, JSON.stringify({
      token: SHARED_TOKEN,
      action: 'complete_photo',
      submissionId: submissionId,
      fileName: fileName,
      mimeType: 'image/jpeg',
      imageBase64: imageBase64
    }));
    if (isHtml(text)) {
      const message = explainScriptPage(text);
      console.error('Maintenance work photo upload returned HTML:', message);
      return jsonResponse(502, { result: 'error', retryable: true, message: message });
    }
    var parsed = null;
    try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
    if (parsed && parsed.result === 'error') return jsonResponse(400, parsed);
    if (parsed && parsed.result === 'ok' && (!parsed.maintenanceId || isMaintenanceId(parsed.maintenanceId))) {
      return jsonResponse(200, parsed);
    }
    return jsonResponse(502, {
      result: 'error',
      retryable: true,
      message: 'The photograph was not uploaded. Your answers are still here.'
    });
  } catch (err) {
    console.error('Complete job photo error:', err);
    return jsonResponse(500, {
      result: 'error',
      retryable: true,
      message: 'The photograph was not uploaded. Your answers are still here.'
    });
  }
};
