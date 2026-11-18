const fetch = require('node-fetch');
const {
  DROPDOWNS_CSV_URL,
  listsFromCsv,
  validatePartsAdd,
  validatePartsReceipt,
  isMaintenanceId,
  jsonResponse
} = require('./maintenanceCore');
const scriptConfig = require('./scriptConfig');
const { explainScriptPage, readScriptText } = require('./submitFault');

const SHARED_TOKEN = 'J4PAN88';
const FAILURE = 'The server did not confirm that the parts were saved. Your answers are still here. Try again.';

function isHtml(text) {
  return /^\s*<!DOCTYPE/i.test(text) || /<html[\s>]/i.test(text);
}

async function loadPeople() {
  const csvResponse = await fetch(DROPDOWNS_CSV_URL, { timeout: 20000 });
  if (!csvResponse.ok) throw new Error('Dropdown list request failed (' + csvResponse.status + ').');
  const csvText = await csvResponse.text();
  if (!csvText || csvText.trim().charAt(0) === '<') throw new Error('Dropdown list did not return spreadsheet data.');
  const lists = listsFromCsv(csvText);
  if (!lists.operators.length) throw new Error('The people list was empty.');
  return lists.operators;
}

function confirmedParts(text, action) {
  var parsed = null;
  try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
  if (parsed && parsed.result === 'error') return jsonResponse(400, parsed);
  if (action === 'parts_jobs' && parsed && parsed.result === 'ok' && Array.isArray(parsed.requests) && Array.isArray(parsed.people)) {
    return jsonResponse(200, parsed);
  }
  if (action === 'parts_orders' && parsed && parsed.result === 'ok' && isMaintenanceId(parsed.maintenanceId) && Array.isArray(parsed.orders)) {
    return jsonResponse(200, parsed);
  }
  if (action === 'parts_add' && parsed && parsed.result === 'success' && isMaintenanceId(parsed.maintenanceId) && Array.isArray(parsed.parts) && parsed.parts.length) {
    return jsonResponse(200, parsed);
  }
  if (action === 'parts_receipt' && parsed && parsed.result === 'success' && isMaintenanceId(parsed.maintenanceId) && parsed.partId) {
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
        message: 'The parts order could not be read. Your answers are still here.'
      });
    }

    var action = String(payload.action || '').trim().toLowerCase();
    if (action !== 'parts_jobs' && action !== 'parts_orders' && action !== 'parts_add' && action !== 'parts_receipt') {
      return jsonResponse(400, { result: 'error', retryable: false, message: 'Unknown action.' });
    }

    if (action === 'parts_add') {
      const validated = validatePartsAdd(payload);
      if (!validated.ok) return jsonResponse(400, { result: 'error', retryable: true, message: validated.message });
      payload = validated.value;
    }
    if (action === 'parts_receipt') {
      const validated = validatePartsReceipt(payload);
      if (!validated.ok) return jsonResponse(400, { result: 'error', retryable: true, message: validated.message });
      payload = validated.value;
    }
    if (action === 'parts_orders') {
      const maintenanceId = String(payload.maintenanceId || '').trim().toUpperCase();
      if (!isMaintenanceId(maintenanceId)) {
        return jsonResponse(400, { result: 'error', retryable: true, message: 'Select a maintenance job.' });
      }
      payload = { maintenanceId: maintenanceId };
    }

    let people = [];
    if (action === 'parts_jobs' || action === 'parts_receipt') {
      try {
        people = await loadPeople();
      } catch (err) {
        return jsonResponse(502, {
          result: 'error',
          retryable: true,
          message: action === 'parts_receipt'
            ? 'The people list could not be loaded, so the receipt was not saved. Your answers are still here.'
            : 'The people list could not be loaded.'
        });
      }
    }

    const scriptURL = scriptConfig.getMaintenanceScriptUrl();
    if (!scriptURL) {
      return jsonResponse(500, { result: 'error', retryable: false, message: scriptConfig.missingMaintenanceUrlMessage() });
    }

    const body = new URLSearchParams();
    body.append('token', SHARED_TOKEN);
    body.append('action', action);
    if (action === 'parts_orders') body.append('maintenanceId', payload.maintenanceId);
    if (action === 'parts_add') {
      body.append('submissionId', payload.submissionId);
      body.append('label', payload.label);
      body.append('maintenanceId', payload.maintenanceId);
      body.append('items', JSON.stringify(payload.items));
    }
    if (action === 'parts_receipt') {
      body.append('submissionId', payload.submissionId);
      body.append('maintenanceId', payload.maintenanceId);
      body.append('partId', payload.partId);
      body.append('dateOrdered', payload.dateOrdered || '');
      body.append('dateArrived', payload.dateArrived || '');
      body.append('receivedBy', payload.receivedBy || '');
      body.append('checkedBy', payload.checkedBy || '');
      body.append('status', payload.status || '');
    }

    const text = await readScriptText(scriptURL, body);
    if (/Script function not found/i.test(text)) {
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: 'The deployed Maintenance web app does not include this parts action. In Apps Script, open Deploy, then Manage deployments, edit the existing deployment, select New version, and deploy again.'
      });
    }
    if (isHtml(text)) {
      const message = explainScriptPage(text);
      console.error('Maintenance web app returned HTML:', message);
      return jsonResponse(502, { result: 'error', retryable: true, message: message });
    }
    const confirmed = confirmedParts(text, action);
    if (action === 'parts_jobs' && confirmed.statusCode === 200) {
      const listed = JSON.parse(confirmed.body);
      listed.people = people;
      return jsonResponse(200, listed);
    }
    return confirmed;
  } catch (err) {
    console.error('Maintenance parts error:', err);
    return jsonResponse(500, {
      result: 'error',
      retryable: true,
      message: 'The parts were not saved. Your answers are still here.'
    });
  }
};
