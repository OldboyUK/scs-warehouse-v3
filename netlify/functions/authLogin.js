const fetch = require('node-fetch');
const { getAuthScriptUrl, missingAuthUrlMessage } = require('./scriptConfig');
const SHARED_TOKEN = 'J4PAN88';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ result: 'failure' }) };
    }

    const scriptURL = getAuthScriptUrl();
    if (!scriptURL) {
      return {
        statusCode: 500,
        body: JSON.stringify({ result: 'failure', message: missingAuthUrlMessage() })
      };
    }

    let payload = {};
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (_) {
      return { statusCode: 400, body: JSON.stringify({ result: 'failure' }) };
    }

    const body = new URLSearchParams();
    body.append('action', 'auth_login');
    body.append('username', String(payload.username || '').trim());
    body.append('pin', String(payload.pin || '').trim());
    body.append('token', SHARED_TOKEN);

    const response = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const text = await response.text();
    return { statusCode: response.status || 200, body: text };
  } catch (err) {
    console.error('Auth login error:', err);
    return { statusCode: 500, body: JSON.stringify({ result: 'failure' }) };
  }
};
