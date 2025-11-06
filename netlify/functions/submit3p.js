// /.netlify/functions/submit3p.js
const fetch = require('node-fetch');

const SHARED_TOKEN = 'J4PAN88';

// Prefer env var so you can rotate endpoints easily.
// netlify env:set GOODS3P_SCRIPT_URL "https://script.google.com/macros/s/XXXXX/exec"
const FALLBACK_GOODS3P_SCRIPT_URL = ''; // optional fallback

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ result: 'error', message: 'Method Not Allowed' }) };
    }

    const scriptURL = process.env.GOODS3P_SCRIPT_URL || FALLBACK_GOODS3P_SCRIPT_URL;
    if (!scriptURL) {
      return { statusCode: 500, body: JSON.stringify({ result: 'error', message: 'Missing GOODS3P_SCRIPT_URL environment variable' }) };
    }

    const params = new URLSearchParams(event.body || '');
    const required = ['pallet','units','date','time','helper','company','product','format','abv','bbe','duty'];
    const missing = required.filter(k => !params.get(k));
    if (missing.length){
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: `Missing parameters: ${missing.join(', ')}` }) };
    }

    // Forward to Apps Script
    const body = new URLSearchParams();
    required.forEach(k => body.append(k, params.get(k)));
    body.append('token', SHARED_TOKEN);
    body.append('action', 'goods_in_3p'); // optional: route on Apps Script

    const res = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const text = await res.text();
    // Try JSON first
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