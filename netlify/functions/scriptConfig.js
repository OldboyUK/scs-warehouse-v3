// Apps Script URL must be set in Netlify env (never commit the /exec URL to the repo).
// Warehouse, Auth, and HR are separate Apps Script deployments.
function getAppsScriptUrl(legacyEnvKey) {
  return (
    process.env.APPS_SCRIPT_URL ||
    (legacyEnvKey && process.env[legacyEnvKey]) ||
    ''
  );
}

function getAuthScriptUrl() {
  return process.env.AUTH_SCRIPT_URL || '';
}

function getHrScriptUrl() {
  return process.env.HR_SCRIPT_URL || '';
}

function missingUrlMessage(legacyEnvKey) {
  return `Missing Apps Script URL. Set APPS_SCRIPT_URL or ${legacyEnvKey} in Netlify env.`;
}

function missingAuthUrlMessage() {
  return 'Missing AUTH_SCRIPT_URL in Netlify env (SCS Auth Apps Script /exec URL).';
}

function missingHrUrlMessage() {
  return 'Missing HR_SCRIPT_URL in Netlify env (SCS HR Apps Script /exec URL).';
}

// Apps Script web apps often 302 after doPost has already written the row.
// Never pass Google's status through to the browser — the frontend treats
// non-2xx as a failed submit even when result is ok/success.
function appsScriptProxyResult(res, text) {
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) {}

  if (parsed && parsed.result === 'error') {
    return { statusCode: 400, body: JSON.stringify(parsed) };
  }
  if (parsed && (parsed.result === 'ok' || parsed.result === 'success')) {
    return { statusCode: 200, body: JSON.stringify(parsed) };
  }
  return { statusCode: 200, body: JSON.stringify({ result: 'ok' }) };
}

module.exports = {
  getAppsScriptUrl,
  getAuthScriptUrl,
  getHrScriptUrl,
  missingUrlMessage,
  missingAuthUrlMessage,
  missingHrUrlMessage,
  appsScriptProxyResult
};
