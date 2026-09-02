// /.netlify/functions/submitPackaging.js
const fetch = require('node-fetch');
const { getAppsScriptUrl, missingUrlMessage } = require('./scriptConfig');

const SHARED_TOKEN = 'J4PAN88';
const PACKAGE_OPTIONS = ['Box', 'Bundle', 'Bag', 'Individual Units'];
const PACKAGE_INDIVIDUAL = 'Individual Units';

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
    const packageType = (params.get('packageType') || '').trim();
    const unitsPerPackage = (params.get('unitsPerPackage') || '').trim();
    const packageQty = (params.get('packageQty') || '').trim();
    const username = (params.get('username') || '').trim();

    const required = {
      pallet, customer, customerCode, productType, packageType, unitsPerPackage, packageQty, username
    };
    for (const [key, val] of Object.entries(required)) {
      if (!val) {
        return { statusCode: 400, body: JSON.stringify({ result: 'error', message: `Missing parameter: ${key}` }) };
      }
    }

    if (!isValidPallet(pallet)) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Invalid pallet' }) };
    }
    if (!PACKAGE_OPTIONS.includes(packageType)) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Invalid package type' }) };
    }
    if (packageType === PACKAGE_INDIVIDUAL) {
      if (Number(unitsPerPackage) !== 1) {
        return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Individual Units must have 1 unit per package' }) };
      }
    } else if (!isNumeric(unitsPerPackage) || Number(unitsPerPackage) <= 0) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Units per package must be numeric and greater than zero' }) };
    }
    if (!isNumeric(packageQty) || Number(packageQty) <= 0) {
      return { statusCode: 400, body: JSON.stringify({ result: 'error', message: 'Package quantity must be numeric and greater than zero' }) };
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
