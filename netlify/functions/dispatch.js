// /.netlify/functions/dispatch.js
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
    let pallet = (params.get('pallet') || '').trim();
    // Pallet IDs are always 15 digits; restore leading zeros if Sheets dropped them
    if (/^\d+$/.test(pallet) && pallet.length > 0 && pallet.length < 15) {
      pallet = pallet.padStart(15, '0');
    }
    const date   = params.get('date');
    const time   = params.get('time');

    if (!pallet || !date || !time) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Missing parameters' }) };
    }

    const body = new URLSearchParams();
    body.append('pallet', pallet);
    body.append('date', date);
    body.append('time', time);
    body.append('token', SHARED_TOKEN);
    body.append('action', 'dispatch'); // lets Apps Script route to the right sheet/tab

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
      // If Apps Script returns plain text, wrap it
      return { statusCode: res.status || 200, body: JSON.stringify({ result: 'ok', raw: text }) };
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ result: 'error', message: String(err) }) };
  }
};
