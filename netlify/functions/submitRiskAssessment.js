const fetch = require('node-fetch');
const { getHsScriptUrl, missingHsUrlMessage } = require('./scriptConfig');
const {
  ACTIVITIES_CSV_URL,
  activitiesFromCsv,
  validateSubmission
} = require('./riskAssessmentCore');

const SHARED_TOKEN = 'J4PAN88';

function jsonResponse(statusCode, body) {
  return { statusCode: statusCode, body: JSON.stringify(body) };
}

function confirmedProxyResult(text) {
  var parsed = null;
  try { parsed = JSON.parse(text); } catch (err) { parsed = null; }

  if (parsed && parsed.result === 'success' && parsed.hazardId && Array.isArray(parsed.actionIds)) {
    return jsonResponse(200, parsed);
  }
  if (parsed && parsed.result === 'error') {
    return jsonResponse(400, parsed);
  }

  return jsonResponse(502, {
    result: 'error',
    retryable: true,
    message: 'The server did not confirm that the risk assessment was saved. Your answers are still here. Submit again to retry. If the first attempt did save, you will see the original hazard ID instead of a duplicate.'
  });
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { result: 'error', message: 'Method Not Allowed' });
    }

    const scriptURL = getHsScriptUrl();
    if (!scriptURL) {
      return jsonResponse(500, { result: 'error', retryable: false, message: missingHsUrlMessage() });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '');
    } catch (err) {
      return jsonResponse(400, { result: 'error', retryable: true, message: 'The submission could not be read.' });
    }

    let activities;
    try {
      const csvResponse = await fetch(ACTIVITIES_CSV_URL);
      if (!csvResponse.ok) {
        throw new Error('Activity list request failed (' + csvResponse.status + ').');
      }
      const csvText = await csvResponse.text();
      if (!csvText || csvText.trim().charAt(0) === '<') {
        throw new Error('Activity list did not return spreadsheet data.');
      }
      activities = activitiesFromCsv(csvText);
      if (!activities.length) {
        throw new Error('The activity list was empty.');
      }
    } catch (err) {
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: 'Activities could not be loaded, so the assessment was not saved. ' + (err.message || 'Try again.')
      });
    }

    const validated = validateSubmission(payload, activities);
    if (!validated.ok) {
      return jsonResponse(400, { result: 'error', retryable: true, message: validated.message });
    }

    const body = Object.assign({}, validated.value, {
      token: SHARED_TOKEN,
      action: 'risk_assessment_submit'
    });

    const response = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    if (/Script function not found/i.test(text) || /^\s*<!DOCTYPE/i.test(text)) {
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: 'Health and Safety script is missing doPost. Copy the latest HealthSafety.js into Apps Script and redeploy.'
      });
    }

    return confirmedProxyResult(text);
  } catch (err) {
    console.error('Risk assessment submit error:', err);
    return jsonResponse(500, {
      result: 'error',
      retryable: true,
      message: 'The risk assessment was not saved. Try again.'
    });
  }
};
