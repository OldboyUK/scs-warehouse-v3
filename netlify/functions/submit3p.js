// /.netlify/functions/submit3p.js
const fetch = require('node-fetch');

const SHARED_TOKEN = 'J4PAN88';
// Set in Netlify env: GOODS3P_SCRIPT_URL = your Apps Script /exec URL
const FALLBACK_GOODS3P_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw1gFyQTjsRRdVYkNCVQtz6rF2eNwAnuS-HVidL8bljHLW2pIpp4gjydCJwKXBO3HZn/exec'; // optional fallback, usually keep empty

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ result: 'error', message: 'Method Not Allowed' }) };
    }

    const scriptURL = process.env.GOODS3P_SCRIPT_URL || FALLBACK_GOODS3P_SCRIPT_URL;
    if (!scriptURL) {
      return { statusCode: 500, body: JSON.stringify({ result: 'error', message: 'Missing GOODS3P_SCRIPT_URL env var' }) };
    }

    const params = new URLSearchParams(event.body || '');
    const required = ['pallet','units','date','time','helper','company','product','format','abv','bbe','duty'];
    for (const k of required) {
      if (!params.get(k)) {
        return { statusCode: 400, body: JSON.stringify({ result:'error', message:`Missing parameter: ${k}` }) };
      }
    }

    const body = new URLSearchParams(event.body || '');
    body.append('token', SHARED_TOKEN);

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
