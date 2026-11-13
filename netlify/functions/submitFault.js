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
const SIGN_IN_PAGE = 'Google asked for a sign-in, so the report was not saved. Netlify is not signed in. Edit the deployment: Execute as Me, and Who has access must be “Anyone, even anonymous”. If the menu lists Anyone and Anyone with a Google account, choose Anyone. Then select New version, Deploy, and set MAINTENANCE_SCRIPT_URL to the /exec URL.';

function isHtml(text) {
  return /^\s*<!DOCTYPE/i.test(text) || /<html[\s>]/i.test(text);
}

function scriptHost(url) {
  try {
    return new URL(url).hostname;
  } catch (err) {
    return '';
  }
}

function isScriptResultUrl(url) {
  var host = scriptHost(url);
  return host === 'script.google.com' || host === 'script.googleusercontent.com';
}

function isSignInUrl(url) {
  var host = scriptHost(url);
  return host === 'accounts.google.com' || /ServiceLogin|signin/i.test(url);
}

function scriptResultUrl(text) {
  var patterns = [
    /<a[^>]+href=["']([^"']+)["']/gi,
    /<form[^>]+action=["']([^"']+)["']/gi,
    /content=["']\d+\s*;\s*url=([^"']+)["']/gi,
    /https:\/\/script\.googleusercontent\.com\/[^\s"'<>]+/gi
  ];
  var i;
  for (i = 0; i < patterns.length; i++) {
    var match;
    patterns[i].lastIndex = 0;
    while ((match = patterns[i].exec(String(text || '')))) {
      var url = String(match[1] || match[0]).replace(/&amp;/g, '&');
      if (isScriptResultUrl(url)) return url;
    }
  }
  return '';
}

function explainScriptPage(text) {
  var sample = String(text || '');
  var titleMatch = sample.match(/<title[^>]*>([^<]*)<\/title>/i);
  var title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
  if (/sign in - google accounts|accounts\.google\.com|choose an account|servicelogin/i.test(sample)) {
    return SIGN_IN_PAGE;
  }
  if (/authorization is required|authorization needed|you need to authorize|review permissions/i.test(sample)) {
    return 'The Maintenance script has not been authorized, so the report was not saved. In the Apps Script editor, select doGet, Run it, and allow spreadsheet access and connecting to an external service. Then edit the deployment, choose New version, and Deploy.';
  }
  if (/duplicate function|syntax error/i.test(sample)) {
    return 'The Maintenance script did not load, so the report was not saved. Put Maintenance.js in its own Apps Script project, with no other doPost, then deploy that project as a web app and use its /exec URL.';
  }
  if (/unable to open the file|page not found|error 404/i.test(sample) || /not found/i.test(title)) {
    return 'The Maintenance web app URL could not be opened, so the report was not saved. MAINTENANCE_SCRIPT_URL must be the /exec URL from Deploy, Manage deployments.';
  }
  var plain = sample
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  var detail = title || plain;
  return 'The Maintenance web app returned a web page instead of a saved result. Nothing was confirmed.' +
    (detail ? ' Google’s page said: ' + detail + '.' : '');
}

async function readScriptText(scriptURL, body) {
  const first = await fetch(scriptURL, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'SCS-WMS-Maintenance'
    },
    body: body,
    timeout: 30000
  });
  const location = first.headers.get('location') || '';
  let text = await first.text();
  if (first.status >= 300 && first.status < 400 && location) {
    if (isSignInUrl(location)) {
      return '<!DOCTYPE html><html><head><title>Sign in - Google Accounts</title></head><body>accounts.google.com ServiceLogin</body></html>';
    }
    if (isScriptResultUrl(location)) {
      const second = await fetch(location, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': 'SCS-WMS-Maintenance' },
        timeout: 30000
      });
      return second.text();
    }
  }
  if (isHtml(text)) {
    const next = scriptResultUrl(text);
    if (next) {
      const third = await fetch(next, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': 'SCS-WMS-Maintenance' },
        timeout: 30000
      });
      text = await third.text();
    }
  }
  return text;
}

function confirmed(text) {
  var parsed = null;
  try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
  if (parsed && parsed.result === 'error') return jsonResponse(400, parsed);
  if (parsed && parsed.result === 'success' && isMaintenanceId(parsed.maintenanceId)) {
    return jsonResponse(200, parsed);
  }
  return jsonResponse(502, { result: 'error', retryable: true, message: FAILURE });
}

exports.explainScriptPage = explainScriptPage;
exports.scriptResultUrl = scriptResultUrl;
exports.SIGN_IN_PAGE = SIGN_IN_PAGE;

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
    body.append('user', value.user);
    body.append('reporter', value.reporter);
    body.append('area', String(payload.area || '').trim());
    body.append('areaOther', String(payload.areaOther || '').trim());
    body.append('equipment', String(payload.equipment || '').trim());
    body.append('equipmentOther', String(payload.equipmentOther || '').trim());
    body.append('priority', value.priority);
    body.append('description', value.description);
    body.append('parts', value.parts);
    body.append('maintenanceRequest', value.maintenanceRequest);

    const text = await readScriptText(scriptURL, body);
    if (/Script function not found/i.test(text)) {
      return jsonResponse(502, {
        result: 'error',
        retryable: true,
        message: 'The deployed Maintenance web app does not include doPost. In Apps Script, open Deploy, then Manage deployments, edit the existing deployment, select New version, and deploy again. MAINTENANCE_SCRIPT_URL must be that deployment’s /exec URL.'
      });
    }
    if (isHtml(text)) {
      const message = explainScriptPage(text);
      console.error('Maintenance web app returned HTML:', message);
      return jsonResponse(502, { result: 'error', retryable: true, message: message });
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
