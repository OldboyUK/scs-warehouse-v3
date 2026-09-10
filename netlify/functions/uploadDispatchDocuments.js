// /.netlify/functions/uploadDispatchDocuments.js
const fetch = require('node-fetch');
const { getAppsScriptUrl, missingUrlMessage, appsScriptProxyResult } = require('./scriptConfig');

const SHARED_TOKEN = 'J4PAN88';
const DOCUMENT_KINDS = ['vehicle_photo', 'driver_signature'];
const MAX_BASE64_CHARS = 5500000;

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ result: 'error', message: 'Method Not Allowed' }) };
    }

    const scriptURL = getAppsScriptUrl('DISPATCH_SCRIPT_URL');
    if (!scriptURL) {
      return { statusCode: 500, body: JSON.stringify({ result: 'error', message: missingUrlMessage('DISPATCH_SCRIPT_URL') }) };
    }

    let payload = {};
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (_) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Invalid JSON body' }) };
    }

    const documentKind = String(payload.documentKind || '').trim().toLowerCase();
    const reference = payload.reference == null ? '' : String(payload.reference).trim();
    const mimeType = String(payload.mimeType || 'image/jpeg').trim();
    const extension = String(payload.extension || '').trim();
    let imageBase64 = payload.imageBase64 == null ? '' : String(payload.imageBase64);
    const prefix = imageBase64.indexOf('base64,');
    if (prefix !== -1) imageBase64 = imageBase64.substring(prefix + 7);
    imageBase64 = imageBase64.replace(/\s/g, '');

    if (!DOCUMENT_KINDS.includes(documentKind)) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Invalid document kind' }) };
    }
    if (!reference) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Missing order reference' }) };
    }
    if (!imageBase64) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Missing image' }) };
    }
    if (imageBase64.length > MAX_BASE64_CHARS) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Image is too large. Please take the photo again at a lower resolution.' }) };
    }

    const body = JSON.stringify({
      token: SHARED_TOKEN,
      action: 'dispatch_documents',
      documentKind,
      reference,
      mimeType: documentKind === 'driver_signature' ? 'image/png' : mimeType,
      extension: documentKind === 'driver_signature' ? '.png' : extension,
      imageBase64
    });

    const res = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    const text = await res.text();
    return appsScriptProxyResult(res, text);
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ result: 'error', message: String(err) }) };
  }
};
