const fetch = require('node-fetch');

const RANGES_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vThaK38XWYKd8tXJ0g9BzOxjGVooeeNbpz4A5W4eJ6DSWoPFZOaSkaHipAS2pwXU2_L-QyeMyy7Fnsf/pub?gid=621719663&single=true&output=csv';
const DATABASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vThaK38XWYKd8tXJ0g9BzOxjGVooeeNbpz4A5W4eJ6DSWoPFZOaSkaHipAS2pwXU2_L-QyeMyy7Fnsf/pub?gid=1422053003&single=true&output=csv';

function fetchText(url) {
  return fetch(url, { timeout: 50000 }).then(function (response) {
    if (!response.ok) throw new Error('status ' + response.status);
    return response.text();
  }).then(function (text) {
    if (!text || /^\s*</.test(text)) throw new Error('not csv');
    return text;
  });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: '' };
  }
  try {
    const texts = await Promise.all([fetchText(RANGES_URL), fetchText(DATABASE_URL)]);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'Netlify-CDN-Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400'
      },
      body: JSON.stringify({ ranges: texts[0], database: texts[1], savedAt: new Date().toISOString() })
    };
  } catch (err) {
    console.error('Schedule product list refresh failed');
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: 'The product lists could not be refreshed.' })
    };
  }
};
