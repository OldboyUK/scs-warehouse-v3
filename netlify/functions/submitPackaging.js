// /.netlify/functions/submitPackaging.js
const fetch = require('node-fetch');
const { getAppsScriptUrl, missingUrlMessage } = require('./scriptConfig');

const SHARED_TOKEN = 'J4PAN88';
const UNIT_OPTIONS = ['Kg', 'g', 'L', 'ml'];

function isValidPallet(pallet) {
  return pallet === 'NO_BARCODE' || /^\d{15}$/.test(pallet);
}

function isNumeric(value) {
  if (value === '' || value == null) return false;
  const n = Number(value);
  return !Number.isNaN(n);
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ result: 'error', message: 'Method Not Allowed' }) };
    }

    const scriptURL = getAppsScriptUrl('PACKAGING_SCRIPT_URL');
    if (!scriptURL) {
      return { statusCode: 500, body: JSON.stringify({ result: 'error', message: missingUrlMessage('PACKAGING_SCRIPT_URL') }) };
    }

    const params = new URLSearchParams(event.body || '');
    const pallet = (params.get('pallet') || '').trim();
    const customer = (params.get('customer') || '').trim();
    const customerCode = (params.get('customerCode') || '').trim();
    const productType = (params.get('productType') || '').trim();
    const size = (params.get('size') || '').trim();
    const colour = (params.get('colour') || '').trim();
    const type = (params.get('type') || '').trim();
    const unitType = (params.get('unitType') || '').trim();
    const value = (params.get('value') || '').trim();
    const username = (params.get('username') || '').trim();

    const required = {
      pallet, customer, customerCode, productType, size, colour, type, unitType, value, username
    };
    for (const [key, val] of Object.entries(required)) {
      if (!val) {
        return { statusCode: 400, body: JSON.stringify({ result: 'error', message: `Missing parameter: ${key}` }) };
      }
    }

    if (!isValidPallet(pallet)) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Invalid pallet' }) };
    }
    if (!UNIT_OPTIONS.includes(unitType)) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Invalid unit type' }) };
    }
    if (!isNumeric(value) || Number(value) <= 0) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Value must be numeric and greater than zero' }) };
    }

    const body = new URLSearchParams(event.body || '');
    body.append('token', SHARED_TOKEN);
    body.append('action', 'packaging_entry');

    const res = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return { statusCode: res.status || 200, body: JSON.stringify(json) };
    } catch {
      return { statusCode: res.status || 200, body: JSON.stringify({ result: 'ok', raw: text }) };
    }
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ result: 'error', message: String(err) }) };
  }
};
