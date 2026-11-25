const session = require('./session');
const schedule = require('../../schedule/schedule-data');

const DAYS = { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true };
const CATEGORIES = { bottles: true, keg: true, owk: true, bibs: true, bulk: true };
const BLENDING = { base_in: true, filtering: true, filtering_2: true, blending: true, bulk_out: true };
const APPOINTMENTS = { scs: true, management: true, qc_blending: true, warehouse_logistics: true, engineering: true };

function scheduleName(value) {
  if (value === 'blending' || value === 'appointments') return value;
  return 'production';
}
const COLOURS = {};
schedule.COLOURS.forEach(function (colour) { COLOURS[colour] = true; });

const BOOKING_RETURN = `
  id,
  to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
  day, category, start_time, end_time, customer, product, liquid_code,
  packing_format, volume, legacy_text, background_colour, schedule_kind, free_text,
  block_type, lane_span, version, updated_by
`;

let databaseClient = null;

function database() {
  if (databaseClient) return Promise.resolve(databaseClient);
  return import('@netlify/database').then(function (mod) {
    databaseClient = mod.getDatabase();
    return databaseClient;
  });
}

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function sheetShouldWrite(existingVersion, incomingVersion) {
  const existing = Number(existingVersion);
  const incoming = Number(incomingVersion);
  if (!isFinite(incoming)) return false;
  if (!isFinite(existing)) return true;
  return incoming >= existing;
}

function offsetsOk(startTime, endTime) {
  const start = schedule.clockToOffset(startTime, false);
  const end = schedule.clockToOffset(endTime, true);
  if (start == null || end == null) return false;
  return start >= 0 && start <= schedule.DAY_LENGTH - 60 &&
    end >= 60 && end <= schedule.DAY_LENGTH &&
    start % 60 === 0 && end % 60 === 0 &&
    end - start >= 60;
}

function mapBooking(row) {
  if (!row) return null;
  return {
    id: row.id,
    weekCommencing: row.week_commencing,
    day: row.day,
    category: row.category,
    startTime: row.start_time,
    endTime: row.end_time,
    customer: row.customer || '',
    product: row.product || '',
    liquidCode: row.liquid_code || '',
    packingFormat: row.packing_format || '',
    volume: row.volume == null || row.volume === '' ? null : Number(row.volume),
    legacyText: row.legacy_text || '',
    backgroundColour: row.background_colour,
    schedule: scheduleName(row.schedule_kind),
    freeText: row.free_text || '',
    blockType: row.block_type === 'cip' ? 'cip' : 'booking',
    laneSpan: schedule.cleanLaneSpan(row.category, row.lane_span, row.block_type === 'cip' ? 'cip' : 'booking'),
    version: Number(row.version) || 0,
    updatedBy: row.updated_by || ''
  };
}

function mapNote(row) {
  return {
    date: row.note_date,
    weekCommencing: row.week_commencing,
    important: row.important || '',
    absence: row.absence || '',
    version: Number(row.version) || 0,
    updatedBy: row.updated_by || ''
  };
}

function mapWeek(row) {
  return {
    weekCommencing: row.week_commencing,
    schedule: scheduleName(row.schedule_kind),
    nightShift: !!row.night_shift,
    saturday: !!row.saturday_running,
    version: Number(row.version) || 0,
    updatedBy: row.updated_by || ''
  };
}

function checkedBooking(input) {
  const booking = input || {};
  const id = String(booking.id || '');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) return { error: 'The booking id is not valid.' };
  const monday = requireWeek(booking.weekCommencing);
  if (!monday) return { error: 'The production week is not valid.' };
  const kind = scheduleName(booking.schedule);
  const allowed = kind === 'blending' ? BLENDING : (kind === 'appointments' ? APPOINTMENTS : CATEGORIES);
  if (!DAYS[booking.day] || !allowed[booking.category]) return { error: 'The day or category is not valid.' };
  if (!offsetsOk(booking.startTime, booking.endTime)) return { error: 'The start and finish times are not valid.' };
  const colour = String(booking.backgroundColour || '').toLowerCase();
  const blockType = booking.blockType === 'cip' ? 'cip' : 'booking';
  if (blockType === 'cip' && kind !== 'production') return { error: 'CIP blocks belong on the production schedule.' };
  if (blockType !== 'cip' && !COLOURS[colour]) return { error: 'The status colour is not valid.' };
  let volume = null;
  if (kind !== 'appointments' && booking.volume != null && booking.volume !== '') {
    volume = Number(booking.volume);
    if (!isFinite(volume)) return { error: 'The volume is not valid.' };
  }
  if (kind === 'blending' && (volume == null || volume < 100 || volume > 1000000)) {
    return { error: 'The volume is not valid.' };
  }
  const details = kind === 'production' ? '' : clean(booking.freeText, 2000);
  if (kind === 'appointments' && !details) return { error: 'The appointment details are missing.' };
  const cip = blockType === 'cip';
  return {
    booking: {
      id: id,
      weekCommencing: monday,
      day: booking.day,
      category: booking.category,
      startTime: booking.startTime,
      endTime: booking.endTime,
      customer: kind === 'appointments' || cip ? '' : clean(booking.customer, 500),
      product: kind === 'appointments' || cip ? '' : clean(booking.product, 500),
      liquidCode: kind === 'appointments' || cip ? '' : clean(booking.liquidCode, 80),
      packingFormat: kind === 'production' && !cip ? clean(booking.packingFormat, 200) : '',
      volume: kind === 'appointments' || cip ? null : volume,
      legacyText: kind === 'appointments' || cip ? '' : clean(booking.legacyText, 2000),
      backgroundColour: blockType === 'cip' ? schedule.CIP_COLOUR : colour,
      schedule: kind,
      freeText: cip ? '' : details,
      blockType: blockType,
      laneSpan: schedule.cleanLaneSpan(booking.category, booking.laneSpan, blockType)
    }
  };
}

function requireWeek(value) {
  const parsed = schedule.parseISODate(value);
  if (!parsed) return '';
  const monday = schedule.mondayISO(parsed);
  if (!monday || monday !== String(value || '')) return '';
  return monday;
}

function noteWeek(date) {
  const parsed = schedule.parseISODate(date);
  if (!parsed) return '';
  return schedule.mondayISO(parsed);
}

const NOTE_RETURN = `
  to_char(note_date, 'YYYY-MM-DD') AS note_date,
  to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
  important, absence, version, updated_by
`;

const WEEK_RETURN = `
  to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
  schedule_kind, night_shift, saturday_running, version, updated_by
`;

async function run(text, params) {
  const db = await database();
  return db.pool.query(text, params);
}

function wrote(result) {
  return result && Array.isArray(result.rows) && result.rows.length > 0;
}

async function backupSummary() {
  const db = await database();
  const result = await db.pool.query(
    `SELECT
       (SELECT count(*)::int FROM schedule_backup_jobs WHERE status = 'pending') AS pending,
       (SELECT count(*)::int FROM schedule_backup_jobs WHERE status = 'failed') AS failed,
       (SELECT to_char(backed_up_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          FROM schedule_backup_state WHERE scope_key = 'full') AS last_full`
  );
  const row = result.rows[0] || {};
  return {
    configured: !!(process.env.SCHEDULE_SCRIPT_URL && process.env.SCHEDULE_SCRIPT_TOKEN),
    pending: Number(row.pending) || 0,
    failed: Number(row.failed) || 0,
    lastFullAt: row.last_full || null
  };
}

async function loadYear(year) {
  const weeks = schedule.productionWeeks(Number(year));
  if (!weeks.length) return null;
  const start = weeks[0].weekCommencing;
  const end = weeks[weeks.length - 1].weekCommencing;
  const db = await database();
  const bookings = await db.pool.query(
    `SELECT ${BOOKING_RETURN}
     FROM schedule_bookings
     WHERE week_commencing >= $1::date AND week_commencing <= $2::date
     ORDER BY week_commencing, day, category, start_time, id`,
    [start, end]
  );
  const notes = await db.pool.query(
    `SELECT to_char(note_date, 'YYYY-MM-DD') AS note_date,
            to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
            important, absence, version, updated_by
     FROM schedule_day_notes
     WHERE week_commencing >= $1::date AND week_commencing <= $2::date
     ORDER BY note_date`,
    [start, end]
  );
  const settings = await db.pool.query(
    `SELECT ${WEEK_RETURN}
     FROM schedule_weeks
     WHERE week_commencing >= $1::date AND week_commencing <= $2::date
     ORDER BY week_commencing, schedule_kind`,
    [start, end]
  );
  return {
    year: Number(year),
    start: start,
    end: end,
    bookings: bookings.rows.map(mapBooking),
    dayNotes: notes.rows.map(mapNote),
    weeks: settings.rows.map(mapWeek),
    backup: await backupSummary()
  };
}

async function applyOp(op, username) {
  if (!op || typeof op !== 'object') return { ok: false, error: 'The change could not be read.' };
  if (op.type === 'booking') return applyBooking(op, username);
  if (op.type === 'note') return applyNote(op, username);
  if (op.type === 'week') return applyWeek(op, username);
  return { ok: false, error: 'The change is not a booking, note, or week setting.' };
}

async function applyBooking(op, username) {
  if (op.action === 'delete') return deleteBooking(op, username);
  const checked = checkedBooking(op.booking);
  if (checked.error) return { ok: false, type: 'booking', error: checked.error };
  const booking = checked.booking;
  const expected = Number(op.expectedVersion);
  const values = [
    booking.id, booking.weekCommencing, booking.day, booking.category, booking.startTime,
    booking.endTime, booking.customer, booking.product, booking.liquidCode, booking.packingFormat,
    booking.volume, booking.legacyText, booking.backgroundColour, username,
    booking.schedule, booking.freeText, booking.blockType, booking.laneSpan
  ];
  if (!expected) {
    const inserted = await run(
      `WITH inserted AS (
         INSERT INTO schedule_bookings (
           id, week_commencing, day, category, start_time, end_time, customer, product,
           liquid_code, packing_format, volume, legacy_text, background_colour, version, updated_by,
           schedule_kind, free_text, block_type, lane_span
         ) VALUES (
           $1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1, $14, $15, $16, $17, $18
         )
         ON CONFLICT (id) DO NOTHING
         RETURNING ${BOOKING_RETURN}
       ), bumped AS (
         UPDATE schedule_revision SET revision = revision + 1
         WHERE id = 1 AND EXISTS (SELECT 1 FROM inserted)
       ), queued AS (
         INSERT INTO schedule_backup_jobs (scope, week_commencing, status)
         SELECT 'week', $2::date, 'pending'
         WHERE EXISTS (SELECT 1 FROM inserted)
           AND $15 = 'production'
           AND NOT EXISTS (
             SELECT 1 FROM schedule_backup_jobs
             WHERE scope = 'week' AND week_commencing = $2::date AND status IN ('pending', 'failed')
           )
       )
       SELECT * FROM inserted`,
      values
    );
    if (!wrote(inserted)) {
      const current = await run(`SELECT ${BOOKING_RETURN} FROM schedule_bookings WHERE id = $1`, [booking.id]);
      return { ok: false, conflict: true, type: 'booking', id: booking.id, server: mapBooking(current.rows[0]) };
    }
    return { ok: true, type: 'booking', action: 'upsert', id: booking.id, version: 1, record: mapBooking(inserted.rows[0]) };
  }
  const updated = await run(
    `WITH old AS (
       SELECT week_commencing FROM schedule_bookings WHERE id = $1 AND version = $19 AND schedule_kind = $15
     ), updated AS (
       UPDATE schedule_bookings SET
         week_commencing = $2::date, day = $3, category = $4, start_time = $5, end_time = $6,
         customer = $7, product = $8, liquid_code = $9, packing_format = $10, volume = $11,
         legacy_text = $12, background_colour = $13, free_text = $16, block_type = $17,
         lane_span = $18, version = version + 1, updated_at = now(), updated_by = $14
       WHERE id = $1 AND version = $19 AND schedule_kind = $15
       RETURNING ${BOOKING_RETURN}
     ), bumped AS (
       UPDATE schedule_revision SET revision = revision + 1
       WHERE id = 1 AND EXISTS (SELECT 1 FROM updated)
     ), queued AS (
       INSERT INTO schedule_backup_jobs (scope, week_commencing, status)
       SELECT 'week', weeks.week_value, 'pending'
       FROM (
         SELECT week_commencing AS week_value FROM old
         UNION
         SELECT $2::date FROM updated
       ) weeks
       WHERE EXISTS (SELECT 1 FROM updated WHERE schedule_kind = 'production')
         AND NOT EXISTS (
           SELECT 1 FROM schedule_backup_jobs
           WHERE scope = 'week' AND week_commencing = weeks.week_value AND status IN ('pending', 'failed')
         )
     )
     SELECT * FROM updated`,
    values.concat(expected)
  );
  if (!wrote(updated)) {
    const current = await run(`SELECT ${BOOKING_RETURN} FROM schedule_bookings WHERE id = $1`, [booking.id]);
    return { ok: false, conflict: true, type: 'booking', id: booking.id, server: mapBooking(current.rows[0]) };
  }
  return { ok: true, type: 'booking', action: 'upsert', id: booking.id, version: Number(updated.rows[0].version), record: mapBooking(updated.rows[0]) };
}

async function deleteBooking(op, username) {
  const id = String(op.id || '');
  const expected = Number(op.expectedVersion);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id) || !expected) {
    return { ok: false, type: 'booking', error: 'The booking could not be removed.' };
  }
  const removed = await run(
    `WITH old AS (
       SELECT week_commencing, schedule_kind FROM schedule_bookings WHERE id = $1 AND version = $2
     ), removed AS (
       DELETE FROM schedule_bookings WHERE id = $1 AND version = $2
       RETURNING id
     ), bumped AS (
       UPDATE schedule_revision SET revision = revision + 1
       WHERE id = 1 AND EXISTS (SELECT 1 FROM removed)
     ), queued AS (
       INSERT INTO schedule_backup_jobs (scope, week_commencing, status)
       SELECT 'week', old.week_commencing, 'pending' FROM old
       WHERE EXISTS (SELECT 1 FROM removed)
         AND old.schedule_kind = 'production'
         AND NOT EXISTS (
           SELECT 1 FROM schedule_backup_jobs
           WHERE scope = 'week' AND week_commencing = old.week_commencing AND status IN ('pending', 'failed')
         )
     )
     SELECT id FROM removed`,
    [id, expected]
  );
  if (wrote(removed)) return { ok: true, type: 'booking', action: 'delete', id: id, version: expected };
  const current = await run(`SELECT ${BOOKING_RETURN} FROM schedule_bookings WHERE id = $1`, [id]);
  if (!current.rows.length) return { ok: true, type: 'booking', action: 'delete', id: id, missing: true };
  return { ok: false, conflict: true, type: 'booking', id: id, server: mapBooking(current.rows[0]) };
}

async function applyNote(op, username) {
  const date = String((op.note && op.note.date) || op.date || '');
  const week = noteWeek(date);
  if (!week) return { ok: false, type: 'note', error: 'The note date is not valid.' };
  const expected = Number(op.expectedVersion);
  const important = clean(op.note && op.note.important, 2000);
  const absence = clean(op.note && op.note.absence, 2000);
  if (op.action === 'delete' || (!important && !absence)) {
    const removed = await run(
      `WITH removed AS (
         DELETE FROM schedule_day_notes
         WHERE note_date = $1::date AND version = $2
         RETURNING note_date
       ), bumped AS (
         UPDATE schedule_revision SET revision = revision + 1
         WHERE id = 1 AND EXISTS (SELECT 1 FROM removed)
       ), queued AS (
         INSERT INTO schedule_backup_jobs (scope, week_commencing, status)
         SELECT 'week', $3::date, 'pending'
         WHERE EXISTS (SELECT 1 FROM removed)
           AND NOT EXISTS (
             SELECT 1 FROM schedule_backup_jobs
             WHERE scope = 'week' AND week_commencing = $3::date AND status IN ('pending', 'failed')
           )
       )
       SELECT note_date FROM removed`,
      [date, expected, week]
    );
    if (wrote(removed)) return { ok: true, type: 'note', action: 'delete', date: date, version: expected };
    const current = await run(`SELECT ${NOTE_RETURN} FROM schedule_day_notes WHERE note_date = $1::date`, [date]);
    if (!current.rows.length) return { ok: true, type: 'note', action: 'delete', date: date, missing: true };
    return { ok: false, conflict: true, type: 'note', date: date, server: mapNote(current.rows[0]) };
  }
  if (!expected) {
    const inserted = await run(
      `WITH inserted AS (
         INSERT INTO schedule_day_notes (note_date, week_commencing, important, absence, version, updated_by)
         VALUES ($1::date, $2::date, $3, $4, 1, $5)
         ON CONFLICT (note_date) DO NOTHING
         RETURNING ${NOTE_RETURN}
       ), bumped AS (
         UPDATE schedule_revision SET revision = revision + 1
         WHERE id = 1 AND EXISTS (SELECT 1 FROM inserted)
       ), queued AS (
         INSERT INTO schedule_backup_jobs (scope, week_commencing, status)
         SELECT 'week', $2::date, 'pending'
         WHERE EXISTS (SELECT 1 FROM inserted)
           AND NOT EXISTS (
             SELECT 1 FROM schedule_backup_jobs
             WHERE scope = 'week' AND week_commencing = $2::date AND status IN ('pending', 'failed')
           )
       )
       SELECT * FROM inserted`,
      [date, week, important, absence, username]
    );
    if (!wrote(inserted)) {
      const current = await run(`SELECT ${NOTE_RETURN} FROM schedule_day_notes WHERE note_date = $1::date`, [date]);
      return { ok: false, conflict: true, type: 'note', date: date, server: mapNote(current.rows[0]) };
    }
    return { ok: true, type: 'note', action: 'upsert', date: date, version: 1, record: mapNote(inserted.rows[0]) };
  }
  const updated = await run(
    `WITH updated AS (
       UPDATE schedule_day_notes SET
         important = $2, absence = $3, version = version + 1, updated_at = now(), updated_by = $4
       WHERE note_date = $1::date AND version = $5
       RETURNING ${NOTE_RETURN}
     ), bumped AS (
       UPDATE schedule_revision SET revision = revision + 1
       WHERE id = 1 AND EXISTS (SELECT 1 FROM updated)
     ), queued AS (
       INSERT INTO schedule_backup_jobs (scope, week_commencing, status)
       SELECT 'week', $6::date, 'pending'
       WHERE EXISTS (SELECT 1 FROM updated)
         AND NOT EXISTS (
           SELECT 1 FROM schedule_backup_jobs
           WHERE scope = 'week' AND week_commencing = $6::date AND status IN ('pending', 'failed')
         )
     )
     SELECT * FROM updated`,
    [date, important, absence, username, expected, week]
  );
  if (!wrote(updated)) {
    const current = await run(`SELECT ${NOTE_RETURN} FROM schedule_day_notes WHERE note_date = $1::date`, [date]);
    return { ok: false, conflict: true, type: 'note', date: date, server: current.rows[0] ? mapNote(current.rows[0]) : null };
  }
  return { ok: true, type: 'note', action: 'upsert', date: date, version: Number(updated.rows[0].version), record: mapNote(updated.rows[0]) };
}

async function applyWeek(op, username) {
  const week = op.week || {};
  const monday = requireWeek(week.weekCommencing);
  if (!monday) return { ok: false, type: 'week', error: 'The production week is not valid.' };
  const expected = Number(op.expectedVersion);
  const night = !!week.nightShift;
  const saturday = !!week.saturday;
  const kind = scheduleName(week.schedule);
  if (!expected) {
    const inserted = await run(
      `WITH inserted AS (
         INSERT INTO schedule_weeks (week_commencing, night_shift, saturday_running, version, updated_by, schedule_kind)
         VALUES ($1::date, $2, $3, 1, $4, $5)
         ON CONFLICT (week_commencing, schedule_kind) DO NOTHING
         RETURNING ${WEEK_RETURN}
       ), bumped AS (
         UPDATE schedule_revision SET revision = revision + 1
         WHERE id = 1 AND EXISTS (SELECT 1 FROM inserted)
       ), queued AS (
         INSERT INTO schedule_backup_jobs (scope, week_commencing, status)
         SELECT 'week', $1::date, 'pending'
         WHERE EXISTS (SELECT 1 FROM inserted)
           AND $5 = 'production'
           AND NOT EXISTS (
             SELECT 1 FROM schedule_backup_jobs
             WHERE scope = 'week' AND week_commencing = $1::date AND status IN ('pending', 'failed')
           )
       )
       SELECT * FROM inserted`,
      [monday, night, saturday, username, kind]
    );
    if (!wrote(inserted)) {
      const current = await run(
        `SELECT ${WEEK_RETURN} FROM schedule_weeks WHERE week_commencing = $1::date AND schedule_kind = $2`,
        [monday, kind]
      );
      return { ok: false, conflict: true, type: 'week', weekCommencing: monday, server: current.rows[0] ? mapWeek(current.rows[0]) : null };
    }
    return { ok: true, type: 'week', action: 'upsert', weekCommencing: monday, version: 1, record: mapWeek(inserted.rows[0]) };
  }
  const updated = await run(
    `WITH updated AS (
       UPDATE schedule_weeks SET
         night_shift = $2, saturday_running = $3, version = version + 1,
         updated_at = now(), updated_by = $4
       WHERE week_commencing = $1::date AND schedule_kind = $5 AND version = $6
       RETURNING ${WEEK_RETURN}
     ), bumped AS (
       UPDATE schedule_revision SET revision = revision + 1
       WHERE id = 1 AND EXISTS (SELECT 1 FROM updated)
     ), queued AS (
       INSERT INTO schedule_backup_jobs (scope, week_commencing, status)
       SELECT 'week', $1::date, 'pending'
       WHERE EXISTS (SELECT 1 FROM updated)
         AND $5 = 'production'
         AND NOT EXISTS (
           SELECT 1 FROM schedule_backup_jobs
           WHERE scope = 'week' AND week_commencing = $1::date AND status IN ('pending', 'failed')
         )
     )
     SELECT * FROM updated`,
    [monday, night, saturday, username, kind, expected]
  );
  if (!wrote(updated)) {
    const current = await run(
      `SELECT ${WEEK_RETURN} FROM schedule_weeks WHERE week_commencing = $1::date AND schedule_kind = $2`,
      [monday, kind]
    );
    return { ok: false, conflict: true, type: 'week', weekCommencing: monday, server: current.rows[0] ? mapWeek(current.rows[0]) : null };
  }
  return { ok: true, type: 'week', action: 'upsert', weekCommencing: monday, version: Number(updated.rows[0].version), record: mapWeek(updated.rows[0]) };
}

function backupConfigured() {
  return !!(process.env.SCHEDULE_SCRIPT_URL && process.env.SCHEDULE_SCRIPT_TOKEN);
}

async function postSheet(payload) {
  const response = await fetch(process.env.SCHEDULE_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ token: process.env.SCHEDULE_SCRIPT_TOKEN }, payload))
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
  if (!response.ok || !parsed || parsed.result !== 'ok') {
    throw new Error((parsed && parsed.message) || 'Google Sheets backup was rejected');
  }
  return parsed;
}

async function readWeek(db, week) {
  const revision = await db.pool.query('SELECT revision FROM schedule_revision WHERE id = 1');
  const bookings = await db.pool.query(
    `SELECT ${BOOKING_RETURN} FROM schedule_bookings
     WHERE week_commencing = $1::date AND schedule_kind = 'production'
       AND block_type <> 'cip'
     ORDER BY day, category, start_time, id`,
    [week]
  );
  const notes = await db.pool.query(
    `SELECT to_char(note_date, 'YYYY-MM-DD') AS note_date,
            to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
            important, absence, version, updated_by
     FROM schedule_day_notes WHERE week_commencing = $1::date ORDER BY note_date`,
    [week]
  );
  const settings = await db.pool.query(
    `SELECT to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
            night_shift, saturday_running, version, updated_by
     FROM schedule_weeks WHERE week_commencing = $1::date AND schedule_kind = 'production'`,
    [week]
  );
  return {
    weekCommencing: week,
    revision: Number(revision.rows[0] && revision.rows[0].revision) || 0,
    bookings: bookings.rows.map(mapBooking),
    dayNotes: notes.rows.map(mapNote),
    week: settings.rowCount ? mapWeek(settings.rows[0]) : {
      weekCommencing: week, nightShift: false, saturday: false, version: 0
    }
  };
}

async function readAll(db) {
  const revision = await db.pool.query('SELECT revision FROM schedule_revision WHERE id = 1');
  const bookings = await db.pool.query(
    `SELECT ${BOOKING_RETURN} FROM schedule_bookings
     WHERE schedule_kind = 'production'
       AND block_type <> 'cip'
     ORDER BY week_commencing, day, category, start_time, id`
  );
  const notes = await db.pool.query(
    `SELECT to_char(note_date, 'YYYY-MM-DD') AS note_date,
            to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
            important, absence, version, updated_by
     FROM schedule_day_notes ORDER BY note_date`
  );
  const settings = await db.pool.query(
    `SELECT to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
            night_shift, saturday_running, version, updated_by
     FROM schedule_weeks WHERE schedule_kind = 'production' ORDER BY week_commencing`
  );
  return {
    revision: Number(revision.rows[0] && revision.rows[0].revision) || 0,
    bookings: bookings.rows.map(mapBooking),
    dayNotes: notes.rows.map(mapNote),
    weeks: settings.rows.map(mapWeek)
  };
}

async function finishJob(db, job, error) {
  if (!error) {
    await db.pool.query(
      `UPDATE schedule_backup_jobs
       SET status = 'done', last_error = '', updated_at = now()
       WHERE id = $1`,
      [job.id]
    );
    return;
  }
  const attempts = Number(job.attempts) + 1;
  await db.pool.query(
    `UPDATE schedule_backup_jobs
     SET attempts = $2, status = $3, last_error = $4, updated_at = now()
     WHERE id = $1`,
    [job.id, attempts, attempts >= 3 ? 'failed' : 'pending', String(error.message || error).slice(0, 500)]
  );
}

async function rememberBackup(db, key, revision) {
  await db.pool.query(
    `INSERT INTO schedule_backup_state (scope_key, revision, backed_up_at)
     VALUES ($1, $2, now())
     ON CONFLICT (scope_key) DO UPDATE
     SET revision = EXCLUDED.revision, backed_up_at = now()`,
    [key, revision]
  );
}

async function runBackup() {
  if (!backupConfigured()) return { configured: false, processed: 0, full: false };
  const db = await database();
  const jobs = await db.pool.query(
    `SELECT id, scope, to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing, attempts
     FROM schedule_backup_jobs
     WHERE status IN ('pending', 'failed') AND scope = 'week'
     ORDER BY id
     LIMIT 8`
  );
  let processed = 0;
  for (let i = 0; i < jobs.rows.length; i++) {
    const job = jobs.rows[i];
    try {
      const payload = await readWeek(db, job.week_commencing);
      await postSheet({ action: 'backup_week', week: payload });
      await finishJob(db, job, null);
      await rememberBackup(db, 'week:' + job.week_commencing, payload.revision);
      processed += 1;
    } catch (err) {
      await finishJob(db, job, err);
    }
  }
  const full = await runFullBackup(db);
  return { configured: true, processed: processed, full: full };
}

async function runFullBackup(db) {
  const state = await db.pool.query(
    `SELECT backed_up_at FROM schedule_backup_state WHERE scope_key = 'full'`
  );
  const last = state.rows[0] && state.rows[0].backed_up_at;
  const age = last ? Date.now() - new Date(last).getTime() : Infinity;
  if (age < 20 * 60 * 60 * 1000) return false;
  try {
    const payload = await readAll(db);
    await postSheet({ action: 'backup_full', schedule: payload });
    await rememberBackup(db, 'full', payload.revision);
    await db.pool.query(
      `UPDATE schedule_backup_jobs SET status = 'done', last_error = '', updated_at = now()
       WHERE scope = 'full' AND status IN ('pending', 'failed')`
    );
    return true;
  } catch (err) {
    const message = String(err.message || err).slice(0, 500);
    const existing = await db.pool.query(
      `SELECT id, attempts FROM schedule_backup_jobs
       WHERE scope = 'full' AND status IN ('pending', 'failed')
       ORDER BY id LIMIT 1`
    );
    if (existing.rowCount) {
      await db.pool.query(
        `UPDATE schedule_backup_jobs
         SET status = 'failed', attempts = $2, last_error = $3, updated_at = now()
         WHERE id = $1`,
        [existing.rows[0].id, Number(existing.rows[0].attempts) + 1, message]
      );
    } else {
      await db.pool.query(
        `INSERT INTO schedule_backup_jobs (scope, status, attempts, last_error)
         VALUES ('full', 'failed', 1, $1)`,
        [message]
      );
    }
    return false;
  }
}

function requireScheduleUser(event) {
  const user = session.requireUser(event);
  if (!user) return { response: session.unauthorised() };
  return { user: user };
}

module.exports = {
  sheetShouldWrite: sheetShouldWrite,
  checkedBooking: checkedBooking,
  loadYear: loadYear,
  applyOp: applyOp,
  backupSummary: backupSummary,
  runBackup: runBackup,
  requireScheduleUser: requireScheduleUser
};
