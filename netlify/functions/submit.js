const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  const params = new URLSearchParams(event.body);
  const code = params.get('code');
  const run = params.get('run');

  if (!code || !run) {
    return {
      statusCode: 400,
      body: JSON.stringify({ result: 'error', message: 'Missing code or run parameter' }),
    };
  }

  const scriptURL = `https://script.google.com/macros/s/AKfycbzXFPdo6T41ZOPAPjRm4AC3F7m0zlQGOzGoJEimNcQWOuNEFbCY1mQiKmv0bhaw-rpi/exec?code=${encodeURIComponent(code)}&run=${encodeURIComponent(run)}`;

  try {
    const response = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      // body: `code=${encodeURIComponent(code)}&run=${encodeURIComponent(run)}`, // Optional: If your Apps Script expects POST data in body
    });
    const text = await response.text();

    return {
      statusCode: 200,
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ result: 'error', message: err.message }),
    };
  }
};
