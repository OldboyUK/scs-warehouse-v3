const assert = require('assert');
const session = require('../netlify/functions/session');
const sync = require('../schedule/schedule-sync');
const core = require('../netlify/functions/scheduleCore');

process.env.SCS_SESSION_SECRET = 'test-secret-which-is-long-enough';

function block(patch) {
  return Object.assign({
    id: 'block-0001',
    weekCommencing: '2026-11-09',
    day: 'monday',
    category: 'bottles',
    startTime: '14:00',
    endTime: '16:00',
    customer: 'Thatchers',
    product: 'Gold',
    liquidCode: 'THA-GO1',
    packingFormat: 'Bottle',
    volume: 1000,
    legacyText: '',
    backgroundColour: '#ff0000',
    version: 1
  }, patch);
}

const empty = { blocks: [], dayNotes: {}, weeks: {} };

assert.strictEqual(session.verifySession(''), null);
assert.strictEqual(session.verifySession('nope'), null);

const token = session.signSession('Alex');
const user = session.verifySession(token);
assert.strictEqual(user.username, 'Alex');
assert.ok(user.expiresAt > Date.now());

const expired = session.signSession('Alex', Date.now() - 1000);
assert.strictEqual(session.verifySession(expired), null);

const tampered = token.slice(0, -3) + 'abc';
assert.strictEqual(session.verifySession(tampered), null);

const cookie = session.cookieHeader(token, true);
assert.ok(cookie.indexOf('HttpOnly') !== -1);
assert.ok(cookie.indexOf('Secure') !== -1);
const read = session.readCookie({ headers: { cookie: 'other=1; ' + cookie.split(';')[0] } }, 'scs_session');
assert.strictEqual(session.verifySession(read).username, 'Alex');
const commaJoined = session.readCookie({
  headers: { cookie: 'nf_ab=1, ' + cookie.split(';')[0] }
}, 'scs_session');
assert.strictEqual(session.verifySession(commaJoined).username, 'Alex');
const fromList = session.readCookie({ cookies: [cookie.split(';')[0]] }, 'scs_session');
assert.strictEqual(session.verifySession(fromList).username, 'Alex');
assert.strictEqual(session.requireUser({ headers: {} }), null);

const created = sync.planChanges(empty, { blocks: [block({ version: 0 })], dayNotes: {}, weeks: {} }, 'block');
assert.strictEqual(created.length, 1);
assert.strictEqual(created[0].action, 'upsert');
assert.strictEqual(created[0].expectedVersion, 0);

const moved = sync.planChanges(
  { blocks: [block()], dayNotes: {}, weeks: {} },
  { blocks: [block({ weekCommencing: '2026-11-16', day: 'tuesday' })], dayNotes: {}, weeks: {} },
  'block'
);
assert.strictEqual(moved.length, 1);
assert.strictEqual(moved[0].booking.weekCommencing, '2026-11-16');
assert.strictEqual(moved[0].expectedVersion, 1);
assert.strictEqual(moved[0].previousWeek, '2026-11-09');

const removed = sync.planChanges(
  { blocks: [block()], dayNotes: {}, weeks: {} },
  empty,
  'block'
);
assert.strictEqual(removed[0].action, 'delete');
assert.strictEqual(sync.planChanges({ blocks: [block()], dayNotes: {}, weeks: {} }, empty, 'notes').length, 0);

const noted = sync.planChanges(empty, {
  blocks: [],
  dayNotes: { '2026-11-09': { weekCommencing: '2026-11-09', important: 'Tasting', absence: '', version: 0 } },
  weeks: {}
}, 'notes');
assert.strictEqual(noted.length, 1);
assert.strictEqual(noted[0].note.important, 'Tasting');

const cleared = sync.planChanges({
  blocks: [],
  dayNotes: { '2026-11-09': { weekCommencing: '2026-11-09', important: 'Tasting', absence: '', version: 2 } },
  weeks: {}
}, empty, 'notes');
assert.strictEqual(cleared[0].action, 'delete');
assert.strictEqual(cleared[0].expectedVersion, 2);

const night = sync.planChanges(empty, {
  blocks: [],
  dayNotes: {},
  weeks: { '2026-11-09': { weekCommencing: '2026-11-09', nightShift: true, saturday: false, version: 0 } }
}, 'week');
assert.strictEqual(night.length, 1);
assert.strictEqual(night[0].expectedVersion, 0);
assert.strictEqual(sync.planChanges(empty, empty, 'week').length, 0);

const nightOff = sync.planChanges({
  blocks: [],
  dayNotes: {},
  weeks: { '2026-11-09': { weekCommencing: '2026-11-09', nightShift: true, saturday: false, version: 3 } }
}, {
  blocks: [],
  dayNotes: {},
  weeks: { '2026-11-09': { weekCommencing: '2026-11-09', nightShift: false, saturday: false, version: 3 } }
}, 'week');
assert.strictEqual(nightOff[0].expectedVersion, 3);
assert.strictEqual(nightOff[0].week.nightShift, false);

assert.strictEqual(core.sheetShouldWrite(2, 4), true);
assert.strictEqual(core.sheetShouldWrite(4, 4), true);
assert.strictEqual(core.sheetShouldWrite(5, 4), false);

const handlers = require('../netlify/lib/scheduleHandlers');
const yearFn = { handler: handlers.year };
const mutateFn = { handler: handlers.mutate };
const statusFn = { handler: handlers.backupStatus };

Promise.all([
  yearFn.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { year: '2026' } }),
  mutateFn.handler({ httpMethod: 'POST', headers: {}, body: '{"ops":[]}' }),
  statusFn.handler({ httpMethod: 'GET', headers: {} }),
  yearFn.handler({
    httpMethod: 'GET',
    headers: { cookie: session.cookieHeader(expired, false) },
    queryStringParameters: { year: '2026' }
  })
]).then(function (responses) {
  responses.forEach(function (response) {
    assert.strictEqual(response.statusCode, 401);
    assert.strictEqual(JSON.parse(response.body).error, 'unauthorised');
  });
  console.log('schedule server checks passed');
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
