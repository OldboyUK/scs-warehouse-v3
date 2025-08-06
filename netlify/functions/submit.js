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

  
  const scriptURL = `https://script.google.com/macros/s/AKfycbzwQSASOLSssqz7Ksk9AQ7tU9RbbPW2ifuU0SHDAb-g7NZEPT0PzELzHaVNolzikw5b/exec?code=${code}&run=${run}`;

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
