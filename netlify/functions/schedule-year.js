const session = require('./session');
const core = require('./scheduleCore');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return session.json(405, { error: 'method' });
  const gate = core.requireScheduleUser(event);
  if (gate.response) return gate.response;
  const year = Number(event.queryStringParameters && event.queryStringParameters.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return session.json(400, { error: 'The production year is not valid.' });
  }
  try {
    const payload = await core.loadYear(year);
    if (!payload) return session.json(400, { error: 'That production year has no weeks.' });
    return session.json(200, payload);
  } catch (err) {
    console.error('Schedule year load failed');
    return session.json(500, { error: 'The schedule could not be loaded.' });
  }
};
