const session = require('./session');
const core = require('./scheduleCore');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return session.json(405, { error: 'method' });
  const gate = core.requireScheduleUser(event);
  if (gate.response) return gate.response;
  try {
    return session.json(200, await core.backupSummary());
  } catch (err) {
    console.error('Schedule backup status failed');
    return session.json(500, { error: 'The backup status could not be read.' });
  }
};
