const fetch = require('node-fetch');
const SHARED_TOKEN = 'J4PAN88';

exports.handler = async function (event) {
  try {
    const params = new URLSearchParams(event.body || '');
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        result: "debug",
        message: "Netlify function is responding",
        received: {
          code: params.get('code'),
          run: params.get('run'),
          units: params.get('units'),
          date: params.get('date'),
          time: params.get('time')
        },
        scriptURL: process.env.PALLET_SCRIPT_URL
      })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ result: 'error', message: err.message }) };
  }
};