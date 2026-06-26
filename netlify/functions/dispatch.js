// /.netlify/functions/dispatch.js
const fetch = require('node-fetch');
const { APPS_SCRIPT_URL } = require('./scriptConfig');

const SHARED_TOKEN = 'J4PAN88';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ result: 'error', message: 'Method Not Allowed' }) };
    }

    const scriptURL = process.env.DISPATCH_SCRIPT_URL || process.env.APPS_SCRIPT_URL || APPS_SCRIPT_URL;

    const params = new URLSearchParams(event.body || '');
    const pallet = params.get('pallet');
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
