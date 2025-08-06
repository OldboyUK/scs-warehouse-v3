const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  const params = new URLSearchParams(event.body);
  const code = params.get('code');
  const run = params.get('run');
  const units = params.get('units');

  if (!code || !run || !units) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        result: 'error',
        message: 'Missing code, run, or units parameter',
      }),
    };
  }

  const scriptURL = `https://script.google.com/macros/s/AKfycbzacnjpEPebjKnRczosrxrp2UEWvRqA5yG-OzBqpQa2FTuL5E67lJ7ZIDAmRQbi6j7R/exec?code=${encodeURIComponent(code)}&run=${encodeURIComponent(run)}&units=${encodeURIComponent(units)}`;

  try {
    const response = await fetch(scriptURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const text = await response.text();

    return {
      statusCode: 200,
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        result: 'error',
        message: err.message,
      }),
    };
  }
};
