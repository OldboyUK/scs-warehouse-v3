var app = document.getElementById('app');

var SCRIPT_URL = '/.netlify/functions/orderParts';
var DRAFT_KEY = 'scs_order_parts_draft';
var RECEIPT_STATUSES = ['As Described', 'Purchased Wrong Item', 'Received Wrong Item', 'Arrived Broken'];

var state = {
  requests: [],
  people: [],
  label: '',
  orders: [],
  items: [],
  submissionId: '',
  listsLoading: true,
  listsError: '',
  ordersLoading: false,
  ordersError: '',
  saving: false,
  savingKind: '',
  error: '',
  notice: '',
  fieldErrors: {}
};

var receiptIds = {};

function createSubmissionId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) {
    var rand = Math.random() * 16 | 0;
    var value = ch === 'x' ? rand : (rand & 0x3 | 0x8);
    return value.toString(16);
  });
}

function blankItem() {
  return { key: createSubmissionId(), purchaser: '', name: '', supplier: '', dateOrdered: '' };
}

function escapeHTML(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (match) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match];
  });
}

function idFromLabel(label) {
  var text = String(label || '').trim();
  var cut = text.indexOf(' | ');
  if (cut < 0) return '';
  var id = text.slice(0, cut).trim().toUpperCase();
  if (!/^MA\d{4}$/.test(id)) return '';
  if (!text.slice(cut + 3).trim()) return '';
  return id;
}

function ukDate(iso) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!match) return '';
  return match[3] + '/' + match[2] + '/' + match[1];
}

function queryJob() {
  try {
    var job = String(new URLSearchParams(window.location.search).get('job') || '').trim().toUpperCase();
    return /^MA\d{4}$/.test(job) ? job : '';
  } catch (err) {
    return '';
  }
}

function selectedRequest() {
  for (var i = 0; i < state.requests.length; i++) {
    if (state.requests[i].label === state.label) return state.requests[i];
  }
  return null;
}

function restoreDraft() {
  state.submissionId = createSubmissionId();
  state.items = [blankItem()];
  try {
    var raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    var draft = JSON.parse(raw);
    if (!draft || typeof draft !== 'object') return;
    if (draft.submissionId) state.submissionId = String(draft.submissionId);
    state.label = String(draft.label || '');
    if (Array.isArray(draft.items) && draft.items.length) {
      state.items = draft.items.map(function (item) {
        return {
          key: String(item.key || createSubmissionId()),
          purchaser: String(item.purchaser || ''),
          name: String(item.name || ''),
          supplier: String(item.supplier || ''),
          dateOrdered: /^\d{4}-\d{2}-\d{2}$/.test(String(item.dateOrdered || '')) ? String(item.dateOrdered) : ''
        };
      });
    }
  } catch (err) {}
}

function persist() {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      submissionId: state.submissionId,
      label: state.label,
      items: state.items
    }));
  } catch (err) {}
}

function bannerHtml() {
  if (!state.error) return '';
  return '<div class="fault-banner" role="alert">' + escapeHTML(state.error) + '</div>';
}

function fieldError(key) {
  if (!state.fieldErrors[key]) return '';
  return '<p class="fault-error" id="' + key + '-error">' + escapeHTML(state.fieldErrors[key]) + '</p>';
}

function invalidClass(key) {
  return state.fieldErrors[key] ? 'fault-invalid' : '';
}

function describedBy(key) {
  return state.fieldErrors[key] ? ' aria-invalid="true" aria-describedby="' + key + '-error"' : '';
}

function personOptions(selected) {
  var names = state.people.slice();
  if (selected && names.indexOf(selected) === -1) names.push(selected);
  var html = '<option value="">Select…</option>';
  for (var i = 0; i < names.length; i++) {
    html += '<option value="' + escapeHTML(names[i]) + '"' + (names[i] === selected ? ' selected' : '') + '>' + escapeHTML(names[i]) + '</option>';
  }
  return html;
}

function statusOptions(selected) {
  var statuses = RECEIPT_STATUSES.slice();
  if (selected && statuses.indexOf(selected) === -1) statuses.push(selected);
  var html = '<option value="">Select…</option>';
  for (var i = 0; i < statuses.length; i++) {
    html += '<option value="' + escapeHTML(statuses[i]) + '"' + (statuses[i] === selected ? ' selected' : '') + '>' + escapeHTML(statuses[i]) + '</option>';
  }
  return html;
}

function render() {
  if (state.listsLoading) {
    app.innerHTML = '<p class="status" role="status">Loading maintenance jobs…</p>';
    return;
  }
  if (state.listsError) {
    app.innerHTML = bannerHtml() +
      '<p class="fault-intro">' + escapeHTML(state.listsError) + '</p>' +
      '<div class="actions"><button type="button" class="btn btn-primary" id="retryLists">Try again</button></div>';
    document.getElementById('retryLists').addEventListener('click', loadJobs);
    return;
  }
  app.innerHTML = renderForm();
  wire();
}

function renderItems(disabled) {
  var html = '';
  for (var i = 0; i < state.items.length; i++) {
    var item = state.items[i];
    var key = item.key;
    html += '<section class="parts-item">' +
      '<div class="parts-item-head"><h3>Part ' + (i + 1) + '</h3>' +
      (state.items.length > 1
        ? '<button type="button" class="btn btn-secondary parts-remove" data-remove="' + escapeHTML(key) + '"' + disabled + '>Remove</button>'
        : '') +
      '</div>' +
      '<label class="fault-question" for="purchaser-' + escapeHTML(key) + '">Purchaser <span class="fault-req">Required</span></label>' +
      '<input id="purchaser-' + escapeHTML(key) + '" data-item="' + escapeHTML(key) + '" data-field="purchaser" type="text" maxlength="200" value="' + escapeHTML(item.purchaser) + '" class="' + invalidClass('purchaser-' + key) + '"' + describedBy('purchaser-' + key) + disabled + ' autocomplete="name" />' +
      fieldError('purchaser-' + key) +
      '<label class="fault-question" for="name-' + escapeHTML(key) + '">Name of Part <span class="fault-req">Required</span></label>' +
      '<input id="name-' + escapeHTML(key) + '" data-item="' + escapeHTML(key) + '" data-field="name" type="text" maxlength="200" value="' + escapeHTML(item.name) + '" class="' + invalidClass('name-' + key) + '"' + describedBy('name-' + key) + disabled + ' autocomplete="off" />' +
      fieldError('name-' + key) +
      '<label class="fault-question" for="supplier-' + escapeHTML(key) + '">Supplier <span class="fault-req">Required</span></label>' +
      '<input id="supplier-' + escapeHTML(key) + '" data-item="' + escapeHTML(key) + '" data-field="supplier" type="text" maxlength="200" value="' + escapeHTML(item.supplier) + '" class="' + invalidClass('supplier-' + key) + '"' + describedBy('supplier-' + key) + disabled + ' autocomplete="organization" />' +
      fieldError('supplier-' + key) +
      '<label class="fault-question" for="ordered-' + escapeHTML(key) + '">Date Ordered</label>' +
      '<input id="ordered-' + escapeHTML(key) + '" data-item="' + escapeHTML(key) + '" data-field="dateOrdered" type="date" value="' + escapeHTML(item.dateOrdered) + '" class="' + invalidClass('ordered-' + key) + '"' + describedBy('ordered-' + key) + disabled + ' />' +
      '<p class="fault-hint">Leave blank if it has not been ordered yet.' + (ukDate(item.dateOrdered) ? ' Saved as ' + escapeHTML(ukDate(item.dateOrdered)) + '.' : '') + '</p>' +
      fieldError('ordered-' + key) +
      '</section>';
  }
  return html;
}

function renderOrders(disabled) {
  if (!state.label) return '';
  var body = '';
  if (state.ordersLoading) body = '<p class="status" role="status">Loading current orders…</p>';
  else if (state.ordersError) body = '<p class="fault-error">' + escapeHTML(state.ordersError) + '</p>';
  else if (!state.orders.length) body = '<p class="review-note">No parts have been recorded against this maintenance job yet.</p>';
  else {
    for (var i = 0; i < state.orders.length; i++) body += renderOrder(state.orders[i], disabled);
  }
  return '<hr class="parts-divider" />' +
    '<h2 class="fault-question">Current Orders Under This Job</h2>' +
    body;
}

function renderOrder(order, disabled) {
  var shownOrdered = order.dateOrderedUk || ukDate(order.dateOrdered);
  var shownArrived = order.dateArrivedUk || ukDate(order.dateArrived);
  return '<article class="parts-card">' +
    '<div class="parts-card-head"><h3>' + escapeHTML(order.partId) + '</h3></div>' +
    '<p class="parts-meta"><strong>' + escapeHTML(order.name || 'Unnamed part') + '</strong><br />' +
      'Purchaser: ' + escapeHTML(order.purchaser || '—') + '<br />' +
      'Supplier: ' + escapeHTML(order.supplier || '—') +
      (shownOrdered ? '<br />Date ordered: ' + escapeHTML(shownOrdered) : '') +
      (shownArrived ? '<br />Date arrived: ' + escapeHTML(shownArrived) : '') +
    '</p>' +
    '<label class="fault-question" for="receipt-ordered-' + escapeHTML(order.partId) + '">Date Ordered</label>' +
    '<input id="receipt-ordered-' + escapeHTML(order.partId) + '" data-receipt="' + escapeHTML(order.partId) + '" data-field="dateOrdered" type="date" value="' + escapeHTML(order.dateOrdered) + '"' + disabled + ' />' +
    '<label class="fault-question" for="receipt-arrived-' + escapeHTML(order.partId) + '">Date Arrived</label>' +
    '<input id="receipt-arrived-' + escapeHTML(order.partId) + '" data-receipt="' + escapeHTML(order.partId) + '" data-field="dateArrived" type="date" value="' + escapeHTML(order.dateArrived) + '"' + disabled + ' />' +
    '<label class="fault-question" for="receipt-received-' + escapeHTML(order.partId) + '">Received by</label>' +
    '<select id="receipt-received-' + escapeHTML(order.partId) + '" data-receipt="' + escapeHTML(order.partId) + '" data-field="receivedBy"' + disabled + '>' + personOptions(order.receivedBy) + '</select>' +
    '<label class="fault-question" for="receipt-checked-' + escapeHTML(order.partId) + '">Checked by</label>' +
    '<select id="receipt-checked-' + escapeHTML(order.partId) + '" data-receipt="' + escapeHTML(order.partId) + '" data-field="checkedBy"' + disabled + '>' + personOptions(order.checkedBy) + '</select>' +
    '<label class="fault-question" for="receipt-status-' + escapeHTML(order.partId) + '">Receipt status</label>' +
    '<select id="receipt-status-' + escapeHTML(order.partId) + '" data-receipt="' + escapeHTML(order.partId) + '" data-field="status"' + disabled + '>' + statusOptions(order.status) + '</select>' +
    fieldError('receipt-' + order.partId) +
    '<div class="actions"><button type="button" class="btn btn-primary" data-save-receipt="' + escapeHTML(order.partId) + '"' + disabled + '>Save receipt</button></div>' +
    '</article>';
}

function renderForm() {
  var disabled = state.saving ? ' disabled' : '';
  var selected = selectedRequest();
  var options = '<option value="">Select a maintenance job…</option>';
  for (var i = 0; i < state.requests.length; i++) {
    options += '<option value="' + escapeHTML(state.requests[i].label) + '"' +
      (state.requests[i].label === state.label ? ' selected' : '') + '>' +
      escapeHTML(state.requests[i].label) + '</option>';
  }
  var selectedLine = selected
    ? '<p class="review-selected">Parts will be linked to <strong>' + escapeHTML(selected.label) + '</strong>.</p>'
    : '';
  var notice = state.notice ? '<p class="review-note" role="status">' + escapeHTML(state.notice) + '</p>' : '';
  return bannerHtml() +
    '<form id="partsForm" novalidate>' +
      '<p class="fault-intro">Add one or more parts to an existing maintenance job. This does not create a new maintenance ID.</p>' +
      notice +
      '<label class="fault-question" for="request">Select a maintenance job <span class="fault-req">Required</span></label>' +
      '<select id="request" class="' + invalidClass('request') + '"' + describedBy('request') + disabled + '>' + options + '</select>' +
      fieldError('request') +
      selectedLine +
      '<h2 class="fault-question">Add parts</h2>' +
      renderItems(disabled) +
      '<div class="actions">' +
        '<button type="button" class="btn btn-secondary" id="addItem"' + disabled + '>+ Add Another Item</button>' +
      '</div>' +
      '<div class="actions">' +
        '<button type="submit" class="btn btn-primary btn-block" id="submitBtn"' + disabled + '>' +
          (state.savingKind === 'parts' ? 'Saving…' : 'Save parts') +
        '</button>' +
      '</div>' +
      (state.saving ? '<p class="status" role="status">Saving…</p>' : '') +
      renderOrders(disabled) +
    '</form>';
}

function itemByKey(key) {
  for (var i = 0; i < state.items.length; i++) {
    if (state.items[i].key === key) return state.items[i];
  }
  return null;
}

function orderById(partId) {
  for (var i = 0; i < state.orders.length; i++) {
    if (state.orders[i].partId === partId) return state.orders[i];
  }
  return null;
}

function wire() {
  var form = document.getElementById('partsForm');
  if (!form) return;
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submitParts();
  });
  document.getElementById('request').addEventListener('change', function (event) {
    if (state.saving) return;
    state.label = event.target.value;
    state.notice = '';
    state.error = '';
    delete state.fieldErrors.request;
    persist();
    render();
    if (state.label) loadOrders();
    else {
      state.orders = [];
      state.ordersError = '';
      render();
    }
  });
  document.getElementById('addItem').addEventListener('click', function () {
    if (state.saving) return;
    state.items.push(blankItem());
    state.error = '';
    persist();
    render();
  });
  var removers = form.querySelectorAll('[data-remove]');
  for (var r = 0; r < removers.length; r++) {
    removers[r].addEventListener('click', function (event) {
      if (state.saving) return;
      var key = event.currentTarget.getAttribute('data-remove');
      state.items = state.items.filter(function (item) { return item.key !== key; });
      if (!state.items.length) state.items = [blankItem()];
      persist();
      render();
    });
  }
  var fields = form.querySelectorAll('[data-item]');
  for (var f = 0; f < fields.length; f++) {
    fields[f].addEventListener('input', onItemEdit);
    fields[f].addEventListener('change', onItemEdit);
  }
  var receipts = form.querySelectorAll('[data-receipt]');
  for (var c = 0; c < receipts.length; c++) {
    receipts[c].addEventListener('input', onReceiptEdit);
    receipts[c].addEventListener('change', onReceiptEdit);
  }
  var saves = form.querySelectorAll('[data-save-receipt]');
  for (var s = 0; s < saves.length; s++) {
    saves[s].addEventListener('click', function (event) {
      saveReceipt(event.currentTarget.getAttribute('data-save-receipt'));
    });
  }
}

function onItemEdit(event) {
  if (state.saving) return;
  var item = itemByKey(event.target.getAttribute('data-item'));
  if (!item) return;
  item[event.target.getAttribute('data-field')] = event.target.value;
  state.error = '';
  persist();
}

function onReceiptEdit(event) {
  if (state.saving) return;
  var order = orderById(event.target.getAttribute('data-receipt'));
  if (!order) return;
  order[event.target.getAttribute('data-field')] = event.target.value;
  state.error = '';
}

function validateItems() {
  var errors = {};
  var request = selectedRequest();
  if (!state.label || !request) errors.request = 'Select a maintenance job.';
  else if (request.duplicate) errors.request = 'That maintenance job appears more than once, so parts cannot be added.';
  else if (!request.maintenanceId || request.maintenanceId !== idFromLabel(request.label)) {
    errors.request = 'That job no longer matches its maintenance ID, so parts cannot be added.';
  }
  for (var i = 0; i < state.items.length; i++) {
    var item = state.items[i];
    if (!String(item.purchaser || '').trim()) errors['purchaser-' + item.key] = 'Enter the purchaser.';
    if (!String(item.name || '').trim()) errors['name-' + item.key] = 'Enter the name of the part.';
    if (!String(item.supplier || '').trim()) errors['supplier-' + item.key] = 'Enter the supplier.';
    if (item.dateOrdered && !ukDate(item.dateOrdered)) errors['ordered-' + item.key] = 'Enter a valid date ordered, or leave it blank.';
  }
  return errors;
}

function readFailure(response, fallback) {
  return response.json().catch(function () { return {}; }).then(function (body) {
    throw new Error((body && body.message) || fallback);
  });
}

function submitParts() {
  if (state.saving) return;
  var errors = validateItems();
  state.fieldErrors = errors;
  if (Object.keys(errors).length) {
    state.error = 'Complete the required answers. Nothing was saved.';
    state.notice = '';
    render();
    return;
  }
  var request = selectedRequest();
  state.saving = true;
  state.savingKind = 'parts';
  state.error = '';
  state.notice = '';
  render();
  var payload = {
    action: 'parts_add',
    submissionId: state.submissionId,
    label: request.label,
    maintenanceId: request.maintenanceId,
    items: state.items.map(function (item) {
      return {
        purchaser: String(item.purchaser || '').trim(),
        name: String(item.name || '').trim(),
        supplier: String(item.supplier || '').trim(),
        dateOrdered: item.dateOrdered || ''
      };
    })
  };
  fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function (response) {
    if (!response.ok) return readFailure(response, 'The parts were not saved. Your answers are still here.');
    return response.json();
  }).then(function (body) {
    if (!body || body.result !== 'success' || body.maintenanceId !== request.maintenanceId || !Array.isArray(body.parts) || !body.parts.length) {
      throw new Error((body && body.message) || 'The parts were not saved. Your answers are still here.');
    }
    var ids = body.parts.map(function (part) { return part.partId; });
    state.notice = 'Saved ' + ids.join(', ') + '.';
    state.saving = false;
    state.savingKind = '';
    state.submissionId = createSubmissionId();
    state.items = [blankItem()];
    state.fieldErrors = {};
    persist();
    render();
    loadOrders();
  }).catch(function (err) {
    state.saving = false;
    state.savingKind = '';
    state.error = err && err.message ? err.message : 'The parts were not saved. Your answers are still here.';
    render();
  });
}

function saveReceipt(partId) {
  if (state.saving) return;
  var request = selectedRequest();
  var order = orderById(partId);
  if (!request || !order) return;
  if (!receiptIds[partId]) receiptIds[partId] = createSubmissionId();
  state.saving = true;
  state.savingKind = 'receipt';
  state.error = '';
  state.notice = '';
  render();
  var payload = {
    action: 'parts_receipt',
    submissionId: receiptIds[partId],
    maintenanceId: request.maintenanceId,
    partId: order.partId,
    dateOrdered: order.dateOrdered || '',
    dateArrived: order.dateArrived || '',
    receivedBy: order.receivedBy || '',
    checkedBy: order.checkedBy || '',
    status: order.status || ''
  };
  fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function (response) {
    if (!response.ok) return readFailure(response, 'The receipt was not saved. Your answers are still here.');
    return response.json();
  }).then(function (body) {
    if (!body || body.result !== 'success' || body.partId !== partId) {
      throw new Error((body && body.message) || 'The receipt was not saved. Your answers are still here.');
    }
    delete receiptIds[partId];
    state.saving = false;
    state.savingKind = '';
    state.notice = 'Updated ' + partId + '.';
    render();
    loadOrders();
  }).catch(function (err) {
    state.saving = false;
    state.savingKind = '';
    state.error = err && err.message ? err.message : 'The receipt was not saved. Your answers are still here.';
    render();
  });
}

function rememberReceiptIds(orders) {
  var next = {};
  for (var i = 0; i < orders.length; i++) {
    var id = orders[i].partId;
    if (receiptIds[id]) next[id] = receiptIds[id];
  }
  receiptIds = next;
}

function loadOrders() {
  var request = selectedRequest();
  if (!request || request.duplicate) {
    state.orders = [];
    state.ordersLoading = false;
    render();
    return;
  }
  state.ordersLoading = true;
  state.ordersError = '';
  render();
  fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'parts_orders', maintenanceId: request.maintenanceId })
  }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      if (!response.ok || !body || body.result !== 'ok' || body.maintenanceId !== request.maintenanceId || !Array.isArray(body.orders)) {
        throw new Error((body && body.message) || 'The current orders could not be loaded.');
      }
      return body;
    });
  }).then(function (body) {
    if (!selectedRequest() || selectedRequest().maintenanceId !== request.maintenanceId) return;
    state.orders = body.orders;
    rememberReceiptIds(state.orders);
    state.ordersLoading = false;
    render();
  }).catch(function (err) {
    if (!selectedRequest() || selectedRequest().maintenanceId !== request.maintenanceId) return;
    state.ordersLoading = false;
    state.ordersError = err && err.message ? err.message : 'The current orders could not be loaded.';
    render();
  });
}

function applyRequestedJob() {
  var job = queryJob();
  if (!job) {
    if (state.label && !selectedRequest()) state.label = '';
    return;
  }
  var matches = [];
  for (var i = 0; i < state.requests.length; i++) {
    if (state.requests[i].maintenanceId === job && !state.requests[i].duplicate) matches.push(state.requests[i]);
  }
  state.label = matches.length === 1 ? matches[0].label : '';
}

function loadJobs() {
  state.listsLoading = true;
  state.listsError = '';
  state.error = '';
  render();
  fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'parts_jobs' })
  }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      if (!response.ok || !body || body.result !== 'ok' || !Array.isArray(body.requests) || !Array.isArray(body.people)) {
        throw new Error((body && body.message) || 'The maintenance jobs could not be loaded.');
      }
      return body;
    });
  }).then(function (body) {
    state.requests = body.requests;
    state.people = body.people;
    applyRequestedJob();
    state.listsLoading = false;
    render();
    if (state.label) loadOrders();
  }).catch(function (err) {
    state.listsLoading = false;
    state.listsError = err && err.message ? err.message : 'The maintenance jobs could not be loaded.';
    render();
  });
}

restoreDraft();
loadJobs();
