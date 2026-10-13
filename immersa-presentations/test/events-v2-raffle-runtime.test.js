const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { RaffleStore } = require('../raffle-store');
const { EventRaffleRuntime, normalizeRaffles, pack, unpack } = require('../events-v2/raffle-runtime');
const { definitions } = require('./helpers/events-v2-raffle-suite');

test('raffle preparation rejects duplicate choices, legacy assets and invalid visual key instead of repairing them', () => {
  const source = definitions()[2];
  for (const definitions of [[source, source], [{ ...source, entryKey: '' }], [{ ...source, options: [source.options[0], source.options[0], source.options[1], source.options[2]] }],
    [{ ...source, options: source.options.map(option => ({ ...option, asset: '/decks/private/file.png' })) }]]) {
    assert.throws(() => normalizeRaffles(definitions), { code: 'RAFFLE_CONTENT_NOT_PREPARED' });
  }
  assert.equal(normalizeRaffles([{ ...source, script: 'PRIVATE', entries: ['external'] }])[0].script, undefined);
});
test('SQL snapshot reconstruction keeps pending choice, own entry and winner exclusion without exposing an engine cache', () => {
  const key = 'event-live', actor = crypto.randomUUID(), runId = crypto.randomUUID(), store = new RaffleStore(() => 0, { now: () => 1000 });
  store.create({ sessionId: key, config: { ...definitions()[0], id: runId } }); store.enter({ sessionId: key, audienceId: actor, name: 'Alice' }); store.closeEntries(key); store.drawWinner(key, [actor], { nowMs: 1000 });
  const body = { latestRunId: runId, definitionId: 'free', draftDefinitionId: null };
  const restored = unpack(JSON.stringify(pack(body, store, key)), key, () => 0, () => 6001).store;
  assert.equal(restored.getActive(key).pendingWinner.audienceId, actor); assert.equal(restored.getAudienceState(key, actor).active.ownEntry.ticketNumber, 1);
  restored.revealWinner(key, { nowMs: 6001 }); restored.close(key); restored.create({ sessionId: key, config: { ...definitions()[0], id: crypto.randomUUID() } }); restored.enter({ sessionId: key, audienceId: actor, name: 'Alice' }); restored.closeEntries(key);
  assert.equal(restored.getControllerState(key).active.eligibleCount, 0);
});
test('raffle DTO omits roster/keys/pending winner for Player and sends each participant only its own receipt', async () => {
  const key = 'event-live', first = crypto.randomUUID(), other = crypto.randomUUID(), runId = crypto.randomUUID(), store = new RaffleStore(() => 0);
  store.create({ sessionId: key, config: { ...definitions()[0], id: runId } }); store.enter({ sessionId: key, audienceId: first, name: 'Alice' }); store.enter({ sessionId: key, audienceId: other, name: 'Other' }); store.closeEntries(key); store.drawWinner(key, [first], { nowMs: 1000 });
  const runtime = new EventRaffleRuntime({ liveRuntime: {}, now: () => 1000 }); runtime.scope = async () => ({ key, record: { revision: 1 }, body: { latestRunId: runId }, store, definitions: normalizeRaffles(definitions()) }); runtime.name = async () => 'Saved';
  const player = await runtime.projection({ kind: 'PLAYER', eventId: 'event' }, {}, 'live'); assert.equal(player.active.entries, undefined); assert.equal(player.active.entryKey, undefined); assert.equal(player.active.winner, undefined); assert.equal(JSON.stringify(player).includes('Alice'), false);
  const audience = await runtime.projection({ kind: 'PARTICIPANT', participantId: other, eventId: 'event' }, {}, 'live'); assert.equal(audience.active.ownEntry.name, 'Other'); assert.equal(JSON.stringify(audience).includes('Alice'), false);
  store.revealWinner(key, { nowMs: 6000 }); const revealed = await runtime.projection({ kind: 'PLAYER', eventId: 'event' }, {}, 'live'); assert.equal(revealed.active.winner.name, 'Alice'); assert.equal(revealed.active.winner.audienceId, undefined);
});
test('read-only projections and denied grants cannot initialize persistent raffle state', async () => {
  let reads = 0;
  const runtime = new EventRaffleRuntime({ liveRuntime: { serial: async (_key, operation) => operation() } }); runtime.scope = async () => { reads++; throw new Error('private reader'); };
  await assert.rejects(runtime.operate({ withSession: async () => { throw new Error('revoked'); } }, { eventId: 'event' }, 'live', 'open', { definitionId: 'free' }), /revoked/); assert.equal(reads, 0);
});
test('revoked deadline witnesses cannot notify and valid controller fallback remains scoped', async () => {
  let fire, notifications = 0; const tried = [];
  const runtime = new EventRaffleRuntime({ liveRuntime: {}, now: () => 1000, setTimeoutFn: callback => { fire = callback; return 1; }, clearTimeoutFn: () => {} });
  runtime.notify = async () => { notifications++; };
  runtime.operate = async (_grants, credential) => { tried.push(credential.grantId); if (credential.grantId === 'revoked') throw new Error('revoked'); };
  const active = { state: 'drawing', revealAt: new Date(6000).toISOString() };
  runtime.schedule('event-live', active, {}, { grantId: 'valid' }, 'live', 'PLAYER'); runtime.schedule('event-live', active, {}, { grantId: 'revoked' }, 'live', 'STAGE'); await fire(); assert.deepEqual(tried, ['revoked', 'valid']); assert.equal(notifications, 1);
  runtime.close();
});
test('serialized corruption fails closed and the injected server clock governs entry/close timestamps', () => {
  assert.throws(() => unpack('{"format":"unknown","session":{}}', 'live', null, Date.now), { code: 'RAFFLE_STATE_INVALID' });
  const store = new RaffleStore(() => 0, { now: () => 1000 }); const actor = crypto.randomUUID();
  store.create({ sessionId: 'live', config: definitions()[0] }); store.enter({ sessionId: 'live', audienceId: actor, name: 'Alice' }); store.closeEntries('live');
  assert.equal(store.getActive('live').createdAt, new Date(1000).toISOString()); assert.equal(store.getActive('live').entries.get(actor).enteredAt, new Date(1000).toISOString()); assert.equal(store.getActive('live').entriesClosedAt, new Date(1000).toISOString());
});
