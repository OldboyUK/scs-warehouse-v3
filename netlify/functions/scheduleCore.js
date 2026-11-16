const fetch = require('node-fetch');
const session = require('./session');
const schedule = require('../../schedule/schedule-data');

const DAYS = { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true };
const CATEGORIES = { bottles: true, keg: true, owk: true, bibs: true, bulk: true };
const COLOURS = {};
schedule.COLOURS.forEach(function (colour) { COLOURS[colour] = true; });

const BOOKING_RETURN = `
  id,
  to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
  day, category, start_time, end_time, customer, product, liquid_code,
  packing_format, volume, legacy_text, background_colour, version, updated_by
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
  if (!DAYS[booking.day] || !CATEGORIES[booking.category]) return { error: 'The day or category is not valid.' };
  if (!offsetsOk(booking.startTime, booking.endTime)) return { error: 'The start and finish times are not valid.' };
  const colour = String(booking.backgroundColour || '').toLowerCase();
  if (!COLOURS[colour]) return { error: 'The status colour is not valid.' };
  let volume = null;
  if (booking.volume != null && booking.volume !== '') {
    volume = Number(booking.volume);
    if (!isFinite(volume)) return { error: 'The volume is not valid.' };
  }
  return {
    booking: {
      id: id,
      weekCommencing: monday,
      day: booking.day,
      category: booking.category,
      startTime: booking.startTime,
      endTime: booking.endTime,
      customer: clean(booking.customer, 500),
      product: clean(booking.product, 500),
      liquidCode: clean(booking.liquidCode, 80),
      packingFormat: clean(booking.packingFormat, 200),
      volume: volume,
      legacyText: clean(booking.legacyText, 2000),
      backgroundColour: colour
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

async function withTransaction(work) {
  const db = await database();
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rollbackErr) { /* already failing */ }
    throw err;
  } finally {
    client.release();
  }
}

async function bump(client) {
  await client.query('UPDATE schedule_revision SET revision = revision + 1 WHERE id = 1');
}

async function enqueueWeek(client, week) {
  if (!week) return;
  await client.query(
    `INSERT INTO schedule_backup_jobs (scope, week_commencing, status)
     SELECT 'week', $1::date, 'pending'
     WHERE NOT EXISTS (
       SELECT 1 FROM schedule_backup_jobs
       WHERE scope = 'week' AND week_commencing = $1::date AND status IN ('pending', 'failed')
     )`,
    [week]
  );
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
    `SELECT to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
            night_shift, saturday_running, version, updated_by
     FROM schedule_weeks
     WHERE week_commencing >= $1::date AND week_commencing <= $2::date
     ORDER BY week_commencing`,
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
  return withTransaction(async function (client) {
    if (!expected) {
      const inserted = await client.query(
        `INSERT INTO schedule_bookings (
           id, week_commencing, day, category, start_time, end_time, customer, product,
           liquid_code, packing_format, volume, legacy_text, background_colour, version, updated_by
         ) VALUES (
           $1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1, $14
         )
         ON CONFLICT (id) DO NOTHING
         RETURNING ${BOOKING_RETURN}`,
        [
          booking.id, booking.weekCommencing, booking.day, booking.category, booking.startTime,
          booking.endTime, booking.customer, booking.product, booking.liquidCode, booking.packingFormat,
          booking.volume, booking.legacyText, booking.backgroundColour, username
        ]
      );
      if (!inserted.rowCount) {
        const current = await client.query(`SELECT ${BOOKING_RETURN} FROM schedule_bookings WHERE id = $1`, [booking.id]);
        return { ok: false, conflict: true, type: 'booking', id: booking.id, server: mapBooking(current.rows[0]) };
      }
      await bump(client);
      await enqueueWeek(client, booking.weekCommencing);
      return { ok: true, type: 'booking', action: 'upsert', id: booking.id, version: 1, record: mapBooking(inserted.rows[0]) };
    }
    const existing = await client.query(
      `SELECT ${BOOKING_RETURN} FROM schedule_bookings WHERE id = $1 FOR UPDATE`,
      [booking.id]
    );
    if (!existing.rowCount) {
      return { ok: false, conflict: true, type: 'booking', id: booking.id, server: null };
    }
    if (Number(existing.rows[0].version) !== expected) {
      return { ok: false, conflict: true, type: 'booking', id: booking.id, server: mapBooking(existing.rows[0]) };
    }
    const previousWeek = existing.rows[0].week_commencing;
    const updated = await client.query(
      `UPDATE schedule_bookings SET
         week_commencing = $2::date, day = $3, category = $4, start_time = $5, end_time = $6,
         customer = $7, product = $8, liquid_code = $9, packing_format = $10, volume = $11,
         legacy_text = $12, background_colour = $13, version = version + 1,
         updated_at = now(), updated_by = $14
       WHERE id = $1 AND version = $15
       RETURNING ${BOOKING_RETURN}`,
      [
        booking.id, booking.weekCommencing, booking.day, booking.category, booking.startTime,
        booking.endTime, booking.customer, booking.product, booking.liquidCode, booking.packingFormat,
        booking.volume, booking.legacyText, booking.backgroundColour, username, expected
      ]
    );
    if (!updated.rowCount) {
      const current = await client.query(`SELECT ${BOOKING_RETURN} FROM schedule_bookings WHERE id = $1`, [booking.id]);
      return { ok: false, conflict: true, type: 'booking', id: booking.id, server: mapBooking(current.rows[0]) };
    }
    await bump(client);
    await enqueueWeek(client, previousWeek);
    if (previousWeek !== booking.weekCommencing) await enqueueWeek(client, booking.weekCommencing);
    return { ok: true, type: 'booking', action: 'upsert', id: booking.id, version: Number(updated.rows[0].version), record: mapBooking(updated.rows[0]) };
  });
}

async function deleteBooking(op, username) {
  const id = String(op.id || '');
  const expected = Number(op.expectedVersion);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id) || !expected) {
    return { ok: false, type: 'booking', error: 'The booking could not be removed.' };
  }
  return withTransaction(async function (client) {
    const existing = await client.query(
      `SELECT ${BOOKING_RETURN} FROM schedule_bookings WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!existing.rowCount) return { ok: true, type: 'booking', action: 'delete', id: id, missing: true };
    if (Number(existing.rows[0].version) !== expected) {
      return { ok: false, conflict: true, type: 'booking', id: id, server: mapBooking(existing.rows[0]) };
    }
    await client.query('DELETE FROM schedule_bookings WHERE id = $1 AND version = $2', [id, expected]);
    await bump(client);
    await enqueueWeek(client, existing.rows[0].week_commencing);
    return { ok: true, type: 'booking', action: 'delete', id: id, version: expected };
  });
}

async function applyNote(op, username) {
  const date = String((op.note && op.note.date) || op.date || '');
  const week = noteWeek(date);
  if (!week) return { ok: false, type: 'note', error: 'The note date is not valid.' };
  const expected = Number(op.expectedVersion);
  const important = clean(op.note && op.note.important, 2000);
  const absence = clean(op.note && op.note.absence, 2000);
  return withTransaction(async function (client) {
    const existing = await client.query(
      `SELECT to_char(note_date, 'YYYY-MM-DD') AS note_date,
              to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
              important, absence, version, updated_by
       FROM schedule_day_notes WHERE note_date = $1::date FOR UPDATE`,
      [date]
    );
    if (op.action === 'delete' || (!important && !absence)) {
      if (!existing.rowCount) return { ok: true, type: 'note', action: 'delete', date: date, missing: true };
      if (Number(existing.rows[0].version) !== expected) {
        return { ok: false, conflict: true, type: 'note', date: date, server: mapNote(existing.rows[0]) };
      }
      await client.query('DELETE FROM schedule_day_notes WHERE note_date = $1::date AND version = $2', [date, expected]);
      await bump(client);
      await enqueueWeek(client, week);
      return { ok: true, type: 'note', action: 'delete', date: date, version: expected };
    }
    if (!existing.rowCount) {
      if (expected) return { ok: false, conflict: true, type: 'note', date: date, server: null };
      const inserted = await client.query(
        `INSERT INTO schedule_day_notes (note_date, week_commencing, important, absence, version, updated_by)
         VALUES ($1::date, $2::date, $3, $4, 1, $5)
         ON CONFLICT (note_date) DO NOTHING
         RETURNING to_char(note_date, 'YYYY-MM-DD') AS note_date,
                   to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
                   important, absence, version, updated_by`,
        [date, week, important, absence, username]
      );
      if (!inserted.rowCount) {
        const current = await client.query(
          `SELECT to_char(note_date, 'YYYY-MM-DD') AS note_date,
                  to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
                  important, absence, version, updated_by
           FROM schedule_day_notes WHERE note_date = $1::date`,
          [date]
        );
        return { ok: false, conflict: true, type: 'note', date: date, server: mapNote(current.rows[0]) };
      }
      await bump(client);
      await enqueueWeek(client, week);
      return { ok: true, type: 'note', action: 'upsert', date: date, version: 1, record: mapNote(inserted.rows[0]) };
    }
    if (Number(existing.rows[0].version) !== expected) {
      return { ok: false, conflict: true, type: 'note', date: date, server: mapNote(existing.rows[0]) };
    }
    const updated = await client.query(
      `UPDATE schedule_day_notes SET
         important = $2, absence = $3, version = version + 1, updated_at = now(), updated_by = $4
       WHERE note_date = $1::date AND version = $5
       RETURNING to_char(note_date, 'YYYY-MM-DD') AS note_date,
                 to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
                 important, absence, version, updated_by`,
      [date, important, absence, username, expected]
    );
    if (!updated.rowCount) {
      return { ok: false, conflict: true, type: 'note', date: date, server: mapNote(existing.rows[0]) };
    }
    await bump(client);
    await enqueueWeek(client, week);
    return { ok: true, type: 'note', action: 'upsert', date: date, version: Number(updated.rows[0].version), record: mapNote(updated.rows[0]) };
  });
}

async function applyWeek(op, username) {
  const week = op.week || {};
  const monday = requireWeek(week.weekCommencing);
  if (!monday) return { ok: false, type: 'week', error: 'The production week is not valid.' };
  const expected = Number(op.expectedVersion);
  const night = !!week.nightShift;
  const saturday = !!week.saturday;
  return withTransaction(async function (client) {
    const existing = await client.query(
      `SELECT to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
              night_shift, saturday_running, version, updated_by
       FROM schedule_weeks WHERE week_commencing = $1::date FOR UPDATE`,
      [monday]
    );
    if (!existing.rowCount) {
      if (expected) return { ok: false, conflict: true, type: 'week', weekCommencing: monday, server: null };
      const inserted = await client.query(
        `INSERT INTO schedule_weeks (week_commencing, night_shift, saturday_running, version, updated_by)
         VALUES ($1::date, $2, $3, 1, $4)
         ON CONFLICT (week_commencing) DO NOTHING
         RETURNING to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
                   night_shift, saturday_running, version, updated_by`,
        [monday, night, saturday, username]
      );
      if (!inserted.rowCount) {
        const current = await client.query(
          `SELECT to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
                  night_shift, saturday_running, version, updated_by
           FROM schedule_weeks WHERE week_commencing = $1::date`,
          [monday]
        );
        return { ok: false, conflict: true, type: 'week', weekCommencing: monday, server: mapWeek(current.rows[0]) };
      }
      await bump(client);
      await enqueueWeek(client, monday);
      return { ok: true, type: 'week', action: 'upsert', weekCommencing: monday, version: 1, record: mapWeek(inserted.rows[0]) };
    }
    if (Number(existing.rows[0].version) !== expected) {
      return { ok: false, conflict: true, type: 'week', weekCommencing: monday, server: mapWeek(existing.rows[0]) };
    }
    const updated = await client.query(
      `UPDATE schedule_weeks SET
         night_shift = $2, saturday_running = $3, version = version + 1,
         updated_at = now(), updated_by = $4
       WHERE week_commencing = $1::date AND version = $5
       RETURNING to_char(week_commencing, 'YYYY-MM-DD') AS week_commencing,
                 night_shift, saturday_running, version, updated_by`,
      [monday, night, saturday, username, expected]
    );
    if (!updated.rowCount) {
      return { ok: false, conflict: true, type: 'week', weekCommencing: monday, server: mapWeek(existing.rows[0]) };
    }
    await bump(client);
    await enqueueWeek(client, monday);
    return { ok: true, type: 'week', action: 'upsert', weekCommencing: monday, version: Number(updated.rows[0].version), record: mapWeek(updated.rows[0]) };
  });
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
    `SELECT ${BOOKING_RETURN} FROM schedule_bookings WHERE week_commencing = $1::date ORDER BY day, category, start_time, id`,
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
     FROM schedule_weeks WHERE week_commencing = $1::date`,
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
    `SELECT ${BOOKING_RETURN} FROM schedule_bookings ORDER BY week_commencing, day, category, start_time, id`
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
     FROM schedule_weeks ORDER BY week_commencing`
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
  loadYear: loadYear,
  applyOp: applyOp,
  backupSummary: backupSummary,
  runBackup: runBackup,
  requireScheduleUser: requireScheduleUser
};
