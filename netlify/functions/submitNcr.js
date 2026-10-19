const {
  validateSection1,
  isNcrNumber,
  jsonResponse,
  forwardQuality
} = require('./ncrCore');

const FAILURE = 'The server did not confirm that the NCR was saved. Your answers are still here. Try again. If the first attempt did save, you will get the original NCR number instead of a duplicate.';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { result: 'error', message: 'Method Not Allowed' });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '');
    } catch (err) {
      return jsonResponse(400, {
        result: 'error',
        retryable: true,
        message: 'The submission could not be read. Your answers are still here.'
      });
    }

    const validated = validateSection1(payload);
    if (!validated.ok) {
      return jsonResponse(400, { result: 'error', retryable: true, message: validated.message });
    }

    const value = validated.value;
    return forwardQuality('ncr_create', {
      submissionId: value.submissionId,
      priority: value.priority,
      reporter: value.reporter,
      category: value.category,
      batches: value.batches,
      description: value.description,
      involved: value.involved,
      happened: value.happened,
      whenOccurred: value.whenOccurred,
      whereOccurred: value.whereOccurred,
      why: value.why,
      remedial: value.remedial
    }, function (parsed) {
      return parsed.result === 'success' && isNcrNumber(parsed.ncrNumber);
    }, FAILURE);
  } catch (err) {
    console.error('NCR create error:', err);
    return jsonResponse(500, {
      result: 'error',
      retryable: true,
      message: 'The NCR was not saved. Your answers are still here.'
    });
  }
};
