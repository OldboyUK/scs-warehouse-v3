const fetch = require('node-fetch');
const { getHrScriptUrl, missingHrUrlMessage } = require('./scriptConfig');
const SHARED_TOKEN = 'J4PAN88';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ result: 'error', message: 'Method Not Allowed' }) };
    }

    const scriptURL = getHrScriptUrl();
    if (!scriptURL) {
      return { statusCode: 500, body: JSON.stringify({ result: 'error', message: missingHrUrlMessage() }) };
    }

    const params = new URLSearchParams(event.body || '');

    const body = new URLSearchParams();
    body.append('token', SHARED_TOKEN);
    body.append('action', 'hourly_submit');
    body.append('username', params.get('username') || '');
    body.append('dateWorked', params.get('dateWorked') || '');
    body.append('startTime', params.get('startTime') || '');
    body.append('breakMinutes', params.get('breakMinutes') || '');
    body.append('finishTime', params.get('finishTime') || '');
    body.append('totalHours', params.get('totalHours') || '');
    body.append('comments', params.get('comments') || '');
    body.append('browserModel', params.get('browserModel') || '');
    body.append('os', params.get('os') || '');
    body.append('browser', params.get('browser') || '');
    body.append('deviceType', params.get('deviceType') || '');

    const response = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const text = await response.text();

    if (/Script function not found/i.test(text) || text.trim().startsWith('<!DOCTYPE')) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          result: 'error',
          message: 'HR script is missing doPost. Copy the latest HR.js into Apps Script and redeploy.'
        })
      };
    }

    return { statusCode: response.status || 200, body: text };
  } catch (err) {
    console.error('Hourly hours submit error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ result: 'error', message: 'Internal server error' })
    };
  }
};
