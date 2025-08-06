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

  const scriptURL = `https://script.google.com/macros/s/AKfycbzS93dNg8LX9FkCFZIquPmQ9FTdx1IHoSb0C101dILnXV712T7r3R9pJokmcqG6e-Xf/exec?code=${encodeURIComponent(code)}&run=${encodeURIComponent(run)}`;

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
