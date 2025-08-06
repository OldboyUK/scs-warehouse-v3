const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  // Parse the incoming POST body
  const params = new URLSearchParams(event.body);
  const code = params.get('code');
  const run = params.get('run');
  const units = params.get('units');

  // Validate parameters
  if (!code || !run || !units) {
    console.log('Error: Missing parameters', { code, run, units });
    return {
      statusCode: 400,
      body: JSON.stringify({
        result: 'error',
        message: `Missing parameters: code=${code}, run=${run}, units=${units}`
      }),
    };
  }

  const scriptURL = 'https://script.google.com/macros/s/AKfycbyILeG2KOvbzEdqZc5DvFTTJZWGuJrZYE5XTBIr6LOVEavwv3gRG2sCmrMImrS8GFY/exec';

  try {
    const response = await fetch(scriptURL, {
      method: 'POST',
      body: new URLSearchParams({
        code: code,
        run: run,
        units: units
      }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const text = await response.text();
    console.log('Google Apps Script response:', text);

    return {
      statusCode: 200,
      body: text
    };
  } catch (err) {
    console.error('Fetch error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        result: 'error',
        message: `Fetch error: ${err.message}`
      })
    };
  }
};