const session = require('./session');
const core = require('./scheduleCore');

exports.handler = async function (event) {
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
    const backup = await core.backupSummary();
    return session.json(200, { results: results, backup: backup });
  } catch (err) {
    console.error('Schedule save failed');
    return session.json(500, { error: 'The schedule change could not be saved.' });
  }
};
