(function () {
  if (!window.SCSAuth || !SCSAuth.isAuthenticated() || !window.ScheduleData || !window.ScheduleProducts) return;

  var data = window.ScheduleData;
  var products = window.ScheduleProducts;
  var MOVE_SLOP = 4;
  var laneMap = {};
  var editingId = null;
  var editorMode = null;
  var editorSnapshot = null;
  var draft = null;
  var currentMatch = null;
  var filling = false;
  var drag = null;
  var navigating = false;
  var scrollLock = false;

  var scroll = document.getElementById('scheduleScroll');
  var grid = document.getElementById('scheduleGrid');
  var runSuffix = document.getElementById('runSuffix');
  var notes = document.getElementById('importantNotes');
  var modal = document.getElementById('blockEditor');
  var editorTitle = document.getElementById('editorTitle');
  var editorLane = document.getElementById('editorLane');
  var editorError = document.getElementById('editorError');
  var editorCustomer = document.getElementById('editorCustomer');
  var editorProduct = document.getElementById('editorProduct');
  var editorLiquid = document.getElementById('editorLiquid');
  var editorFormat = document.getElementById('editorFormat');
  var editorVolume = document.getElementById('editorVolume');
  var editorVolumeError = document.getElementById('editorVolumeError');
  var editorStart = document.getElementById('editorStart');
  var editorEnd = document.getElementById('editorEnd');
  var editorDuration = document.getElementById('editorDuration');
  var editorSwatches = document.getElementById('editorSwatches');
  var editorStatus = document.getElementById('editorStatus');
  var editorCustomerList = document.getElementById('editorCustomerList');
  var editorDelete = document.getElementById('editorDelete');
  var editorDismiss = document.getElementById('editorDismiss');
  var editorConfirm = document.getElementById('editorConfirm');
  var editorActions = document.getElementById('editorActions');
  var sourceStatus = document.getElementById('sourceStatus');
  var sourceMessage = document.getElementById('sourceMessage');
  var sourceRetry = document.getElementById('sourceRetry');
  var statusLegend = document.getElementById('statusLegend');
  var yearSelect = document.getElementById('yearSelect');
  var weekJump = document.getElementById('weekJump');
  var currentWeek = document.getElementById('currentWeek');
  var activeCustomer = '';
  var customerMatches = [];
  var customerIndex = -1;
  var customerQuiet = false;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function el(className, text) {
    var node = document.createElement('div');
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function laneKey(week, day, category) {
    return week + '|' + day + '|' + category;
  }

  function ukDate(date) {
    var day = date.getDate();
    var month = date.getMonth() + 1;
    return (day < 10 ? '0' : '') + day + '-' + (month < 10 ? '0' : '') + month + '-' + date.getFullYear();
  }

  function weekHeading(iso) {
    var info = data.productionInfo(iso);
    if (!info) return '';
    var monday = data.parseISODate(info.weekCommencing);
    return 'Week ' + info.week + ' (W/C ' + ukDate(monday) + ')';
  }

  function blockElement(id) {
    return grid.querySelector('.prod-block[data-id="' + CSS.escape(id) + '"]');
  }

  function hourAt(lane, clientY) {
    var rect = lane.getBoundingClientRect();
    var hourHeight = rect.height / 24;
    if (!hourHeight) return 0;
    var hour = Math.floor((clientY - rect.top) / hourHeight);
    if (hour < 0) hour = 0;
    if (hour > 23) hour = 23;
    return hour;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function durationText(start, end) {
    var hours = (end - start) / 60;
    return hours === 1 ? '1 hour' : hours + ' hours';
  }

  function endOptionLabel(offset) {
    var label = data.minutesToLabel(offset);
    return offset === data.DAY_LENGTH ? label + ' (next day)' : label;
  }

  function paint(node, block) {
    if (!node || !block) return;
    node.dataset.start = String(block.startOffset);
    node.dataset.end = String(block.endOffset);
    node.style.top = 'calc(var(--sch-hour) * ' + (block.startOffset / 60) + ')';
    node.style.height = 'calc(var(--sch-hour) * ' + ((block.endOffset - block.startOffset) / 60) + ')';
    node.style.background = block.backgroundColour;
    node.style.color = data.textColour(block.backgroundColour);
    node.querySelector('.prod-text').textContent = block.text || '';
    var spoken = (block.text || 'Empty block').replace(/\s*\n\s*/g, ', ');
    var label = spoken + ', ' +
      data.minutesToLabel(block.startOffset) + ' to ' + endOptionLabel(block.endOffset);
    node.title = label;
    node.setAttribute('aria-label', label);
  }

  function renderBlock(block) {
    var node = document.createElement('div');
    node.className = 'prod-block';
    node.dataset.id = block.id;
    node.setAttribute('role', 'button');
    node.tabIndex = 0;
    node.setAttribute('draggable', 'false');
    var north = document.createElement('span');
    north.className = 'prod-handle prod-handle-n';
    north.dataset.edge = 'start';
    north.setAttribute('role', 'slider');
    north.setAttribute('aria-label', 'Adjust start time');
    north.setAttribute('draggable', 'false');
    var south = document.createElement('span');
    south.className = 'prod-handle prod-handle-s';
    south.dataset.edge = 'end';
    south.setAttribute('role', 'slider');
    south.setAttribute('aria-label', 'Adjust end time');
    south.setAttribute('draggable', 'false');
    var text = document.createElement('p');
    text.className = 'prod-text';
    node.appendChild(north);
    node.appendChild(text);
    node.appendChild(south);
    paint(node, block);
    return node;
  }

  function renderBlocks() {
    Object.keys(laneMap).forEach(function (key) {
      laneMap[key].querySelectorAll('.prod-block').forEach(function (node) { node.remove(); });
    });
    var state = data.getState();
    state.blocks.forEach(function (block) {
      var lane = laneMap[laneKey(block.weekCommencing, block.day, block.category)];
      if (lane) lane.appendChild(renderBlock(block));
    });
  }

  function buildWeekGrid(target, week) {
    var corner = el('sch-corner', 'Time');
    target.appendChild(corner);

    data.DAYS.forEach(function (day, dayIndex) {
      var head = el('sch-day is-day-end', day.label);
      head.style.gridColumn = (2 + dayIndex * 5) + ' / span 5';
      head.style.gridRow = '1';
      target.appendChild(head);
    });

    data.DAYS.forEach(function (day, dayIndex) {
      data.CATEGORIES.forEach(function (category, categoryIndex) {
        var classes = 'sch-cat' + (categoryIndex === data.CATEGORIES.length - 1 ? ' is-day-end' : '');
        var cell = el(classes, category.label);
        cell.style.gridColumn = String(2 + dayIndex * 5 + categoryIndex);
        cell.style.gridRow = '2';
        target.appendChild(cell);
      });
    });

    var time = el('sch-time');
    time.style.gridColumn = '1';
    time.style.gridRow = '3';
    for (var hour = 0; hour < 24; hour++) {
      var tick = el(hour === 0 ? 'sch-tick is-start' : 'sch-tick', data.minutesToLabel(hour * 60));
      tick.style.top = 'calc(var(--sch-hour) * ' + hour + ')';
      time.appendChild(tick);
    }
    target.appendChild(time);

    data.DAYS.forEach(function (day, dayIndex) {
      data.CATEGORIES.forEach(function (category, categoryIndex) {
        var classes = 'sch-lane' + (categoryIndex === data.CATEGORIES.length - 1 ? ' is-day-end' : '');
        var lane = el(classes);
        lane.dataset.week = week;
        lane.dataset.day = day.id;
        lane.dataset.category = category.id;
        lane.style.gridColumn = String(2 + dayIndex * 5 + categoryIndex);
        lane.style.gridRow = '3';
        lane.setAttribute('role', 'group');
        lane.setAttribute('aria-label', day.label + ' ' + category.label);
        lane.appendChild(el('sch-midnight'));
        target.appendChild(lane);
        laneMap[laneKey(week, day.id, category.id)] = lane;
      });
    });
  }

  function categoryLabel(id) {
    for (var i = 0; i < data.CATEGORIES.length; i++) {
      if (data.CATEGORIES[i].id === id) return data.CATEGORIES[i].label;
    }
    return id;
  }

  function dayLabel(id) {
    for (var i = 0; i < data.DAYS.length; i++) {
      if (data.DAYS[i].id === id) return data.DAYS[i].label;
    }
    return id;
  }

  function fillStartOptions(selected) {
    editorStart.innerHTML = '';
    for (var offset = 0; offset <= data.DAY_LENGTH - 60; offset += 60) {
      var option = document.createElement('option');
      option.value = String(offset);
      option.textContent = data.minutesToLabel(offset);
      editorStart.appendChild(option);
    }
    editorStart.value = String(selected);
  }

  function fillEndOptions(start, selected) {
    editorEnd.innerHTML = '';
    for (var offset = start + 60; offset <= data.DAY_LENGTH; offset += 60) {
      var option = document.createElement('option');
      option.value = String(offset);
      option.textContent = endOptionLabel(offset);
      editorEnd.appendChild(option);
    }
    editorEnd.value = String(selected);
  }

  function markSwatch(colour) {
    var chosen = '';
    editorSwatches.querySelectorAll('.sch-swatch').forEach(function (swatch) {
      var selected = swatch.dataset.colour === colour;
      swatch.classList.toggle('is-selected', selected);
      swatch.setAttribute('aria-pressed', selected ? 'true' : 'false');
      if (selected) chosen = colour;
    });
    editorStatus.textContent = data.statusLabel(chosen || colour);
  }

  function refreshDuration(block) {
    editorDuration.textContent = durationText(block.startOffset, block.endOffset);
  }

  function closeEditor() {
    if (editingId) {
      var node = blockElement(editingId);
      if (node) node.classList.remove('is-editing');
    }
    editingId = null;
    editorMode = null;
    editorSnapshot = null;
    modal.hidden = true;
    editorActions.classList.remove('is-adding');
  }

  function copyBlock(block) {
    return {
      day: block.day,
      category: block.category,
      startOffset: block.startOffset,
      endOffset: block.endOffset,
      weekCommencing: block.weekCommencing,
      customer: block.customer,
      product: block.product,
      liquidCode: block.liquidCode,
      packingFormat: block.packingFormat,
      volume: block.volume,
      legacyText: block.legacyText,
      backgroundColour: block.backgroundColour
    };
  }

  function placeBlock(block) {
    var node = blockElement(block.id);
    var lane = laneMap[laneKey(block.weekCommencing, block.day, block.category)];
    if (node && lane && node.parentElement !== lane) lane.appendChild(node);
    paint(node, block);
    return node;
  }

  function restoreSnapshot() {
    if (!editingId || !editorSnapshot) return;
    var restored = data.updateBlock(editingId, {
      day: editorSnapshot.day,
      category: editorSnapshot.category,
      startOffset: editorSnapshot.startOffset,
      endOffset: editorSnapshot.endOffset,
      customer: editorSnapshot.customer,
      product: editorSnapshot.product,
      liquidCode: editorSnapshot.liquidCode,
      packingFormat: editorSnapshot.packingFormat,
      volume: editorSnapshot.volume,
      legacyText: editorSnapshot.legacyText,
      backgroundColour: editorSnapshot.backgroundColour
    });
    if (restored) placeBlock(restored);
  }

  function dismissEditor() {
    if (editorMode === 'add') {
      draft = null;
      closeEditor();
      return;
    }
    if (!editingId) return;
    restoreSnapshot();
    closeEditor();
  }

  function showFormError(message) {
    editorError.textContent = message || '';
    editorError.hidden = !message;
  }

  function volumeProblem(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (!text) return 'Enter the packing volume in litres.';
    if (!/^\d+(\.\d+)?$/.test(text)) return 'Enter a number of litres.';
    var value = Number(text);
    if (value < 100 || value > 1000000) return 'Volume must be between 100 and 1,000,000 litres.';
    return '';
  }

  function readVolume() {
    var problem = volumeProblem(editorVolume.value);
    return problem ? null : Number(editorVolume.value.trim());
  }

  function refreshVolumeMessage() {
    var text = String(editorVolume.value || '').trim();
    var problem = text ? volumeProblem(text) : '';
    editorVolumeError.textContent = problem;
    editorVolumeError.hidden = !problem;
    editorVolume.setAttribute('aria-invalid', problem ? 'true' : 'false');
  }

  function formReady() {
    return products.ready() &&
      !!canonicalCustomer(editorCustomer.value) &&
      currentMatch &&
      !currentMatch.ambiguous &&
      editorProduct.value &&
      editorFormat.value &&
      readVolume() != null;
  }

  function refreshSubmit() {
    editorConfirm.disabled = !formReady();
  }

  function fillSelect(select, values, placeholder, current) {
    var chosen = current || '';
    select.innerHTML = '';
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = placeholder;
    select.appendChild(blank);
    var seen = false;
    values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      if (value === chosen) seen = true;
      select.appendChild(option);
    });
    if (chosen && !seen) {
      var extra = document.createElement('option');
      extra.value = chosen;
      extra.textContent = chosen;
      select.appendChild(extra);
    }
    select.value = chosen;
    select.disabled = !products.ready();
  }

  function applyLiquid() {
    currentMatch = null;
    editorLiquid.value = '';
    var customerName = canonicalCustomer(editorCustomer.value);
    if (!products.ready() || !customerName || !editorProduct.value) {
      if (products.ready()) showFormError('');
      return;
    }
    var result = products.lookup(customerName, editorProduct.value);
    if (!result) {
      showFormError('The selected customer and product could not be found among active products in PRODUCT DATABASE.');
      return;
    }
    if (result.ambiguous) {
      showFormError('This customer and product have more than one liquid code (' + result.codes.join(', ') + '). Check PRODUCT DATABASE before continuing.');
      return;
    }
    currentMatch = result;
    editorLiquid.value = result.liquidCode;
    showFormError('');
  }

  function customerQuery(value) {
    return String(value || '').trim().toLowerCase();
  }

  function canonicalCustomer(value) {
    var query = customerQuery(value);
    if (!query || !products.ready()) return '';
    var list = products.customers();
    for (var i = 0; i < list.length; i++) {
      if (list[i].trim().toLowerCase() === query) return list[i];
    }
    return '';
  }

  function matchingCustomers(value) {
    var query = customerQuery(value);
    var list = products.customers();
    if (!query) return list;
    return list.filter(function (name) {
      return name.trim().toLowerCase().indexOf(query) !== -1;
    });
  }

  function isCustomerOpen() {
    return editorCustomerList && !editorCustomerList.hidden;
  }

  function closeCustomerList() {
    editorCustomerList.hidden = true;
    editorCustomerList.innerHTML = '';
    editorCustomer.setAttribute('aria-expanded', 'false');
    editorCustomer.removeAttribute('aria-activedescendant');
    customerIndex = -1;
    customerMatches = [];
  }

  function markCustomerOption(scroll) {
    var options = editorCustomerList.querySelectorAll('.sch-customer-option');
    options.forEach(function (option, index) {
      var selected = index === customerIndex;
      option.classList.toggle('is-active', selected);
      option.setAttribute('aria-selected', selected ? 'true' : 'false');
      if (selected) {
        editorCustomer.setAttribute('aria-activedescendant', option.id);
        if (scroll && option.scrollIntoView) option.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function openCustomerList() {
    if (!products.ready() || editorCustomer.disabled) return;
    customerMatches = matchingCustomers(editorCustomer.value);
    editorCustomerList.innerHTML = '';
    if (!customerMatches.length) {
      var empty = document.createElement('p');
      empty.className = 'sch-customer-empty';
      empty.textContent = customerQuery(editorCustomer.value)
        ? 'No matching customers found'
        : 'No customers available';
      editorCustomerList.appendChild(empty);
      customerIndex = -1;
      editorCustomer.removeAttribute('aria-activedescendant');
    } else {
      customerMatches.forEach(function (name, index) {
        var option = document.createElement('button');
        option.type = 'button';
        option.className = 'sch-customer-option';
        option.id = 'editorCustomerOption' + index;
        option.setAttribute('role', 'option');
        option.tabIndex = -1;
        option.dataset.index = String(index);
        option.textContent = name;
        option.addEventListener('mouseenter', function () {
          customerIndex = index;
          markCustomerOption(false);
        });
        editorCustomerList.appendChild(option);
      });
      customerIndex = 0;
      markCustomerOption(false);
    }
    editorCustomerList.hidden = false;
    editorCustomer.setAttribute('aria-expanded', 'true');
  }

  function moveCustomer(delta) {
    if (!customerMatches.length) return;
    if (customerIndex < 0) customerIndex = delta > 0 ? 0 : customerMatches.length - 1;
    else customerIndex = Math.max(0, Math.min(customerMatches.length - 1, customerIndex + delta));
    markCustomerOption(true);
  }

  function syncCustomerFromInput() {
    if (filling) return;
    var next = canonicalCustomer(editorCustomer.value);
    if (next === activeCustomer) {
      refreshSubmit();
      return;
    }
    activeCustomer = next;
    filling = true;
    fillSelect(
      editorProduct,
      next ? products.productsFor(next) : [],
      next ? 'Select a product' : 'Select a customer first',
      ''
    );
    editorProduct.disabled = !products.ready() || !next;
    filling = false;
    applyLiquid();
    refreshSubmit();
  }

  function chooseCustomer(name) {
    if (!name) return;
    customerQuiet = true;
    editorCustomer.value = name;
    closeCustomerList();
    syncCustomerFromInput();
    editorCustomer.focus();
    customerQuiet = false;
  }

  function focusCustomerField() {
    customerQuiet = true;
    editorCustomer.focus();
    customerQuiet = false;
  }

  function fillForm(customer, product, format) {
    var raw = String(customer || '');
    var canonical = canonicalCustomer(raw);
    activeCustomer = canonical;
    editorCustomer.value = canonical || raw;
    editorCustomer.disabled = !products.ready();
    closeCustomerList();
    fillSelect(
      editorProduct,
      canonical ? products.productsFor(canonical) : [],
      canonical ? 'Select a product' : 'Select a customer first',
      product
    );
    editorProduct.disabled = !products.ready() || !canonical;
    fillSelect(editorFormat, products.formats(), 'Select a packing format', format);
    applyLiquid();
  }

  function selectedColour() {
    var swatch = editorSwatches.querySelector('.sch-swatch.is-selected');
    return swatch ? swatch.dataset.colour : data.DEFAULT_COLOUR;
  }

  function productPatch(match, volume) {
    return {
      customer: match.customer,
      product: match.product,
      liquidCode: match.liquidCode,
      packingFormat: editorFormat.value,
      volume: volume,
      legacyText: '',
      backgroundColour: selectedColour(),
      startOffset: Number(editorStart.value),
      endOffset: Number(editorEnd.value)
    };
  }

  function confirmEditor() {
    if (!formReady()) {
      refreshVolumeMessage();
      refreshSubmit();
      return;
    }
    var volume = readVolume();
    var customerName = canonicalCustomer(editorCustomer.value);
    var match = customerName ? products.lookup(customerName, editorProduct.value) : null;
    if (!match || match.ambiguous) {
      if (editorMode === 'edit') restoreSnapshot();
      applyLiquid();
      refreshSubmit();
      return;
    }
    showFormError('');
    if (editorMode === 'add') {
      if (!draft) return;
      var created = data.addBlock({
        day: draft.day,
        category: draft.category,
        startOffset: Number(editorStart.value),
        endOffset: Number(editorEnd.value),
        backgroundColour: selectedColour(),
        customer: match.customer,
        product: match.product,
        liquidCode: match.liquidCode,
        packingFormat: editorFormat.value,
        volume: volume,
        weekCommencing: draft.weekCommencing
      });
      if (!created) {
        showFormError('The production block could not be created.');
        return;
      }
      var lane = laneMap[laneKey(created.weekCommencing, created.day, created.category)];
      if (lane) lane.appendChild(renderBlock(created));
      data.persist();
      draft = null;
      closeEditor();
      return;
    }
    if (!editingId) return;
    var updated = data.updateBlock(editingId, productPatch(match, volume));
    if (updated) placeBlock(updated);
    data.persist();
    closeEditor();
  }

  function setEditorMode(mode) {
    editorMode = mode;
    var adding = mode === 'add';
    editorActions.classList.toggle('is-adding', adding);
    editorDelete.tabIndex = adding ? -1 : 0;
    editorDismiss.textContent = adding ? 'Cancel' : 'Back';
    editorConfirm.textContent = adding ? 'Create Production Block' : 'Save changes';
    editorTitle.textContent = adding ? 'Create production block' : 'Edit production block';
  }

  function openEditor(id, mode) {
    var block = data.getBlock(id);
    if (!block) return;
    if (editingId && editingId !== id) {
      var previous = blockElement(editingId);
      if (previous) previous.classList.remove('is-editing');
    }
    editingId = id;
    draft = null;
    editorSnapshot = copyBlock(block);
    setEditorMode(mode);
    var node = blockElement(id);
    if (node) node.classList.add('is-editing');
    filling = true;
    editorLane.textContent = weekHeading(block.weekCommencing) + ' · ' + dayLabel(block.day) + ' · ' + categoryLabel(block.category);
    fillForm(block.customer, block.product, block.packingFormat);
    editorVolume.value = block.volume == null ? '' : String(block.volume);
    fillStartOptions(block.startOffset);
    fillEndOptions(block.startOffset, block.endOffset);
    refreshDuration(block);
    markSwatch(block.backgroundColour);
    filling = false;
    refreshVolumeMessage();
    refreshSubmit();
    modal.hidden = false;
    if (products.ready()) focusCustomerField();
  }

  function openCreate(day, category, hour, week) {
    if (editorMode === 'edit') dismissEditor();
    else if (editorMode === 'add') closeEditor();
    draft = {
      day: day,
      category: category,
      startOffset: hour * 60,
      endOffset: hour * 60 + 60,
      backgroundColour: data.DEFAULT_COLOUR,
      weekCommencing: week || data.getState().weekCommencing
    };
    editingId = null;
    editorSnapshot = null;
    setEditorMode('add');
    filling = true;
    editorLane.textContent = weekHeading(draft.weekCommencing) + ' · ' + dayLabel(day) + ' · ' + categoryLabel(category);
    fillForm('', '', '');
    editorVolume.value = '';
    fillStartOptions(draft.startOffset);
    fillEndOptions(draft.startOffset, draft.endOffset);
    refreshDuration(draft);
    markSwatch(draft.backgroundColour);
    filling = false;
    showFormError(products.ready() ? '' : (products.status().message || 'Product lists are still loading.'));
    refreshVolumeMessage();
    refreshSubmit();
    modal.hidden = false;
    if (products.ready()) focusCustomerField();
  }

  function applyTimes(start, end) {
    if (!editingId) return;
    var updated = data.updateBlock(editingId, { startOffset: start, endOffset: end });
    if (!updated) return;
    paint(blockElement(editingId), updated);
    filling = true;
    fillEndOptions(updated.startOffset, updated.endOffset);
    editorStart.value = String(updated.startOffset);
    filling = false;
    refreshDuration(updated);
  }

  function createBlock(day, category, hour, week) {
    openCreate(day, category, hour, week);
  }

  function finishDrag(commit) {
    if (!drag) return;
    var info = drag;
    drag = null;
    document.body.classList.remove('sch-dragging', 'sch-moving');
    try {
      if (scroll.hasPointerCapture(info.pointerId)) scroll.releasePointerCapture(info.pointerId);
    } catch (err) { /* capture may already be gone */ }

    var node = info.id ? blockElement(info.id) : null;
    if (node) node.classList.remove('is-active');
    clearDropTarget();

    if (!commit) {
      if (info.kind !== 'create' && info.id) {
        var restored = data.updateBlock(info.id, {
          day: info.day,
          category: info.category,
          weekCommencing: info.week,
          startOffset: info.startOffset,
          endOffset: info.endOffset
        });
        if (restored) placeBlock(restored);
      }
      return;
    }

    if (info.kind === 'create') {
      if (!info.moved) createBlock(info.day, info.category, info.hour, info.week);
      return;
    }

    var block = data.getBlock(info.id);
    if (!block) return;
    var changed = block.startOffset !== info.startOffset ||
      block.endOffset !== info.endOffset ||
      block.day !== info.day ||
      block.category !== info.category ||
      block.weekCommencing !== info.week;
    if (changed) data.persist();
    else openEditor(info.id, 'edit');
  }

  function clearDropTarget() {
    grid.querySelectorAll('.sch-lane.is-drop-target').forEach(function (lane) {
      lane.classList.remove('is-drop-target');
    });
  }

  function laneUnderPoint(clientX, clientY) {
    var stack = document.elementsFromPoint(clientX, clientY);
    for (var i = 0; i < stack.length; i++) {
      if (!stack[i].closest) continue;
      var lane = stack[i].closest('.sch-lane');
      if (lane && scroll.contains(lane)) return lane;
    }
    return null;
  }

  function nudgeScroll(clientX, clientY) {
    var rect = scroll.getBoundingClientRect();
    if (clientX > rect.right - 48) scroll.scrollLeft += 28;
    else if (clientX < rect.left + 24) scroll.scrollLeft -= 28;
    if (clientY > rect.bottom - 36) scroll.scrollTop += 18;
    else if (clientY < rect.top + 28) scroll.scrollTop -= 18;
  }

  function trackMove(clientX, clientY) {
    if (!drag) return;
    var dx = clientX - drag.x;
    var dy = clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < MOVE_SLOP) return;
    drag.moved = true;
    if (drag.kind === 'create') return;

    nudgeScroll(clientX, clientY);
    document.body.classList.add(drag.kind === 'move' ? 'sch-moving' : 'sch-dragging');
    var hourHeight = drag.lane.getBoundingClientRect().height / 24;
    var delta = Math.round(dy / hourHeight) * 60;
    var start = drag.startOffset;
    var end = drag.endOffset;
    var patch = {};
    if (drag.kind === 'move') {
      var length = end - start;
      start = drag.startOffset + delta;
      end = start + length;
      if (start < 0) {
        start = 0;
        end = length;
      }
      if (end > data.DAY_LENGTH) {
        end = data.DAY_LENGTH;
        start = end - length;
      }
      var lane = laneUnderPoint(clientX, clientY);
      clearDropTarget();
      if (lane) {
        patch.day = lane.dataset.day;
        patch.category = lane.dataset.category;
        patch.weekCommencing = lane.dataset.week;
        drag.lane = lane;
        lane.classList.add('is-drop-target');
      }
    } else if (drag.kind === 'start') {
      start = clamp(drag.startOffset + delta, 0, drag.endOffset - 60);
    } else if (drag.kind === 'end') {
      end = clamp(drag.endOffset + delta, drag.startOffset + 60, data.DAY_LENGTH);
    }
    patch.startOffset = start;
    patch.endOffset = end;
    var updated = data.updateBlock(drag.id, patch);
    if (updated) placeBlock(updated);
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    trackMove(event.clientX, event.clientY);
  }

  function onMouseMove(event) {
    if (!drag) return;
    trackMove(event.clientX, event.clientY);
  }

  function endPointer(event, commit) {
    if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
    if (commit && event.clientX != null) trackMove(event.clientX, event.clientY);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    finishDrag(commit);
  }

  function onPointerUp(event) {
    endPointer(event, true);
  }

  function onMouseUp(event) {
    if (!drag || drag.settled) return;
    endPointer({ pointerId: drag.pointerId, clientX: event.clientX, clientY: event.clientY }, true);
  }

  function onPointerCancel(event) {
    endPointer(event, false);
  }

  function onPointerDown(event) {
    if (event.button !== 0 || drag) return;
    var handle = event.target.closest('.prod-handle');
    var blockNode = event.target.closest('.prod-block');
    var lane = event.target.closest('.sch-lane');
    if (!lane || !scroll.contains(lane)) return;

    if (blockNode) {
      event.preventDefault();
      drag = {
        kind: handle ? handle.dataset.edge : 'move',
        pointerId: event.pointerId,
        id: blockNode.dataset.id,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        lane: lane,
        week: lane.dataset.week,
        day: lane.dataset.day,
        category: lane.dataset.category,
        startOffset: Number(blockNode.dataset.start),
        endOffset: Number(blockNode.dataset.end)
      };
      blockNode.classList.add('is-active');
    } else {
      drag = {
        kind: 'create',
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        lane: lane,
        week: lane.dataset.week,
        day: lane.dataset.day,
        category: lane.dataset.category,
        hour: hourAt(lane, event.clientY)
      };
    }

    try { scroll.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function availableYears() {
    var current = data.productionInfo(data.mondayISO(new Date()));
    var years = {};
    var year;
    for (year = current.year - 1; year <= current.year + 2; year++) years[year] = true;
    data.getState().blocks.forEach(function (block) {
      var info = data.productionInfo(block.weekCommencing);
      if (info) years[info.year] = true;
    });
    return Object.keys(years).map(Number).sort(function (a, b) { return a - b; });
  }

  function fillYearSelect(selected) {
    yearSelect.innerHTML = '';
    availableYears().forEach(function (year) {
      var option = document.createElement('option');
      option.value = String(year);
      option.textContent = String(year);
      yearSelect.appendChild(option);
    });
    yearSelect.value = String(selected);
  }

  function fillWeekJump(year, selected) {
    weekJump.innerHTML = '';
    data.productionWeeks(year).forEach(function (info) {
      var monday = data.parseISODate(info.weekCommencing);
      var option = document.createElement('option');
      option.value = info.weekCommencing;
      option.textContent = 'Week ' + info.week + ' (W/C ' + ukDate(monday) + ')';
      weekJump.appendChild(option);
    });
    if (selected) weekJump.value = selected;
  }

  function markActive(iso) {
    var boards = grid.querySelectorAll('.sch-board');
    for (var i = 0; i < boards.length; i++) {
      boards[i].classList.toggle('is-active', boards[i].dataset.week === iso);
    }
  }

  function renderYear(year) {
    Object.keys(laneMap).forEach(function (key) { delete laneMap[key]; });
    var weeks = data.productionWeeks(year);
    var today = data.productionInfo(data.mondayISO(new Date()));
    var fragment = document.createDocumentFragment();
    var lastMonth = '';
    weeks.forEach(function (info) {
      var monday = data.parseISODate(info.weekCommencing);
      var monthKey = monday.getFullYear() + '-' + monday.getMonth();
      if (monthKey !== lastMonth) {
        var month = document.createElement('h2');
        month.className = 'sch-month';
        var monthText = document.createElement('span');
        monthText.textContent = MONTHS[monday.getMonth()] + ' ' + monday.getFullYear();
        month.appendChild(monthText);
        fragment.appendChild(month);
        lastMonth = monthKey;
      }
      var board = document.createElement('section');
      board.className = 'sch-board';
      board.dataset.week = info.weekCommencing;
      if (today && today.weekCommencing === info.weekCommencing) board.classList.add('is-current');
      var head = document.createElement('div');
      head.className = 'sch-board-head';
      var label = document.createElement('div');
      label.className = 'sch-board-label';
      var title = document.createElement('h3');
      title.className = 'sch-board-title';
      title.textContent = weekHeading(info.weekCommencing);
      var suffix = document.createElement('span');
      suffix.className = 'sch-board-suffix';
      suffix.textContent = info.suffix;
      var weekGrid = el('sch-grid');
      label.appendChild(title);
      label.appendChild(suffix);
      head.appendChild(label);
      board.appendChild(head);
      board.appendChild(weekGrid);
      fragment.appendChild(board);
      buildWeekGrid(weekGrid, info.weekCommencing);
    });
    grid.innerHTML = '';
    grid.appendChild(fragment);
    renderBlocks();
  }

  function scrollToWeek(iso, smooth) {
    var board = grid.querySelector('.sch-board[data-week="' + iso + '"]');
    if (!board) return;
    markActive(iso);
    var top = board.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    if (top < 0) top = 0;
    scrollLock = true;
    scroll.scrollTo({ top: top, behavior: smooth ? 'smooth' : 'auto' });
    window.setTimeout(function () { scrollLock = false; }, smooth ? 800 : 80);
  }

  function showYear(year, weekIso, smooth) {
    var weeks = data.productionWeeks(year);
    if (!weeks.length) return;
    var iso = weekIso;
    var found = false;
    for (var i = 0; i < weeks.length; i++) {
      if (weeks[i].weekCommencing === iso) found = true;
    }
    if (!found) iso = weeks[0].weekCommencing;
    if (editorMode) dismissEditor();
    navigating = true;
    fillYearSelect(year);
    fillWeekJump(year, iso);
    renderYear(year);
    data.setMeta({ weekCommencing: iso });
    runSuffix.value = data.runSuffixFor(iso);
    markActive(iso);
    navigating = false;
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () { scrollToWeek(iso, !!smooth); });
    });
  }

  function syncVisibleWeek() {
    if (scrollLock || navigating) return;
    var edge = scroll.getBoundingClientRect().top + 12;
    var boards = grid.querySelectorAll('.sch-board');
    var chosen = null;
    for (var i = 0; i < boards.length; i++) {
      if (boards[i].getBoundingClientRect().top <= edge) chosen = boards[i];
      else break;
    }
    if (!chosen) chosen = boards[0];
    if (!chosen) return;
    var iso = chosen.dataset.week;
    if (iso === data.getState().weekCommencing && chosen.classList.contains('is-active')) return;
    markActive(iso);
    if (weekJump.value !== iso) weekJump.value = iso;
    runSuffix.value = data.runSuffixFor(iso);
    data.setMeta({ weekCommencing: iso });
  }

  function bindMeta() {
    notes.value = data.getState().notes;
    notes.addEventListener('input', function () {
      data.setMeta({ notes: notes.value });
      data.persist();
    });
    yearSelect.addEventListener('change', function () {
      if (navigating) return;
      var year = Number(yearSelect.value);
      var current = data.productionInfo(data.mondayISO(new Date()));
      var iso = current && current.year === year ? current.weekCommencing : data.productionWeeks(year)[0].weekCommencing;
      showYear(year, iso, false);
    });
    weekJump.addEventListener('change', function () {
      if (navigating) return;
      var iso = weekJump.value;
      data.setMeta({ weekCommencing: iso });
      runSuffix.value = data.runSuffixFor(iso);
      scrollToWeek(iso, true);
    });
    currentWeek.addEventListener('click', function () {
      var current = data.productionInfo(data.mondayISO(new Date()));
      if (!current) return;
      if (String(yearSelect.value) !== String(current.year)) {
        showYear(current.year, current.weekCommencing, true);
        return;
      }
      if (weekJump.value !== current.weekCommencing) weekJump.value = current.weekCommencing;
      data.setMeta({ weekCommencing: current.weekCommencing });
      runSuffix.value = current.suffix;
      scrollToWeek(current.weekCommencing, true);
    });
    var scrollTimer = null;
    scroll.addEventListener('scroll', function () {
      if (scrollLock || navigating) return;
      if (scrollTimer) window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(function () {
        scrollTimer = null;
        syncVisibleWeek();
      }, 60);
    });
  }

  function bindEditor() {
    data.STATUSES.forEach(function (status) {
      var colour = status.colour;
      var swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'sch-swatch';
      swatch.dataset.colour = colour;
      swatch.style.background = colour;
      swatch.title = status.label;
      swatch.setAttribute('aria-label', status.label);
      swatch.setAttribute('aria-pressed', 'false');
      swatch.addEventListener('click', function () {
        if (editorMode === 'add' && draft) {
          draft.backgroundColour = colour;
          markSwatch(colour);
          return;
        }
        if (!editingId) return;
        var updated = data.updateBlock(editingId, { backgroundColour: colour });
        paint(blockElement(editingId), updated);
        markSwatch(updated.backgroundColour);
      });
      editorSwatches.appendChild(swatch);
    });

    editorCustomer.addEventListener('input', function () {
      if (filling) return;
      openCustomerList();
      syncCustomerFromInput();
    });

    editorCustomer.addEventListener('focus', function () {
      if (customerQuiet || filling) return;
      openCustomerList();
    });

    editorCustomer.addEventListener('click', function () {
      if (!isCustomerOpen()) openCustomerList();
    });

    editorCustomer.closest('.sch-customer').addEventListener('click', function (event) {
      if (event.target.closest('.sch-customer-option')) return;
      if (!isCustomerOpen()) openCustomerList();
    });

    editorCustomer.addEventListener('blur', function () {
      var canonical = canonicalCustomer(editorCustomer.value);
      if (canonical && editorCustomer.value !== canonical) editorCustomer.value = canonical;
      closeCustomerList();
    });

    editorCustomer.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (!isCustomerOpen()) {
          openCustomerList();
          return;
        }
        moveCustomer(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (!isCustomerOpen()) {
          openCustomerList();
          return;
        }
        moveCustomer(-1);
        return;
      }
      if (event.key === 'Enter') {
        if (!isCustomerOpen() || customerIndex < 0) return;
        event.preventDefault();
        chooseCustomer(customerMatches[customerIndex]);
        return;
      }
      if (event.key === 'Escape' && isCustomerOpen()) {
        event.preventDefault();
        event.stopPropagation();
        closeCustomerList();
      }
    });

    editorCustomerList.addEventListener('mousedown', function (event) {
      var option = event.target.closest('.sch-customer-option');
      if (!option) return;
      event.preventDefault();
      chooseCustomer(customerMatches[Number(option.dataset.index)]);
    });

    editorProduct.addEventListener('change', function () {
      if (filling) return;
      applyLiquid();
      refreshSubmit();
    });

    editorFormat.addEventListener('change', function () {
      if (filling) return;
      refreshSubmit();
    });

    editorVolume.addEventListener('input', function () {
      if (filling) return;
      refreshVolumeMessage();
      refreshSubmit();
    });

    editorStart.addEventListener('change', function () {
      if (filling) return;
      if (editorMode === 'add' && draft) {
        var start = Number(editorStart.value);
        var end = Number(editorEnd.value);
        if (end <= start) end = Math.min(start + 60, data.DAY_LENGTH);
        draft.startOffset = start;
        draft.endOffset = end;
        filling = true;
        fillEndOptions(start, end);
        filling = false;
        refreshDuration(draft);
        return;
      }
      if (!editingId) return;
      var block = data.getBlock(editingId);
      var nextStart = Number(editorStart.value);
      var nextEnd = block.endOffset;
      if (nextEnd <= nextStart) nextEnd = Math.min(nextStart + 60, data.DAY_LENGTH);
      applyTimes(nextStart, nextEnd);
    });

    editorEnd.addEventListener('change', function () {
      if (filling) return;
      if (editorMode === 'add' && draft) {
        draft.startOffset = Number(editorStart.value);
        draft.endOffset = Number(editorEnd.value);
        refreshDuration(draft);
        return;
      }
      if (!editingId) return;
      applyTimes(Number(editorStart.value), Number(editorEnd.value));
    });

    editorDelete.addEventListener('click', function () {
      if (!editingId || editorMode !== 'edit') return;
      var id = editingId;
      closeEditor();
      data.removeBlock(id);
      data.persist();
      var node = blockElement(id);
      if (node) node.remove();
    });

    editorDismiss.addEventListener('click', dismissEditor);
    editorConfirm.addEventListener('click', confirmEditor);
    modal.addEventListener('pointerdown', function (event) {
      if (event.target === modal) dismissEditor();
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (drag) {
      endPointer({ pointerId: drag.pointerId }, false);
      return;
    }
    if (isCustomerOpen()) {
      closeCustomerList();
      return;
    }
    if (!modal.hidden) {
      dismissEditor();
      return;
    }
  });

  document.addEventListener('pointerdown', function (event) {
    if (isCustomerOpen() && !event.target.closest('.sch-customer')) closeCustomerList();
  });

  var sourceNotice = '';

  function renderSource(current) {
    var failed = current.state === 'error';
    sourceStatus.hidden = current.state === 'ready';
    sourceStatus.classList.toggle('is-error', failed);
    sourceMessage.textContent = current.state === 'ready' ? '' : current.message;
    sourceRetry.hidden = !failed;
    if (!modal.hidden) {
      if (current.state === 'ready') {
        fillForm(editorCustomer.value, editorProduct.value, editorFormat.value);
        if (sourceNotice && editorError.textContent === sourceNotice) showFormError('');
      } else if (editorMode === 'add' || editorMode === 'edit') {
        sourceNotice = current.message;
        showFormError(current.message);
      }
      refreshSubmit();
    }
    if (current.state !== 'ready') sourceNotice = current.message;
  }

  function renderLegend() {
    statusLegend.innerHTML = '';
    data.STATUSES.forEach(function (status) {
      var item = document.createElement('div');
      item.className = 'sch-legend-item';
      item.style.background = status.colour;
      item.textContent = status.label;
      statusLegend.appendChild(item);
    });
  }

  sourceRetry.addEventListener('click', function () {
    products.load(true).catch(function () { /* status already reported */ });
  });
  products.subscribe(renderSource);

  scroll.addEventListener('pointerdown', onPointerDown);
  renderLegend();
  bindMeta();
  bindEditor();
  var opening = data.productionInfo(data.mondayISO(new Date()));
  showYear(opening.year, opening.weekCommencing, false);
  products.load().catch(function () { /* status already reported */ });
})();
