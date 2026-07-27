const fetch = require('node-fetch');
const { getAppsScriptUrl, missingUrlMessage } = require('./scriptConfig');
const SHARED_TOKEN = 'J4PAN88';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: JSON.stringify({ result: 'error', users: [] }) };
    }

    const scriptURL = getAppsScriptUrl('AUTH_SCRIPT_URL');
    if (!scriptURL) {
      return {
        statusCode: 500,
        body: JSON.stringify({ result: 'error', users: [], message: missingUrlMessage('AUTH_SCRIPT_URL') })
      };
    }

    const url = `${scriptURL}?action=auth_get_users&token=${encodeURIComponent(SHARED_TOKEN)}`;
    const response = await fetch(url);
    const text = await response.text();

    return { statusCode: response.status || 200, body: text };
  } catch (err) {
    console.error('Auth users error:', err);
    return { statusCode: 500, body: JSON.stringify({ result: 'error', users: [] }) };
  }
};
