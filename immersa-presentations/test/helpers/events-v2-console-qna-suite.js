const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { io } = require('socket.io-client');
const { createClient, consumeLink } = require('../../public/events-v2/access-client');
const { createController: createLive, targetKey } = require('../../public/events-v2/live-console');
const { createController: createQna } = require('../../public/events-v2/qna-console');
const { executionKey } = require('../../events-v2/live-runtime');

// Actual shipped modules with HTTP/SQL/Socket.IO and controlled private
// preparation. Browser rendering and Secure-cookie acceptance are separate.
async function consoleQnaSuite(t, f) {
  const { sql, request, grants, base, a, o1, preparations } = f;
  const admin = f.ids.get('admin1'), stageId = crypto.randomUUID(), otherStage = crypto.randomUUID();
  const activity = crypto.randomUUID(), otherActivity = crypto.randomUUID(), liveId = crypto.randomUUID(), otherLive = crypto.randomUUID();
  await grants.setWindow(admin, o1, a, new Date(f.now().getTime() + 2 * 86400000).toISOString());
  await sql('INSERT INTO event_stages (id,event_workspace_id,name) VALUES (?,?,?),(?,?,?)', [stageId, a, 'Q&A console', otherStage, a, 'Other Q&A console']);
  const poll = { id: 'console-poll', type: 'poll', title: 'Operator title', prompt: 'Choose one', options: [{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }], script: 'PRIVATE_SCRIPT', participants: ['PRIVATE_ACTOR'] };
  for (const [id, stage, run] of [[activity, stageId, liveId], [otherActivity, otherStage, otherLive]]) {
    await sql("INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title,deck_id,deck_check_status,access_level,status) VALUES (?,?,?,?,?,'DECK_CHECK','FREE','LIVE')", [id, a, stage, 'Q&A fixture', 'console-qna-deck']);
    await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [run, a, stage, id, 'console-qna-deck']);
    preparations.set(run, { eventId: a, liveSessionId: run, deckId: 'console-qna-deck', versionId: 'console-qna-v1', slideCount: 5, polls: [poll], knowledge: [], raffles: [], games: [], resources: [], playlists: [] });
  }
  f.setQnaClockOffset(0);
  const active = new Set();
  const close = () => { for (const client of active) client.access.close(); };
  t.after(close);
  async function until(predicate, label) {
    const end = Date.now() + 25000;
    while (!predicate()) { if (Date.now() > end) throw new Error('Console Q&A timeout: ' + label); await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  async function issue(view, kind, scope) { return { view, issued: await grants.issue(admin, o1, a, { kind, purpose: kind === 'PLAYER' ? 'player' : 'live', ...scope }) }; }
  async function audience() {
    const r = await request(null, 'POST', `/api/events-v2/public/${f.publicId}/participants`, { name: 'Q&A registered name' }); assert.equal(r.status, 201);
    return { view: 'audience', issued: { grantId: r.body.context.grantId }, cookie: r.headers.get('set-cookie').split(';')[0] };
  }
  function open(item, chosen = activity) {
    let cookie = item.cookie, live, qna; const sockets = [], commands = [];
    const link = consumeLink(new URL(`${base}/events-v2/console/${item.view}/${a}/${item.issued.grantId}` + (item.issued.token ? '#token=' + item.issued.token : '')), { replaceState() {} });
    const access = createClient({ binding: link.binding, now: () => f.now().getTime(), requestTimeoutMs: 15000, retryDelayMs: 10,
      fetch: async (url, options) => { const r = await fetch(base + url, { ...options, headers: { ...options.headers, origin: base, ...(cookie ? { cookie } : {}) } }); if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0]; return r; },
      io: (ns, options) => { const socket = io(base + ns, { ...options, extraHeaders: { origin: base }, transports: ['websocket'] }); const emit = socket.emit.bind(socket);
        socket.emit = (name, ...args) => { commands.push(name); return emit(name, ...args); }; sockets.push(socket); return socket; },
      onState: state => { qna.updateAccess(state); live.updateAccess(state); }, onEvent: (name, value) => { live.receive(name, value); qna.receive(name, value); } });
    live = createLive({ access, onState: state => qna?.updateLive(state) }); qna = createQna({ access });
    const record = { access, live, qna, sockets, commands, cookie: () => cookie,
      start: async () => { await access.start(link.token); await until(() => access.getState().status === 'ready', 'access');
        if (['stage', 'audience'].includes(item.view)) await live.select(targetKey(access.getState().targets.find(row => row.activityId === chosen))); await record.ready(); },
      ready: () => until(() => live.getState().status === 'live' && qna.getState().status === 'ready' && !qna.getState().pending, 'Q&A snapshot'),
      snapshot: () => qna.getState().snapshot };
    active.add(record); return record;
  }
  const stage = open(await issue('stage', 'STAGE', { stageId })), speaker = open(await issue('speaker', 'SPEAKER', { activityId: activity }));
  const player = open(await issue('screen', 'PLAYER', { liveSessionId: liveId })), other = open(await issue('screen', 'PLAYER', { liveSessionId: otherLive }), otherActivity);
  const attendeeItem = await audience(), attendee = open(attendeeItem), second = open(await audience());
  let round, firstQuestion, secondQuestion;
  const count = async () => Number((await sql('SELECT COUNT(*) n FROM event_v2_qna_questions WHERE qna_round_id = ?', [round]))[0].n);
  try {
    await t.test('shipped Q&A consoles read without initialization, open one canonical round and preserve poll coexistence', async () => {
      for (const c of [stage, speaker, player, other, attendee, second]) await c.start();
      assert.equal(stage.snapshot().roundId, null); assert.equal(await attendee.qna.operate('open'), false);
      assert.equal(await speaker.qna.operate('open'), true); round = speaker.snapshot().roundId;
      await until(() => attendee.snapshot()?.roundId === round && player.snapshot()?.roundId === round, 'round fanout');
      assert.equal(attendee.snapshot().displayName, 'Q&A registered name'); assert.equal(attendee.snapshot().screen, undefined); assert.equal(player.snapshot().questions, undefined);
      assert.equal((await stage.access.command('events:poll:launch', { interactionId: poll.id })).ok, true);
      assert.equal(await attendee.qna.operate('submit', { question: 'Private question', name: 'Corrected name', allowNameOnScreen: false }), true);
      firstQuestion = attendee.snapshot().questionId;
      await until(() => stage.snapshot()?.questions?.some(q => q.id === firstQuestion) && player.snapshot()?.availableQuestions?.length === 1, 'question fanout');
      assert.equal(stage.snapshot().questions[0].name, 'Corrected name'); assert.equal(JSON.stringify(player.snapshot()).includes('Private question'), false);
      assert.equal(JSON.stringify(player.snapshot()).includes('Corrected name'), false); assert.equal(second.snapshot().questionId, null);
      assert.equal(f.pollRuntime.states.get(executionKey(a, liveId)).store.getSession(executionKey(a, liveId)).active.id, poll.id);
      assert.equal(await other.qna.operate('open'), true); assert.notEqual(other.snapshot().roundId, round); assert.equal(other.snapshot().availableQuestions.length, 0);
    });
    await t.test('Q&A own receipt, saved name and cooldown survive a second tab and cookie reconnect without identity duplication', async () => {
      const same = open({ ...attendeeItem, cookie: attendee.cookie() }); await same.start();
      assert.equal(same.snapshot().questionId, firstQuestion); assert.equal(same.snapshot().displayName, 'Corrected name');
      // Keep server time fixed relative to this SQL row so slow remote SQL
      // cannot turn a cooldown test into a timing race.
      const created = (await sql('SELECT created_at FROM event_v2_qna_questions WHERE id = ?', [firstQuestion]))[0].created_at;
      f.setQnaClockOffset(new Date(created).getTime() - Date.now());
      await same.qna.refresh(); assert.equal(same.snapshot().hasSubmitted, true);
      assert.equal(await same.qna.operate('submit', { question: 'Duplicate?', allowNameOnScreen: false }), false);
      const before = {}; for (const table of ['event_participants','event_access_grants','event_live_attendance','event_live_sessions']) before[table] = Number((await sql('SELECT COUNT(*) n FROM ' + table))[0].n);
      await attendee.access.resume(); await attendee.ready(); assert.equal(attendee.snapshot().questionId, firstQuestion); assert.equal(attendee.snapshot().displayName, 'Corrected name');
      for (const table of Object.keys(before)) assert.equal(Number((await sql('SELECT COUNT(*) n FROM ' + table))[0].n), before[table]);
      assert.equal(await count(), 1); same.access.close(); f.setQnaClockOffset(0);
    });
    await t.test('real lost Q&A submit acknowledgement recovers by read without resubmitting or duplicating questions and identities', async () => {
      const socket = second.sockets.at(-1), emit = socket.emit.bind(socket); let dropped = false;
      const before = {}; for (const table of ['event_participants','event_access_grants','event_live_attendance','event_live_sessions']) before[table] = Number((await sql('SELECT COUNT(*) n FROM ' + table))[0].n);
      const actor = second.access.getState().context.actorId;
      socket.emit = (name, ...args) => { if (name === 'events:qna:submit' && !dropped) { dropped = true; args.pop(); return emit(name, ...args, () => {}); } return emit(name, ...args); };
      await second.qna.operate('submit', { question: 'Consented question', name: 'Consented name', allowNameOnScreen: true });
      await until(() => second.sockets.at(-1) !== socket && second.snapshot()?.questionId && second.qna.getState().status === 'ready', 'lost question receipt');
      secondQuestion = second.snapshot().questionId; assert.equal(second.commands.filter(n => n === 'events:qna:submit').length, 1);
      assert.equal(second.access.getState().context.actorId, actor); assert.equal(await count(), 2);
      for (const table of Object.keys(before)) assert.equal(Number((await sql('SELECT COUNT(*) n FROM ' + table))[0].n), before[table]);
    });
    await t.test('Player completes Q&A select/project/hide/intake/delete/new-round with consent, stale-round, revoke and finish isolation', async () => {
      await until(() => player.snapshot()?.availableQuestions?.length === 2, 'Player candidates');
      assert.equal(await player.qna.operate('select', { questionId: firstQuestion }), true);
      assert.equal(await player.qna.operate('project', { questionId: firstQuestion }), true); assert.equal(player.snapshot().screen.question.name, '');
      assert.equal(await player.qna.operate('project', { questionId: secondQuestion }), true); assert.equal(player.snapshot().screen.question.name, 'Consented name');
      assert.equal(await player.qna.operate('delete', { questionId: secondQuestion }), false);
      assert.equal(await player.qna.operate('panel_close'), true); assert.equal(player.snapshot().screen.visible, false); assert.equal(player.snapshot().questionsOpen, true);
      assert.equal(await player.qna.operate('set_open', { open: false }), true);
      await until(() => attendee.snapshot()?.questionsOpen === false, 'closed intake'); assert.equal(await attendee.qna.operate('submit', { question: 'Closed?', allowNameOnScreen: false }), false);
      assert.equal(await player.qna.operate('new_round'), true); const next = player.snapshot().roundId; assert.notEqual(next, round);
      const stale = await attendee.access.command('events:qna:submit', { roundId: round, question: 'Stale?', allowNameOnScreen: false }); assert.equal(stale.code, 'QNA_STALE_ROUND');
      assert.equal(await player.qna.operate('set_open', { open: true }), true); await attendee.qna.refresh();
      assert.equal(await attendee.qna.operate('submit', { question: 'Removable', name: '', allowNameOnScreen: false }), true);
      const removable = attendee.snapshot().questionId; await until(() => player.snapshot()?.availableQuestions?.some(q => q.id === removable), 'deletable candidate');
      assert.equal(await player.qna.operate('delete', { questionId: removable }), true); assert.equal(player.snapshot().availableQuestions.length, 0);
      await grants.revoke(admin, o1, a, speaker.access.getState().context.grantId); await f.grantSockets.reviewAll(); await until(() => speaker.access.getState().status === 'denied', 'revoked Q&A');
      assert.equal(speaker.snapshot(), null); assert.equal(await speaker.qna.operate('new_round'), false);
      await stage.live.operate('finish'); await until(() => attendee.snapshot() === null && player.snapshot() === null, 'finished Q&A');
      assert.equal(other.snapshot().availableQuestions.length, 0); assert.notEqual(other.snapshot().roundId, next);
    });
  } finally { close(); f.setQnaClockOffset(0); }
}
module.exports = { consoleQnaSuite };
