const fetch = require('node-fetch');
const { getAdminTasksScriptUrl, missingAdminTasksUrlMessage } = require('./scriptConfig');

const SHARED_TOKEN = 'J4PAN88';

function jsonResponse(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { result: 'error', message: 'Method Not Allowed' });
    }

    const scriptURL = getAdminTasksScriptUrl();
    if (!scriptURL) {
      return jsonResponse(500, { result: 'error', message: missingAdminTasksUrlMessage() });
    }

    const body = new URLSearchParams();
    body.append('token', SHARED_TOKEN);
    body.append('action', 'admin_actions_list');

    const response = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (err) { parsed = null; }

    if (parsed && parsed.result === 'ok' && Array.isArray(parsed.actions)) {
      return jsonResponse(200, { result: 'ok', actions: parsed.actions });
    }
    if (parsed && parsed.result === 'error') {
      return jsonResponse(502, parsed);
    }
    return jsonResponse(502, {
      result: 'error',
      message: 'Actions could not be loaded. Deploy the latest Admin Tasks script and try again.'
    });
  } catch (err) {
    console.error('Admin action list error:', err && err.message ? err.message : err);
    return jsonResponse(502, {
      result: 'error',
      message: 'Actions could not be loaded. ' + ((err && err.message) || 'Try again.')
    });
  }
};
