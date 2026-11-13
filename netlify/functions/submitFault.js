const fetch = require('node-fetch');
const {
  DROPDOWNS_CSV_URL,
  listsFromCsv,
  validateFault,
  isMaintenanceId,
  jsonResponse
} = require('./maintenanceCore');
const scriptConfig = require('./scriptConfig');

const SHARED_TOKEN = 'J4PAN88';
const FAILURE = 'The server did not confirm that the fault report was saved. Your answers are still here. Try again. If the first attempt did save, you will get the original maintenance ID instead of a duplicate.';

function confirmed(text) {
  var parsed = null;
  try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
  if (parsed && parsed.result === 'error') return jsonResponse(400, parsed);
  if (parsed && parsed.result === 'success' && isMaintenanceId(parsed.maintenanceId)) {
    return jsonResponse(200, parsed);
  }
  return jsonResponse(502, { result: 'error', retryable: true, message: FAILURE });
}

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

    let lists;
    try {
      const csvResponse = await fetch(DROPDOWNS_CSV_URL, { timeout: 20000 });
      if (!csvResponse.ok) throw new Error('Dropdown list request failed (' + csvResponse.status + ').');
      const csvText = await csvResponse.text();
      if (!csvText || csvText.trim().charAt(0) === '<') {
        throw new Error('Dropdown list did not return spreadsheet data.');
      }
      lists = listsFromCsv(csvText);
      if (!lists.operators.length || !lists.areas.length) throw new Error('The dropdown list was empty.');
    } catch (err) {
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: 'The line and equipment lists could not be loaded, so the report was not saved. Your answers are still here.'
      });
    }

    const validated = validateFault(payload, lists);
    if (!validated.ok) {
      return jsonResponse(400, { result: 'error', retryable: true, message: validated.message });
    }

    const scriptURL = scriptConfig.getMaintenanceScriptUrl();
    if (!scriptURL) {
      return jsonResponse(500, { result: 'error', retryable: false, message: scriptConfig.missingMaintenanceUrlMessage() });
    }

    const value = validated.value;
    const body = new URLSearchParams();
    body.append('token', SHARED_TOKEN);
    body.append('action', 'fault_create');
    body.append('submissionId', value.submissionId);
    body.append('reporterMode', value.reporterMode);
    body.append('operator', value.operator);
    body.append('area', String(payload.area || '').trim());
    body.append('areaOther', String(payload.areaOther || '').trim());
    body.append('equipment', String(payload.equipment || '').trim());
    body.append('equipmentOther', String(payload.equipmentOther || '').trim());
    body.append('priority', value.priority);
    body.append('description', value.description);
    body.append('parts', value.parts);
    body.append('maintenanceRequest', value.maintenanceRequest);

    const response = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
      timeout: 30000
    });
    const text = await response.text();
    if (/Script function not found/i.test(text)) {
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: 'The deployed Maintenance web app does not include doPost. In Apps Script, open Deploy, then Manage deployments, edit the existing deployment, select New version, and deploy again. MAINTENANCE_SCRIPT_URL must be that deployment’s /exec URL.'
      });
    }
    if (/^\s*<!DOCTYPE/i.test(text) || /<html[\s>]/i.test(text)) {
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: 'The Maintenance web app returned a web page instead of a saved result. Nothing was confirmed. Check that the deployment is Execute as: Me, Who has access: Anyone, and that MAINTENANCE_SCRIPT_URL is the /exec URL.'
      });
    }
    return confirmed(text);
  } catch (err) {
    console.error('Fault report error:', err);
    return jsonResponse(500, {
      result: 'error',
      retryable: true,
      message: 'The fault report was not saved. Your answers are still here.'
    });
  }
};
