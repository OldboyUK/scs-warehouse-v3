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

    const body = new URLSearchParams();
    body.append('token', SHARED_TOKEN);
    body.append('action', 'risk_assessment_submit');
    body.append('submissionId', validated.value.submissionId);
    body.append('activity', validated.value.activity);
    body.append('hazardName', validated.value.hazardName);
    body.append('hazardDescription', validated.value.hazardDescription);
    body.append('whoMightBeHarmed', validated.value.whoMightBeHarmed);
    body.append('currentControls', validated.value.currentControls);
    body.append('likelihood', String(validated.value.likelihood));
    body.append('severity', String(validated.value.severity));
    body.append('actions', JSON.stringify(validated.value.actions));

    const response = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const text = await response.text();
    if (/Script function not found/i.test(text)) {
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: 'The deployed Health and Safety web app does not include doPost. In Apps Script, open Deploy, then Manage deployments, edit the existing deployment, select New version, and deploy again. HS_SCRIPT_URL must be that deployment’s /exec URL.'
      });
    }
    if (/^\s*<!DOCTYPE/i.test(text) || /<html[\s>]/i.test(text)) {
      console.error('Health and Safety script returned HTML:', text.slice(0, 300));
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: 'The Health and Safety web app returned a web page instead of a result. Check that the deployment is Execute as: Me, Who has access: Anyone, and that HS_SCRIPT_URL is the /exec URL from that deployment, not the /dev URL.'
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
