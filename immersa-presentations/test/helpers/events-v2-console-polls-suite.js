const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { io } = require('socket.io-client');
const { createClient, consumeLink } = require('../../public/events-v2/access-client');
const { createController: createLive, targetKey } = require('../../public/events-v2/live-console');
const { createController: createPoll } = require('../../public/events-v2/poll-console');
const { executionKey } = require('../../events-v2/live-runtime');

// Actual shipped modules with HTTP/SQL/Socket.IO and controlled private
// preparation. Browser rendering and Secure-cookie acceptance are separate.
async function consolePollsSuite(t, f) {
  const { sql, request, grants, base, a, o1, preparations, pollRuntime } = f;
  const admin = f.ids.get('admin1'), stageId = crypto.randomUUID(), otherStage = crypto.randomUUID();
  const activity = crypto.randomUUID(), otherActivity = crypto.randomUUID(), liveId = crypto.randomUUID(), otherLive = crypto.randomUUID();
  await grants.setWindow(admin, o1, a, new Date(f.now().getTime() + 2 * 86400000).toISOString());
  await sql('INSERT INTO event_stages (id,event_workspace_id,name) VALUES (?,?,?),(?,?,?)', [stageId, a, 'Poll console', otherStage, a, 'Other poll console']);
  const poll = { id: 'console-poll', type: 'poll', title: 'Operator title', prompt: 'Choose one', options: [{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }], script: 'PRIVATE_SCRIPT', participants: ['PRIVATE_ACTOR'] };
  for (const [id, stage, run] of [[activity, stageId, liveId], [otherActivity, otherStage, otherLive]]) {
    await sql("INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title,deck_id,deck_check_status,access_level,status) VALUES (?,?,?,?,?,'DECK_CHECK','FREE','LIVE')", [id, a, stage, 'Poll fixture', 'console-poll-deck']);
    await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [run, a, stage, id, 'console-poll-deck']);
    preparations.set(run, { eventId: a, liveSessionId: run, deckId: 'console-poll-deck', versionId: 'console-polls-v1', slideCount: 5, polls: [poll], knowledge: [], raffles: [], games: [], resources: [], playlists: [] });
  }
  const active = new Set();
  const close = () => { for (const client of active) client.access.close(); };
  t.after(close);
  async function until(predicate, label) {
    const end = Date.now() + 25000;
    while (!predicate()) { if (Date.now() > end) throw new Error('Console polls timeout: ' + label); await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  async function issue(view, kind, scope) { return { view, issued: await grants.issue(admin, o1, a, { kind, purpose: kind === 'PLAYER' ? 'player' : 'live', ...scope }) }; }
  async function audience() {
    const r = await request(null, 'POST', `/api/events-v2/public/${f.publicId}/participants`, { name: 'Console poll participant' }); assert.equal(r.status, 201);
    return { view: 'audience', issued: { grantId: r.body.context.grantId }, cookie: r.headers.get('set-cookie').split(';')[0] };
  }
  function open(item, chosen = activity) {
    let cookie = item.cookie, live, polls; const sockets = [], commands = [];
    const link = consumeLink(new URL(`${base}/events-v2/console/${item.view}/${a}/${item.issued.grantId}` + (item.issued.token ? '#token=' + item.issued.token : '')), { replaceState() {} });
    const access = createClient({ binding: link.binding, now: () => f.now().getTime(), requestTimeoutMs: 15000, retryDelayMs: 10,
      fetch: async (url, options) => { const r = await fetch(base + url, { ...options, headers: { ...options.headers, origin: base, ...(cookie ? { cookie } : {}) } }); if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0]; return r; },
      io: (ns, options) => { const socket = io(base + ns, { ...options, extraHeaders: { origin: base }, transports: ['websocket'] }); const emit = socket.emit.bind(socket);
        socket.emit = (name, ...args) => { commands.push(name); return emit(name, ...args); }; sockets.push(socket); return socket; },
      onState: state => { polls.updateAccess(state); live.updateAccess(state); }, onEvent: (name, value) => { live.receive(name, value); polls.receive(name, value); } });
    live = createLive({ access, onState: state => polls?.updateLive(state) }); polls = createPoll({ access });
    const record = { access, live, polls, sockets, commands, cookie: () => cookie,
      start: async () => { await access.start(link.token); await until(() => access.getState().status === 'ready', 'access');
        if (['stage', 'audience'].includes(item.view)) await live.select(targetKey(access.getState().targets.find(row => row.activityId === chosen))); await record.ready(); },
      ready: () => until(() => live.getState().status === 'live' && polls.getState().status === 'ready' && !polls.getState().pending, 'poll snapshot'),
      snapshot: () => polls.getState().snapshot };
    active.add(record); return record;
  }
  const stage = open(await issue('stage', 'STAGE', { stageId })), speaker = open(await issue('speaker', 'SPEAKER', { activityId: activity }));
  const player = open(await issue('screen', 'PLAYER', { liveSessionId: liveId })), other = open(await issue('screen', 'PLAYER', { liveSessionId: otherLive }), otherActivity);
  const attendeeItem = await audience(), attendee = open(attendeeItem), second = open(await audience());
  const key = executionKey(a, liveId); let run;
  try {
    await t.test('shipped poll consoles read the prepared fixed catalog and launch one canonical run with restricted projections', async () => {
      for (const c of [stage, speaker, player, other, attendee, second]) await c.start();
      assert.equal(pollRuntime.states.has(key), false); assert.deepEqual(player.snapshot().available, [{ id: poll.id, title: poll.title }]);
      assert.equal(attendee.snapshot().available, undefined); assert.equal(await attendee.polls.operate('launch', { interactionId: poll.id }), false);
      assert.equal(await speaker.polls.operate('launch', { interactionId: poll.id }), true); run = speaker.snapshot().pollRunId;
      await until(() => attendee.snapshot()?.pollRunId === run && player.snapshot()?.pollRunId === run, 'poll fanout');
      assert.equal(player.snapshot().active.title, undefined); assert.equal(attendee.snapshot().active.title, undefined); assert.equal(attendee.snapshot().results, undefined);
      for (const c of [stage, speaker, player, attendee]) assert.equal(JSON.stringify(c.snapshot()).includes('PRIVATE'), false);
      assert.equal(await other.polls.operate('launch', { interactionId: poll.id }), true); assert.notEqual(other.snapshot().pollRunId, run);
    });
    await t.test('single public vote and own receipt survive cookie reconnect and a second tab without duplicating identity or responses', async () => {
      assert.equal(await attendee.polls.operate('submit', { optionId: 'a' }), true); assert.equal(attendee.snapshot().response.optionId, 'a');
      assert.equal(await attendee.polls.operate('submit', { optionId: 'b' }), false);
      const same = open({ ...attendeeItem, cookie: attendee.cookie() }); await same.start(); assert.equal(same.snapshot().response.optionId, 'a');
      assert.equal(await same.polls.operate('submit', { optionId: 'b' }), false);
      await attendee.access.resume(); await attendee.ready(); assert.equal(attendee.snapshot().response.optionId, 'a');
      assert.equal(second.snapshot().response, null); assert.equal(second.snapshot().results, undefined);
      await until(() => stage.snapshot()?.results?.totalResponses === 1, 'aggregate count'); assert.equal(other.snapshot().results.totalResponses, 0);
      assert.equal(pollRuntime.states.get(key).store.getSession(key).responses.size, 1); same.access.close();
    });
    await t.test('real lost vote acknowledgement recovers by snapshot without resubmitting or creating participants, grants, attendance or runs', async () => {
      const before = {}; for (const table of ['event_participants','event_access_grants','event_live_attendance','event_live_sessions']) before[table] = Number((await sql('SELECT COUNT(*) n FROM ' + table))[0].n);
      const actor = second.access.getState().context.actorId, socket = second.sockets.at(-1), emit = socket.emit.bind(socket); let dropped = false;
      socket.emit = (name, ...args) => { if (name === 'events:poll:submit' && !dropped) { dropped = true; args.pop(); return emit(name, ...args, () => {}); } return emit(name, ...args); };
      await second.polls.operate('submit', { optionId: 'b' });
      await until(() => second.sockets.at(-1) !== socket && second.snapshot()?.response?.optionId === 'b' && second.polls.getState().status === 'ready', 'lost vote receipt');
      assert.equal(second.access.getState().context.actorId, actor); assert.equal(second.commands.filter(name => name === 'events:poll:submit').length, 1);
      assert.equal(pollRuntime.states.get(key).store.getSession(key).responses.size, 2);
      for (const table of Object.keys(before)) assert.equal(Number((await sql('SELECT COUNT(*) n FROM ' + table))[0].n), before[table], table);
    });
    await t.test('Player completes hide/show/close/relaunch with new run IDs; revoke and finish clear current consoles without touching another execution', async () => {
      assert.equal(await player.polls.operate('hide'), true); assert.equal(player.snapshot().results, null);
      assert.equal(await player.polls.operate('show'), true); assert.equal(player.snapshot().results.totalResponses, 2);
      assert.equal(await player.polls.operate('close'), true); assert.equal(player.snapshot().active, null);
      await until(() => stage.snapshot()?.active === null, 'closed poll fanout');
      assert.equal(await stage.polls.operate('launch', { interactionId: poll.id }), true); const next = stage.snapshot().pollRunId; assert.notEqual(next, run);
      const before = pollRuntime.states.get(key); const rejected = await attendee.access.command('events:poll:submit', { pollRunId: run, optionId: 'a' }); assert.equal(rejected.code, 'POLL_NOT_ACTIVE'); assert.equal(pollRuntime.states.get(key), before);
      assert.equal(await player.polls.refresh(), true); assert.equal(player.snapshot().pollRunId, next); assert.equal(player.snapshot().results.totalResponses, 0);
      await grants.revoke(admin, o1, a, speaker.access.getState().context.grantId); await f.grantSockets.reviewAll(); await until(() => speaker.access.getState().status === 'denied', 'revoked poll console');
      assert.equal(speaker.snapshot(), null); assert.equal(await speaker.polls.operate('close'), false);
      await stage.live.operate('finish'); await until(() => !pollRuntime.states.has(key) && attendee.snapshot() === null && player.snapshot() === null, 'finished poll projections');
      assert.equal(other.snapshot().results.totalResponses, 0); assert.equal(pollRuntime.states.has(executionKey(a, otherLive)), true);
    });
  } finally { close(); }
}
module.exports = { consolePollsSuite };
