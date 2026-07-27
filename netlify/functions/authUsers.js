const fetch = require('node-fetch');
const { getAuthScriptUrl, missingAuthUrlMessage } = require('./scriptConfig');
const SHARED_TOKEN = 'J4PAN88';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: JSON.stringify({ result: 'error', users: [] }) };
    }

    const scriptURL = getAuthScriptUrl();
    if (!scriptURL) {
      return {
        statusCode: 500,
        body: JSON.stringify({ result: 'error', users: [], message: missingAuthUrlMessage() })
      };
    }
    const body = new URLSearchParams();
    body.append('action', 'auth_get_users');
    body.append('token', SHARED_TOKEN);

    const response = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const text = await response.text();

    return {
      statusCode: response.status || 200,
      headers: { 'Content-Type': 'application/json' },
      body: text
    };
  } catch (err) {
    console.error('Auth users error:', err);
    return { statusCode: 500, body: JSON.stringify({ result: 'error', users: [] }) };
  }
};
