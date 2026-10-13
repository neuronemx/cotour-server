const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { io: clientSocket } = require('socket.io-client');
const { runMigrations } = require('../../db/migrate');
const { EventDomainRepository } = require('../../events-v2/domain-repository');
const { EventGrantRepository } = require('../../events-v2/grant-repository');
const { EventRaffleRuntime } = require('../../events-v2/raffle-runtime');
const { RaffleStore } = require('../../raffle-store');
function definitions() {
  return [{ id: 'free', mode: 'free', title: 'Free raffle', prompt: 'Enter by name', options: [] },
    { id: 'poll', mode: 'poll', title: 'Poll raffle', prompt: 'Vote to participate', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] },
    { id: 'visual', mode: 'visual_key', title: 'Visual key raffle', prompt: 'Choose the marked option', entryKey: 'b',
      options: ['a', 'b', 'c', 'd'].map(id => ({ id, label: id.toUpperCase() })) }];
}
async function raffleSuite(t, f) {
  const { request, sql, grants, domain, base, o1, a, b, stageA, activityA, activityB, publicId, raffleRuntime, preparations } = f;
  const path = event => `/api/events-v2/organizations/${o1}/events/${event}`;
  const live = crypto.randomUUID(), second = crypto.randomUUID(), foreign = crypto.randomUUID();
  const stageB = (await sql('SELECT event_stage_id FROM event_activities WHERE id = ?', [activityB]))[0].event_stage_id;
  for (const [id, event, stage, activity] of [[live, a, stageA, activityA], [second, a, stageA, activityA], [foreign, b, stageB, activityB]]) {
    await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [id, event, stage, activity, 'v2-private-deck']);
    preparations.set(id, { eventId: event, liveSessionId: id, deckId: 'v2-private-deck', versionId: 'raffle-version', slideCount: 5, raffles: definitions(),
      knowledge: [{ id: 'trivia', category: 'contest', title: 'Trivia', identificationMode: 'anonymous', questionDurationSeconds: 5,
        questions: [{ id: 'q', prompt: 'Choose', correctOptionId: 'a', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }] }],
      polls: [{ id: 'poll', type: 'poll', title: 'Poll', prompt: 'Choose', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }] });
  }
  await sql('UPDATE event_activities SET access_level = ? WHERE id IN (?,?)', ['FREE', activityA, activityB]);
  let clock = 0; f.setRaffleClockOffset(clock);
  const clients = new Set(); t.after(() => { for (const client of clients) client.close(); });
  const ack = (client, name, payload = {}) => { const failure = new Error(`raffle acknowledgment failed: ${name}`); return new Promise((resolve, reject) => {
    if (!client.connected) return reject(Object.assign(failure, { cause: new Error('client already disconnected') }));
    client.timeout(7000).emit(name, payload, (error, result) => error ? reject(Object.assign(failure, { cause: error })) : resolve(result));
  }); };
  const credentials = session => ({ eventId: session.context.eventId, grantId: session.context.grantId, sessionToken: session.sessionToken });
  async function issue(kind, fields, event = a) {
    const result = await request('admin1', 'POST', path(event) + '/grants', { kind, purpose: kind === 'PLAYER' ? 'player' : 'live', ...fields }); assert.equal(result.status, 201);
    const session = await request(null, 'POST', '/api/events-v2/access/exchange', { eventId: event, token: result.body.token }); assert.equal(session.status, 200); return session.body;
  }
  async function register(name = 'Nora') { const result = await request(null, 'POST', `/api/events-v2/public/${publicId}/participants`, { name }); assert.equal(result.status, 201); return result.body; }
  async function connect(session, liveId = live) {
    const client = clientSocket(base + '/events-v2', { auth: { ...credentials(session), role: 'STAGE', participantId: 'forged', audienceLevel: 'PAID' }, extraHeaders: { origin: base }, transports: ['websocket'], forceNew: true, reconnection: false }); clients.add(client);
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('raffle context timeout')), 7000); client.once('events:context', () => { clearTimeout(timer); resolve(); }); client.once('connect_error', error => { clearTimeout(timer); reject(error); }); });
    assert.equal((await ack(client, 'events:live:join', { liveSessionId: liveId })).ok, true); return client;
  }
  const command = (client, action, data = {}) => ack(client, `events:raffle:${action}`, data);
  const snap = async client => { const result = await command(client, 'snapshot'); assert.equal(result.ok, true, JSON.stringify(result)); return result.snapshot; };
  const control = (client, action, runId) => command(client, action, { raffleRunId: runId });
  const enter = (client, runId, extra = {}) => command(client, 'enter', { raffleRunId: runId, ...extra });
  const persisted = async (liveId = live) => {
    const record = (await sql('SELECT * FROM event_v2_raffle_sessions WHERE id = ?', [liveId]))[0];
    return record ? { ...record, snapshot_json: typeof record.snapshot_json === 'string' ? JSON.parse(record.snapshot_json) : record.snapshot_json } : null;
  };
  function faultyGrants() {
    const faultyDomain = new EventDomainRepository(domain.pool);
    faultyDomain.transaction = async (_actor, _action, operation) => { const db = await domain.pool.getConnection(); try { await db.beginTransaction(); await operation(db); throw new Error('RAFFLE_TEST_COMMIT_FAILURE'); } finally { await db.rollback(); db.release(); } };
    return new EventGrantRepository(faultyDomain, { now: f.now });
  }
  async function closePresence(client) {
    const peer = f.sockets.of('/events-v2').sockets.get(client.id);
    const done = peer ? new Promise(resolve => peer.once('disconnect', resolve)) : Promise.resolve(); client.close(); await done;
  }
  function disconnected(client) {
    if (!client.connected) return Promise.resolve();
    return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('raffle disconnect timeout')), 7000); client.once('disconnect', () => { clearTimeout(timer); resolve(); }); });
  }
  let stage, speaker, player, attendee, other, spectator, stageSession, participantSession, otherSession, spectatorSession, revokedSession, revokedClient, runId;
  const beforeLegacy = (await sql('SELECT COUNT(*) n FROM presentation_sessions'))[0].n;
  await t.test('raffle migration is re-runnable; idle reads and denied roles never create a session', async () => {
    await sql("DELETE FROM schema_migrations WHERE id = '041_event_raffles.sql'");
    assert.deepEqual((await runMigrations(domain.pool)).executed, ['041_event_raffles.sql']); assert.deepEqual((await runMigrations(domain.pool)).executed, []);
    stageSession = await issue('STAGE', { stageId: stageA }); stage = await connect(stageSession);
    speaker = await connect(await issue('SPEAKER', { activityId: activityA })); player = await connect(await issue('PLAYER', { liveSessionId: live }));
    participantSession = await register(); attendee = await connect(participantSession); otherSession = await register('Bobby'); other = await connect(otherSession);
    spectatorSession = await register('Bystander'); spectator = await connect(spectatorSession);
    assert.equal((await snap(stage)).active, null); assert.equal((await snap(attendee)).displayName, 'Nora'); assert.equal((await snap(attendee)).available, undefined);
    assert.equal((await command(attendee, 'open', { definitionId: 'free' })).code, 'RAFFLE_COMMAND_DENIED'); assert.equal(await persisted(), null);
  });
  await t.test('raffle activation and entries roll back before commit; concurrent opens cannot replace an active run', async () => {
    await assert.rejects(raffleRuntime.operate(faultyGrants(), credentials(stageSession), live, 'open', { definitionId: 'free' }), /RAFFLE_TEST_COMMIT_FAILURE/);
    assert.equal(await persisted(), null);
    const replies = await Promise.all([command(stage, 'open', { definitionId: 'free' }), command(player, 'open', { definitionId: 'free' })]);
    assert.equal(replies.filter(reply => reply.ok).length, 1); assert.equal(replies.find(reply => !reply.ok).code, 'RAFFLE_ACTIVE_RAFFLE_EXISTS');
    runId = replies.find(reply => reply.ok).snapshot.raffleRunId;
    await assert.rejects(raffleRuntime.operate(faultyGrants(), credentials(participantSession), live, 'enter', { raffleRunId: runId, name: 'Uncommitted' }), /RAFFLE_TEST_COMMIT_FAILURE/);
    assert.equal((await persisted()).snapshot_json.session.active.entries.length, 0); assert.equal((await snap(attendee)).displayName, 'Nora');
  });
  await t.test('free raffle uses event identity and names, deduplicates windows and never enters bystanders', async () => {
    assert.equal((await enter(attendee, runId, { name: 'Alice' })).ok, true); await enter(other, runId);
    const unnamed = await connect(await register(null)); const beforeRejected = (await persisted()).revision;
    assert.equal((await enter(unnamed, runId)).code, 'RAFFLE_NAME_REQUIRED'); assert.equal((await persisted()).revision, beforeRejected); await closePresence(unnamed);
    const duplicate = await connect(participantSession); assert.equal((await enter(duplicate, runId, { name: '' })).ok, true);
    assert.equal((await snap(duplicate)).displayName, 'Alice'); assert.equal((await snap(duplicate)).active.ownEntry.ticketNumber, 1);
    assert.equal((await snap(stage)).active.entryCount, 2); assert.equal((await snap(spectator)).active.ownEntry, null);
    revokedSession = await register('Revoked entrant'); revokedClient = await connect(revokedSession); await enter(revokedClient, runId);
    assert.equal((await snap(player)).active.entries, undefined); assert.equal((await snap(attendee)).active.entryKey, undefined);
    assert.equal((await command(attendee, 'submit_poll_response', { raffleRunId: runId, optionId: 'yes', name: 'Rejected correction' })).code, 'RAFFLE_NOT_POLL_RAFFLE');
    assert.equal((await snap(attendee)).displayName, 'Alice');
    const stored = (await persisted()).snapshot_json.session.active.entries; assert.equal(stored[0][0], participantSession.context.participantId);
    assert.equal((await control(attendee, 'close_entries', runId)).code, 'RAFFLE_COMMAND_DENIED'); await closePresence(duplicate);
    assert.equal((await control(player, 'close_entries', runId)).ok, true);
    attendee.close(); attendee = await connect(participantSession); assert.equal((await snap(attendee)).active.ownEntry.ticketNumber, 1);
  });
  await t.test('draw revalidates connected live-bound participants in one transaction; timer reveals one persisted winner', async () => {
    await closePresence(other);
    await assert.rejects(raffleRuntime.operate(faultyGrants(), credentials(stageSession), live, 'draw', { raffleRunId: runId }), /RAFFLE_TEST_COMMIT_FAILURE/);
    assert.equal((await persisted()).snapshot_json.session.active.pendingWinner, null);
    // Revoke inside the drawing transaction while the cached socket is still
    // present: sessionOn must reject it without a nested pool connection.
    const stalePresence = { withSession: (credential, operation) => grants.withSession(credential, async (context, db, g) => {
      assert.ok(f.sockets.of('/events-v2').sockets.has(revokedClient.id));
      await db.execute('UPDATE event_access_grants SET revoked_at = ? WHERE id = ?', [f.now(), revokedSession.context.grantId]);
      return operation(context, db, g);
    }) };
    await raffleRuntime.operate(stalePresence, credentials(stageSession), live, 'draw', { raffleRunId: runId });
    const revokedGone = disconnected(revokedClient); await f.grantSockets.reviewAll(); await revokedGone;
    const chosen = (await persisted()).snapshot_json.session.active.pendingWinner; assert.equal(chosen.audienceId, participantSession.context.participantId);
    assert.equal((await snap(player)).active.hasWinner, false); assert.equal((await snap(player)).active.winner, undefined);
    assert.equal((await snap(attendee)).active.isWinner, false); assert.equal((await snap(stage)).active.winner, null);
    const rebuilt = new EventRaffleRuntime({ liveRuntime: f.runtime, readRaffles: async prepared => preparations.get(prepared.liveSessionId), now: () => f.raffleClockStart() + clock });
    const restored = await grants.withSession(credentials(stageSession), (context, db) => rebuilt.projection(context, db, live)); assert.equal(restored.active.revealAt, (await snap(stage)).active.revealAt);
    const originalReader = rebuilt.readRaffles; rebuilt.readRaffles = async prepared => ({ ...preparations.get(prepared.liveSessionId), versionId: 'foreign-version' });
    await assert.rejects(grants.withSession(credentials(stageSession), (context, db) => rebuilt.projection(context, db, live)), { code: 'RAFFLE_CONTENT_NOT_PREPARED' });
    rebuilt.readRaffles = async prepared => ({ ...preparations.get(prepared.liveSessionId), raffles: definitions().map(item => ({ ...item, title: 'Changed without a version' })) });
    await assert.rejects(grants.withSession(credentials(stageSession), (context, db) => rebuilt.projection(context, db, live)), { code: 'CONTENT_VERSION_CHANGED' }); rebuilt.readRaffles = originalReader;
    let fire, notifications = 0; const driver = new EventRaffleRuntime({ liveRuntime: f.runtime, readRaffles: rebuilt.readRaffles, now: rebuilt.now,
      setTimeoutFn: callback => { fire = callback; return { unref() {} }; }, clearTimeoutFn: () => {} });
    driver.connected = raffleRuntime.connected; driver.notify = async () => { notifications++; };
    await driver.operate(grants, credentials(stageSession), live, 'tick'); clock += 5001; f.setRaffleClockOffset(clock); await fire(); driver.close();
    assert.equal(notifications, 1); const winner = (await snap(player)).active.winner; assert.equal(winner.name, 'Alice'); assert.equal(winner.audienceId, undefined);
    assert.equal((await snap(attendee)).active.isWinner, true); assert.equal((await snap(spectator)).active.isWinner, false);
    assert.equal((await persisted()).snapshot_json.session.winners.length, 1); assert.equal((await control(player, 'reset_winners', runId)).code, 'RAFFLE_INVALID_STATE');
    assert.equal((await control(player, 'close', runId)).ok, true);
  });
  await t.test('winner exclusion, reset and close cancel pending reveal; stale IDs cannot enter a new run', async () => {
    const opened = await command(player, 'open', { definitionId: 'free' }); const next = opened.snapshot.raffleRunId;
    assert.equal((await enter(attendee, runId)).code, 'RAFFLE_STALE_EXECUTION'); await enter(attendee, next);
    other = await connect(otherSession); await enter(other, next); await control(player, 'close_entries', next);
    assert.equal((await snap(stage)).active.eligibleCount, 1); assert.equal((await snap(stage)).previousWinnerCount, 1);
    assert.equal((await control(player, 'reset_winners', next)).ok, true); assert.equal((await snap(stage)).active.eligibleCount, 2);
    await control(player, 'draw', next); await control(player, 'close', next); clock += 5001; f.setRaffleClockOffset(clock);
    assert.equal((await snap(stage)).active, null); assert.equal((await snap(stage)).winners.length, 0); runId = next;
  });
  await t.test('poll and visual-key raffle retain their actual machines and private projections through a full Player cycle', async () => {
    let opened = await command(player, 'open', { definitionId: 'poll' }), run = opened.snapshot.raffleRunId;
    assert.equal((await enter(attendee, run, { optionId: 'yes' })).code, 'RAFFLE_USE_POLL_RESPONSE');
    assert.equal((await command(attendee, 'submit_poll_response', { raffleRunId: run, optionId: 'yes' })).ok, true);
    assert.equal((await command(attendee, 'submit_poll_response', { raffleRunId: run, optionId: 'no' })).code, 'RAFFLE_DUPLICATE_ENTRY');
    assert.equal((await snap(stage)).active.pollResults.totalResponses, 1); assert.equal((await snap(player)).active.pollResults, undefined); assert.equal((await snap(spectator)).active.ownEntry, null);
    await control(player, 'close_entries', run); await control(player, 'draw', run); await control(player, 'reveal', run); await control(player, 'close', run);
    assert.equal((await command(player, 'configure_key', { definitionId: 'visual', optionId: 'c' })).ok, true);
    opened = await command(player, 'open', { definitionId: 'visual' }); run = opened.snapshot.raffleRunId;
    assert.equal(opened.snapshot.active.displayOptionId, 'c'); assert.equal((await snap(attendee)).active.entryKey, undefined);
    assert.equal((await command(player, 'configure_key', { definitionId: 'visual', optionId: 'a' })).code, 'RAFFLE_ACTIVE_RAFFLE_EXISTS');
    await enter(attendee, run, { optionId: 'a' }); await enter(attendee, run, { optionId: 'c' }); await enter(other, run, { optionId: 'b' });
    assert.equal((await snap(attendee)).active.ownSelection.selectedOptionId, 'c'); assert.equal((await snap(attendee)).active.ownEntry, null);
    await control(player, 'close_entries', run); assert.equal((await snap(stage)).active.entryCount, 1); await control(player, 'reset_winners', run);
    await control(player, 'draw', run); await control(player, 'reveal', run); assert.equal((await snap(player)).active.winner.name, 'Alice');
    await control(player, 'close', run); runId = run;
  });
  await t.test('raffles exclude polls and Knowledge, coexist with Q&A, isolate other executions/events and reject legacy/forged packets', async () => {
    const opened = await command(player, 'open', { definitionId: 'free' }), run = opened.snapshot.raffleRunId;
    assert.equal((await ack(stage, 'events:poll:launch', { interactionId: 'poll' })).code, 'INTERACTION_BUSY');
    assert.equal((await ack(stage, 'events:knowledge:open', { definitionId: 'trivia' })).code, 'INTERACTION_BUSY'); assert.equal((await ack(stage, 'events:qna:open')).ok, true);
    const secondPlayer = await connect(await issue('PLAYER', { liveSessionId: second }), second), foreignPlayer = await connect(await issue('PLAYER', { liveSessionId: foreign }, b), foreign);
    let foreignEmits = 0; foreignPlayer.on('events:raffle:state', () => { foreignEmits++; });
    assert.equal((await snap(secondPlayer)).active, null); assert.equal((await snap(foreignPlayer)).active, null); foreignEmits = 0;
    const secondRun = await command(secondPlayer, 'open', { definitionId: 'free' }); assert.equal(secondRun.ok, true);
    assert.equal((await control(secondPlayer, 'close', run)).code, 'RAFFLE_STALE_EXECUTION'); await control(secondPlayer, 'close', secondRun.snapshot.raffleRunId); await snap(secondPlayer); assert.equal(foreignEmits, 0);
    await control(player, 'close', run);
    const races = await Promise.all([command(player, 'open', { definitionId: 'free' }), ack(stage, 'events:poll:launch', { interactionId: 'poll' })]); assert.equal(races.filter(reply => reply.ok).length, 1);
    if (races[0].ok) await control(player, 'close', races[0].snapshot.raffleRunId); else await ack(stage, 'events:poll:close', { pollRunId: races[1].snapshot.pollRunId });
    const knowledge = await ack(stage, 'events:knowledge:open', { definitionId: 'trivia' }); assert.equal(knowledge.ok, true);
    assert.equal((await command(player, 'open', { definitionId: 'free' })).code, 'INTERACTION_BUSY'); await ack(stage, 'events:knowledge:cancel', { executionId: knowledge.snapshot.execution.executionId, expectedRevision: knowledge.snapshot.execution.revision });
    const forged = await connect(participantSession); const gone = disconnected(forged); const before = (await persisted()).revision;
    assert.equal((await enter(forged, runId, { participantId: 'forged', name: 'Rejected' })).ok, false); await gone; assert.equal((await persisted()).revision, before);
    const raw = await connect(participantSession), legacyDenied = new Promise(resolve => raw.once('events:command_denied', resolve)); raw.emit('raffle:create', { mode: 'free', entries: ['external list'] }); assert.equal((await legacyDenied).code, 'COMMAND_NOT_ENABLED'); raw.close();
    assert.equal((await sql('SELECT COUNT(*) n FROM presentation_sessions'))[0].n, beforeLegacy);
    assert.equal(new RaffleStore().getControllerState(live).winners.length, 0); secondPlayer.close(); foreignPlayer.close();
  });
  await t.test('pending winner losing access stays private without resampling; outage, kill switch and live finish deny writes/delivery', async () => {
    const newActor = await register('Pending winner'), candidate = await connect(newActor);
    const opened = await command(player, 'open', { definitionId: 'free' }), run = opened.snapshot.raffleRunId;
    await enter(candidate, run); await control(player, 'close_entries', run); await control(player, 'reset_winners', run);
    const previousWinners = (await persisted()).snapshot_json.session.winners.length; await control(player, 'draw', run);
    const selected = (await persisted()).snapshot_json.session.active.pendingWinner;
    const gone = disconnected(candidate); await request('admin1', 'DELETE', path(a) + '/grants/' + newActor.context.grantId); await gone;
    clock += 5001; f.setRaffleClockOffset(clock); const hidden = await snap(player); assert.equal(hidden.active.state, 'drawing'); assert.equal(hidden.active.hasWinner, false);
    assert.equal((await control(player, 'reveal', run)).code, 'RAFFLE_WINNER_NOT_CONNECTED'); assert.deepEqual((await persisted()).snapshot_json.session.active.pendingWinner, selected);
    assert.equal((await persisted()).snapshot_json.session.winners.length, previousWinners);
    await control(player, 'close', run);
    const before = (await persisted()).revision;
    const broken = { withSession: async () => { throw new Error('raffle database unavailable'); } }; await assert.rejects(raffleRuntime.operate(broken, credentials(stageSession), live, 'open', { definitionId: 'free' }), /database unavailable/);
    const killed = disconnected(player); f.setEnabled(false); await assert.rejects(raffleRuntime.operate(grants, credentials(stageSession), live, 'open', { definitionId: 'free' }));
    await f.grantSockets.reviewAll(); await killed; f.setEnabled(true); assert.equal((await persisted()).revision, before);
    player.close(); player = await connect(await issue('PLAYER', { liveSessionId: live })); spectator.close(); spectator = await connect(spectatorSession);
    let emissions = 0; spectator.on('events:raffle:state', () => { emissions++; }); const publicGone = disconnected(spectator);
    await sql("UPDATE event_activities SET access_level = 'PAID' WHERE id = ?", [activityA]); await f.grantSockets.reviewAll(); await publicGone; emissions = 0; await snap(player); assert.equal(emissions, 0);
    const playerGone = disconnected(player); await sql("UPDATE event_live_sessions SET status = 'FINISHED', ended_at = CURRENT_TIMESTAMP WHERE id = ?", [live]);
    await assert.rejects(raffleRuntime.operate(grants, credentials(stageSession), live, 'tick')); await f.grantSockets.reviewAll(); await playerGone;
    assert.equal((await persisted()).revision, before); raffleRuntime.close(); await sql("UPDATE event_activities SET access_level = 'FREE' WHERE id = ?", [activityA]);
  });
}
module.exports = { raffleSuite, definitions };
