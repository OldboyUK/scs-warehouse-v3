const fetch = require('node-fetch'); // Ensure node-fetch@2 is installed

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

  // Call your Apps Script endpoint (GET or POST, depending on your setup)
  const scriptURL = `https://script.google.com/macros/s/AKfycbx2pFPXhZr6665XC155i4RD4i0iS8mbytJ1mI8IRR6lWhWRgUVnCwsaMcEn3u4Fw7qJ/exec?code=${code}&run=${run}`;

  try {
    const response = await fetch(scriptURL);
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
