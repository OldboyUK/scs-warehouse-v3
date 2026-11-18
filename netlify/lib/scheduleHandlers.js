const session = require('../functions/session');
const core = require('../functions/scheduleCore');

async function year(event) {
  if (event.httpMethod !== 'GET') return session.json(405, { error: 'method' });
  const gate = core.requireScheduleUser(event);
  if (gate.response) return gate.response;
  const yearValue = Number(event.queryStringParameters && event.queryStringParameters.year);
  if (!Number.isInteger(yearValue) || yearValue < 2000 || yearValue > 2100) {
    return session.json(400, { error: 'The production year is not valid.' });
  }
  try {
    const payload = await core.loadYear(yearValue);
    if (!payload) return session.json(400, { error: 'That production year has no weeks.' });
    return session.json(200, payload);
  } catch (err) {
    console.error('Schedule year load failed', String(err && err.message || err).replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 300));
    return session.json(500, { error: 'The schedule could not be loaded.' });
  }
}

async function mutate(event) {
  if (event.httpMethod !== 'POST') return session.json(405, { error: 'method' });
  const gate = core.requireScheduleUser(event);
  if (gate.response) return gate.response;
  if ((event.body || '').length > 100000) return session.json(413, { error: 'The change is too large.' });
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return session.json(400, { error: 'The change could not be read.' });
  }
  const ops = Array.isArray(body.ops) ? body.ops.slice(0, 20) : null;
  if (!ops) return session.json(400, { error: 'No schedule changes were sent.' });
  try {
    const results = [];
    for (let i = 0; i < ops.length; i++) {
      results.push(await core.applyOp(ops[i], gate.user.username));
    }
    let backup = { configured: false, pending: 0, failed: 0 };
    try {
      backup = await core.backupSummary();
    } catch (err) {
      console.error('Schedule backup status failed', String(err && err.message || err).replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 300));
    }
    return session.json(200, { results: results, backup: backup });
  } catch (err) {
    console.error('Schedule save failed', String(err && err.message || err).replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 300));
    return session.json(500, { error: 'The schedule change could not be saved.' });
  }
}

async function backupStatus(event) {
  if (event.httpMethod !== 'GET') return session.json(405, { error: 'method' });
  const gate = core.requireScheduleUser(event);
  if (gate.response) return gate.response;
  try {
    return session.json(200, await core.backupSummary());
  } catch (err) {
    console.error('Schedule backup status failed', String(err && err.message || err).replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 300));
    return session.json(500, { error: 'The backup status could not be read.' });
  }
}

async function backup() {
  try {
    await core.runBackup();
  } catch (err) {
    console.error('Schedule backup run failed', String(err && err.message || err).replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 300));
  }
  return { statusCode: 200, body: '' };
}

module.exports = { year: year, mutate: mutate, backupStatus: backupStatus, backup: backup };
