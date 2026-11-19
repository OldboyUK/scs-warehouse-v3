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
assert.strictEqual(nightOff[0].week.schedule, 'production');
assert.strictEqual(nightOff[0].week.weekCommencing, '2026-11-09');

const blendNight = sync.planChanges(empty, {
  blocks: [],
  dayNotes: {},
  weeks: {
    'blending|2026-11-09': {
      weekCommencing: '2026-11-09',
      schedule: 'blending',
      nightShift: true,
      saturday: false,
      version: 0
    }
  }
}, 'week');
assert.strictEqual(blendNight.length, 1);
assert.strictEqual(blendNight[0].week.schedule, 'blending');
assert.strictEqual(blendNight[0].week.weekCommencing, '2026-11-09');

const freeText = sync.planChanges(
  { blocks: [block({ schedule: 'blending', freeText: 'first' })], dayNotes: {}, weeks: {} },
  { blocks: [block({ schedule: 'blending', freeText: 'second' })], dayNotes: {}, weeks: {} },
  'block'
);
assert.strictEqual(freeText.length, 1);
assert.strictEqual(freeText[0].booking.freeText, 'second');
assert.strictEqual(freeText[0].booking.schedule, 'blending');
assert.strictEqual(freeText[0].booking.packingFormat, '');

const blendingBooking = core.checkedBooking({
  id: 'blend-0001',
  weekCommencing: '2026-11-09',
  day: 'monday',
  category: 'base_in',
  schedule: 'blending',
  startTime: '08:00',
  endTime: '10:00',
  customer: 'Atkinson Wines Ltd',
  product: 'Mango',
  liquidCode: 'ATK-MA1',
  freeText: 'Filter before blend',
  volume: 250.5,
  backgroundColour: '#ff0000'
});
assert.strictEqual(blendingBooking.booking.schedule, 'blending');
assert.strictEqual(blendingBooking.booking.category, 'base_in');
assert.strictEqual(blendingBooking.booking.freeText, 'Filter before blend');
assert.strictEqual(blendingBooking.booking.packingFormat, '');
assert.ok(core.checkedBooking(Object.assign({}, blendingBooking.booking, { category: 'bottles' })).error);
assert.ok(core.checkedBooking(Object.assign({}, blendingBooking.booking, { volume: 50 })).error);
assert.ok(core.checkedBooking(block({ category: 'base_in' })).error);
assert.strictEqual(core.checkedBooking(Object.assign({}, blendingBooking.booking, { category: 'filtering_2' })).booking.category, 'filtering_2');

const appointment = core.checkedBooking({
  id: 'appt-0001',
  weekCommencing: '2026-11-09',
  day: 'wednesday',
  category: 'warehouse_logistics',
  schedule: 'appointments',
  startTime: '18:00',
  endTime: '21:00',
  customer: 'Should not be stored',
  volume: 500,
  freeText: 'Collect samples\nGate 3',
  backgroundColour: '#ff0000'
});
assert.strictEqual(appointment.booking.schedule, 'appointments');
assert.strictEqual(appointment.booking.customer, '');
assert.strictEqual(appointment.booking.volume, null);
assert.strictEqual(appointment.booking.freeText, 'Collect samples\nGate 3');
assert.ok(core.checkedBooking(Object.assign({}, appointment.booking, { category: 'bottles' })).error);
assert.ok(core.checkedBooking(Object.assign({}, appointment.booking, { freeText: '   ' })).error);
assert.ok(core.checkedBooking(block({ category: 'scs' })).error);

const appointmentNight = sync.planChanges(empty, {
  blocks: [],
  dayNotes: {},
  weeks: {
    'appointments|2026-11-09': {
      weekCommencing: '2026-11-09',
      schedule: 'appointments',
      nightShift: true,
      saturday: false,
      version: 0
    }
  }
}, 'week');
assert.strictEqual(appointmentNight[0].week.schedule, 'appointments');
assert.strictEqual(appointmentNight[0].week.weekCommencing, '2026-11-09');

const scheduleData = require('../schedule/schedule-data');
const blendBlock = scheduleData.addBlock({
  day: 'monday',
  category: 'filtering',
  schedule: 'blending',
  startOffset: 120,
  endOffset: 240,
  customer: 'Atkinson Wines Ltd',
  product: 'Mango',
  liquidCode: 'ATK-MA1',
  freeText: 'Hold for filter',
  volume: 1000,
  backgroundColour: '#ff9900',
  weekCommencing: '2026-11-09'
});
assert.ok(blendBlock);
assert.strictEqual(blendBlock.schedule, 'blending');
assert.strictEqual(blendBlock.freeText, 'Hold for filter');
assert.ok(blendBlock.text.indexOf('Hold for filter') === -1);
assert.ok(blendBlock.text.indexOf('Atkinson Wines Ltd') !== -1);
assert.strictEqual(scheduleData.addBlock({
  day: 'monday', category: 'base_in', startOffset: 0, endOffset: 60,
  weekCommencing: '2026-11-09', volume: 100
}), null);
scheduleData.setNightManual('2026-11-09', true, 'blending');
assert.strictEqual(scheduleData.isNightManual('2026-11-09', 'blending'), true);
assert.strictEqual(scheduleData.isNightManual('2026-11-09', 'production'), false);
scheduleData.setSaturdayRunning('2026-11-09', true);
assert.strictEqual(scheduleData.isSaturdayRunning('2026-11-09', 'production'), true);
assert.strictEqual(scheduleData.isSaturdayRunning('2026-11-09', 'blending'), false);

const appointmentBlock = scheduleData.addBlock({
  day: 'tuesday',
  category: 'engineering',
  schedule: 'appointments',
  startOffset: 60,
  endOffset: 180,
  customer: 'Not stored',
  freeText: 'Boiler service\nBring permit',
  volume: 250,
  backgroundColour: '#00ffff',
  weekCommencing: '2026-11-09'
});
assert.ok(appointmentBlock);
assert.strictEqual(appointmentBlock.schedule, 'appointments');
assert.strictEqual(appointmentBlock.customer, '');
assert.strictEqual(appointmentBlock.volume, null);
assert.strictEqual(appointmentBlock.text, 'Boiler service\nBring permit');
assert.strictEqual(scheduleData.addBlock({
  day: 'tuesday', category: 'engineering', startOffset: 0, endOffset: 60,
  weekCommencing: '2026-11-09'
}), null);
scheduleData.setNightManual('2026-11-09', true, 'appointments');
assert.strictEqual(scheduleData.isNightManual('2026-11-09', 'appointments'), true);
assert.strictEqual(scheduleData.isNightManual('2026-11-09', 'production'), false);
assert.strictEqual(scheduleData.isNightManual('2026-11-09', 'blending'), true);

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
