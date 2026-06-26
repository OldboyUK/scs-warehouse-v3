// /.netlify/functions/submit3p.js
const fetch = require('node-fetch');
const { getAppsScriptUrl, missingUrlMessage } = require('./scriptConfig');

const SHARED_TOKEN = 'J4PAN88';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ result: 'error', message: 'Method Not Allowed' }) };
    }

    const scriptURL = getAppsScriptUrl('GOODS3P_SCRIPT_URL');
    if (!scriptURL) {
      return { statusCode: 500, body: JSON.stringify({ result: 'error', message: missingUrlMessage('GOODS3P_SCRIPT_URL') }) };
    }

    const params = new URLSearchParams(event.body || '');
    const required = ['pallet', 'units', 'helper', 'format', 'bbe', 'duty', 'run'];
    for (const k of required) {
      if (!params.get(k)) {
        return { statusCode: 400, body: JSON.stringify({ result:'error', message:`Missing parameter: ${k}` }) };
      }
    }

    const body = new URLSearchParams(event.body || '');
    body.append('token', SHARED_TOKEN);
    body.append('action', 'goods_in_3p');

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
