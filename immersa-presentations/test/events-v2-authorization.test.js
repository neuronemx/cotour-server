const test = require('node:test');
const assert = require('node:assert/strict');
const { requireCapability, assertFields, accountActor } = require('../events-v2/authorization');

test('v2 preparation never grants membership delegation or implicit live control', () => {
  requireCapability({ roles: ['PRODUCER'] }, 'event.configure');
  assert.throws(() => requireCapability({ roles: ['PRODUCER'] }, 'event.members.manage'), { statusCode: 403 });
  for (const roles of [['ADMIN'], ['PRODUCER'], ['ADMIN', 'PRODUCER'], ['stage'], []]) {
    assert.throws(() => requireCapability({ roles }, 'live.control'), { statusCode: 403 });
  }
});

test('v2 effective identity cannot come from a client role or actor body', () => {
  assert.throws(() => accountActor({ body: { userId: 'admin', role: 'ADMIN' } }), { statusCode: 401 });
  assert.equal(accountActor({ accountContext: { user: { id: 'real-user' } } }), 'real-user');
  for (const body of [null, [], { title: 'x', eventId: 'B' }, { title: 'x', roles: ['ADMIN'] }]) {
    assert.throws(() => assertFields(body, ['title']), { statusCode: 400 });
  }
});
