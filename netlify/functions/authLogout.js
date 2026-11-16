const session = require('./session');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return session.json(405, { error: 'method' });
  }
  return session.json(200, { result: 'ok' }, {
    'Set-Cookie': session.clearCookieHeader(session.requestIsSecure(event))
  });
};
