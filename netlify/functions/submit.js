const fetch = require('node-fetch');
const SHARED_TOKEN = 'J4PAN88';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ result: 'error', message: 'Method Not Allowed' }) };
    }

    const scriptURL = process.env.PALLET_SCRIPT_URL;
    if (!scriptURL) {
      return { statusCode: 500, body: JSON.stringify({ result: 'error', message: 'PALLET_SCRIPT_URL not set' }) };
    }

    const params = new URLSearchParams(event.body || '');
    const code  = params.get('code');
    const run   = params.get('run');
    const units = params.get('units');
    const date  = params.get('date');
    const time  = params.get('time');

    const body = new URLSearchParams();
    body.append('code', code);
    body.append('run', run);
    body.append('units', units);
    if (date) body.append('date', date);
    if (time) body.append('time', time);
    body.append('token', SHARED_TOKEN);
    body.append('action', 'pallet_entry');   // Force it to use the right handler

    const response = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const text = await response.text();

    return { 
      statusCode: response.status || 200, 
      body: text 
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ result: 'error', message: `Fetch error: ${err.message}` }) };
  }
};