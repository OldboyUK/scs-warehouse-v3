/*
 * Schedule data for Phase 1.
 * Blocks live in memory and localStorage only. No network calls.
 *
 * Stored block shape (ready for a later database):
 *   id, weekCommencing, day, category, startTime, endTime,
 *   customer, product, liquidCode, packingFormat, volume, backgroundColour
 * weekCommencing is the Monday of the production week, "YYYY-MM-DD".
 * Older free-text blocks keep legacyText so they can still be shown.
 * Blocks saved before weeks were stored are kept and assigned to the
 * selected week the first time they are loaded.
 *
 * startTime and endTime are whole-hour clock times, "HH:MM".
 * The production day runs 06:00 to 06:00 the next morning, so an
 * endTime of "06:00" is the following morning, not the start of the day.
 */
(function (root) {
  var STORAGE_KEY = 'scs_schedule_v1';
  var DAY_LENGTH = 24 * 60;
  var DAY_START = 6 * 60;
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
  DAYS.forEach(function (day) { dayIds[day.id] = day; });
  CATEGORIES.forEach(function (category) { categoryIds[category.id] = category; });

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

  function mondayISO(from) {
    var date = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    var weekday = date.getDay();
    var shift = weekday === 0 ? -6 : 1 - weekday;
    date.setDate(date.getDate() + shift);
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
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
  // week containing 1 January is week 1. Not ISO week numbering.
  function weekNumber(date) {
    var jan1 = new Date(date.getFullYear(), 0, 1);
    var diff = Math.round((date - jan1) / 86400000);
    return Math.floor((diff + weekdayMonday(jan1) - 1) / 7) + 1;
  }

  function runSuffixFor(iso) {
    var date = parseISODate(canonicalWeek(iso) || iso);
    if (!date) return '';
    var week = weekNumber(date);
    return String(date.getFullYear()).slice(-1) + (week < 10 ? '0' : '') + week;
  }

  function blankState() {
    var week = mondayISO(new Date());
    return {
      version: 1,
      runSuffix: runSuffixFor(week),
      weekCommencing: week,
      notes: '',
      blocks: []
    };
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

  function displayText(block) {
    var structured = block.customer || block.product || block.liquidCode ||
      block.packingFormat || block.volume != null;
    if (!structured) return block.legacyText || '';
    var lines = [block.customer, block.product, block.liquidCode, block.packingFormat];
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
      volume: block.volume,
      legacyText: block.legacyText,
      text: displayText(block),
      backgroundColour: block.backgroundColour
    };
  }

  function normaliseBlock(item, seen, fallbackWeek) {
    if (!item || typeof item !== 'object') return null;
    if (!dayIds[item.day] || !categoryIds[item.category]) return null;
    var start = clockToOffset(item.startTime, false);
    var end = clockToOffset(item.endTime, true);
    if (!validOffsets(start, end)) return null;
    var id = String(item.id || '');
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id) || seen[id]) id = newId();
    seen[id] = true;
    var customer = cleanLine(item.customer, 500) || cleanLine(item.companyName, 500);
    var product = cleanLine(item.product, 500) || cleanLine(item.productName, 500);
    var liquidCode = cleanLine(item.liquidCode, 80);
    var packingFormat = cleanLine(item.packingFormat, 200);
    var volume = storedVolume(item.volume);
    var structured = customer || product || liquidCode || packingFormat || volume != null;
    var legacyText = '';
    if (!structured) {
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
      volume: volume,
      legacyText: legacyText,
      backgroundColour: normaliseColour(item.backgroundColour)
    };
  }

  var migratedOnLoad = false;

  function load() {
    var fresh = blankState();
    var store = storage();
    if (!store) return fresh;
    try {
      var raw = store.getItem(STORAGE_KEY);
      if (!raw) return fresh;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return fresh;
      var changed = false;
      if (typeof data.notes === 'string') fresh.notes = data.notes.slice(0, 4000);
      if (typeof data.weekCommencing === 'string') {
        var monday = canonicalWeek(data.weekCommencing);
        if (monday) {
          if (monday !== data.weekCommencing) changed = true;
          fresh.weekCommencing = monday;
        } else {
          changed = true;
        }
      }
      var suffix = runSuffixFor(fresh.weekCommencing);
      if (data.runSuffix !== suffix) changed = true;
      fresh.runSuffix = suffix;
      var seen = {};
      var blocks = Array.isArray(data.blocks) ? data.blocks : [];
      fresh.blocks = [];
      blocks.forEach(function (item) {
        var block = normaliseBlock(item, seen, fresh.weekCommencing);
        if (!block) return;
        if (canonicalWeek(item && item.weekCommencing) !== block.weekCommencing) changed = true;
        if (String((item && item.backgroundColour) || '').toLowerCase() !== block.backgroundColour) changed = true;
        fresh.blocks.push(block);
      });
      if (changed) migratedOnLoad = true;
      return fresh;
    } catch (err) {
      migratedOnLoad = false;
      return blankState();
    }
  }

  var state = load();

  function persist() {
    var store = storage();
    if (!store) return false;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      return false;
    }
  }

  if (migratedOnLoad) persist();

  function getState() {
    return {
      version: state.version,
      runSuffix: runSuffixFor(state.weekCommencing),
      weekCommencing: state.weekCommencing,
      notes: state.notes,
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

  function addBlock(input) {
    input = input || {};
    if (!dayIds[input.day] || !categoryIds[input.category]) return null;
    if (!validOffsets(input.startOffset, input.endOffset)) return null;
    var block = {
      id: newId(),
      weekCommencing: canonicalWeek(input.weekCommencing) || state.weekCommencing,
      day: input.day,
      category: input.category,
      startTime: offsetToClock(input.startOffset),
      endTime: offsetToClock(input.endOffset),
      customer: cleanLine(input.customer, 500),
      product: cleanLine(input.product, 500),
      liquidCode: cleanLine(input.liquidCode, 80),
      packingFormat: cleanLine(input.packingFormat, 200),
      volume: storedVolume(input.volume),
      legacyText: '',
      backgroundColour: normaliseColour(input.backgroundColour)
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
    if (patch.packingFormat !== undefined) block.packingFormat = cleanLine(patch.packingFormat, 200);
    if (patch.volume !== undefined) block.volume = storedVolume(patch.volume);
    if (patch.legacyText !== undefined) block.legacyText = String(patch.legacyText).slice(0, 2000);
    if (patch.backgroundColour !== undefined) block.backgroundColour = normaliseColour(patch.backgroundColour);
    if (patch.day !== undefined && dayIds[patch.day]) block.day = patch.day;
    if (patch.category !== undefined && categoryIds[patch.category]) block.category = patch.category;
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

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    DAY_LENGTH: DAY_LENGTH,
    DEFAULT_COLOUR: DEFAULT_COLOUR,
    DAYS: DAYS,
    CATEGORIES: CATEGORIES,
    STATUSES: STATUSES.map(function (status) {
      return { colour: status.colour, label: status.label };
    }),
    COLOURS: COLOURS.slice(),
    mondayISO: mondayISO,
    parseISODate: parseISODate,
    weekNumber: weekNumber,
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
    addBlock: addBlock,
    updateBlock: updateBlock,
    removeBlock: removeBlock,
    persist: persist
  };

  root.ScheduleData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
