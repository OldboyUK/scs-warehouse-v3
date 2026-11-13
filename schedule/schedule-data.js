/*
 * Schedule data for Phase 1.
 * Blocks live in memory and localStorage only. No network calls.
 *
 * Stored block shape (ready for a later database):
 *   id, day, category, startTime, endTime, backgroundColour,
 *   productSelection, packingFormat, volume,
 *   companyName, productName, liquidCode
 * Older free-text blocks keep legacyText so they can still be shown.
 *
 * startTime and endTime are whole-hour clock times, "HH:MM".
 * The production day runs 06:00 to 06:00 the next morning, so an
 * endTime of "06:00" is the following morning, not the start of the day.
 */
(function (root) {
  var STORAGE_KEY = 'scs_schedule_v1';
  var DAY_LENGTH = 24 * 60;
  var DAY_START = 6 * 60;
  var DEFAULT_COLOUR = '#ff9900';

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

  var COLOURS = [
    '#ff0000',
    '#ff9900',
    '#fff2cc',
    '#9fc5e8',
    '#c27ba0',
    '#b7b7b7',
    '#93c47d',
    '#ffff00',
    '#00ffff',
    '#ff00ff',
    '#3c78d8'
  ];

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

  function blankState() {
    return {
      version: 1,
      runSuffix: '',
      weekCommencing: mondayISO(new Date()),
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
    var structured = block.companyName || block.productName || block.liquidCode ||
      block.packingFormat || block.volume != null;
    if (!structured) return block.legacyText || '';
    var lines = [block.companyName, block.productName, block.packingFormat, block.liquidCode];
    if (block.volume != null) lines.push(formatVolume(block.volume));
    return lines.filter(function (line) { return String(line || '').trim(); }).join('\n');
  }

  function present(block) {
    return {
      id: block.id,
      day: block.day,
      category: block.category,
      startTime: block.startTime,
      endTime: block.endTime,
      startOffset: clockToOffset(block.startTime, false),
      endOffset: clockToOffset(block.endTime, true),
      productSelection: block.productSelection,
      packingFormat: block.packingFormat,
      volume: block.volume,
      companyName: block.companyName,
      productName: block.productName,
      liquidCode: block.liquidCode,
      legacyText: block.legacyText,
      text: displayText(block),
      backgroundColour: block.backgroundColour
    };
  }

  function normaliseBlock(item, seen) {
    if (!item || typeof item !== 'object') return null;
    if (!dayIds[item.day] || !categoryIds[item.category]) return null;
    var start = clockToOffset(item.startTime, false);
    var end = clockToOffset(item.endTime, true);
    if (!validOffsets(start, end)) return null;
    var id = String(item.id || '');
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id) || seen[id]) id = newId();
    seen[id] = true;
    var productSelection = cleanLine(item.productSelection, 500);
    var companyName = cleanLine(item.companyName, 500);
    var productName = cleanLine(item.productName, 500);
    var liquidCode = cleanLine(item.liquidCode, 80);
    var packingFormat = cleanLine(item.packingFormat, 200);
    var volume = storedVolume(item.volume);
    var structured = productSelection || companyName || productName || liquidCode || packingFormat || volume != null;
    var legacyText = '';
    if (!structured) {
      if (typeof item.legacyText === 'string') legacyText = item.legacyText.slice(0, 2000);
      else if (typeof item.text === 'string') legacyText = item.text.slice(0, 2000);
    }
    return {
      id: id,
      day: item.day,
      category: item.category,
      startTime: offsetToClock(start),
      endTime: offsetToClock(end),
      productSelection: productSelection,
      packingFormat: packingFormat,
      volume: volume,
      companyName: companyName,
      productName: productName,
      liquidCode: liquidCode,
      legacyText: legacyText,
      backgroundColour: normaliseColour(item.backgroundColour)
    };
  }

  function load() {
    var fresh = blankState();
    var store = storage();
    if (!store) return fresh;
    try {
      var raw = store.getItem(STORAGE_KEY);
      if (!raw) return fresh;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return fresh;
      if (typeof data.runSuffix === 'string') fresh.runSuffix = data.runSuffix.slice(0, 40);
      if (typeof data.notes === 'string') fresh.notes = data.notes.slice(0, 4000);
      if (typeof data.weekCommencing === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.weekCommencing)) {
        fresh.weekCommencing = data.weekCommencing;
      }
      var seen = {};
      var blocks = Array.isArray(data.blocks) ? data.blocks : [];
      fresh.blocks = [];
      blocks.forEach(function (item) {
        var block = normaliseBlock(item, seen);
        if (block) fresh.blocks.push(block);
      });
      return fresh;
    } catch (err) {
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

  function getState() {
    return {
      version: state.version,
      runSuffix: state.runSuffix,
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
    if (patch.runSuffix !== undefined) state.runSuffix = String(patch.runSuffix).slice(0, 40);
    if (patch.notes !== undefined) state.notes = String(patch.notes).slice(0, 4000);
    if (patch.weekCommencing !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(patch.weekCommencing)) {
      state.weekCommencing = patch.weekCommencing;
    }
    return getState();
  }

  function addBlock(input) {
    input = input || {};
    if (!dayIds[input.day] || !categoryIds[input.category]) return null;
    if (!validOffsets(input.startOffset, input.endOffset)) return null;
    var block = {
      id: newId(),
      day: input.day,
      category: input.category,
      startTime: offsetToClock(input.startOffset),
      endTime: offsetToClock(input.endOffset),
      productSelection: cleanLine(input.productSelection, 500),
      packingFormat: cleanLine(input.packingFormat, 200),
      volume: storedVolume(input.volume),
      companyName: cleanLine(input.companyName, 500),
      productName: cleanLine(input.productName, 500),
      liquidCode: cleanLine(input.liquidCode, 80),
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
    if (patch.productSelection !== undefined) block.productSelection = cleanLine(patch.productSelection, 500);
    if (patch.packingFormat !== undefined) block.packingFormat = cleanLine(patch.packingFormat, 200);
    if (patch.volume !== undefined) block.volume = storedVolume(patch.volume);
    if (patch.companyName !== undefined) block.companyName = cleanLine(patch.companyName, 500);
    if (patch.productName !== undefined) block.productName = cleanLine(patch.productName, 500);
    if (patch.liquidCode !== undefined) block.liquidCode = cleanLine(patch.liquidCode, 80);
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
    COLOURS: COLOURS.slice(),
    mondayISO: mondayISO,
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
