/*
 * Schedule data.
 * The database is the source of truth. This file keeps the working copy for
 * the screen, sends each change to the schedule functions, and keeps a local
 * recovery copy only when a change has not reached the server yet.
 *
 * Stored block shape:
 *   id, weekCommencing, day, category, startTime, endTime, schedule,
 *   customer, product, liquidCode, packingFormat, freeText, volume, backgroundColour, version
 * weekCommencing is the Monday of the production week, "YYYY-MM-DD".
 */
(function (root) {
  var STORAGE_KEY = 'scs_schedule_v1';
  var DAY_LENGTH = 24 * 60;
  var DAY_START = 5 * 60;
  var DEFAULT_COLOUR = '#ff0000';

  var DAYS = [
    { id: 'monday', label: 'Monday' },
    { id: 'tuesday', label: 'Tuesday' },
    { id: 'wednesday', label: 'Wednesday' },
    { id: 'thursday', label: 'Thursday' },
    { id: 'friday', label: 'Friday' },
    { id: 'saturday', label: 'Saturday' }
  ];

  var CATEGORIES = [
    { id: 'bottles', label: 'Bottles' },
    { id: 'keg', label: 'Keg' },
    { id: 'owk', label: 'OWK' },
    { id: 'bibs', label: 'Bibs & Pouches' },
    { id: 'bulk', label: 'Bulk' }
  ];

  var BLENDING_CATEGORIES = [
    { id: 'base_in', label: 'BASE IN' },
    { id: 'filtering', label: 'FILTERING 1' },
    { id: 'filtering_2', label: 'FILTERING 2' },
    { id: 'blending', label: 'BLENDING' },
    { id: 'bulk_out', label: 'BULK OUT' }
  ];

  var APPOINTMENT_CATEGORIES = [
    { id: 'scs', label: 'SCS' },
    { id: 'management', label: 'Management' },
    { id: 'qc_blending', label: 'QC / Blending' },
    { id: 'warehouse_logistics', label: 'Warehouse / Logistics' },
    { id: 'engineering', label: 'Engineering' }
  ];

  var STATUSES = [
    { colour: '#ff0000', label: 'PRODUCTION SPACE SCHEDULED BUT NOT CONFIRMED' },
    { colour: '#ff9900', label: 'PRODUCTION APPROVAL DOCUMENT SENT TO CUSTOMER' },
    { colour: '#fff2cc', label: 'ALL PRODUCTION PAPERWORK PRODUCED & PRINTED & STOCK DEDUCTED' },
    { colour: '#9fc5e8', label: 'BLENDING / RUN REPORT COMPLETE' },
    { colour: '#c27ba0', label: 'STOCK COUNT COMPLETE & PASSED TO OFFICE FOR INVOICING' },
    { colour: '#b7b7b7', label: 'INVOICED' },
    { colour: '#93c47d', label: 'INVOICE PAID / RELEASE' },
    { colour: '#ffff00', label: 'STOCK COLLECTED' },
    { colour: '#00ffff', label: 'ONBOARDING' },
    { colour: '#ff00ff', label: 'REPACKAGING REQUIRED' }
  ];

  var COLOURS = STATUSES.map(function (status) { return status.colour; });

  var dayIds = {};
  var categoryIds = {};
  var blendingIds = {};
  var appointmentIds = {};
  DAYS.forEach(function (day) { dayIds[day.id] = day; });
  CATEGORIES.forEach(function (category) { categoryIds[category.id] = category; });
  BLENDING_CATEGORIES.forEach(function (category) { blendingIds[category.id] = category; });
  APPOINTMENT_CATEGORIES.forEach(function (category) { appointmentIds[category.id] = category; });

  function storage() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return null;
      return localStorage;
    } catch (err) {
      return null;
    }
  }

  function pad(value) {
    return (value < 10 ? '0' : '') + value;
  }

  function newId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return root.crypto.randomUUID();
    }
    return 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function dateISO(from) {
    var date = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function mondayISO(from) {
    var date = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    var weekday = date.getDay();
    var shift = weekday === 0 ? -6 : 1 - weekday;
    date.setDate(date.getDate() + shift);
    return dateISO(date);
  }

  function parseISODate(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function canonicalWeek(value) {
    var date = parseISODate(value);
    return date ? mondayISO(date) : '';
  }

  function weekdayMonday(date) {
    var day = date.getDay();
    return day === 0 ? 7 : day;
  }

  // Excel / Google Sheets WEEKNUM(date, 2): weeks start on Monday, and the
  // week containing 1 January is week 1 of that date's calendar year.
  // Not ISO week numbering. A Monday in late December can still be week 53
  // of its own calendar year; production weeks below do not use that result
  // when the Monday–Sunday period contains 1 January of the next year.
  function weekNumber(date) {
    var jan1 = new Date(date.getFullYear(), 0, 1);
    var diff = Math.round((date - jan1) / 86400000);
    return Math.floor((diff + weekdayMonday(jan1) - 1) / 7) + 1;
  }

  function weekOneMonday(year) {
    return parseISODate(mondayISO(new Date(year, 0, 1)));
  }

  // Production year Y begins on the Monday of the week that contains
  // 1 January Y, even when that Monday is in December of Y - 1.
  // Weeks then run until the Monday before week 01 of Y + 1.
  function productionInfo(iso) {
    var monday = parseISODate(canonicalWeek(iso) || iso);
    if (!monday) return null;
    var calendarYear = monday.getFullYear();
    var startThis = weekOneMonday(calendarYear);
    var startNext = weekOneMonday(calendarYear + 1);
    var productionYear;
    var start;
    if (monday.getTime() >= startNext.getTime()) {
      productionYear = calendarYear + 1;
      start = startNext;
    } else if (monday.getTime() >= startThis.getTime()) {
      productionYear = calendarYear;
      start = startThis;
    } else {
      productionYear = calendarYear - 1;
      start = weekOneMonday(calendarYear - 1);
    }
    var diff = Math.round((monday.getTime() - start.getTime()) / 86400000);
    var week = Math.floor(diff / 7) + 1;
    return {
      year: productionYear,
      week: week,
      weekCommencing: mondayISO(monday),
      suffix: String(productionYear).slice(-1) + (week < 10 ? '0' : '') + week
    };
  }

  function productionWeeks(year) {
    var start = weekOneMonday(year);
    var next = weekOneMonday(year + 1);
    var count = Math.round((next.getTime() - start.getTime()) / 86400000 / 7);
    var weeks = [];
    for (var index = 0; index < count; index++) {
      var monday = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (index * 7));
      var info = productionInfo(mondayISO(monday));
      if (info) weeks.push(info);
    }
    return weeks;
  }

  function runSuffixFor(iso) {
    var info = productionInfo(iso);
    return info ? info.suffix : '';
  }

  function blankState() {
    var week = mondayISO(new Date());
    return {
      version: 1,
      runSuffix: runSuffixFor(week),
      weekCommencing: week,
      notes: '',
      dayNotes: {},
      nightShift: {},
      saturday: {},
      weekVersions: {},
      blendingNight: {},
      blendingSaturday: {},
      blendingWeekVersions: {},
      appointmentNight: {},
      appointmentSaturday: {},
      appointmentWeekVersions: {},
      loadedYear: null,
      blocks: []
    };
  }

  // 20:00 on the working day. The day opens at 05:00, and overtime still
  // begins after 20:00. It now closes at 05:00 the next morning.
  var NIGHT_AFTER = 15 * 60;
  var DAY_HOURS = NIGHT_AFTER / 60;

  function needsNight(endOffset) {
    return endOffset > NIGHT_AFTER;
  }

  function cleanNightShift(raw) {
    var saved = {};
    if (!raw || typeof raw !== 'object') return saved;
    Object.keys(raw).forEach(function (key) {
      var monday = canonicalWeek(key);
      if (monday && raw[key] === true) saved[monday] = true;
    });
    return saved;
  }

  var DAY_NOTE_MAX = 2000;

  function cleanDayNotes(raw) {
    var notes = {};
    if (!raw || typeof raw !== 'object') return notes;
    Object.keys(raw).forEach(function (key) {
      if (!parseISODate(key)) return;
      var item = raw[key];
      if (!item || typeof item !== 'object') return;
      var important = typeof item.important === 'string' ? item.important.slice(0, DAY_NOTE_MAX) : '';
      var absence = typeof item.absence === 'string' ? item.absence.slice(0, DAY_NOTE_MAX) : '';
      if (!important && !absence) return;
      notes[key] = { important: important, absence: absence };
    });
    return notes;
  }

  function copyDayNotes() {
    var copy = {};
    Object.keys(state.dayNotes).forEach(function (key) {
      copy[key] = {
        important: state.dayNotes[key].important,
        absence: state.dayNotes[key].absence,
        version: state.dayNotes[key].version || 0
      };
    });
    return copy;
  }

  function clockToOffset(time, isEnd) {
    var match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time || ''));
    if (!match) return null;
    var minutes = Number(match[1]) * 60 + Number(match[2]);
    if (minutes % 60 !== 0) return null;
    var offset = (minutes - DAY_START + DAY_LENGTH) % DAY_LENGTH;
    if (isEnd && offset === 0) offset = DAY_LENGTH;
    return offset;
  }

  function offsetToClock(offset) {
    var clock = (DAY_START + offset) % DAY_LENGTH;
    return pad(Math.floor(clock / 60)) + ':' + pad(clock % 60);
  }

  function minutesToLabel(offset) {
    return offsetToClock(offset);
  }

  function validOffsets(start, end) {
    return Number.isInteger(start) && Number.isInteger(end) &&
      start >= 0 && start <= DAY_LENGTH - 60 &&
      end >= 60 && end <= DAY_LENGTH &&
      start % 60 === 0 && end % 60 === 0 &&
      end - start >= 60;
  }

  function channel(pair) {
    var value = parseInt(pair, 16) / 255;
    if (value <= 0.04045) return value / 12.92;
    return Math.pow((value + 0.055) / 1.055, 2.4);
  }

  function textColour(hex) {
    var colour = String(hex || '').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(colour)) return '#111111';
    var luminance = 0.2126 * channel(colour.slice(0, 2)) +
      0.7152 * channel(colour.slice(2, 4)) +
      0.0722 * channel(colour.slice(4, 6));
    var onBlack = (luminance + 0.05) / 0.05;
    var onWhite = 1.05 / (luminance + 0.05);
    return onBlack >= onWhite ? '#111111' : '#ffffff';
  }

  function normaliseColour(value) {
    var colour = String(value || '').toLowerCase();
    return COLOURS.indexOf(colour) !== -1 ? colour : DEFAULT_COLOUR;
  }

  function statusLabel(colour) {
    var key = String(colour || '').toLowerCase();
    for (var i = 0; i < STATUSES.length; i++) {
      if (STATUSES[i].colour === key) return STATUSES[i].label;
    }
    return '';
  }

  function cleanLine(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max || 500) : '';
  }

  function storedVolume(value) {
    if (value == null || value === '') return null;
    var number = typeof value === 'number' ? value : Number(String(value).trim());
    if (!isFinite(number)) return null;
    return number;
  }

  function formatVolume(volume) {
    var value = Number(volume);
    if (!isFinite(value)) return '';
    return value.toLocaleString('en-GB', { maximumFractionDigits: 4, useGrouping: true }) + ' L';
  }

  function blockKind(value) {
    return value === 'cip' ? 'cip' : 'booking';
  }

  function cleanLaneSpan(category, span, blockType) {
    if (blockType !== 'cip') return 1;
    var index = -1;
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].id === category) index = i;
    }
    if (index < 0) return 1;
    var count = Math.round(Number(span));
    if (!isFinite(count) || count < 1) count = 1;
    if (index + count > CATEGORIES.length) count = CATEGORIES.length - index;
    return count;
  }

  function displayText(block) {
    if (block.blockType === 'cip') return 'CIP';
    if (block.schedule === 'appointments') return block.freeText || '';
    var detail = block.schedule === 'blending' ? '' : block.packingFormat;
    var structured = block.customer || block.product || block.liquidCode ||
      detail || block.volume != null;
    if (!structured) return block.legacyText || '';
    var lines = [block.customer, block.product, block.liquidCode, detail];
    if (block.volume != null) lines.push(formatVolume(block.volume));
    return lines.filter(function (line) { return String(line || '').trim(); }).join('\n');
  }

  function present(block) {
    return {
      id: block.id,
      weekCommencing: block.weekCommencing,
      day: block.day,
      category: block.category,
      startTime: block.startTime,
      endTime: block.endTime,
      startOffset: clockToOffset(block.startTime, false),
      endOffset: clockToOffset(block.endTime, true),
      customer: block.customer,
      product: block.product,
      liquidCode: block.liquidCode,
      packingFormat: block.packingFormat,
      freeText: block.freeText || '',
      volume: block.volume,
      legacyText: block.legacyText,
      schedule: scheduleKind(block.schedule),
      blockType: blockKind(block.blockType),
      laneSpan: cleanLaneSpan(block.category, block.laneSpan, block.blockType),
      text: displayText(block),
      backgroundColour: block.backgroundColour,
      version: block.version || 0
    };
  }

  function normaliseBlock(item, seen, fallbackWeek) {
    if (!item || typeof item !== 'object') return null;
    var schedule = scheduleKind(item.schedule);
    var allowed = categoriesFor(schedule);
    if (!dayIds[item.day] || !allowed[item.category]) return null;
    var start = clockToOffset(item.startTime, false);
    var end = clockToOffset(item.endTime, true);
    if (!validOffsets(start, end)) return null;
    var id = String(item.id || '');
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id) || seen[id]) id = newId();
    seen[id] = true;
    var blockType = item.blockType === 'cip' && schedule === 'production' ? 'cip' : 'booking';
    var cip = blockType === 'cip';
    var customer = schedule === 'appointments' || cip ? '' : (cleanLine(item.customer, 500) || cleanLine(item.companyName, 500));
    var product = schedule === 'appointments' || cip ? '' : (cleanLine(item.product, 500) || cleanLine(item.productName, 500));
    var liquidCode = schedule === 'appointments' || cip ? '' : cleanLine(item.liquidCode, 80);
    var packingFormat = schedule === 'production' && !cip ? cleanLine(item.packingFormat, 200) : '';
    var freeText = schedule === 'production' || cip ? '' : cleanLine(item.freeText, 2000);
    var volume = schedule === 'appointments' || cip ? null : storedVolume(item.volume);
    var structured = customer || product || liquidCode || packingFormat || freeText || volume != null;
    var legacyText = '';
    if (schedule !== 'appointments' && !structured) {
      if (typeof item.legacyText === 'string') legacyText = item.legacyText.slice(0, 2000);
      else if (typeof item.text === 'string') legacyText = item.text.slice(0, 2000);
    }
    return {
      id: id,
      weekCommencing: canonicalWeek(item.weekCommencing) || fallbackWeek || mondayISO(new Date()),
      day: item.day,
      category: item.category,
      startTime: offsetToClock(start),
      endTime: offsetToClock(end),
      customer: customer,
      product: product,
      liquidCode: liquidCode,
      packingFormat: packingFormat,
      freeText: freeText,
      volume: volume,
      legacyText: cip ? '' : legacyText,
      schedule: schedule,
      blockType: blockType,
      laneSpan: cleanLaneSpan(item.category, item.laneSpan, blockType),
      backgroundColour: normaliseColour(item.backgroundColour),
      version: Number(item.version) || 0
    };
  }

  function load() {
    return blankState();
  }

  var state = load();

  function persist(scope) {
    queueSync(scope || 'block');
  }

  function getState() {
    return {
      version: state.version,
      runSuffix: runSuffixFor(state.weekCommencing),
      weekCommencing: state.weekCommencing,
      notes: state.notes,
      dayNotes: copyDayNotes(),
      nightShift: Object.assign({}, state.nightShift),
      saturday: Object.assign({}, state.saturday),
      blocks: state.blocks.map(present)
    };
  }

  function getBlock(id) {
    for (var i = 0; i < state.blocks.length; i++) {
      if (state.blocks[i].id === id) return present(state.blocks[i]);
    }
    return null;
  }

  function setMeta(patch) {
    if (!patch) return getState();
    if (patch.notes !== undefined) state.notes = String(patch.notes).slice(0, 4000);
    if (patch.weekCommencing !== undefined) {
      var monday = canonicalWeek(patch.weekCommencing);
      if (monday) {
        state.weekCommencing = monday;
        state.runSuffix = runSuffixFor(monday);
      }
    }
    return getState();
  }

  function scheduleKind(value) {
    if (value === 'blending' || value === 'appointments') return value;
    return 'production';
  }

  function categoriesFor(schedule) {
    if (schedule === 'blending') return blendingIds;
    if (schedule === 'appointments') return appointmentIds;
    return categoryIds;
  }

  function weekBag(schedule) {
    var kind = scheduleKind(schedule);
    if (kind === 'blending') {
      return {
        night: state.blendingNight,
        saturday: state.blendingSaturday,
        versions: state.blendingWeekVersions
      };
    }
    if (kind === 'appointments') {
      return {
        night: state.appointmentNight,
        saturday: state.appointmentSaturday,
        versions: state.appointmentWeekVersions
      };
    }
    return {
      night: state.nightShift,
      saturday: state.saturday,
      versions: state.weekVersions
    };
  }

  function weekSnapKey(schedule, week) {
    var kind = scheduleKind(schedule);
    if (kind === 'production') return week;
    return kind + '|' + week;
  }

  function isNightManual(week, schedule) {
    var monday = canonicalWeek(week);
    return !!(monday && weekBag(schedule).night[monday]);
  }

  function setNightManual(week, on, schedule) {
    var monday = canonicalWeek(week);
    if (!monday) return false;
    var bag = weekBag(schedule);
    if (on) bag.night[monday] = true;
    else delete bag.night[monday];
    return true;
  }

  function isSaturdayRunning(week, schedule) {
    var monday = canonicalWeek(week);
    return !!(monday && weekBag(schedule).saturday[monday]);
  }

  function setSaturdayRunning(week, on, schedule) {
    var monday = canonicalWeek(week);
    if (!monday) return false;
    var bag = weekBag(schedule);
    if (on) bag.saturday[monday] = true;
    else delete bag.saturday[monday];
    return true;
  }

  function setDayNote(date, field, value) {
    if (!parseISODate(date) || (field !== 'important' && field !== 'absence')) return null;
    var text = String(value == null ? '' : value).slice(0, DAY_NOTE_MAX);
    var current = state.dayNotes[date] || { important: '', absence: '', version: 0 };
    var next = {
      important: field === 'important' ? text : current.important,
      absence: field === 'absence' ? text : current.absence,
      version: current.version || 0
    };
    if (!next.important && !next.absence) delete state.dayNotes[date];
    else state.dayNotes[date] = next;
    return { date: date, important: next.important, absence: next.absence };
  }

  function addBlock(input) {
    input = input || {};
    var schedule = scheduleKind(input.schedule);
    var allowed = categoriesFor(schedule);
    if (!dayIds[input.day] || !allowed[input.category]) return null;
    if (!validOffsets(input.startOffset, input.endOffset)) return null;
    var blockType = input.blockType === 'cip' && schedule === 'production' ? 'cip' : 'booking';
    var cip = blockType === 'cip';
    var block = {
      id: newId(),
      weekCommencing: canonicalWeek(input.weekCommencing) || state.weekCommencing,
      day: input.day,
      category: input.category,
      startTime: offsetToClock(input.startOffset),
      endTime: offsetToClock(input.endOffset),
      customer: schedule === 'appointments' || cip ? '' : cleanLine(input.customer, 500),
      product: schedule === 'appointments' || cip ? '' : cleanLine(input.product, 500),
      liquidCode: schedule === 'appointments' || cip ? '' : cleanLine(input.liquidCode, 80),
      packingFormat: schedule === 'production' && !cip ? cleanLine(input.packingFormat, 200) : '',
      freeText: schedule === 'production' || cip ? '' : cleanLine(input.freeText, 2000),
      volume: schedule === 'appointments' || cip ? null : storedVolume(input.volume),
      legacyText: '',
      backgroundColour: normaliseColour(input.backgroundColour),
      schedule: schedule,
      blockType: blockType,
      laneSpan: cleanLaneSpan(input.category, cip ? input.laneSpan : 1, blockType),
      version: 0
    };
    state.blocks.push(block);
    return present(block);
  }

  function updateBlock(id, patch) {
    var block = null;
    for (var i = 0; i < state.blocks.length; i++) {
      if (state.blocks[i].id === id) block = state.blocks[i];
    }
    if (!block || !patch) return null;
    if (patch.customer !== undefined) block.customer = cleanLine(patch.customer, 500);
    if (patch.product !== undefined) block.product = cleanLine(patch.product, 500);
    if (patch.liquidCode !== undefined) block.liquidCode = cleanLine(patch.liquidCode, 80);
    if (patch.packingFormat !== undefined && block.schedule === 'production') block.packingFormat = cleanLine(patch.packingFormat, 200);
    if (patch.freeText !== undefined && block.schedule !== 'production') block.freeText = cleanLine(patch.freeText, 2000);
    if (patch.volume !== undefined && block.schedule !== 'appointments') block.volume = storedVolume(patch.volume);
    if (block.schedule === 'appointments' || block.blockType === 'cip') {
      block.customer = '';
      block.product = '';
      block.liquidCode = '';
      block.packingFormat = '';
      block.freeText = '';
      block.volume = null;
      block.legacyText = '';
    }
    if (patch.legacyText !== undefined && block.schedule !== 'appointments') block.legacyText = String(patch.legacyText).slice(0, 2000);
    if (patch.backgroundColour !== undefined) block.backgroundColour = normaliseColour(patch.backgroundColour);
    if (patch.day !== undefined && dayIds[patch.day]) block.day = patch.day;
    var allowedCategory = categoriesFor(block.schedule);
    if (patch.category !== undefined && allowedCategory[patch.category]) block.category = patch.category;
    if (patch.laneSpan !== undefined || patch.category !== undefined) {
      block.laneSpan = cleanLaneSpan(
        block.category,
        patch.laneSpan !== undefined ? patch.laneSpan : block.laneSpan,
        block.blockType
      );
    }
    if (patch.weekCommencing !== undefined) {
      var monday = canonicalWeek(patch.weekCommencing);
      if (monday) block.weekCommencing = monday;
    }
    if (patch.startOffset !== undefined || patch.endOffset !== undefined) {
      var current = present(block);
      var start = patch.startOffset !== undefined ? patch.startOffset : current.startOffset;
      var end = patch.endOffset !== undefined ? patch.endOffset : current.endOffset;
      if (!validOffsets(start, end)) return present(block);
      block.startTime = offsetToClock(start);
      block.endTime = offsetToClock(end);
    }
    return present(block);
  }

  function removeBlock(id) {
    var next = state.blocks.filter(function (block) { return block.id !== id; });
    var removed = next.length !== state.blocks.length;
    state.blocks = next;
    return removed;
  }

  var CACHE_KEY = 'scs_schedule_cache_v1';
  var acked = null;
  var lastPayload = null;
  var backupStatus = { configured: false, pending: 0, failed: 0, lastFullAt: null };
  var statusCode = 'loading';
  var statusDetail = '';
  var statusHandler = null;
  var conflictHandler = null;
  var appliedHandler = null;
  var conflicts = [];
  var conflictOpen = false;
  var noteTimer = null;
  var flights = { block: null, notes: null, week: null };

  function queueSync(scope) {
    if (scope === 'notes') {
      if (noteTimer) clearTimeout(noteTimer);
      noteTimer = setTimeout(function () {
        noteTimer = null;
        flush('notes');
      }, 700);
      return;
    }
    flush(scope === 'week' ? 'week' : 'block');
  }

  function snapshot() {
    var blocks = state.blocks.map(function (block) {
      return {
        id: block.id,
        weekCommencing: block.weekCommencing,
        day: block.day,
        category: block.category,
        startTime: block.startTime,
        endTime: block.endTime,
        customer: block.customer,
        product: block.product,
        liquidCode: block.liquidCode,
        packingFormat: block.packingFormat,
        freeText: block.freeText || '',
        volume: block.volume,
        legacyText: block.legacyText,
        backgroundColour: block.backgroundColour,
        schedule: scheduleKind(block.schedule),
        blockType: blockKind(block.blockType),
        laneSpan: cleanLaneSpan(block.category, block.laneSpan, block.blockType),
        version: block.version || 0
      };
    });
    var dayNotes = {};
    Object.keys(state.dayNotes).forEach(function (date) {
      var note = state.dayNotes[date];
      var parsed = parseISODate(date);
      dayNotes[date] = {
        weekCommencing: parsed ? mondayISO(parsed) : '',
        important: note.important || '',
        absence: note.absence || '',
        version: note.version || 0
      };
    });
    var weeks = {};
    function collectWeeks(schedule) {
      var bag = weekBag(schedule);
      var seen = {};
      Object.keys(bag.night).forEach(function (week) { seen[week] = true; });
      Object.keys(bag.saturday).forEach(function (week) { seen[week] = true; });
      Object.keys(bag.versions).forEach(function (week) { seen[week] = true; });
      Object.keys(seen).forEach(function (week) {
        weeks[weekSnapKey(schedule, week)] = {
          weekCommencing: week,
          schedule: scheduleKind(schedule),
          nightShift: !!bag.night[week],
          saturday: !!bag.saturday[week],
          version: bag.versions[week] || 0
        };
      });
    }
    collectWeeks('production');
    collectWeeks('blending');
    collectWeeks('appointments');
    return { blocks: blocks, dayNotes: dayNotes, weeks: weeks };
  }

  function isDirty() {
    if (!root.ScheduleSync || !acked) return false;
    return root.ScheduleSync.planChanges(acked, snapshot(), 'all').length > 0;
  }

  function statusMessage() {
    if (statusCode === 'loading') return 'Loading schedule…';
    if (statusCode === 'saving') return 'Saving…';
    if (statusCode === 'unsaved') return 'Not saved on this computer. These changes will be sent when the connection returns.';
    if (statusCode === 'save-failed') return statusDetail || 'Couldn\u2019t save these changes. They are still on this computer.';
    if (statusCode === 'offline-changes') return 'Couldn\u2019t reach the schedule store. Changes on this computer have not been saved yet.';
    if (statusCode === 'offline') return 'Couldn\u2019t reach the schedule store. Showing the last copy saved on this computer.';
    if (statusCode === 'error') return 'Couldn\u2019t load the schedule.';
    if (statusCode === 'conflict') return 'A change needs a decision before it can be saved.';
    if (!backupStatus.configured) return 'Saved. Google Sheets backup is not set up yet.';
    if (backupStatus.failed) return 'Saved. Google Sheets backup failed and will retry.';
    if (backupStatus.pending) return 'Saved. Google Sheets backup is waiting.';
    return 'Saved';
  }

  function statusTone() {
    if (statusCode === 'error' || statusCode === 'unsaved' || statusCode === 'save-failed' || statusCode === 'offline' || statusCode === 'offline-changes') return 'error';
    if (statusCode === 'conflict' || statusCode === 'saved-fail' || (statusCode === 'saved' && backupStatus.failed)) return 'problem';
    if (statusCode === 'saved' && !backupStatus.configured) return 'problem';
    return '';
  }

  function browserOffline() {
    return root.navigator && root.navigator.onLine === false;
  }

  function pendingStatus() {
    return browserOffline() ? 'unsaved' : 'save-failed';
  }

  function setStatus(code, detail) {
    if ((code === 'unsaved' || code === 'save-failed') && !isDirty()) code = 'saved';
    if (code === 'offline-changes' && !isDirty()) code = 'offline';
    statusCode = code;
    statusDetail = code === 'save-failed' ? (detail || '') : '';
    if (statusHandler) statusHandler({ code: code, message: statusMessage(), tone: statusTone(), backup: backupStatus });
  }

  function emitStatus() {
    if (statusHandler) statusHandler({ code: statusCode, message: statusMessage(), tone: statusTone(), backup: backupStatus });
  }

  function readCache() {
    var store = storage();
    if (!store) return {};
    try { return JSON.parse(store.getItem(CACHE_KEY)) || {}; } catch (err) { return {}; }
  }

  function writeCache(year) {
    if (!year) return;
    var store = storage();
    if (!store) return;
    var all = readCache();
    all[String(year)] = {
      server: lastPayload,
      acked: acked,
      local: isDirty() ? snapshot() : null
    };
    try { store.setItem(CACHE_KEY, JSON.stringify(all)); } catch (err) { /* the screen copy remains */ }
  }

  function applyPayload(payload, asAck) {
    state.blocks = [];
    state.dayNotes = {};
    state.nightShift = {};
    state.saturday = {};
    state.weekVersions = {};
    state.blendingNight = {};
    state.blendingSaturday = {};
    state.blendingWeekVersions = {};
    state.appointmentNight = {};
    state.appointmentSaturday = {};
    state.appointmentWeekVersions = {};
    state.loadedYear = payload.year;
    var seen = {};
    (payload.bookings || []).forEach(function (booking) {
      var block = normaliseBlock(booking, seen, booking.weekCommencing);
      if (!block) return;
      block.version = Number(booking.version) || 0;
      state.blocks.push(block);
    });
    (payload.dayNotes || []).forEach(function (note) {
      if (!note || !parseISODate(note.date)) return;
      if (!note.important && !note.absence) return;
      state.dayNotes[note.date] = {
        important: note.important || '',
        absence: note.absence || '',
        version: Number(note.version) || 0
      };
    });
    (payload.weeks || []).forEach(function (week) {
      if (!week || !week.weekCommencing) return;
      var bag = weekBag(week.schedule);
      if (week.nightShift) bag.night[week.weekCommencing] = true;
      if (week.saturday) bag.saturday[week.weekCommencing] = true;
      bag.versions[week.weekCommencing] = Number(week.version) || 0;
    });
    if (payload.backup) backupStatus = payload.backup;
    lastPayload = payload;
    if (asAck) acked = snapshot();
  }

  function applyPendingOps(ops) {
    ops.forEach(function (op) {
      if (op.type === 'booking' && op.action === 'delete') {
        state.blocks = state.blocks.filter(function (block) { return block.id !== op.id; });
        return;
      }
      if (op.type === 'booking' && op.booking) {
        state.blocks = state.blocks.filter(function (block) { return block.id !== op.booking.id; });
        var block = normaliseBlock(op.booking, {}, op.booking.weekCommencing);
        if (block) state.blocks.push(block);
        return;
      }
      if (op.type === 'note' && op.action === 'delete') {
        delete state.dayNotes[op.date];
        return;
      }
      if (op.type === 'note' && op.note) {
        state.dayNotes[op.note.date] = {
          important: op.note.important || '',
          absence: op.note.absence || '',
          version: 0
        };
        return;
      }
      if (op.type === 'week' && op.week) {
        var week = op.week.weekCommencing;
        var bag = weekBag(op.week.schedule);
        if (op.week.nightShift) bag.night[week] = true;
        else delete bag.night[week];
        if (op.week.saturday) bag.saturday[week] = true;
        else delete bag.saturday[week];
      }
    });
  }

  function restoreLocal(snap) {
    state.blocks = (snap.blocks || []).map(function (block) { return Object.assign({}, block); });
    state.dayNotes = {};
    Object.keys(snap.dayNotes || {}).forEach(function (date) {
      state.dayNotes[date] = {
        important: snap.dayNotes[date].important || '',
        absence: snap.dayNotes[date].absence || '',
        version: snap.dayNotes[date].version || 0
      };
    });
    state.nightShift = {};
    state.saturday = {};
    state.weekVersions = {};
    state.blendingNight = {};
    state.blendingSaturday = {};
    state.blendingWeekVersions = {};
    state.appointmentNight = {};
    state.appointmentSaturday = {};
    state.appointmentWeekVersions = {};
    Object.keys(snap.weeks || {}).forEach(function (key) {
      var item = snap.weeks[key] || {};
      var schedule = scheduleKind(item.schedule);
      if (item.schedule == null && String(key).indexOf('|') !== -1) schedule = scheduleKind(String(key).split('|')[0]);
      var week = item.weekCommencing || (String(key).indexOf('|') === -1 ? key : String(key).split('|')[1]);
      var bag = weekBag(schedule);
      if (item.nightShift) bag.night[week] = true;
      if (item.saturday) bag.saturday[week] = true;
      if (item.version) bag.versions[week] = item.version;
    });
  }

  function peekYear(year) {
    var cached = readCache()[String(year)];
    if (!cached || !cached.server) return false;
    applyPayload(cached.server, true);
    if (cached.local) {
      restoreLocal(cached.local);
      acked = cached.acked || acked;
      setStatus(isDirty() ? pendingStatus() : 'saved');
    }
    return true;
  }

  function authError() {
    var error = new Error('auth');
    error.auth = true;
    return error;
  }

  function sessionExpired() {
    setStatus('auth');
    if (root.SCSAuth && root.SCSAuth.clearSession) root.SCSAuth.clearSession();
    if (root.location) root.location.href = '/';
  }

  function postOps(ops) {
    var chunks = [];
    var index;
    for (index = 0; index < ops.length; index += 20) chunks.push(ops.slice(index, index + 20));
    var all = [];
    var chain = Promise.resolve();
    chunks.forEach(function (chunk) {
      chain = chain.then(function () {
        return fetch('/.netlify/functions/schedule-mutate', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ops: chunk })
        }).then(function (response) {
          if (response.status === 401) {
            sessionExpired();
            throw authError();
          }
          if (!response.ok) throw new Error('save');
          return response.json();
        }).then(function (body) {
          if (body && body.backup) backupStatus = body.backup;
          all = all.concat((body && body.results) || []);
        });
      });
    });
    return chain.then(function () { return all; });
  }

  function flush(scope) {
    if (!root.ScheduleSync || !acked) return Promise.resolve();
    if (flights[scope]) {
      flights[scope].again = true;
      return flights[scope].promise;
    }
    var ops = root.ScheduleSync.planChanges(acked, snapshot(), scope);
    if (!ops.length) {
      if (!conflicts.length && !isDirty()) setStatus(backupStatus.failed ? 'saved' : 'saved');
      return Promise.resolve();
    }
    setStatus('saving');
    var job = { again: false, promise: null };
    job.promise = postOps(ops).then(function (results) {
      handleResults(results, ops);
    }).catch(function (err) {
      if (err && err.auth) return;
      setStatus(pendingStatus());
      writeCache(state.loadedYear);
    }).then(function () {
      flights[scope] = null;
      if (job.again) return flush(scope);
      return null;
    });
    flights[scope] = job;
    return job.promise;
  }

  function flushAll() {
    if (noteTimer) {
      clearTimeout(noteTimer);
      noteTimer = null;
    }
    return flush('block').then(function () {
      return flush('notes');
    }).then(function () {
      return flush('week');
    });
  }

  function handleResults(results) {
    var found = [];
    var problem = '';
    (results || []).forEach(function (result) {
      if (result && result.ok) acknowledge(result);
      else if (result && result.conflict) found.push(result);
      else if (result && result.error) problem = result.error;
    });
    if (found.length) {
      found.forEach(function (item) { conflicts.push(item); });
      setStatus('conflict');
      openConflict();
      writeCache(state.loadedYear);
      return;
    }
    if (isDirty()) setStatus(pendingStatus(), problem);
    else {
      setStatus('saved');
      writeCache(state.loadedYear);
    }
  }

  function sameBooking(left, right) {
    if (!left || !right) return false;
    return left.weekCommencing === right.weekCommencing && left.day === right.day &&
      left.category === right.category && left.startTime === right.startTime &&
      left.endTime === right.endTime && left.customer === right.customer &&
      left.product === right.product && left.liquidCode === right.liquidCode &&
      left.packingFormat === right.packingFormat && left.freeText === right.freeText &&
      left.schedule === right.schedule && left.volume === right.volume &&
      left.legacyText === right.legacyText && left.backgroundColour === right.backgroundColour &&
      blockKind(left.blockType) === blockKind(right.blockType) &&
      cleanLaneSpan(left.category, left.laneSpan, left.blockType) === cleanLaneSpan(right.category, right.laneSpan, right.blockType);
  }

  function acknowledge(result) {
    if (result.type === 'booking' && result.action === 'delete') {
      acked.blocks = acked.blocks.filter(function (block) { return block.id !== result.id; });
      return;
    }
    if (result.type === 'booking' && result.record) {
      var saved = result.record;
      var previous = null;
      acked.blocks.forEach(function (block) { if (block.id === saved.id) previous = block; });
      acked.blocks = acked.blocks.filter(function (block) { return block.id !== saved.id; });
      acked.blocks.push(Object.assign({}, saved, { version: result.version }));
      var existing = null;
      state.blocks.forEach(function (block) { if (block.id === saved.id) existing = block; });
      if (!existing || sameBooking(existing, previous)) {
        state.blocks = state.blocks.filter(function (block) { return block.id !== saved.id; });
        var block = normaliseBlock(saved, {}, saved.weekCommencing);
        if (block) {
          block.version = result.version;
          state.blocks.push(block);
        }
      } else if (sameBooking(existing, saved)) {
        existing.version = result.version;
      }
      return;
    }
    if (result.type === 'note' && result.action === 'delete') {
      delete acked.dayNotes[result.date];
      return;
    }
    if (result.type === 'note' && result.record) {
      var note = result.record;
      var previousNote = acked.dayNotes[note.date];
      acked.dayNotes[note.date] = {
        weekCommencing: note.weekCommencing,
        important: note.important,
        absence: note.absence,
        version: result.version
      };
      var live = state.dayNotes[note.date];
      var previousSame = previousNote && live && live.important === previousNote.important && live.absence === previousNote.absence;
      if (!live || previousSame) {
        state.dayNotes[note.date] = {
          important: note.important,
          absence: note.absence,
          version: result.version
        };
      } else if (live.important === note.important && live.absence === note.absence) {
        live.version = result.version;
      }
      return;
    }
    if (result.type === 'week' && result.record) {
      var week = result.record;
      var weekKey = weekSnapKey(week.schedule, week.weekCommencing);
      var bag = weekBag(week.schedule);
      var previousWeek = acked.weeks[weekKey];
      acked.weeks[weekKey] = {
        weekCommencing: week.weekCommencing,
        schedule: scheduleKind(week.schedule),
        nightShift: !!week.nightShift,
        saturday: !!week.saturday,
        version: result.version
      };
      var liveNight = !!bag.night[week.weekCommencing];
      var liveSaturday = !!bag.saturday[week.weekCommencing];
      var previousNight = previousWeek ? !!previousWeek.nightShift : false;
      var previousSaturday = previousWeek ? !!previousWeek.saturday : false;
      if (liveNight === previousNight && liveSaturday === previousSaturday) {
        if (week.nightShift) bag.night[week.weekCommencing] = true;
        else delete bag.night[week.weekCommencing];
        if (week.saturday) bag.saturday[week.weekCommencing] = true;
        else delete bag.saturday[week.weekCommencing];
        bag.versions[week.weekCommencing] = result.version;
      } else if (liveNight === !!week.nightShift && liveSaturday === !!week.saturday) {
        bag.versions[week.weekCommencing] = result.version;
      }
    }
  }

  function openConflict() {
    if (conflictOpen || !conflicts.length || !conflictHandler) return;
    conflictOpen = true;
    var item = conflicts[0];
    conflictHandler(describeConflict(item), function (choice) {
      conflicts.shift();
      conflictOpen = false;
      if (choice === 'theirs') applyTheirs(item);
      else keepMine(item);
      if (appliedHandler) appliedHandler();
      if (conflicts.length) openConflict();
      else if (choice === 'mine' || isDirty()) flush(item.type === 'note' ? 'notes' : (item.type === 'week' ? 'week' : 'block'));
      else setStatus('saved');
    });
  }

  function describeConflict(item) {
    if (item.type === 'note') return 'Someone else changed this day\u2019s Important note or absence line. Your text is still on screen, but it has not replaced theirs.';
    if (item.type === 'week') return 'Someone else changed the night shift or Saturday setting for this week. Your switch has not replaced theirs.';
    if (!item.server) return 'Someone else removed this booking. It is still on your screen, but it is no longer on the shared schedule.';
    return 'Someone else changed this booking. Your version is still on screen, but it has not replaced theirs.';
  }

  function applyTheirs(item) {
    if (item.type === 'booking') {
      state.blocks = state.blocks.filter(function (block) { return block.id !== (item.server ? item.server.id : item.id); });
      acked.blocks = acked.blocks.filter(function (block) { return block.id !== (item.server ? item.server.id : item.id); });
      if (item.server) {
        var seen = {};
        var block = normaliseBlock(item.server, seen, item.server.weekCommencing);
        if (block) {
          block.version = item.server.version || 0;
          state.blocks.push(block);
          acked.blocks.push(Object.assign({}, block));
        }
      }
      return;
    }
    if (item.type === 'note') {
      var date = item.date || (item.server && item.server.date);
      delete state.dayNotes[date];
      delete acked.dayNotes[date];
      if (item.server && (item.server.important || item.server.absence)) {
        state.dayNotes[date] = {
          important: item.server.important || '',
          absence: item.server.absence || '',
          version: item.server.version || 0
        };
        acked.dayNotes[date] = {
          weekCommencing: item.server.weekCommencing,
          important: item.server.important || '',
          absence: item.server.absence || '',
          version: item.server.version || 0
        };
      }
      return;
    }
    if (item.type === 'week' && item.server) {
      var week = item.server.weekCommencing;
      var bag = weekBag(item.server.schedule);
      var weekKey = weekSnapKey(item.server.schedule, week);
      if (item.server.nightShift) bag.night[week] = true;
      else delete bag.night[week];
      if (item.server.saturday) bag.saturday[week] = true;
      else delete bag.saturday[week];
      bag.versions[week] = item.server.version || 0;
      acked.weeks[weekKey] = {
        weekCommencing: week,
        schedule: scheduleKind(item.server.schedule),
        nightShift: !!item.server.nightShift,
        saturday: !!item.server.saturday,
        version: item.server.version || 0
      };
    }
  }

  function keepMine(item) {
    if (item.type === 'booking') {
      var id = item.server ? item.server.id : item.id;
      var found = false;
      acked.blocks.forEach(function (block) {
        if (block.id !== id) return;
        found = true;
        block.version = item.server ? item.server.version : 0;
      });
      if (!found && item.server) acked.blocks.push(Object.assign({}, item.server));
      if (!item.server) acked.blocks = acked.blocks.filter(function (block) { return block.id !== id; });
      return;
    }
    if (item.type === 'note') {
      var date = item.date || (item.server && item.server.date);
      if (!acked.dayNotes[date] && item.server) {
        acked.dayNotes[date] = {
          weekCommencing: item.server.weekCommencing,
          important: '',
          absence: '',
          version: item.server.version || 0
        };
      }
      if (acked.dayNotes[date]) acked.dayNotes[date].version = item.server ? item.server.version : 0;
      if (!item.server) delete acked.dayNotes[date];
      return;
    }
    if (item.type === 'week') {
      var record = item.server || { weekCommencing: item.weekCommencing, schedule: item.schedule };
      var weekKey = weekSnapKey(record.schedule, record.weekCommencing);
      if (!acked.weeks[weekKey]) {
        acked.weeks[weekKey] = {
          weekCommencing: record.weekCommencing,
          schedule: scheduleKind(record.schedule),
          nightShift: false,
          saturday: false,
          version: 0
        };
      }
      acked.weeks[weekKey].version = item.server ? item.server.version : 0;
    }
  }

  function loadYear(year) {
    setStatus('loading');
    var previous = state.loadedYear;
    var prepare = Promise.resolve();
    if (previous && Number(previous) !== Number(year)) {
      prepare = flushAll().then(function () {
        writeCache(previous);
      }).catch(function () {
        writeCache(previous);
      });
    }
    return prepare.then(function () {
      return fetch('/.netlify/functions/schedule-year?year=' + encodeURIComponent(year), {
        credentials: 'same-origin',
        cache: 'no-store'
      });
    }).then(function (response) {
      if (response.status === 401) {
        sessionExpired();
        throw authError();
      }
      if (!response.ok) throw new Error('load');
      return response.json();
    }).then(function (payload) {
      var cached = readCache()[String(year)];
      applyPayload(payload, true);
      var replay = cached && cached.local && cached.acked && root.ScheduleSync
        ? root.ScheduleSync.planChanges(cached.acked, cached.local, 'all')
        : [];
      if (!replay.length) {
        setStatus('saved');
        writeCache(year);
        return payload;
      }
      applyPendingOps(replay);
      setStatus('saving');
      return postOps(replay).then(function (results) {
        handleResults(results);
        return payload;
      }).catch(function (err) {
        if (err && err.auth) throw err;
        setStatus(pendingStatus());
        writeCache(year);
        return payload;
      });
    }).catch(function (err) {
      if (err && err.auth) throw err;
      var cached = readCache()[String(year)];
      if (cached && cached.server) {
        applyPayload(cached.server, true);
        if (cached.local) {
          restoreLocal(cached.local);
          acked = cached.acked || acked;
        }
        setStatus(cached.local && isDirty() ? 'offline-changes' : 'offline');
        emitStatus();
        return cached.server;
      }
      state.loadedYear = Number(year);
      lastPayload = {
        year: Number(year),
        bookings: [],
        dayNotes: [],
        weeks: [],
        backup: backupStatus
      };
      setStatus('error');
      throw err;
    });
  }

  if (root.addEventListener) {
    root.addEventListener('online', function () { flushAll(); });
    root.addEventListener('beforeunload', function () {
      if (state.loadedYear && isDirty()) writeCache(state.loadedYear);
    });
  }

  acked = snapshot();

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    DAY_LENGTH: DAY_LENGTH,
    DAY_HOURS: DAY_HOURS,
    NIGHT_AFTER: NIGHT_AFTER,
    needsNight: needsNight,
    cleanLaneSpan: cleanLaneSpan,
    DEFAULT_COLOUR: DEFAULT_COLOUR,
    DAYS: DAYS,
    CATEGORIES: CATEGORIES,
    BLENDING_CATEGORIES: BLENDING_CATEGORIES,
    APPOINTMENT_CATEGORIES: APPOINTMENT_CATEGORIES,
    STATUSES: STATUSES.map(function (status) {
      return { colour: status.colour, label: status.label };
    }),
    COLOURS: COLOURS.slice(),
    dateISO: dateISO,
    mondayISO: mondayISO,
    parseISODate: parseISODate,
    weekNumber: weekNumber,
    productionInfo: productionInfo,
    productionWeeks: productionWeeks,
    runSuffixFor: runSuffixFor,
    statusLabel: statusLabel,
    minutesToLabel: minutesToLabel,
    formatVolume: formatVolume,
    textColour: textColour,
    clockToOffset: clockToOffset,
    offsetToClock: offsetToClock,
    getState: getState,
    getBlock: getBlock,
    setMeta: setMeta,
    setDayNote: setDayNote,
    isNightManual: isNightManual,
    setNightManual: setNightManual,
    isSaturdayRunning: isSaturdayRunning,
    setSaturdayRunning: setSaturdayRunning,
    addBlock: addBlock,
    updateBlock: updateBlock,
    removeBlock: removeBlock,
    persist: persist,
    loadYear: loadYear,
    peekYear: peekYear,
    loadedYear: function () { return state.loadedYear; },
    onStatus: function (handler) { statusHandler = handler; emitStatus(); },
    onConflict: function (handler) { conflictHandler = handler; },
    onApplied: function (handler) { appliedHandler = handler; }
  };

  root.ScheduleData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
