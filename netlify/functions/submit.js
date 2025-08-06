const fetch = require('node-fetch');
exports.handler = async (event) => {
  const { code, run } = JSON.parse(event.body);
  const scriptUrl = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';

  const url = `${scriptUrl}?code=${encodeURIComponent(code)}&run=${encodeURIComponent(run)}`;
  const res = await fetch(url);
  const json = await res.json();

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(json)
  };
};
