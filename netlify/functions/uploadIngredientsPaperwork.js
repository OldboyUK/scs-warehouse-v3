// /.netlify/functions/uploadIngredientsPaperwork.js
const fetch = require('node-fetch');
const { getAppsScriptUrl, missingUrlMessage, appsScriptProxyResult } = require('./scriptConfig');

const SHARED_TOKEN = 'J4PAN88';
const PAPERWORK_TYPES = ['Type 1', 'Type 2', 'Type 3'];
const MAX_BASE64_CHARS = 5500000;

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ result: 'error', message: 'Method Not Allowed' }) };
    }

    const scriptURL = getAppsScriptUrl('INGREDIENTS_SCRIPT_URL');
    if (!scriptURL) {
      return { statusCode: 500, body: JSON.stringify({ result: 'error', message: missingUrlMessage('INGREDIENTS_SCRIPT_URL') }) };
    }

    let payload = {};
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (_) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Invalid JSON body' }) };
    }

    const documentType = String(payload.documentType || '').trim();
    const stockCode = payload.stockCode == null ? '' : String(payload.stockCode).trim();
    const lotCode = payload.lotCode == null ? '' : String(payload.lotCode).trim();
    const mimeType = String(payload.mimeType || 'image/jpeg').trim();
    const extension = String(payload.extension || '').trim();
    let imageBase64 = payload.imageBase64 == null ? '' : String(payload.imageBase64);
    const prefix = imageBase64.indexOf('base64,');
    if (prefix !== -1) imageBase64 = imageBase64.substring(prefix + 7);
    imageBase64 = imageBase64.replace(/\s/g, '');

    if (!PAPERWORK_TYPES.includes(documentType)) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Invalid document type' }) };
    }
    if (!imageBase64) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Missing image' }) };
    }
    if (imageBase64.length > MAX_BASE64_CHARS) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Image is too large. Please take the photo again at a lower resolution.' }) };
    }

    const body = JSON.stringify({
      token: SHARED_TOKEN,
      action: 'ingredients_paperwork',
      documentType,
      stockCode,
      lotCode,
      mimeType,
      extension,
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
