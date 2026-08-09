// /.netlify/functions/getHoursWorkedApprovals.js
// Fetches the published hours-worked CSV server-side and returns only the
// signed-in user's rows (columns F, B, N). Full sheet never reaches the browser.
const fetch = require('node-fetch');
const { getAuthScriptUrl } = require('./scriptConfig');

const SHARED_TOKEN = 'J4PAN88';
const HOURS_WORKED_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRwmwFtehlAvkStjr7fPHhvV6tYNL6iGBprG2S5cKb5uXJprHkuiIJxyx17-vF4S3QKjmTRCoFIbu-a/pub?gid=1958661563&single=true&output=csv';

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.length > 1 || String(row[0] || '').trim()) rows.push(row);
  return rows;
}

function clean(value) {
  return String(value || '').trim();
}

function formatApprovalStatus(raw) {
  const v = clean(raw).toUpperCase();
  if (v === 'TRUE' || v === 'APPROVED' || v === 'YES' || v === '1') return 'Approved';
  return 'Awaiting Approval';
}

async function isKnownUsername(username) {
  const scriptURL = getAuthScriptUrl();
  if (!scriptURL) return true;

  try {
    const body = new URLSearchParams();
    body.append('action', 'auth_get_users');
    body.append('token', SHARED_TOKEN);

    const response = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const data = await response.json();
    const users = Array.isArray(data.users) ? data.users : [];
    return users.some(u => clean(u) === username);
  } catch (err) {
    console.error('Auth user check failed:', err);
    return true;
  }
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return json(405, { result: 'error', message: 'Method Not Allowed', rows: [] });
    }

    const params = new URLSearchParams(event.body || '');
    const username = clean(params.get('username'));

    if (!username) {
      return json(401, { result: 'error', message: 'Unauthorized', rows: [] });
    }

    const known = await isKnownUsername(username);
    if (!known) {
      return json(403, { result: 'error', message: 'Unauthorized', rows: [] });
    }

    const csvRes = await fetch(HOURS_WORKED_CSV_URL);
    if (!csvRes.ok) {
      return json(502, { result: 'error', message: 'Failed to load hours worked data.', rows: [] });
    }

    const text = await csvRes.text();
    const parsed = parseCSV(text);
    const rows = [];

    for (let i = 0; i < parsed.length; i++) {
      const r = parsed[i];
      const staff = clean(r[0]);
      if (!staff) continue;
      if (i === 0 && /staff/i.test(staff)) continue;
      if (staff !== username) continue;

      // F = Hours Worked (5), B = Date (1), N = Approval Status (13)
      rows.push({
        hoursWorked: clean(r[5]),
        date: clean(r[1]),
        approvalStatus: formatApprovalStatus(r[13])
      });
    }

    return json(200, { result: 'success', rows });
  } catch (err) {
    console.error('getHoursWorkedApprovals error:', err);
    return json(500, { result: 'error', message: 'Internal server error', rows: [] });
  }
};
