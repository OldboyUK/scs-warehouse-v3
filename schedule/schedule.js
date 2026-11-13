(function () {
  if (!window.SCSAuth || !SCSAuth.isAuthenticated() || !window.ScheduleData) return;

  var data = window.ScheduleData;
  var MOVE_SLOP = 4;
  var laneMap = {};
  var editingId = null;
  var editorMode = null;
  var editorSnapshot = null;
  var filling = false;
  var drag = null;

  var scroll = document.getElementById('scheduleScroll');
  var grid = document.getElementById('scheduleGrid');
  var runSuffix = document.getElementById('runSuffix');
  var weekCommencing = document.getElementById('weekCommencing');
  var notes = document.getElementById('importantNotes');
  var modal = document.getElementById('blockEditor');
  var editorTitle = document.getElementById('editorTitle');
  var editorLane = document.getElementById('editorLane');
  var editorText = document.getElementById('editorText');
  var editorStart = document.getElementById('editorStart');
  var editorEnd = document.getElementById('editorEnd');
  var editorDuration = document.getElementById('editorDuration');
  var editorSwatches = document.getElementById('editorSwatches');
  var editorDelete = document.getElementById('editorDelete');
  var editorDismiss = document.getElementById('editorDismiss');
  var editorConfirm = document.getElementById('editorConfirm');
  var editorActions = document.getElementById('editorActions');

  function el(className, text) {
    var node = document.createElement('div');
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function laneKey(day, category) {
    return day + ':' + category;
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
    node.querySelector('.prod-text').textContent = block.text;
    var label = (block.text || 'Empty block') + ', ' +
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
    data.getState().blocks.forEach(function (block) {
      var lane = laneMap[laneKey(block.day, block.category)];
      if (lane) lane.appendChild(renderBlock(block));
    });
  }

  function buildGrid() {
    var corner = el('sch-corner', 'Time');
    grid.appendChild(corner);

    data.DAYS.forEach(function (day, dayIndex) {
      var head = el('sch-day is-day-end', day.label);
      head.style.gridColumn = (2 + dayIndex * 5) + ' / span 5';
      head.style.gridRow = '1';
      grid.appendChild(head);
    });

    data.DAYS.forEach(function (day, dayIndex) {
      data.CATEGORIES.forEach(function (category, categoryIndex) {
        var classes = 'sch-cat' + (categoryIndex === data.CATEGORIES.length - 1 ? ' is-day-end' : '');
        var cell = el(classes, category.label);
        cell.style.gridColumn = String(2 + dayIndex * 5 + categoryIndex);
        cell.style.gridRow = '2';
        grid.appendChild(cell);
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
    grid.appendChild(time);

    data.DAYS.forEach(function (day, dayIndex) {
      data.CATEGORIES.forEach(function (category, categoryIndex) {
        var classes = 'sch-lane' + (categoryIndex === data.CATEGORIES.length - 1 ? ' is-day-end' : '');
        var lane = el(classes);
        lane.dataset.day = day.id;
        lane.dataset.category = category.id;
        lane.style.gridColumn = String(2 + dayIndex * 5 + categoryIndex);
        lane.style.gridRow = '3';
        lane.setAttribute('role', 'group');
        lane.setAttribute('aria-label', day.label + ' ' + category.label);
        lane.appendChild(el('sch-midnight'));
        grid.appendChild(lane);
        laneMap[laneKey(day.id, category.id)] = lane;
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
    editorSwatches.querySelectorAll('.sch-swatch').forEach(function (swatch) {
      var selected = swatch.dataset.colour === colour;
      swatch.classList.toggle('is-selected', selected);
      swatch.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
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
      text: block.text,
      backgroundColour: block.backgroundColour
    };
  }

  function placeBlock(block) {
    var node = blockElement(block.id);
    var lane = laneMap[laneKey(block.day, block.category)];
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
      text: editorSnapshot.text,
      backgroundColour: editorSnapshot.backgroundColour
    });
    if (restored) placeBlock(restored);
  }

  function dismissEditor() {
    if (!editingId) return;
    if (editorMode === 'add') {
      var id = editingId;
      closeEditor();
      data.removeBlock(id);
      var node = blockElement(id);
      if (node) node.remove();
      return;
    }
    restoreSnapshot();
    closeEditor();
  }

  function confirmEditor() {
    if (!editingId) return;
    data.persist();
    closeEditor();
  }

  function setEditorMode(mode) {
    editorMode = mode;
    var adding = mode === 'add';
    editorActions.classList.toggle('is-adding', adding);
    editorDelete.tabIndex = adding ? -1 : 0;
    editorDismiss.textContent = adding ? 'Cancel' : 'Back';
    editorConfirm.textContent = adding ? 'Add' : 'Save changes';
    editorTitle.textContent = adding ? 'Add production block' : 'Edit production block';
  }

  function openEditor(id, mode) {
    var block = data.getBlock(id);
    if (!block) return;
    if (editingId && editingId !== id) {
      var previous = blockElement(editingId);
      if (previous) previous.classList.remove('is-editing');
    }
    editingId = id;
    editorSnapshot = copyBlock(block);
    setEditorMode(mode);
    var node = blockElement(id);
    if (node) node.classList.add('is-editing');
    filling = true;
    editorLane.textContent = dayLabel(block.day) + ' · ' + categoryLabel(block.category);
    editorText.value = block.text;
    fillStartOptions(block.startOffset);
    fillEndOptions(block.startOffset, block.endOffset);
    refreshDuration(block);
    markSwatch(block.backgroundColour);
    filling = false;
    modal.hidden = false;
    editorText.focus();
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

  function createBlock(day, category, hour) {
    var block = data.addBlock({
      day: day,
      category: category,
      startOffset: hour * 60,
      endOffset: hour * 60 + 60,
      text: '',
      backgroundColour: data.DEFAULT_COLOUR
    });
    if (!block) return;
    var lane = laneMap[laneKey(day, category)];
    if (lane) lane.appendChild(renderBlock(block));
    openEditor(block.id, 'add');
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
          startOffset: info.startOffset,
          endOffset: info.endOffset
        });
        if (restored) placeBlock(restored);
      }
      return;
    }

    if (info.kind === 'create') {
      if (!info.moved) createBlock(info.day, info.category, info.hour);
      return;
    }

    var block = data.getBlock(info.id);
    if (!block) return;
    var changed = block.startOffset !== info.startOffset ||
      block.endOffset !== info.endOffset ||
      block.day !== info.day ||
      block.category !== info.category;
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

  function bindMeta() {
    var state = data.getState();
    runSuffix.value = state.runSuffix;
    weekCommencing.value = state.weekCommencing;
    notes.value = state.notes;

    runSuffix.addEventListener('input', function () {
      data.setMeta({ runSuffix: runSuffix.value });
      data.persist();
    });
    weekCommencing.addEventListener('change', function () {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekCommencing.value)) {
        weekCommencing.value = data.getState().weekCommencing;
        return;
      }
      data.setMeta({ weekCommencing: weekCommencing.value });
      data.persist();
    });
    notes.addEventListener('input', function () {
      data.setMeta({ notes: notes.value });
      data.persist();
    });
  }

  function bindEditor() {
    data.COLOURS.forEach(function (colour) {
      var swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'sch-swatch';
      swatch.dataset.colour = colour;
      swatch.style.background = colour;
      swatch.setAttribute('aria-label', 'Colour ' + colour);
      swatch.setAttribute('aria-pressed', 'false');
      swatch.addEventListener('click', function () {
        if (!editingId) return;
        var updated = data.updateBlock(editingId, { backgroundColour: colour });
        paint(blockElement(editingId), updated);
        markSwatch(updated.backgroundColour);
      });
      editorSwatches.appendChild(swatch);
    });

    editorText.addEventListener('input', function () {
      if (filling || !editingId) return;
      var updated = data.updateBlock(editingId, { text: editorText.value });
      paint(blockElement(editingId), updated);
    });

    editorStart.addEventListener('change', function () {
      if (filling || !editingId) return;
      var block = data.getBlock(editingId);
      var start = Number(editorStart.value);
      var end = block.endOffset;
      if (end <= start) end = Math.min(start + 60, data.DAY_LENGTH);
      applyTimes(start, end);
    });

    editorEnd.addEventListener('change', function () {
      if (filling || !editingId) return;
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
    if (!modal.hidden) dismissEditor();
  });

  scroll.addEventListener('pointerdown', onPointerDown);
  buildGrid();
  renderBlocks();
  bindMeta();
  bindEditor();
})();
