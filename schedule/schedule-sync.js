/*
 * Pure comparison between the last acknowledged schedule and the copy on screen.
 * The browser uses this to send one booking, note, or week at a time.
 */
(function (root) {
  var BLOCK_FIELDS = [
    'weekCommencing', 'day', 'category', 'startTime', 'endTime',
    'customer', 'product', 'liquidCode', 'packingFormat', 'freeText', 'volume',
    'legacyText', 'backgroundColour', 'schedule', 'blockType', 'laneSpan'
  ];

  function same(a, b) {
    if (a == null && b == null) return true;
    if (typeof a === 'number' || typeof b === 'number') {
      if (a == null || b == null) return false;
      return Number(a) === Number(b);
    }
    return a === b;
  }

  function blockChanged(left, right) {
    for (var i = 0; i < BLOCK_FIELDS.length; i++) {
      if (!same(left[BLOCK_FIELDS[i]], right[BLOCK_FIELDS[i]])) return true;
    }
    return false;
  }

  function byId(list) {
    var map = {};
    (list || []).forEach(function (item) {
      if (item && item.id) map[item.id] = item;
    });
    return map;
  }

  function planChanges(acked, current, scope) {
    var ops = [];
    var wanted = scope || 'all';
    if (wanted === 'all' || wanted === 'block') ops = ops.concat(planBlocks(acked, current));
    if (wanted === 'all' || wanted === 'notes') ops = ops.concat(planNotes(acked, current));
    if (wanted === 'all' || wanted === 'week') ops = ops.concat(planWeeks(acked, current));
    return ops;
  }

  function planBlocks(acked, current) {
    var ops = [];
    var before = byId(acked && acked.blocks);
    var after = byId(current && current.blocks);
    Object.keys(after).forEach(function (id) {
      var next = after[id];
      var prev = before[id];
      if (!prev) {
        ops.push({ type: 'booking', action: 'upsert', expectedVersion: 0, booking: copyBlock(next) });
        return;
      }
      if (blockChanged(prev, next)) {
        ops.push({
          type: 'booking',
          action: 'upsert',
          expectedVersion: Number(prev.version) || 0,
          previousWeek: prev.weekCommencing,
          booking: copyBlock(next)
        });
      }
    });
    Object.keys(before).forEach(function (id) {
      if (after[id]) return;
      ops.push({
        type: 'booking',
        action: 'delete',
        id: id,
        expectedVersion: Number(before[id].version) || 0,
        previousWeek: before[id].weekCommencing
      });
    });
    return ops;
  }

  function planNotes(acked, current) {
    var ops = [];
    var before = (acked && acked.dayNotes) || {};
    var after = (current && current.dayNotes) || {};
    Object.keys(after).forEach(function (date) {
      var next = after[date];
      var prev = before[date];
      var empty = !next.important && !next.absence;
      if (!prev) {
        if (empty) return;
        ops.push({ type: 'note', action: 'upsert', expectedVersion: 0, note: copyNote(date, next) });
        return;
      }
      if (empty) {
        ops.push({
          type: 'note',
          action: 'delete',
          date: date,
          weekCommencing: prev.weekCommencing,
          expectedVersion: Number(prev.version) || 0
        });
        return;
      }
      if (next.important !== prev.important || next.absence !== prev.absence) {
        ops.push({
          type: 'note',
          action: 'upsert',
          expectedVersion: Number(prev.version) || 0,
          note: copyNote(date, next)
        });
      }
    });
    Object.keys(before).forEach(function (date) {
      if (after[date]) return;
      ops.push({
        type: 'note',
        action: 'delete',
        date: date,
        weekCommencing: before[date].weekCommencing,
        expectedVersion: Number(before[date].version) || 0
      });
    });
    return ops;
  }

  function planWeeks(acked, current) {
    var ops = [];
    var before = (acked && acked.weeks) || {};
    var after = (current && current.weeks) || {};
    var seen = {};
    Object.keys(before).forEach(function (week) { seen[week] = true; });
    Object.keys(after).forEach(function (week) { seen[week] = true; });
    Object.keys(seen).forEach(function (key) {
      var known = before[key] || after[key];
      var schedule = known && (known.schedule === 'blending' || known.schedule === 'appointments') ? known.schedule : 'production';
      if (!known || !known.schedule) {
        if (String(key).indexOf('appointments|') === 0) schedule = 'appointments';
        else if (String(key).indexOf('blending|') === 0) schedule = 'blending';
      }
      var week = known && known.weekCommencing;
      if (!week) week = String(key).indexOf('|') === -1 ? key : String(key).slice(String(key).indexOf('|') + 1);
      var prev = before[key] || { weekCommencing: week, schedule: schedule, nightShift: false, saturday: false, version: 0 };
      var next = after[key] || { weekCommencing: week, schedule: schedule, nightShift: false, saturday: false, version: prev.version || 0 };
      var version = Number(prev.version) || 0;
      if (!version && !next.nightShift && !next.saturday) return;
      if (version && prev.nightShift === !!next.nightShift && prev.saturday === !!next.saturday) return;
      if (!version && prev.nightShift === !!next.nightShift && prev.saturday === !!next.saturday) return;
      ops.push({
        type: 'week',
        action: 'upsert',
        expectedVersion: version,
        week: {
          weekCommencing: week,
          schedule: schedule,
          nightShift: !!next.nightShift,
          saturday: !!next.saturday
        }
      });
    });
    return ops;
  }

  function copyBlock(block) {
    var cip = block.blockType === 'cip' && block.schedule !== 'blending' && block.schedule !== 'appointments';
    return {
      id: block.id,
      weekCommencing: block.weekCommencing,
      day: block.day,
      category: block.category,
      startTime: block.startTime,
      endTime: block.endTime,
      customer: cip ? '' : (block.customer || ''),
      product: cip ? '' : (block.product || ''),
      liquidCode: cip ? '' : (block.liquidCode || ''),
      packingFormat: cip ? '' : (block.schedule === 'production' || !block.schedule ? (block.packingFormat || '') : ''),
      freeText: cip || block.schedule === 'production' || !block.schedule ? '' : (block.freeText || ''),
      volume: cip || block.schedule === 'appointments' || block.volume == null ? null : Number(block.volume),
      legacyText: cip || block.schedule === 'appointments' ? '' : (block.legacyText || ''),
      backgroundColour: block.backgroundColour,
      schedule: block.schedule === 'blending' || block.schedule === 'appointments' ? block.schedule : 'production',
      blockType: cip ? 'cip' : 'booking',
      laneSpan: cip ? Math.max(1, Math.round(Number(block.laneSpan) || 1)) : 1
    };
  }

  function copyNote(date, note) {
    return {
      date: date,
      weekCommencing: note.weekCommencing,
      important: note.important || '',
      absence: note.absence || ''
    };
  }

  var api = { planChanges: planChanges };
  root.ScheduleSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
