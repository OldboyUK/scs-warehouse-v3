const fetch = require('node-fetch');

const SHARED_TOKEN = 'J4PAN88';
// Optional env override for the location Apps Script URL:
const FALLBACK_LOCATION_SCRIPT_URL = 'https://script.google.com/macros/s/REPLACE_WITH_LOCATION_ASSIGNMENT_EXEC_URL/exec';

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ result: 'error', message: 'Method Not Allowed' }) };
  }

  const params = new URLSearchParams(event.body || '');
  const pallet   = params.get('pallet');
  const location = params.get('location');
  const date     = params.get('date');
  const time     = params.get('time');

  if (!pallet || !location || !date || !time) {
    return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Missing parameters' }) };
  }

  const scriptURL = process.env.LOCATION_SCRIPT_URL || FALLBACK_LOCATION_SCRIPT_URL;

  try {
    const body = new URLSearchParams();
    body.append('pallet', pallet);
    body.append('location', location);
    body.append('date', date);
    body.append('time', time);
    body.append('token', SHARED_TOKEN);

    const res = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const text = await res.text();

    // Prefer JSON if Apps Script returns JSON
    try {
      const json = JSON.parse(text);
      return { statusCode: res.status || 200, body: JSON.stringify(json) };
    } catch {
      return { statusCode: res.status || 200, body: JSON.stringify({ result: 'ok', raw: text }) };
    }
  } catch (err) {
    console.error('assignLocation error:', err);
    return { statusCode: 500, body: JSON.stringify({ result: 'error', message: String(err) }) };
  }
};
