const { isNcrNumber, jsonResponse, forwardQuality } = require('./ncrCore');

const FAILURE = 'The NCR could not be loaded. Section 2 was not opened.';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { result: 'error', message: 'Method Not Allowed' });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '');
    } catch (err) {
      return jsonResponse(400, { result: 'error', message: 'The NCR number could not be read.' });
    }

    const ncrNumber = String(payload.ncrNumber || '').trim().toUpperCase();
    if (!isNcrNumber(ncrNumber)) {
      return jsonResponse(400, { result: 'error', message: 'Enter a valid NCR number, such as NCR26-001.' });
    }

    return forwardQuality('ncr_get', { ncrNumber: ncrNumber }, function (parsed) {
      return parsed.result === 'success' && parsed.ncrNumber === ncrNumber && isNcrNumber(parsed.ncrNumber);
    }, FAILURE);
  } catch (err) {
    console.error('NCR load error:', err);
    return jsonResponse(500, { result: 'error', retryable: true, message: FAILURE });
  }
};
