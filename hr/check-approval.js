const app = document.getElementById('app');
const OVERTIME_STATUS_URL = `${window.location.origin}/.netlify/functions/getOvertimeApprovals`;

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function currentUsername() {
  return (typeof SCSAuth !== 'undefined' && SCSAuth.getUsername()) || '';
}

function showChoice() {
  const username = currentUsername() || 'User';
  app.innerHTML = `
    <p class="hr-welcome">Welcome, <span>${escapeHTML(username)}</span></p>
    <p class="hr-intro">Choose what you would like to review.</p>
    <div class="dash-grid">
      <button type="button" class="dash-card" onclick="showOvertimeStatus()">
        <span class="dash-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </span>
        <span class="dash-card-title">View Overtime</span>
        <span class="dash-card-desc">See approval status for your overtime submissions</span>
      </button>
      <button type="button" class="dash-card" onclick="showHoursPlaceholder()">
        <span class="dash-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg>
        </span>
        <span class="dash-card-title">View Hours Worked</span>
        <span class="dash-card-desc">Coming soon</span>
      </button>
    </div>
  `;
}

function showHoursPlaceholder() {
  app.innerHTML = `
    <div class="hr-form-card">
      <p class="hr-welcome">View Hours Worked</p>
      <p class="hr-intro">Coming soon.</p>
      <div class="actions">
        <button type="button" class="btn btn-ghost" onclick="showChoice()">Back</button>
      </div>
    </div>
  `;
}

function showOvertimeStatus() {
  const username = currentUsername();
  if (!username) {
    app.innerHTML = `
      <div class="hr-form-card">
        <p class="status text-error">You must be signed in to view overtime approvals.</p>
        <div class="actions">
          <a href="/" class="btn btn-primary">Sign in</a>
        </div>
      </div>
    `;
    return;
  }

  app.innerHTML = `
    <p class="hr-welcome">Overtime approvals for <span>${escapeHTML(username)}</span></p>
    <p class="status">Loading your overtime records…</p>
  `;

  const body = new URLSearchParams();
  body.append('username', username);

  fetch(OVERTIME_STATUS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
    .then(r => r.json())
    .then(data => {
      if (data.result !== 'success') {
        throw new Error(data.message || 'Failed to load overtime records.');
      }
      renderOvertimeTable(username, Array.isArray(data.rows) ? data.rows : []);
    })
    .catch(err => {
      console.error(err);
      app.innerHTML = `
        <div class="hr-form-card">
          <p class="status text-error">${escapeHTML(err.message || 'Failed to load overtime records.')}</p>
          <div class="actions">
            <button type="button" class="btn btn-ghost" onclick="showChoice()">Back</button>
            <button type="button" class="btn btn-primary" onclick="showOvertimeStatus()">Try again</button>
          </div>
        </div>
      `;
    });
}

function renderOvertimeTable(username, rows) {
  if (!rows.length) {
    app.innerHTML = `
      <p class="hr-welcome">Overtime approvals for <span>${escapeHTML(username)}</span></p>
      <div class="hr-form-card">
        <p class="hr-intro">No overtime records found for your account.</p>
        <div class="actions">
          <button type="button" class="btn btn-ghost" onclick="showChoice()">Back</button>
        </div>
      </div>
    `;
    return;
  }

  const bodyRows = rows.map(row => {
    const status = row.approvalStatus === 'Approved' ? 'Approved' : 'Awaiting Approval';
    const badgeClass = status === 'Approved'
      ? 'hr-status-badge hr-status-badge--approved'
      : 'hr-status-badge hr-status-badge--pending';
    return `
      <tr>
        <td data-label="Overtime Hours">${escapeHTML(row.overtimeHours || '-')}</td>
        <td data-label="Date">${escapeHTML(row.date || '-')}</td>
        <td data-label="Approval Status"><span class="${badgeClass}">${escapeHTML(status)}</span></td>
      </tr>
    `;
  }).join('');

  app.innerHTML = `
    <p class="hr-welcome">Overtime approvals for <span>${escapeHTML(username)}</span></p>
    <p class="hr-intro">${rows.length} record${rows.length === 1 ? '' : 's'} found.</p>
    <div class="table-wrap hr-approval-table">
      <table>
        <thead>
          <tr>
            <th>Overtime Hours</th>
            <th>Date</th>
            <th>Approval Status</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
      </table>
    </div>
    <div class="actions mt-3">
      <button type="button" class="btn btn-ghost" onclick="showChoice()">Back</button>
    </div>
  `;
}

window.showChoice = showChoice;
window.showOvertimeStatus = showOvertimeStatus;
window.showHoursPlaceholder = showHoursPlaceholder;

showChoice();
