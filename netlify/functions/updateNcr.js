const {
  validateSection2,
  isNcrNumber,
  jsonResponse,
  forwardQuality
} = require('./ncrCore');

const FAILURE = 'The server did not confirm that the investigation was saved. Your answers are still here. A new NCR was not created.';

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
        message: 'The investigation could not be read. Your answers are still here.'
      });
    }

    const validated = validateSection2(payload);
    if (!validated.ok) {
      return jsonResponse(400, { result: 'error', retryable: true, message: validated.message });
    }

    const value = validated.value;
    return forwardQuality('ncr_update', {
      ncrNumber: value.ncrNumber,
      findings: value.findings,
      correctiveActions: value.correctiveActions,
      correctiveDue: value.correctiveDue,
      correctiveComplete: value.correctiveComplete,
      rootCause: value.rootCause,
      preventativeActions: value.preventativeActions,
      preventativeDue: value.preventativeDue,
      preventativeComplete: value.preventativeComplete,
      ncrCompleted: value.ncrCompleted,
      completedBy: value.completedBy
    }, function (parsed) {
      return parsed.result === 'success' && parsed.ncrNumber === value.ncrNumber && isNcrNumber(parsed.ncrNumber);
    }, FAILURE);
  } catch (err) {
    console.error('NCR update error:', err);
    return jsonResponse(500, {
      result: 'error',
      retryable: true,
      message: 'The investigation was not saved. Your answers are still here.'
    });
  }
};
