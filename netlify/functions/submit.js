const fetch = require('node-fetch');
const SHARED_TOKEN = 'J4PAN88';

exports.handler = async function (event) {
  try {
    const scriptURL = process.env.PALLET_SCRIPT_URL;

    const params = new URLSearchParams(event.body || '');
    const body = new URLSearchParams();
    body.append('code', params.get('code'));
    body.append('run', params.get('run'));
    body.append('units', params.get('units'));
    body.append('date', params.get('date'));
    body.append('time', params.get('time'));
    body.append('token', SHARED_TOKEN);
    body.append('action', 'pallet_entry');

    const response = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const text = await response.text();
    return { statusCode: response.status || 200, body: text };

  } catch (err) {
    console.error("Submit function error:", err);
    return { statusCode: 500, body: JSON.stringify({ result: 'error', message: 'Internal server error' }) };
  }
};