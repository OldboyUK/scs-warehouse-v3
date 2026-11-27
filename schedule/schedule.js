(function () {
  if (!window.SCSAuth || !SCSAuth.isAuthenticated() || !window.ScheduleData || !window.ScheduleProducts) return;

  var data = window.ScheduleData;
  var products = window.ScheduleProducts;
  var MOVE_SLOP = 4;
  var laneMap = {};
  var editingId = null;
  var editorMode = null;
  var editorBlockType = '';
  var editorSnapshot = null;
  var draft = null;
  var editorCategory = '';
  var currentMatch = null;
  var filling = false;
  var drag = null;
  var navigating = false;
  var yearToken = 0;
  var scrollLock = false;
  var view = 'production';

  var scroll = document.getElementById('scheduleScroll');
  var grid = document.getElementById('scheduleGrid');
  var runSuffix = document.getElementById('runSuffix');
  var modal = document.getElementById('blockEditor');
  var cipChoice = document.getElementById('cipChoice');
  var editorTitle = document.getElementById('editorTitle');
  var editorLane = document.getElementById('editorLane');
  var editorError = document.getElementById('editorError');
  var editorCustomer = document.getElementById('editorCustomer');
  var editorProduct = document.getElementById('editorProduct');
  var editorLiquid = document.getElementById('editorLiquid');
  var editorFormat = document.getElementById('editorFormat');
  var editorFree = document.getElementById('editorFree');
  var editorDetails = document.getElementById('editorDetails');
  var editorCard = document.querySelector('#blockEditor .sch-modal-card');
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
  var scheduleTitle = document.getElementById('scheduleTitle');
  var tabProduction = document.getElementById('tabProduction');
  var tabBlending = document.getElementById('tabBlending');
  var tabAppointments = document.getElementById('tabAppointments');
  var yearSelect = document.getElementById('yearSelect');
  var weekJump = document.getElementById('weekJump');
  var currentWeek = document.getElementById('currentWeek');
  var mainMenu = document.getElementById('mainMenu');
  var leaveMenu = document.getElementById('leaveMenu');
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

  function activeCategories() {
    if (view === 'blending') return data.BLENDING_CATEGORIES;
    if (view === 'appointments') return data.APPOINTMENT_CATEGORIES;
    return data.CATEGORIES;
  }

  function laneCount() {
    return activeCategories().length;
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

  function visibleHours(lane) {
    var weekGrid = lane && lane.closest('.sch-grid');
    return weekGrid && weekGrid.classList.contains('is-night') ? 24 : data.DAY_HOURS;
  }

  function hourAt(lane, clientY) {
    var rect = lane.getBoundingClientRect();
    var span = visibleHours(lane);
    var hourHeight = rect.height / span;
    if (!hourHeight) return 0;
    var hour = Math.floor((clientY - rect.top) / hourHeight);
    if (hour < 0) hour = 0;
    if (hour > span - 1) hour = span - 1;
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

  function fillBlockText(text, block) {
    if (!text) return;
    if (block.product !== 'PLACEHOLDER') {
      text.textContent = block.text || '';
      return;
    }
    text.textContent = '';
    String(block.text || '').split('\n').forEach(function (line) {
      if (!String(line).trim()) return;
      if (line === 'PLACEHOLDER') {
        var pill = document.createElement('span');
        pill.className = 'prod-placeholder';
        pill.textContent = 'PLACEHOLDER';
        text.appendChild(pill);
        return;
      }
      var row = document.createElement('span');
      row.textContent = line;
      text.appendChild(row);
    });
  }

  function paint(node, block) {
    if (!node || !block) return;
    node.dataset.start = String(block.startOffset);
    node.dataset.end = String(block.endOffset);
    node.style.top = 'calc(var(--sch-hour) * ' + (block.startOffset / 60) + ')';
    node.style.height = 'calc(var(--sch-hour) * ' + ((block.endOffset - block.startOffset) / 60) + ')';
    node.style.background = block.backgroundColour;
    node.style.color = data.textColour(block.backgroundColour);
    fillBlockText(node.querySelector('.prod-text'), block);
    var notes = block.schedule === 'blending' ? String(block.freeText || '').trim() : '';
    var note = node.querySelector('.prod-note');
    if (notes) {
      if (!note) {
        note = document.createElement('p');
        note.className = 'prod-note';
        node.appendChild(note);
      }
      note.textContent = notes;
      node.appendChild(note);
    } else if (note) {
      note.remove();
    }
    var white = block.schedule !== 'appointments' && products.isWhiteLabel(block.liquidCode);
    node.classList.toggle('has-flag', white);
    var flag = node.querySelector('.prod-flag');
    if (white) {
      if (!flag) {
        flag = document.createElement('span');
        flag.className = 'prod-flag';
        node.appendChild(flag);
      }
      flag.textContent = 'White Label';
    } else if (flag) {
      flag.remove();
    }
    var spoken = (block.text || 'Empty block').replace(/\s*\n\s*/g, ', ');
    var label = spoken + ', ' +
      data.minutesToLabel(block.startOffset) + ' to ' + endOptionLabel(block.endOffset);
    if (white) label += ', white label';
    if (notes) {
      node.appendChild(note);
      label += ', notes ' + notes.replace(/\s*\n\s*/g, ', ');
    }
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
    if (block.blockType === 'cip') {
      var west = document.createElement('span');
      west.className = 'prod-handle prod-handle-w';
      west.dataset.edge = 'lanes-west';
      west.setAttribute('aria-label', 'Cover lanes to the left');
      west.setAttribute('draggable', 'false');
      var east = document.createElement('span');
      east.className = 'prod-handle prod-handle-e';
      east.dataset.edge = 'lanes-east';
      east.setAttribute('aria-label', 'Cover lanes to the right');
      east.setAttribute('draggable', 'false');
      node.appendChild(west);
      node.appendChild(east);
    }
    paint(node, block);
    return node;
  }

  function renderBlocks() {
    scroll.querySelectorAll('.sch-cip-span').forEach(function (node) { node.remove(); });
    Object.keys(laneMap).forEach(function (key) {
      laneMap[key].querySelectorAll('.prod-block').forEach(function (node) { node.remove(); });
    });
    var state = data.getState();
    state.blocks.forEach(function (block) {
      if ((block.schedule || 'production') !== view) return;
      attachBlock(block);
    });
    paintConflicts();
  }

  function conflictMark() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.pointerEvents = 'none';
    var triangle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    triangle.setAttribute('fill', '#ffffff');
    triangle.setAttribute('d', 'M12 2.6 1.6 21.2h20.8L12 2.6z');
    var bang = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    bang.setAttribute('fill', '#c40000');
    bang.setAttribute('d', 'M11 9.2h2v6.2h-2zm0 7.4h2v2h-2z');
    svg.appendChild(triangle);
    svg.appendChild(bang);
    return svg;
  }

  function mergeConflictZones(zones) {
    if (!zones.length) return [];
    zones.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    var merged = [{ start: zones[0].start, end: zones[0].end }];
    for (var i = 1; i < zones.length; i++) {
      var last = merged[merged.length - 1];
      if (zones[i].start <= last.end) {
        if (zones[i].end > last.end) last.end = zones[i].end;
      } else {
        merged.push({ start: zones[i].start, end: zones[i].end });
      }
    }
    return merged;
  }

  function paintConflicts() {
    try {
    grid.querySelectorAll('.sch-conflict').forEach(function (node) { node.remove(); });
    grid.querySelectorAll('.prod-block.is-conflict').forEach(function (node) {
      node.classList.remove('is-conflict');
    });
    if (view !== 'production') return;
    var lanes = {};
    data.getState().blocks.forEach(function (block) {
      if ((block.schedule || 'production') !== 'production') return;
      var startIndex = categoryIndex(block.category);
      if (startIndex < 0) return;
      var span = block.blockType === 'cip' ? (block.laneSpan || 1) : 1;
      for (var i = 0; i < span; i++) {
        var category = data.CATEGORIES[startIndex + i];
        if (!category) break;
        var key = laneKey(block.weekCommencing, block.day, category.id);
        if (!lanes[key]) lanes[key] = [];
        lanes[key].push({ id: block.id, start: block.startOffset, end: block.endOffset });
      }
    });
    Object.keys(lanes).forEach(function (key) {
      var items = lanes[key];
      if (items.length < 2) return;
      var zones = [];
      var involved = {};
      for (var a = 0; a < items.length; a++) {
        for (var b = a + 1; b < items.length; b++) {
          var start = Math.max(items[a].start, items[b].start);
          var end = Math.min(items[a].end, items[b].end);
          if (end <= start) continue;
          zones.push({ start: start, end: end });
          involved[items[a].id] = true;
          involved[items[b].id] = true;
        }
      }
      Object.keys(involved).forEach(function (id) {
        var node = blockElement(id);
        if (node) node.classList.add('is-conflict');
      });
      var lane = laneMap[key];
      if (!lane) return;
      mergeConflictZones(zones).forEach(function (zone) {
        var overlay = document.createElement('div');
        overlay.className = 'sch-conflict';
        if (zone.end - zone.start < 120) overlay.classList.add('is-compact');
        overlay.style.pointerEvents = 'none';
        overlay.style.top = 'calc(var(--sch-hour) * ' + (zone.start / 60) + ')';
        overlay.style.height = 'calc(var(--sch-hour) * ' + ((zone.end - zone.start) / 60) + ')';
        overlay.setAttribute('aria-hidden', 'true');
        var mark = document.createElement('span');
        mark.className = 'sch-conflict-mark';
        mark.style.pointerEvents = 'none';
        mark.appendChild(conflictMark());
        var label = document.createElement('span');
        label.className = 'sch-conflict-label';
        label.textContent = 'CONFLICT – OVERLAP';
        overlay.appendChild(mark);
        overlay.appendChild(label);
        lane.appendChild(overlay);
      });
    });
    } catch (err) { /* a warning must not lock the schedule */ }
  }

  function categoryIndex(id) {
    var categories = data.CATEGORIES;
    for (var i = 0; i < categories.length; i++) {
      if (categories[i].id === id) return i;
    }
    return -1;
  }

  function positionCipSpan(span, block) {
    var lane = laneMap[laneKey(block.weekCommencing, block.day, block.category)];
    if (!lane) return;
    var grid = lane.closest('.sch-grid');
    if (span.parentElement !== grid) grid.appendChild(span);
    var dayIndex = 0;
    data.DAYS.forEach(function (day, index) {
      if (day.id === block.day) dayIndex = index;
    });
    var start = Math.max(0, categoryIndex(block.category));
    var count = block.laneSpan || 1;
    span.style.gridColumn = (2 + dayIndex * laneCount() + start) + ' / span ' + count;
    span.style.gridRow = '3';
    span.dataset.week = block.weekCommencing;
    span.dataset.day = block.day;
    span.dataset.category = block.category;
  }

  function attachBlock(block) {
    var node = renderBlock(block);
    if (block.blockType !== 'cip') {
      var lane = laneMap[laneKey(block.weekCommencing, block.day, block.category)];
      if (lane) lane.appendChild(node);
      return node;
    }
    var span = document.createElement('div');
    span.className = 'sch-cip-span';
    span.appendChild(node);
    positionCipSpan(span, block);
    return node;
  }

  function buildWeekGrid(target, week) {
    var corner = el('sch-corner', 'Time');
    target.appendChild(corner);

    var lanes = laneCount();
    var categories = activeCategories();
    data.DAYS.forEach(function (day, dayIndex) {
      var head = el('sch-day is-day-end', day.label);
      head.style.gridColumn = (2 + dayIndex * lanes) + ' / span ' + lanes;
      head.style.gridRow = '1';
      head.dataset.day = day.id;
      target.appendChild(head);
    });

    data.DAYS.forEach(function (day, dayIndex) {
      categories.forEach(function (category, categoryIndex) {
        var classes = 'sch-cat' + (categoryIndex === categories.length - 1 ? ' is-day-end' : '');
        var cell = el(classes, category.label);
        cell.dataset.day = day.id;
        cell.style.gridColumn = String(2 + dayIndex * lanes + categoryIndex);
        cell.style.gridRow = '2';
        target.appendChild(cell);
      });
    });

    var time = el('sch-time');
    time.style.gridColumn = '1';
    time.style.gridRow = '3';
    for (var hour = 0; hour < 24; hour++) {
      var tick = el('sch-tick', hour === 0 ? '' : data.minutesToLabel(hour * 60));
      if (hour >= data.DAY_HOURS) tick.classList.add('is-overnight');
      tick.style.top = 'calc(var(--sch-hour) * ' + hour + ')';
      time.appendChild(tick);
    }
    target.appendChild(time);

    data.DAYS.forEach(function (day, dayIndex) {
      categories.forEach(function (category, categoryIndex) {
        var classes = 'sch-lane' + (categoryIndex === categories.length - 1 ? ' is-day-end' : '');
        var lane = el(classes);
        lane.dataset.week = week;
        lane.dataset.day = day.id;
        lane.dataset.category = category.id;
        lane.style.gridColumn = String(2 + dayIndex * lanes + categoryIndex);
        lane.style.gridRow = '3';
        lane.setAttribute('role', 'group');
        lane.setAttribute('aria-label', day.label + ' ' + category.label);
        lane.appendChild(el('sch-midnight'));
        target.appendChild(lane);
        laneMap[laneKey(week, day.id, category.id)] = lane;
      });
    });

    var gutter = el('sch-note-gutter');
    gutter.style.gridColumn = '1';
    gutter.style.gridRow = '4 / span 2';
    target.appendChild(gutter);

    data.DAYS.forEach(function (day, dayIndex) {
      addDayNote(target, week, day, dayIndex, 'important', 'Important', '4');
      addDayNote(target, week, day, dayIndex, 'absence', 'Staff A/L or absence', '5');
    });
  }

  function weekHasSaturdayBlock(week) {
    var blocks = data.getState().blocks;
    for (var i = 0; i < blocks.length; i++) {
      if ((blocks[i].schedule || 'production') !== view) continue;
      if (blocks[i].weekCommencing === week && blocks[i].day === 'saturday') return true;
    }
    return false;
  }

  function saturdayControl(board, week) {
    var wrap = document.createElement('div');
    wrap.className = 'sch-saturday-wrap';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'sch-switch sch-saturday-toggle';
    button.setAttribute('aria-label', 'Toggle Saturday');
    var text = document.createElement('span');
    text.textContent = 'Toggle Saturday';
    wrap.appendChild(button);
    wrap.appendChild(text);
    wrap.addEventListener('click', function (event) {
      event.preventDefault();
      if (navigating || button.disabled) return;
      var next = !button.classList.contains('is-on');
      if (!next && weekHasSaturdayBlock(week)) return;
      data.setSaturdayRunning(week, next, view);
      data.persist('week');
      paintSaturday(board);
    });
    return wrap;
  }

  function paintSaturday(board) {
    if (!board) return;
    var week = board.dataset.week;
    var locked = weekHasSaturdayBlock(week);
    var running = locked || data.isSaturdayRunning(week, view);
    var weekGrid = board.querySelector('.sch-grid');
    if (weekGrid) weekGrid.classList.toggle('is-saturday-off', !running);
    var button = board.querySelector('.sch-saturday-toggle');
    var wrap = board.querySelector('.sch-saturday-wrap');
    if (button) {
      button.classList.toggle('is-on', running);
      button.disabled = locked;
      button.setAttribute('aria-pressed', running ? 'true' : 'false');
    }
    if (wrap) wrap.classList.toggle('is-locked', locked);
  }

  function fitDayNote(input) {
    input.style.height = '28px';
    var next = input.scrollHeight;
    if (next < 28) next = 28;
    if (next > 72) next = 72;
    input.style.height = next + 'px';
  }

  function dayDate(week, dayIndex) {
    var monday = data.parseISODate(week);
    var date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + dayIndex);
    return data.dateISO(date);
  }

  function addDayNote(target, week, day, dayIndex, field, label, row) {
    var date = dayDate(week, dayIndex);
    var saved = data.getState().dayNotes[date] || {};
    var box = document.createElement('label');
    box.className = 'sch-day-note' + (dayIndex === data.DAYS.length - 1 ? ' is-day-end' : '');
    box.dataset.day = day.id;
    box.style.gridColumn = (2 + dayIndex * laneCount()) + ' / span ' + laneCount();
    box.style.gridRow = row;
    var caption = document.createElement('span');
    caption.textContent = label;
    var input = document.createElement('textarea');
    input.rows = 1;
    input.maxLength = 2000;
    input.dataset.date = date;
    input.dataset.field = field;
    input.value = saved[field] || '';
    input.setAttribute('aria-label', day.label + ' ' + label);
    input.addEventListener('input', function () {
      if (navigating) {
        input.value = saved[field] || '';
        return;
      }
      fitDayNote(input);
      data.setDayNote(date, field, input.value);
      data.persist('notes');
    });
    input.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      input.blur();
    });
    box.appendChild(caption);
    box.appendChild(input);
    target.appendChild(box);
  }

  function categoryLabel(id) {
    var lists = [data.CATEGORIES, data.BLENDING_CATEGORIES, data.APPOINTMENT_CATEGORIES];
    for (var list = 0; list < lists.length; list++) {
      for (var i = 0; i < lists[list].length; i++) {
        if (lists[list][i].id === id) return lists[list][i].label;
      }
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
    if (view !== 'production') {
      editorStatus.textContent = '';
      editorStatus.hidden = true;
    } else {
      editorStatus.hidden = false;
      editorStatus.textContent = data.statusLabel(chosen || colour);
    }
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
    editorBlockType = '';
    editorCard.classList.remove('is-cip');
    editorSnapshot = null;
    editorCategory = '';
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
      backgroundColour: block.backgroundColour,
      laneSpan: block.laneSpan || 1
    };
  }

  function placeBlock(block) {
    var node = blockElement(block.id);
    if (!node) return null;
    if (block.blockType === 'cip') {
      var span = node.parentElement;
      if (!span || !span.classList.contains('sch-cip-span')) {
        span = document.createElement('div');
        span.className = 'sch-cip-span';
        span.appendChild(node);
      }
      positionCipSpan(span, block);
    } else {
      if (node.parentElement && node.parentElement.classList.contains('sch-cip-span')) {
        node.parentElement.remove();
      }
      var lane = laneMap[laneKey(block.weekCommencing, block.day, block.category)];
      if (lane && node.parentElement !== lane) lane.appendChild(node);
    }
    paint(node, block);
    if (!drag) paintConflicts();
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
      backgroundColour: editorSnapshot.backgroundColour,
      laneSpan: editorSnapshot.laneSpan
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
    var week = editorSnapshot && editorSnapshot.weekCommencing;
    restoreSnapshot();
    closeEditor();
    if (week) applyNightWeek(week);
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
    if (editorBlockType === 'cip') return true;
    if (view === 'appointments') return String(editorDetails.value || '').trim().length > 0;
    return products.ready() &&
      !!canonicalCustomer(editorCustomer.value) &&
      currentMatch &&
      !currentMatch.ambiguous &&
      editorProduct.value &&
      (view === 'blending' || editorFormat.value) &&
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
      if (value === 'PLACEHOLDER') option.className = 'sch-placeholder-option';
      if (value === chosen) seen = true;
      select.appendChild(option);
    });
    if (chosen && !seen) {
      var extra = document.createElement('option');
      extra.value = chosen;
      extra.textContent = chosen;
      if (chosen === 'PLACEHOLDER') extra.className = 'sch-placeholder-option';
      select.appendChild(extra);
    }
    select.value = chosen;
    if (select === editorProduct) select.classList.toggle('is-placeholder', chosen === 'PLACEHOLDER');
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
    if (view === 'production' && editorProduct.value === 'PLACEHOLDER') {
      currentMatch = { customer: customerName, product: 'PLACEHOLDER', liquidCode: '' };
      editorLiquid.value = '';
      showFormError('');
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
      productChoices(next),
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

  function productChoices(customerName) {
    if (!customerName) return [];
    var list = products.productsFor(customerName);
    if (view === 'production' && list.indexOf('PLACEHOLDER') === -1) list.push('PLACEHOLDER');
    return list;
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
      productChoices(canonical),
      canonical ? 'Select a product' : 'Select a customer first',
      product
    );
    editorProduct.disabled = !products.ready() || !canonical;
    fillSelect(editorFormat, products.formatsFor(editorCategory), 'Select a packing format', format);
    applyLiquid();
  }

  function selectedColour() {
    var swatch = editorSwatches.querySelector('.sch-swatch.is-selected');
    return swatch ? swatch.dataset.colour : data.DEFAULT_COLOUR;
  }

  function selectedMatch(customerName) {
    if (view === 'production' && editorProduct.value === 'PLACEHOLDER') {
      return { customer: customerName, product: 'PLACEHOLDER', liquidCode: '' };
    }
    return customerName ? products.lookup(customerName, editorProduct.value) : null;
  }

  function productPatch(match, volume) {
    if (view === 'appointments') {
      return {
        customer: '',
        product: '',
        liquidCode: '',
        packingFormat: '',
        freeText: editorDetails.value,
        volume: null,
        legacyText: '',
        backgroundColour: selectedColour(),
        startOffset: Number(editorStart.value),
        endOffset: Number(editorEnd.value)
      };
    }
    return {
      customer: match.customer,
      product: match.product,
      liquidCode: match.liquidCode,
      packingFormat: view === 'blending' ? '' : editorFormat.value,
      freeText: view === 'blending' ? editorFree.value : '',
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
    if (editorBlockType === 'cip' && editorMode === 'edit') {
      var cipUpdated = data.updateBlock(editingId, {
        startOffset: Number(editorStart.value),
        endOffset: Number(editorEnd.value)
      });
      if (cipUpdated) placeBlock(cipUpdated);
      data.persist('block');
      if (cipUpdated) releaseNight(cipUpdated.weekCommencing);
      closeEditor();
      return;
    }
    var volume = view === 'appointments' ? null : readVolume();
    var customerName = view === 'appointments' ? '' : canonicalCustomer(editorCustomer.value);
    var match = view === 'appointments' ? { customer: '', product: '', liquidCode: '' } : selectedMatch(customerName);
    if (view !== 'appointments' && (!match || match.ambiguous)) {
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
        customer: view === 'appointments' ? '' : match.customer,
        product: view === 'appointments' ? '' : match.product,
        liquidCode: view === 'appointments' ? '' : match.liquidCode,
        packingFormat: view === 'production' ? editorFormat.value : '',
        freeText: view === 'appointments' ? editorDetails.value : (view === 'blending' ? editorFree.value : ''),
        volume: view === 'appointments' ? null : volume,
        schedule: view,
        weekCommencing: draft.weekCommencing
      });
      if (!created) {
        showFormError(view === 'appointments' ? 'The appointment could not be created.' : (view === 'blending' ? 'The blending booking could not be created.' : 'The production block could not be created.'));
        return;
      }
      var lane = laneMap[laneKey(created.weekCommencing, created.day, created.category)];
      if (lane) lane.appendChild(renderBlock(created));
      data.persist('block');
      releaseNight(created.weekCommencing);
      paintSaturday(boardFor(created.weekCommencing));
      draft = null;
      closeEditor();
      return;
    }
    if (!editingId) return;
    var updated = data.updateBlock(editingId, productPatch(match, volume));
    if (updated) placeBlock(updated);
    data.persist('block');
    if (updated) releaseNight(updated.weekCommencing);
    closeEditor();
  }

  function setEditorMode(mode) {
    editorMode = mode;
    var adding = mode === 'add';
    var blending = view === 'blending';
    var appointments = view === 'appointments';
    editorCard.classList.toggle('is-blending', blending);
    editorCard.classList.toggle('is-appointments', appointments);
    editorSwatches.querySelectorAll('.sch-swatch').forEach(function (swatch) {
      var label = view === 'production' ? data.statusLabel(swatch.dataset.colour) : 'Colour';
      swatch.title = label;
      swatch.setAttribute('aria-label', label);
    });
    editorActions.classList.toggle('is-adding', adding);
    editorDelete.tabIndex = adding ? -1 : 0;
    editorDismiss.textContent = adding ? 'Cancel' : 'Back';
    editorConfirm.textContent = adding ? (appointments ? 'Create Appointment' : (blending ? 'Create Blending Booking' : 'Create Production Block')) : 'Save changes';
    editorTitle.textContent = appointments
      ? (adding ? 'Create appointment' : 'Edit appointment')
      : (blending
        ? (adding ? 'Create blending booking' : 'Edit blending booking')
        : (adding ? 'Create production block' : 'Edit production block'));
  }

  function openEditor(id, mode) {
    var block = data.getBlock(id);
    if (!block) return;
    if (editingId && editingId !== id) {
      var previous = blockElement(editingId);
      if (previous) previous.classList.remove('is-editing');
    }
    editingId = id;
    editorBlockType = block.blockType === 'cip' ? 'cip' : '';
    editorCard.classList.toggle('is-cip', editorBlockType === 'cip');
    editorCategory = block.category;
    draft = null;
    editorSnapshot = copyBlock(block);
    setEditorMode(mode);
    if (editorBlockType === 'cip') {
      editorTitle.textContent = 'CIP';
      editorConfirm.textContent = 'Save changes';
    }
    var node = blockElement(id);
    if (node) node.classList.add('is-editing');
    filling = true;
    editorLane.textContent = weekHeading(block.weekCommencing) + ' · ' + dayLabel(block.day) + ' · ' + categoryLabel(block.category);
    fillForm(block.customer, block.product, block.packingFormat);
    editorFree.value = view === 'blending' ? (block.freeText || '') : '';
    editorDetails.value = view === 'appointments' ? (block.freeText || '') : '';
    editorVolume.value = block.volume == null ? '' : String(block.volume);
    fillStartOptions(block.startOffset);
    fillEndOptions(block.startOffset, block.endOffset);
    refreshDuration(block);
    markSwatch(block.backgroundColour);
    filling = false;
    refreshVolumeMessage();
    refreshSubmit();
    modal.hidden = false;
    if (editorBlockType === 'cip') editorDismiss.focus();
    else if (view === 'appointments') editorDetails.focus();
    else if (products.ready()) focusCustomerField();
  }

  function openCreate(day, category, hour, week) {
    if (editorMode === 'edit') dismissEditor();
    else if (editorMode === 'add') closeEditor();
    editorCategory = category;
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
    editorFree.value = '';
    editorDetails.value = '';
    fillForm('', '', '');
    editorVolume.value = '';
    fillStartOptions(draft.startOffset);
    fillEndOptions(draft.startOffset, draft.endOffset);
    refreshDuration(draft);
    markSwatch(draft.backgroundColour);
    filling = false;
    showFormError(view === 'appointments' || products.ready() ? '' : (products.status().message || 'Product lists are still loading.'));
    refreshVolumeMessage();
    refreshSubmit();
    modal.hidden = false;
    if (view === 'appointments') editorDetails.focus();
    else if (products.ready()) focusCustomerField();
  }

  function applyTimes(start, end) {
    if (!editingId) return;
    var updated = data.updateBlock(editingId, { startOffset: start, endOffset: end });
    if (!updated) return;
    paint(blockElement(editingId), updated);
    previewNight(updated.weekCommencing);
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
    document.body.classList.remove('sch-dragging', 'sch-moving', 'sch-spanning');
    try {
      if (scroll.hasPointerCapture(info.pointerId)) scroll.releasePointerCapture(info.pointerId);
    } catch (err) { /* capture may already be gone */ }
    try {

    var node = info.id ? blockElement(info.id) : null;
    if (node) node.classList.remove('is-active');
    clearDropTarget();

    if (!commit) {
      var movedWeek = null;
      if (info.kind !== 'create' && info.id) {
        var current = data.getBlock(info.id);
        movedWeek = current && current.weekCommencing !== info.week ? current.weekCommencing : null;
        var restored = data.updateBlock(info.id, {
          day: info.day,
          category: info.category,
          weekCommencing: info.week,
          startOffset: info.startOffset,
          endOffset: info.endOffset,
          laneSpan: info.laneSpan
        });
        if (restored) placeBlock(restored);
      }
      applyNightWeek(info.week);
      if (movedWeek) applyNightWeek(movedWeek);
      paintSaturday(boardFor(info.week));
      if (movedWeek) paintSaturday(boardFor(movedWeek));
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
      block.weekCommencing !== info.week ||
      (block.laneSpan || 1) !== (info.laneSpan || 1);
    if (changed) data.persist('block');
    releaseNight(info.week);
    if (block.weekCommencing !== info.week) releaseNight(block.weekCommencing);
    paintSaturday(boardFor(info.week));
    if (block.weekCommencing !== info.week) paintSaturday(boardFor(block.weekCommencing));
    if (!changed) openEditor(info.id, 'edit');
    } finally {
      paintConflicts();
    }
  }

  function markCipLanes(week, day, category, span) {
    clearDropTarget();
    var start = categoryIndex(category);
    if (start < 0) return;
    for (var i = 0; i < span; i++) {
      var lane = laneMap[laneKey(week, day, data.CATEGORIES[start + i].id)];
      if (lane) lane.classList.add('is-drop-target');
    }
  }

  function laneIndexAt(week, day, clientX) {
    var categories = data.CATEGORIES;
    var last = 0;
    for (var i = 0; i < categories.length; i++) {
      var lane = laneMap[laneKey(week, day, categories[i].id)];
      if (!lane) continue;
      var rect = lane.getBoundingClientRect();
      if (clientX < rect.left) return i === 0 ? 0 : i;
      if (clientX < rect.right) return i;
      last = i;
    }
    return last;
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
    document.body.classList.remove('sch-dragging', 'sch-moving', 'sch-spanning');
    document.body.classList.add(
      drag.kind === 'move' ? 'sch-moving' :
      (drag.kind === 'lanes-west' || drag.kind === 'lanes-east' ? 'sch-spanning' : 'sch-dragging')
    );
    var previousWeek = drag.lane.dataset.week;
    var hourHeight = drag.lane.getBoundingClientRect().height / visibleHours(drag.lane);
    var delta = Math.round(dy / hourHeight) * 60;
    var start = drag.startOffset;
    var end = drag.endOffset;
    var patch = {};
    if (drag.kind === 'lanes-west' || drag.kind === 'lanes-east') {
      var edge = laneIndexAt(drag.week, drag.day, clientX);
      var far = drag.startIndex + drag.laneSpan - 1;
      if (drag.kind === 'lanes-east') {
        patch.laneSpan = Math.max(edge, drag.startIndex) - drag.startIndex + 1;
        patch.category = data.CATEGORIES[drag.startIndex].id;
      } else {
        var nextStart = Math.min(edge, far);
        patch.category = data.CATEGORIES[nextStart].id;
        patch.laneSpan = far - nextStart + 1;
      }
      markCipLanes(drag.week, drag.day, patch.category, patch.laneSpan);
    } else if (drag.kind === 'move') {
      var length = end - start;
      var lane = laneUnderPoint(clientX, clientY);
      if (lane && drag.blockType === 'cip' && view !== 'production') lane = null;
      else if (lane && view !== 'appointments' && drag.blockType !== 'cip' && lane.dataset.category !== drag.category) lane = null;
      clearDropTarget();
      var otherWeek = lane && lane.dataset.week !== drag.week;
      if (otherWeek) {
        start = drag.startOffset;
        end = drag.endOffset;
      } else {
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
        var nightAlreadyOpen = drag.nightAtStart[drag.week] || data.isNightManual(drag.week, view);
        if (!nightAlreadyOpen && end > data.NIGHT_AFTER) {
          end = data.NIGHT_AFTER;
          start = Math.max(0, end - length);
        }
      }
      if (lane) {
        patch.day = lane.dataset.day;
        patch.weekCommencing = lane.dataset.week;
        if (drag.blockType === 'cip') {
          var hit = categoryIndex(lane.dataset.category);
          var span = drag.laneSpan || 1;
          var origin = hit - (drag.grabOffset || 0);
          if (origin < 0) origin = 0;
          if (origin + span > data.CATEGORIES.length) origin = data.CATEGORIES.length - span;
          patch.category = data.CATEGORIES[origin].id;
          patch.laneSpan = span;
          markCipLanes(lane.dataset.week, lane.dataset.day, patch.category, span);
        } else {
          patch.category = lane.dataset.category;
          lane.classList.add('is-drop-target');
        }
        drag.lane = lane;
      }
    } else if (drag.kind === 'start') {
      start = clamp(drag.startOffset + delta, 0, drag.endOffset - 60);
    } else if (drag.kind === 'end') {
      end = clamp(drag.endOffset + delta, drag.startOffset + 60, data.DAY_LENGTH);
    }
    patch.startOffset = start;
    patch.endOffset = end;
    var updated = data.updateBlock(drag.id, patch);
    if (updated) {
      placeBlock(updated);
      if (drag.nightAtStart[updated.weekCommencing] === undefined) {
        drag.nightAtStart[updated.weekCommencing] = othersNeedNight(updated.weekCommencing, drag.id);
      }
      if (updated.weekCommencing === drag.week && (drag.nightAtStart[drag.week] || data.needsNight(updated.endOffset))) {
        previewNight(updated.weekCommencing);
      } else {
        applyNightWeek(updated.weekCommencing);
      }
      if (previousWeek && previousWeek !== updated.weekCommencing) restoreDragNight(previousWeek);
    }
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
    try {
      if (commit && event.clientX != null) trackMove(event.clientX, event.clientY);
    } catch (err) { /* keep the pointer usable if a paint fails mid-drag */ }
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
    if (drag && !drag.moved) endPointer(event, true);
    else endPointer(event, false);
  }

  function hitSchedule(x, y) {
    var stack = [];
    try { stack = document.elementsFromPoint(x, y); } catch (err) { return null; }
    var handle = null;
    var block = null;
    var lane = null;
    for (var i = 0; i < stack.length; i++) {
      var el = stack[i];
      if (!el.closest) continue;
      if (!handle) handle = el.closest('.prod-handle');
      if (!block) block = el.closest('.prod-block');
      if (!lane) lane = el.closest('.sch-lane');
    }
    if (handle && !block) block = handle.closest('.prod-block');
    return { handle: handle, block: block, lane: lane };
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    if (drag) endPointer({ pointerId: drag.pointerId, clientX: drag.x, clientY: drag.y }, false);
    navigating = false;
    if (event.target.closest && event.target.closest('.sch-day-note, .sch-modal, .sch-context')) return;
    var hit = hitSchedule(event.clientX, event.clientY) || {};
    var handle = hit.handle || (event.target.closest && event.target.closest('.prod-handle'));
    var blockNode = hit.block || (event.target.closest && event.target.closest('.prod-block'));
    var lane = hit.lane || (event.target.closest && event.target.closest('.sch-lane'));
    var spanHost = blockNode && blockNode.closest('.sch-cip-span');
    if (!lane && spanHost) {
      lane = laneMap[laneKey(spanHost.dataset.week, spanHost.dataset.day, spanHost.dataset.category)];
    }
    if (!lane || !scroll.contains(lane)) return;

    if (blockNode) {
      event.preventDefault();
      var moving = data.getBlock(blockNode.dataset.id);
      var cip = moving && moving.blockType === 'cip';
      drag = {
        kind: handle ? handle.dataset.edge : 'move',
        pointerId: event.pointerId,
        id: blockNode.dataset.id,
        blockType: cip ? 'cip' : 'booking',
        x: event.clientX,
        y: event.clientY,
        moved: false,
        lane: lane,
        week: lane.dataset.week,
        day: lane.dataset.day,
        category: moving ? moving.category : lane.dataset.category,
        laneSpan: moving && moving.laneSpan ? moving.laneSpan : 1,
        startIndex: Math.max(0, categoryIndex(moving ? moving.category : lane.dataset.category)),
        grabOffset: 0,
        startOffset: Number(blockNode.dataset.start),
        endOffset: Number(blockNode.dataset.end),
        nightAtStart: {}
      };
      if (cip) {
        var hitIndex = laneIndexAt(drag.week, drag.day, event.clientX);
        drag.grabOffset = Math.max(0, Math.min(drag.laneSpan - 1, hitIndex - drag.startIndex));
      }
      drag.nightAtStart[lane.dataset.week] = weekNeedsNight(lane.dataset.week);
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
    for (year = current.year - 1; year <= current.year + 2; year++) {
      if (year !== 2025) years[year] = true;
    }
    data.getState().blocks.forEach(function (block) {
      var info = data.productionInfo(block.weekCommencing);
      if (info && info.year !== 2025) years[info.year] = true;
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

  function boardFor(week) {
    return grid.querySelector('.sch-board[data-week="' + week + '"]');
  }

  function weekNeedsNight(week) {
    return othersNeedNight(week, null);
  }

  function othersNeedNight(week, ignoreId) {
    var blocks = data.getState().blocks;
    for (var i = 0; i < blocks.length; i++) {
      if (ignoreId && blocks[i].id === ignoreId) continue;
      if ((blocks[i].schedule || 'production') !== view) continue;
      if (blocks[i].weekCommencing === week && data.needsNight(blocks[i].endOffset)) return true;
    }
    return false;
  }

  function restoreDragNight(week) {
    var board = boardFor(week);
    if (!board) return;
    if (drag && drag.nightAtStart && drag.nightAtStart[week]) {
      previewNight(week);
      return;
    }
    applyNight(board);
  }

  function paintNight(board, on, locked) {
    var weekGrid = board.querySelector('.sch-grid');
    var button = board.querySelector('.sch-night .sch-switch');
    var note = board.querySelector('.sch-night-note');
    if (weekGrid) weekGrid.classList.toggle('is-night', !!on);
    if (button) {
      button.classList.toggle('is-on', !!on);
      button.disabled = !!locked;
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var row = board.querySelector('.sch-night');
    if (row) row.classList.toggle('is-locked', !!locked);
    if (note) note.hidden = !locked;
  }

  function applyNight(board) {
    if (!board) return;
    var required = weekNeedsNight(board.dataset.week);
    board.dataset.nightRequired = required ? 'true' : 'false';
    paintNight(board, required || data.isNightManual(board.dataset.week, view), required);
  }

  function applyNightWeek(week) {
    applyNight(boardFor(week));
  }

  function previewNight(week) {
    var board = boardFor(week);
    if (!board) return;
    var required = weekNeedsNight(week);
    if (required) {
      board.dataset.nightRequired = 'true';
      paintNight(board, true, true);
      return;
    }
    var keep = board.dataset.nightRequired === 'true' || data.isNightManual(week, view);
    paintNight(board, keep, false);
  }

  function releaseNight(week) {
    var board = boardFor(week);
    if (!board) return;
    var required = weekNeedsNight(week);
    if (board.dataset.nightRequired === 'true' && !required && !data.isNightManual(week, view)) {
      data.setNightManual(week, true, view);
      data.persist('week');
    }
    applyNight(board);
  }

  function bindNightToggle(board, week) {
    var wrap = document.createElement('div');
    wrap.className = 'sch-night-wrap';
    var label = document.createElement('div');
    label.className = 'sch-night';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'sch-switch';
    button.setAttribute('aria-label', 'Toggle Night Shift');
    label.appendChild(button);
    label.appendChild(document.createTextNode('Toggle Night Shift'));
    label.addEventListener('click', function (event) {
      event.preventDefault();
      if (navigating || button.disabled) return;
      data.setNightManual(week, !button.classList.contains('is-on'), view);
      data.persist('week');
      applyNight(board);
    });
    var note = document.createElement('p');
    note.className = 'sch-night-note';
    note.hidden = true;
    note.textContent = view === 'appointments'
      ? 'Night shift required – appointment scheduled beyond 20:00'
      : (view === 'blending'
        ? 'Night shift required – booking scheduled beyond 20:00'
        : 'Night shift required – production scheduled beyond 20:00');
    wrap.appendChild(label);
    wrap.appendChild(note);
    return wrap;
  }

  function markActive(iso) {
    var boards = grid.querySelectorAll('.sch-board');
    for (var i = 0; i < boards.length; i++) {
      boards[i].classList.toggle('is-active', boards[i].dataset.week === iso);
    }
  }

  function monthDivider(monthIndex, year) {
    var month = document.createElement('h2');
    month.className = 'sch-month';
    var pill = document.createElement('span');
    pill.className = 'sch-month-pill';
    pill.dataset.month = String(monthIndex);
    var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.classList.add('sch-month-icon');
    var shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('fill', 'none');
    shape.setAttribute('stroke', 'currentColor');
    shape.setAttribute('stroke-width', '2');
    shape.setAttribute('stroke-linecap', 'round');
    shape.setAttribute('stroke-linejoin', 'round');
    shape.setAttribute('d', 'M8 3v3M16 3v3M4.5 9h15M6 5.5h12a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 18 19.5H6A1.5 1.5 0 0 1 4.5 18V7A1.5 1.5 0 0 1 6 5.5z');
    icon.appendChild(shape);
    var monthText = document.createElement('span');
    monthText.textContent = MONTHS[monthIndex] + ' ' + year;
    pill.appendChild(icon);
    pill.appendChild(monthText);
    month.appendChild(pill);
    return month;
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
        fragment.appendChild(monthDivider(monday.getMonth(), monday.getFullYear()));
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
      label.appendChild(bindNightToggle(board, info.weekCommencing));
      head.appendChild(label);
      head.appendChild(saturdayControl(board, info.weekCommencing));
      board.appendChild(head);
      board.appendChild(weekGrid);
      fragment.appendChild(board);
      buildWeekGrid(weekGrid, info.weekCommencing);
    });
    grid.innerHTML = '';
    grid.appendChild(fragment);
    renderBlocks();
    var boards = grid.querySelectorAll('.sch-board');
    for (var index = 0; index < boards.length; index++) {
      applyNight(boards[index]);
      paintSaturday(boards[index]);
    }
    window.requestAnimationFrame(function () {
      var fields = grid.querySelectorAll('.sch-day-note textarea');
      for (var i = 0; i < fields.length; i++) fitDayNote(fields[i]);
    });
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
    data.setMeta({ weekCommencing: iso });
    runSuffix.value = data.runSuffixFor(iso);
    try {
      if (data.peekYear(year) || !data.loadedYear()) {
        renderYear(year);
        markActive(iso);
        window.requestAnimationFrame(function () { scrollToWeek(iso, false); });
      }
    } catch (err) { /* draw what we can, then load the year */ }
    var token = ++yearToken;
    data.loadYear(year).then(function () {
      if (token !== yearToken) return;
      try { renderYear(year); } catch (err) { /* keep the grid usable */ }
      data.setMeta({ weekCommencing: iso });
      runSuffix.value = data.runSuffixFor(iso);
      markActive(iso);
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () { scrollToWeek(iso, !!smooth); });
      });
    }).catch(function () {
      if (token !== yearToken) return;
      try { renderYear(year); } catch (err) { /* keep the grid usable */ }
      markActive(iso);
    }).then(function () {
      if (token === yearToken) navigating = false;
    }, function () {
      if (token === yearToken) navigating = false;
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

  function bindScheduleStatus() {
    var saveStatus = document.getElementById('saveStatus');
    var conflictDialog = document.getElementById('conflictDialog');
    var conflictText = document.getElementById('conflictText');
    var conflictTheirs = document.getElementById('conflictTheirs');
    var conflictMine = document.getElementById('conflictMine');
    data.onStatus(function (info) {
      if (!saveStatus) return;
      saveStatus.textContent = info.message;
      saveStatus.classList.toggle('is-problem', info.tone === 'problem');
      saveStatus.classList.toggle('is-error', info.tone === 'error');
    });
    data.onConflict(function (message, decide) {
      conflictText.textContent = message;
      conflictDialog.hidden = false;
      conflictTheirs.onclick = function () {
        conflictDialog.hidden = true;
        decide('theirs');
      };
      conflictMine.onclick = function () {
        conflictDialog.hidden = true;
        decide('mine');
      };
      conflictTheirs.focus();
    });
    data.onApplied(function () {
      var top = scroll.scrollTop;
      var left = scroll.scrollLeft;
      var iso = weekJump.value;
      renderYear(Number(yearSelect.value));
      scroll.scrollTop = top;
      scroll.scrollLeft = left;
      if (iso) markActive(iso);
    });
  }

  function switchSchedule(next) {
    if (next !== 'production' && next !== 'blending' && next !== 'appointments') return;
    if (next === view) return;
    if (!modal.hidden) dismissEditor();
    view = next;
    document.body.classList.toggle('is-blending', view === 'blending');
    tabProduction.setAttribute('aria-selected', view === 'production' ? 'true' : 'false');
    tabBlending.setAttribute('aria-selected', view === 'blending' ? 'true' : 'false');
    tabAppointments.setAttribute('aria-selected', view === 'appointments' ? 'true' : 'false');
    scheduleTitle.textContent = view === 'appointments' ? 'Appointments' : (view === 'blending' ? 'Blending Schedule' : 'Production Schedule');
    scroll.setAttribute('aria-label', view === 'appointments' ? 'Appointments' : (view === 'blending' ? 'Blending schedule' : 'Production schedule'));
    renderLegend();
    var iso = data.getState().weekCommencing;
    renderYear(data.loadedYear() || Number(yearSelect.value));
    window.requestAnimationFrame(function () { scrollToWeek(iso, false); });
  }

  function bindMeta() {
    tabProduction.addEventListener('click', function () { switchSchedule('production'); });
    tabBlending.addEventListener('click', function () { switchSchedule('blending'); });
    tabAppointments.addEventListener('click', function () { switchSchedule('appointments'); });
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
    mainMenu.addEventListener('click', function () {
      leaveMenu.hidden = false;
      document.getElementById('leaveMenuNo').focus();
    });
    document.getElementById('leaveMenuNo').addEventListener('click', function () {
      leaveMenu.hidden = true;
    });
    document.getElementById('leaveMenuYes').addEventListener('click', function () {
      window.location.href = '../menu.html';
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
        if (editorBlockType === 'cip') return;
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
      editorProduct.classList.toggle('is-placeholder', editorProduct.value === 'PLACEHOLDER');
      if (filling) return;
      applyLiquid();
      refreshSubmit();
    });

    editorFormat.addEventListener('change', function () {
      if (filling) return;
      refreshSubmit();
    });

    editorDetails.addEventListener('input', function () {
      if (filling) return;
      refreshSubmit();
    });
    editorFree.addEventListener('input', function () {
      if (filling || view !== 'blending') return;
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
      var existing = data.getBlock(id);
      var week = existing && existing.weekCommencing;
      closeEditor();
      data.removeBlock(id);
      data.persist('block');
      var node = blockElement(id);
      if (node) {
        var span = node.parentElement;
        if (span && span.classList.contains('sch-cip-span')) span.remove();
        else node.remove();
      }
      paintConflicts();
      if (week) {
        releaseNight(week);
        paintSaturday(boardFor(week));
      }
    });

    editorDismiss.addEventListener('click', dismissEditor);
    editorConfirm.addEventListener('click', confirmEditor);
    modal.addEventListener('pointerdown', function (event) {
      if (event.target === modal) dismissEditor();
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (!scheduleMenu.hidden) {
      closeScheduleMenu();
      return;
    }
    if (cipChoice && !cipChoice.hidden) {
      closeCipChoice();
      return;
    }
    if (drag) {
      endPointer({ pointerId: drag.pointerId }, false);
      return;
    }
    if (isCustomerOpen()) {
      closeCustomerList();
      return;
    }
    if (!leaveMenu.hidden) {
      leaveMenu.hidden = true;
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
    if (current.state === 'ready' && !drag) {
      renderBlocks();
      if (editingId) {
        var editing = blockElement(editingId);
        if (editing) editing.classList.add('is-editing');
      }
    }
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
    var plainKey = view === 'blending' || view === 'appointments';
    statusLegend.innerHTML = '';
    statusLegend.setAttribute('aria-label', view === 'appointments' ? 'Appointment colours' : (view === 'blending' ? 'Blending colours' : 'Production status'));
    data.STATUSES.forEach(function (status) {
      var item = document.createElement('div');
      item.className = 'sch-legend-item';
      item.style.background = status.colour;
      item.textContent = plainKey ? 'Placeholder' : status.label;
      statusLegend.appendChild(item);
    });
  }

  sourceRetry.addEventListener('click', function () {
    products.load(true).catch(function () { /* status already reported */ });
  });
  products.subscribe(renderSource);

  var scheduleMenu = document.getElementById('scheduleMenu');
  var scheduleMenuCip = document.getElementById('scheduleMenuCip');
  var scheduleMenuLine = document.getElementById('scheduleMenuLine');
  var scheduleMenuAll = document.getElementById('scheduleMenuAll');
  var cipChoiceLane = document.getElementById('cipChoiceLane');
  var cipChoiceQuestion = document.getElementById('cipChoiceQuestion');
  var cipChoiceCancel = document.getElementById('cipChoiceCancel');
  var menuTarget = null;
  var menuPoint = { x: 0, y: 0 };

  function categoryLabel(id) {
    var categories = data.CATEGORIES;
    for (var i = 0; i < categories.length; i++) {
      if (categories[i].id === id) return categories[i].label;
    }
    return id;
  }

  function closeScheduleMenu() {
    scheduleMenu.hidden = true;
    if (!cipChoice || cipChoice.hidden) menuTarget = null;
  }

  function closeCipChoice() {
    cipChoice.hidden = true;
    menuTarget = null;
  }

  function placeScheduleMenu() {
    scheduleMenu.hidden = false;
    scheduleMenu.style.left = '0px';
    scheduleMenu.style.top = '0px';
    var rect = scheduleMenu.getBoundingClientRect();
    var left = menuPoint.x;
    var top = menuPoint.y;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    scheduleMenu.style.left = left + 'px';
    scheduleMenu.style.top = top + 'px';
  }

  function openScheduleMenu(x, y, lane) {
    if (!cipChoice.hidden) return;
    menuPoint.x = x;
    menuPoint.y = y;
    menuTarget = {
      week: lane.dataset.week,
      day: lane.dataset.day,
      category: lane.dataset.category,
      hour: hourAt(lane, y)
    };
    placeScheduleMenu();
  }

  function showCipChoice() {
    if (!menuTarget || view !== 'production') return;
    var line = categoryLabel(menuTarget.category).toUpperCase();
    cipChoiceLane.textContent = weekHeading(menuTarget.week) + ' · ' + dayLabel(menuTarget.day) + ' · ' + line;
    cipChoiceQuestion.textContent = 'Would you like to add the CIP block to the ' + line + ' only, or extend the block across all production lines?';
    scheduleMenu.hidden = true;
    cipChoice.hidden = false;
    scheduleMenuLine.focus();
  }

  function addCipBlock(spanAll) {
    var target = menuTarget;
    closeCipChoice();
    if (!target || view !== 'production') return;
    var category = target.category;
    var laneSpan = 1;
    if (spanAll) {
      category = data.CATEGORIES[0].id;
      laneSpan = data.CATEGORIES.length;
    }
    var created = data.addBlock({
      day: target.day,
      category: category,
      laneSpan: laneSpan,
      startOffset: target.hour * 60,
      endOffset: target.hour * 60 + 60,
      backgroundColour: data.CIP_COLOUR,
      schedule: 'production',
      blockType: 'cip',
      weekCommencing: target.week
    });
    if (!created) return;
    attachBlock(created);
    data.persist('block');
    releaseNight(created.weekCommencing);
    paintSaturday(boardFor(created.weekCommencing));
  }

  scroll.addEventListener('contextmenu', function (event) {
    if (view !== 'production' || !modal.hidden) return;
    var lane = event.target.closest && event.target.closest('.sch-lane');
    if (!lane || !scroll.contains(lane)) return;
    if (event.target.closest('.prod-block')) return;
    event.preventDefault();
    openScheduleMenu(event.clientX, event.clientY, lane);
  });

  scheduleMenuCip.addEventListener('click', showCipChoice);
  scheduleMenuLine.addEventListener('click', function () { addCipBlock(false); });
  scheduleMenuAll.addEventListener('click', function () { addCipBlock(true); });
  cipChoiceCancel.addEventListener('click', closeCipChoice);
  cipChoice.addEventListener('pointerdown', function (event) {
    if (event.target === cipChoice) closeCipChoice();
  });
  document.addEventListener('pointerdown', function (event) {
    if (scheduleMenu.hidden || scheduleMenu.contains(event.target)) return;
    closeScheduleMenu();
  });
  scroll.addEventListener('scroll', closeScheduleMenu);
  window.addEventListener('resize', closeScheduleMenu);

  scroll.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerCancel, true);
  document.addEventListener('mouseup', onMouseUp, true);
  renderLegend();
  bindMeta();
  bindEditor();
  bindScheduleStatus();
  var opening = data.productionInfo(data.mondayISO(new Date()));
  showYear(opening.year, opening.weekCommencing, false);
  products.load().catch(function () { /* status already reported */ });
})();
