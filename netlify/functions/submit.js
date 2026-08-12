const fetch = require('node-fetch');
const { getAppsScriptUrl, missingUrlMessage } = require('./scriptConfig');
const SHARED_TOKEN = 'J4PAN88';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ result: 'error', message: 'Method Not Allowed' }) };
    }

    const scriptURL = getAppsScriptUrl('PALLET_SCRIPT_URL');
    if (!scriptURL) {
      return { statusCode: 500, body: JSON.stringify({ result: 'error', message: missingUrlMessage('PALLET_SCRIPT_URL') }) };
    }

    const params = new URLSearchParams(event.body || '');

    const body = new URLSearchParams();
    body.append('code', params.get('code'));
    body.append('run', params.get('run'));
    body.append('units', params.get('units'));
    body.append('date', params.get('date'));
    body.append('time', params.get('time'));
    // Optional Edit Pallet / re-configuration fields (leave unset for normal pallet entry)
    if (params.has('comment')) {
      body.append('comment', params.get('comment') ?? '');
    }
    if (params.has('reconfiguration')) {
      body.append('reconfiguration', params.get('reconfiguration') ?? '');
    }
    if (params.has('username')) {
      body.append('username', params.get('username') ?? '');
    }
    body.append('token', SHARED_TOKEN);
    body.append('action', 'pallet_entry');

    const response = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const text = await response.text();
    return { statusCode: response.status || 200, body: text };

  } catch (err) {
    console.error('Pallet submit error:', err);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ result: 'error', message: 'Internal server error' }) 
    };
  }
};