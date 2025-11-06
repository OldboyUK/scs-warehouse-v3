const fetch = require('node-fetch');

const SHARED_TOKEN = 'J4PAN88';

// Fallback so Pallet Entry works even if the env var isn't set yet.
// (Use your actual Apps Script /exec URL here.)
const FALLBACK_PALLET_SCRIPT_URL = '';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ result: 'error', message: 'Method Not Allowed' }) };
    }

    const scriptURL = process.env.PALLET_SCRIPT_URL || FALLBACK_PALLET_SCRIPT_URL;

    const params = new URLSearchParams(event.body || '');
    const code  = params.get('code');
    const run   = params.get('run');
    const units = params.get('units');

    if (!code || !run || !units) {
      return {
        statusCode: 400,
        body: JSON.stringify({ result: 'error', message: `Missing parameters: code=${code}, run=${run}, units=${units}` })
      };
    }

    const body = new URLSearchParams();
    body.append('code', code);
    body.append('run', run);
    body.append('units', units);
    body.append('token', SHARED_TOKEN);

    const response = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const text = await response.text();
    return { statusCode: response.status || 200, body: text };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ result: 'error', message: `Fetch error: ${err.message}` }) };
  }
};
