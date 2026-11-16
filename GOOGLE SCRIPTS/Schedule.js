/**
 * SCS Schedule backup.
 *
 * This script is the recovery copy. It never writes back to Netlify.
 * Deploy it as its own Apps Script web app (Execute as me, Who has access: Anyone).
 * In Project Settings → Script properties set:
 *   API_TOKEN      the same value as Netlify SCHEDULE_SCRIPT_TOKEN
 *   SCHEDULE_SSID  the spreadsheet that should hold the backup
 *
 * An incoming row is written only when its version is the same or newer than
 * the version already on the sheet. An older backup cannot roll a row backwards.
 */

var HEADERS = {
  Bookings: ['id', 'week_commencing', 'day', 'category', 'start_time', 'end_time', 'customer', 'product', 'liquid_code', 'packing_format', 'volume', 'legacy_text', 'background_colour', 'version', 'updated_by'],
  'Day notes': ['date', 'week_commencing', 'important', 'absence', 'version', 'updated_by'],
  'Week settings': ['week_commencing', 'night_shift', 'saturday', 'version', 'updated_by'],
  'Backup log': ['at', 'scope', 'revision', 'written', 'skipped', 'message']
};

function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var expected = String(PropertiesService.getScriptProperties().getProperty('API_TOKEN') || '');
    var token = String(data.token || '');
    if (!expected || token.length !== expected.length) {
      return json({ result: 'error', message: 'Unauthorized' });
    }
    var mismatch = 0;
    for (var i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ token.charCodeAt(i);
    if (mismatch) return json({ result: 'error', message: 'Unauthorized' });

    var action = String(data.action || '');
    if (action === 'backup_week') return json(writeWeek(data.week || {}));
    if (action === 'backup_full') return json(writeFull(data.schedule || {}));
    return json({ result: 'error', message: 'Unknown action' });
  } catch (err) {
    return json({ result: 'error', message: String(err) });
  }
}

function writeWeek(week) {
  return LockService.getScriptLock().tryLock(20000) ? finishLock(function () {
    var counts = { written: 0, skipped: 0 };
    var weekKey = String(week.weekCommencing || '');
    writeBookings(week.bookings || [], counts, { week: weekKey });
    writeNotes(week.dayNotes || [], counts, { week: weekKey });
    writeWeeks(week.week && week.week.version ? [week.week] : [], counts, { week: weekKey });
    logBackup('week ' + weekKey, week.revision, counts, '');
    return { result: 'ok', written: counts.written, skipped: counts.skipped };
  }) : { result: 'error', message: 'Backup sheet is busy' };
}

function writeFull(schedule) {
  return LockService.getScriptLock().tryLock(25000) ? finishLock(function () {
    var counts = { written: 0, skipped: 0 };
    writeBookings(schedule.bookings || [], counts, { full: true });
    writeNotes(schedule.dayNotes || [], counts, { full: true });
    writeWeeks(keptWeeks(schedule.weeks || []), counts, { full: true });
    logBackup('full', schedule.revision, counts, '');
    return { result: 'ok', written: counts.written, skipped: counts.skipped };
  }) : { result: 'error', message: 'Backup sheet is busy' };
}

function finishLock(work) {
  try {
    return work();
  } finally {
    LockService.getScriptLock().releaseLock();
  }
}

function writeBookings(rows, counts, scope) {
  var sheet = sheetFor('Bookings');
  var index = columnIndex(sheet, 'id');
  rows.forEach(function (row) {
    writeRow(sheet, index, String(row.id || ''), [
      row.id, row.weekCommencing, row.day, row.category, row.startTime, row.endTime,
      row.customer, row.product, row.liquidCode, row.packingFormat,
      row.volume == null ? '' : row.volume, row.legacyText, row.backgroundColour,
      row.version, row.updatedBy
    ], row.version, counts);
  });
  dropMissing(sheet, 'id', 'week_commencing', keysOf(rows, 'id'), scope, counts);
}

function writeNotes(rows, counts, scope) {
  var sheet = sheetFor('Day notes');
  var index = columnIndex(sheet, 'date');
  rows.forEach(function (row) {
    writeRow(sheet, index, String(row.date || ''), [
      row.date, row.weekCommencing, row.important, row.absence, row.version, row.updatedBy
    ], row.version, counts);
  });
  dropMissing(sheet, 'date', 'week_commencing', keysOf(rows, 'date'), scope, counts);
}

function writeWeeks(rows, counts, scope) {
  var sheet = sheetFor('Week settings');
  var index = columnIndex(sheet, 'week_commencing');
  rows.forEach(function (row) {
    if (!row || !row.version) return;
    writeRow(sheet, index, String(row.weekCommencing || ''), [
      row.weekCommencing, row.nightShift ? 'yes' : 'no', row.saturday ? 'yes' : 'no',
      row.version, row.updatedBy
    ], row.version, counts);
  });
  dropMissing(sheet, 'week_commencing', 'week_commencing', keysOf(keptWeeks(rows), 'weekCommencing'), scope, counts);
}

function keptWeeks(rows) {
  return (rows || []).filter(function (row) { return row && row.version; });
}

function keysOf(rows, field) {
  var map = {};
  (rows || []).forEach(function (row) {
    if (row && row[field]) map[String(row[field])] = true;
  });
  return map;
}

function dropMissing(sheet, keyName, weekName, keep, scope, counts) {
  if (!scope) return;
  var last = sheet.getLastRow();
  if (last < 2) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var keyCol = 1;
  var weekCol = 1;
  for (var h = 0; h < headers.length; h++) {
    if (String(headers[h]) === keyName) keyCol = h + 1;
    if (String(headers[h]) === weekName) weekCol = h + 1;
  }
  var width = Math.max(keyCol, weekCol);
  var values = sheet.getRange(2, 1, last - 1, width).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    var key = String(values[i][keyCol - 1] || '');
    var rowWeek = String(values[i][weekCol - 1] || '');
    if (!key || keep[key]) continue;
    if (scope.week && rowWeek !== scope.week) continue;
    sheet.deleteRow(i + 2);
    counts.written += 1;
  }
}

function writeRow(sheet, index, key, values, version, counts) {
  if (!key) return;
  var found = index[key];
  if (found) {
    var current = Number(sheet.getRange(found, versionColumn(sheet)).getValue());
    if (isFinite(current) && current > Number(version)) {
      counts.skipped += 1;
      return;
    }
    sheet.getRange(found, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
    index[key] = sheet.getLastRow();
  }
  counts.written += 1;
}

function versionColumn(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]) === 'version') return i + 1;
  }
  return headers.length;
}

function columnIndex(sheet, keyName) {
  var last = sheet.getLastRow();
  var map = {};
  if (last < 2) return map;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var column = 1;
  for (var h = 0; h < headers.length; h++) {
    if (String(headers[h]) === keyName) column = h + 1;
  }
  var values = sheet.getRange(2, column, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) map[String(values[i][0] || '')] = i + 2;
  return map;
}

function sheetFor(name) {
  var id = PropertiesService.getScriptProperties().getProperty('SCHEDULE_SSID');
  var book = SpreadsheetApp.openById(id);
  var sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.insertSheet(name);
    sheet.appendRow(HEADERS[name]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function logBackup(scope, revision, counts, message) {
  var sheet = sheetFor('Backup log');
  sheet.appendRow([new Date(), scope, revision || 0, counts.written, counts.skipped, message || '']);
}

function json(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
