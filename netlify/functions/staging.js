// /.netlify/functions/staging.js
const fetch = require('node-fetch');
const { getAppsScriptUrl, missingUrlMessage } = require('./scriptConfig');

const SHARED_TOKEN = 'J4PAN88';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ result: 'error', message: 'Method Not Allowed' }) };
    }

    const scriptURL = getAppsScriptUrl('DISPATCH_SCRIPT_URL');
    if (!scriptURL) {
      return {
        statusCode: 500,
        body: JSON.stringify({ result: 'error', message: missingUrlMessage('DISPATCH_SCRIPT_URL') })
      };
    }

    const params = new URLSearchParams(event.body || '');
    const collectionId = params.get('collectionId');
    const pickRef = params.get('pickRef') || '';
    let pallet = (params.get('pallet') || '').trim();
    // Pallet IDs are always 15 digits; restore a leading zero if it was dropped
    if (/^\d{14}$/.test(pallet)) pallet = '0' + pallet;
    const run = params.get('run');
    const company = params.get('company');
    const product = params.get('product');
    const format = params.get('format');
    const qty = params.get('qty');

    if (!collectionId || !pallet || !run || !qty) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Missing parameters' }) };
    }

    const body = new URLSearchParams();
    body.append('collectionId', collectionId);
    body.append('pickRef', pickRef);
    body.append('pallet', pallet);
    body.append('run', run);
    body.append('company', company || '');
    body.append('product', product || '');
    body.append('format', format || '');
    body.append('qty', qty);
    body.append('token', SHARED_TOKEN);
    body.append('action', 'staging');

    const res = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return { statusCode: res.status || 200, body: JSON.stringify(json) };
    } catch {
      return { statusCode: res.status || 200, body: JSON.stringify({ result: 'ok', raw: text }) };
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ result: 'error', message: String(err) }) };
  }
};
