const fetch = require('node-fetch');

const SHARED_TOKEN = 'J4PAN88';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ result: 'error', message: 'Method Not Allowed' }) };
    }

    const scriptURL = process.env.LOCATION_SCRIPT_URL;
    if (!scriptURL) {
      return {
        statusCode: 500,
        body: JSON.stringify({ result: 'error', message: 'Missing LOCATION_SCRIPT_URL environment variable' })
      };
    }

    const params = new URLSearchParams(event.body || '');
    const pallet   = params.get('pallet');
    const location = params.get('location');
    const date     = params.get('date');
    const time     = params.get('time');

    if (!pallet || !location || !date || !time) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Missing parameters' }) };
    }

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
    // Try to return JSON if Apps Script returned JSON
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