// Apps Script URL must be set in Netlify env (never commit the /exec URL to the repo).
// Preferred: APPS_SCRIPT_URL — legacy per-function keys still supported as fallback.
function getAppsScriptUrl(legacyEnvKey) {
  return (
    process.env.APPS_SCRIPT_URL ||
    (legacyEnvKey && process.env[legacyEnvKey]) ||
    ''
  );
}

function missingUrlMessage(legacyEnvKey) {
  return `Missing Apps Script URL. Set APPS_SCRIPT_URL or ${legacyEnvKey} in Netlify env.`;
}

module.exports = { getAppsScriptUrl, missingUrlMessage };
