const fetch = require('node-fetch');

// Fixed shared token (matches your Apps Script check)
const SHARED_TOKEN = 'J4PAN88';

// Optional: keep using your hardcoded URL OR override via env var PALLET_SCRIPT_URL
const FALLBACK_PALLET_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyILeG2KOvbzEdqZc5DvFTTJZWGuJrZYE5XTBIr6LOVEavwv3gRG2sCmrMImrS8GFY/exec';

exports.handler = async function(event) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ result: 'error', message: 'Method Not Allowed' }) };
  }

  // Parse form body
  const params = new URLSearchParams(event.body || '');
  const code  = params.get('code');
  const run   = params.get('run');
  const units = params.get('units');

  // Validate
  if (!code || !run || !units) {
    console.log('Error: Missing parameters', { code, run, units });
    return {
      statusCode: 400,
      body: JSON.stringify({
        result: 'error',
        message: `Missing parameters: code=${code}, run=${run}, units=${units}`
      }),
    };
  }

  const scriptURL = process.env.PALLET_SCRIPT_URL || FALLBACK_PALLET_SCRIPT_URL;

  try {
    // Forward to Apps Script (x-www-form-urlencoded)
    const body = new URLSearchParams();
    body.append('code', code);
    body.append('run', run);
    body.append('units', units);
    body.append('token', SHARED_TOKEN); // <— include your fixed token

    const response = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const text = await response.text();
    console.log('Google Apps Script response:', text);

    return { statusCode: response.status || 200, body: text };
  } catch (err) {
    console.error('Fetch error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ result: 'error', message: `Fetch error: ${err.message}` })
    };
  }
};
