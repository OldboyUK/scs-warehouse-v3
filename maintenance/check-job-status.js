var app = document.getElementById('app');
var SCRIPT_URL = '/.netlify/functions/checkJobStatus';

var STATUSES = {
  'Awaiting Review': 'status-awaiting-review',
  'Awaiting Parts': 'status-awaiting-parts',
  'Awaiting Completion': 'status-awaiting-completion',
  'Completed': 'status-completed',
  'Cancelled': 'status-cancelled',
  'Hold': 'status-hold'
};

var state = {
  view: 'list',
  jobs: [],
  loading: true,
  error: '',
  detail: null,
  detailLoading: false,
  detailError: '',
  thumbs: {},
  full: {},
  viewer: null,
  listScroll: 0
};

var photoToken = 0;

function escapeHTML(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (match) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match];
  });
}

function statusClass(status) {
  return STATUSES[status] || 'status-none';
}

function statusBadge(status) {
  var label = status || 'No status';
  return '<span class="status-badge ' + statusClass(status) + '">' + escapeHTML(label) + '</span>';
}

function shown(value, empty) {
  if (!String(value || '').trim()) return '<p class="status-text">' + escapeHTML(empty) + '</p>';
  return '<p class="status-text">' + escapeHTML(value) + '</p>';
}

async function postJson(body) {
  var response = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  var text = await response.text();
  try { return JSON.parse(text); } catch (err) { return null; }
}

function render() {
  if (state.view === 'detail') {
    app.innerHTML = renderDetail();
    wireDetail();
    loadMissingPhotos();
    return;
  }
  app.innerHTML = renderList();
  wireList();
}

function renderList() {
  if (state.loading) return '<p class="status" role="status">Loading maintenance jobs…</p>';
  if (state.error) {
    return '<div class="fault-banner" role="alert">' + escapeHTML(state.error) + '</div>' +
      '<div class="actions"><button type="button" class="btn btn-primary" id="retryJobs">Try again</button></div>';
  }
  if (!state.jobs.length) return '<p class="fault-intro">No maintenance jobs have been recorded yet.</p>';
  var rows = '';
  for (var i = 0; i < state.jobs.length; i++) {
    var job = state.jobs[i];
    rows += '<tr>' +
      '<td class="status-job">' + escapeHTML(job.label) + '</td>' +
      '<td>' + statusBadge(job.status) + '</td>' +
      '<td><button type="button" class="btn btn-secondary status-open" data-open-row="' + escapeHTML(job.row) + '">Open Job</button></td>' +
      '</tr>';
  }
  return '<div class="status-wrap"><table class="status-table">' +
    '<thead><tr><th>Job</th><th>Job Status</th><th></th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';
}

function renderDetail() {
  if (state.detailLoading) return '<p class="status" role="status">Loading the job…</p>';
  if (state.detailError || !state.detail) {
    return '<div class="fault-banner" role="alert">' + escapeHTML(state.detailError || 'The job could not be loaded.') + '</div>' +
      '<div class="actions"><button type="button" class="btn btn-secondary" id="backToList">Back</button></div>';
  }
  var job = state.detail;
  var parts = job.partsError
    ? '<p class="status-text">Parts summary is unavailable.</p>'
    : shown(job.parts, 'No parts recorded');
  return '<div class="actions"><button type="button" class="btn btn-secondary" id="backToList">Back</button></div>' +
    '<header class="status-header">' +
      '<p class="status-kicker">' + escapeHTML(job.maintenanceId || 'Maintenance job') + '</p>' +
      '<h2>' + escapeHTML(job.label) + '</h2>' +
      statusBadge(job.status) +
      '<p class="status-text">Priority: ' + escapeHTML(job.priority || 'Not recorded') + '</p>' +
    '</header>' +
    section('Fault Report',
      line('Date', job.date) +
      line('Reporter', job.reporter) +
      line('Line / Area', job.lineArea) +
      line('Machine / Equipment', job.equipment) +
      line('Priority', job.priority) +
      '<h4>Description of Issue</h4>' + shown(job.description, 'Not recorded') +
      photoBlock('Original fault photographs', 'requests', job.requestsPhotos, job.requestsFolderUrl, job.requestsPhotoMessage)
    ) +
    section('Assignment & Review',
      line('Owner', job.owner) +
      line('Due Date', job.dueDate) +
      '<h4>Impact to Food Safety / Health & Safety</h4>' + shown(job.assessment, 'Not recorded') +
      '<h4>Parts Ordered</h4>' + parts
    ) +
    section('Work & Completion',
      line('Permit to Work Number', job.permit) +
      '<h4>Work Undertaken</h4>' + shown(job.workUndertaken, 'Not recorded') +
      '<h4>Work Outstanding</h4>' + shown(job.workOutstanding, 'Not recorded') +
      line('Job Completion', job.completed === 'Yes' || job.completed === 'No' ? job.completed : '') +
      '<h4>Current Job Status</h4><p class="status-text">' + statusBadge(job.status) + '</p>' +
      photoBlock('Work Undertaken photographs', 'work', job.workPhotos, job.workFolderUrl, job.workPhotoMessage)
    ) +
    lightbox();
}

function section(title, body) {
  return '<section class="status-section"><h3>' + escapeHTML(title) + '</h3>' + body + '</section>';
}

function line(label, value) {
  return '<p class="status-text"><strong>' + escapeHTML(label) + ':</strong> ' + escapeHTML(String(value || '').trim() || 'Not recorded') + '</p>';
}

function photoBlock(title, kind, photos, folderUrl, message) {
  var html = '<h4>' + escapeHTML(title) + '</h4>';
  if (message) html += '<p class="status-text">' + escapeHTML(message) + '</p>';
  if (!photos || !photos.length) {
    html += '<p class="status-text">No photographs have been added.</p>';
  } else {
    html += '<div class="status-gallery">';
    for (var i = 0; i < photos.length; i++) {
      var photo = photos[i];
      var key = kind + ':' + photo.id;
      var src = state.thumbs[key] || state.full[key] || '';
      html += '<button type="button" class="status-thumb" data-kind="' + kind + '" data-file="' + escapeHTML(photo.id) + '" data-name="' + escapeHTML(photo.name || 'Photograph') + '">';
      if (src) html += '<img src="' + src + '" alt="' + escapeHTML(photo.name || 'Photograph') + '" />';
      else html += escapeHTML(photo.name || 'Photograph');
      html += '</button>';
    }
    html += '</div>';
  }
  if (folderUrl) {
    html += '<p class="status-text"><a href="' + escapeHTML(folderUrl) + '" target="_blank" rel="noopener">Open the Drive folder</a></p>';
  }
  return html;
}

function lightbox() {
  if (!state.viewer) return '';
  var src = state.full[state.viewer.key] || state.thumbs[state.viewer.key] || '';
  return '<div class="status-lightbox" role="dialog" aria-modal="true" aria-label="Photograph">' +
    '<button type="button" class="btn btn-secondary" id="closePhoto">Close</button>' +
    (src ? '<img src="' + src + '" alt="' + escapeHTML(state.viewer.name) + '" />' : '<p class="status">Loading photograph…</p>') +
    '</div>';
}

function wireList() {
  var retry = document.getElementById('retryJobs');
  if (retry) retry.addEventListener('click', loadJobs);
  var buttons = app.querySelectorAll('[data-open-row]');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', function (event) {
      openJob(event.currentTarget.getAttribute('data-open-row'));
    });
  }
  if (state.listScroll) window.scrollTo(0, state.listScroll);
}

function wireDetail() {
  var back = document.getElementById('backToList');
  if (back) back.addEventListener('click', showList);
  var thumbs = app.querySelectorAll('.status-thumb');
  for (var i = 0; i < thumbs.length; i++) {
    thumbs[i].addEventListener('click', function (event) {
      var button = event.currentTarget;
      openPhoto(button.getAttribute('data-kind'), button.getAttribute('data-file'), button.getAttribute('data-name'));
    });
  }
  var close = document.getElementById('closePhoto');
  if (close) close.addEventListener('click', closePhoto);
}

function showList() {
  photoToken += 1;
  state.view = 'list';
  state.viewer = null;
  render();
}

function jobByRow(row) {
  for (var i = 0; i < state.jobs.length; i++) {
    if (String(state.jobs[i].row) === String(row)) return state.jobs[i];
  }
  return null;
}

async function openJob(row) {
  var job = jobByRow(row);
  if (!job) return;
  state.listScroll = window.scrollY || 0;
  state.view = 'detail';
  state.detail = null;
  state.detailLoading = true;
  state.detailError = '';
  state.viewer = null;
  render();
  try {
    var body = await postJson({
      action: 'status_detail',
      row: job.row,
      label: job.label,
      maintenanceId: job.maintenanceId || ''
    });
    if (!body || body.result !== 'ok') throw new Error((body && body.message) || 'The job could not be loaded.');
    state.detail = body;
    state.detailLoading = false;
    render();
  } catch (err) {
    state.detailLoading = false;
    state.detailError = err && err.message ? err.message : 'The job could not be loaded.';
    render();
  }
}

function photoKey(kind, fileId) {
  return kind + ':' + fileId;
}

async function loadMissingPhotos() {
  if (!state.detail || state.view !== 'detail') return;
  var token = ++photoToken;
  var groups = [
    { kind: 'requests', photos: state.detail.requestsPhotos || [] },
    { kind: 'work', photos: state.detail.workPhotos || [] }
  ];
  for (var g = 0; g < groups.length; g++) {
    for (var i = 0; i < groups[g].photos.length; i++) {
      var photo = groups[g].photos[i];
      var key = photoKey(groups[g].kind, photo.id);
      if (state.thumbs[key] || state.full[key]) continue;
      var body = await postJson({
        action: 'status_photo',
        row: state.detail.row,
        label: state.detail.label,
        maintenanceId: state.detail.maintenanceId || '',
        folderKind: groups[g].kind,
        fileId: photo.id,
        size: 'thumb'
      });
      if (token !== photoToken || state.view !== 'detail') return;
      if (body && body.result === 'ok' && body.imageBase64) {
        state.thumbs[key] = 'data:' + (body.mimeType || 'image/jpeg') + ';base64,' + body.imageBase64;
        render();
      }
    }
  }
}

async function openPhoto(kind, fileId, name) {
  if (!state.detail || !fileId) return;
  var key = photoKey(kind, fileId);
  state.viewer = { key: key, kind: kind, fileId: fileId, name: name || 'Photograph' };
  render();
  if (state.full[key]) return;
  var body = await postJson({
    action: 'status_photo',
    row: state.detail.row,
    label: state.detail.label,
    maintenanceId: state.detail.maintenanceId || '',
    folderKind: kind,
    fileId: fileId,
    size: 'full'
  });
  if (!state.viewer || state.viewer.key !== key) return;
  if (body && body.result === 'ok' && body.imageBase64) {
    state.full[key] = 'data:' + (body.mimeType || 'image/jpeg') + ';base64,' + body.imageBase64;
    render();
  }
}

function closePhoto() {
  state.viewer = null;
  render();
}

async function loadJobs() {
  state.loading = true;
  state.error = '';
  state.view = 'list';
  render();
  try {
    var body = await postJson({ action: 'status_jobs' });
    if (!body || body.result !== 'ok' || !Array.isArray(body.jobs)) {
      throw new Error((body && body.message) || 'The maintenance jobs could not be loaded.');
    }
    state.jobs = body.jobs;
    state.loading = false;
    render();
  } catch (err) {
    state.loading = false;
    state.error = err && err.message ? err.message : 'The maintenance jobs could not be loaded.';
    render();
  }
}

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && state.viewer) closePhoto();
});

loadJobs();
