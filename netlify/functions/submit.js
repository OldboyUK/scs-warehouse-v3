const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  try {
    const params = new URLSearchParams(event.body);
    const code = params.get('code');
    const run = params.get('run');
    const units = params.get('units');

    console.log('Netlify received: code=%s, run=%s, units=%s', code, run, units);

    if (!code || !run || !units || isNaN(units) || parseInt(units) <= 0) {
      console.log('Validation failed: code=%s, run=%s, units=%s', code, run, units);
      return {
        statusCode: 400,
        body: JSON.stringify({
          result: 'error',
          message: 'Missing or invalid code, run, or units parameter',
        }),
      };
    }

    const scriptURL = 'https://script.google.com/macros/s/AKfycbyILeG2KOvbzEdqZc5DvFTTJZWGuJrZYE5XTBIr6LOVEavwv3gRG2sCmrMImrS8GFY/exec';

    const response = await fetch(scriptURL, {
      method: 'POST',
      body: new URLSearchParams({
        code: code,
        run: run,
        units: units
      }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const text = await response.text();
    console.log('Google Apps Script response: %s', text);

    return {
      statusCode: 200,
      body: text,
    };
  } catch (err) {
    console.log('Netlify error: %s', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        result: 'error',
        message: 'Server error: ' + err.message,
      }),
    };
  }
};