const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { io } = require('socket.io-client');
const { createClient, consumeLink } = require('../../public/events-v2/access-client');
const { createController: createLive, targetKey } = require('../../public/events-v2/live-console');
const { createGameController, createTimeController } = require('../../public/events-v2/game-time-console');

// Shipped controllers with actual HTTP/SQL/Socket.IO, controlled private
// preparation and a fixed engine clock. This is not browser acceptance.
async function consoleGameTimeSuite(t, f) {
  const { sql, request, grants, base, a, o1, preparations } = f;
  const admin = f.ids.get('admin1'), stageId = crypto.randomUUID(), otherStage = crypto.randomUUID();
  const activity = crypto.randomUUID(), otherActivity = crypto.randomUUID(), liveId = crypto.randomUUID(), otherLive = crypto.randomUUID();
  await grants.setWindow(admin, o1, a, new Date(f.now().getTime() + 2 * 86400000).toISOString());
  await sql('INSERT INTO event_stages (id,event_workspace_id,name) VALUES (?,?,?),(?,?,?)', [stageId, a, 'Game/Time console', otherStage, a, 'Other Game/Time console']);
  for (const [id, stage, run] of [[activity, stageId, liveId], [otherActivity, otherStage, otherLive]]) {
    await sql("INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title,deck_id,deck_check_status,access_level,status) VALUES (?,?,?,?,?,'DECK_CHECK','FREE','LIVE')", [id, a, stage, 'GameTime fixture', 'console-gameTime-deck']);
    await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [run, a, stage, id, 'console-gameTime-deck']);
    preparations.set(run, { eventId: a, liveSessionId: run, deckId: 'console-gameTime-deck', versionId: 'console-gameTime-v1', slideCount: 5,
      raffles: [], polls: [{ id: 'poll', type: 'poll', title: 'Poll', prompt: 'Choose', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }], knowledge: [], games: [{id:'breakout',durationMs:1000},{id:'pong',durationMs:1000}], resources: [], playlists: [] });
  }
  let clock = 0; f.setGameClockOffset(clock);
  const active = new Set();
  const close = () => { for (const c of active) c.access.close(); };
  t.after(close);
  async function until(predicate, label) {
    const end = Date.now() + 25000;
    while (!predicate()) { if (Date.now() > end) throw new Error('Console GameTime timeout: ' + label); await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  async function issue(view, kind, scope) { return { view, issued: await grants.issue(admin, o1, a, { kind, purpose: kind === 'PLAYER' ? 'player' : 'live', ...scope }) }; }
  function open(item, chosen = activity) {
    let cookie = item.cookie, live, game, time; const sockets = [], commands = [];
    const link = consumeLink(new URL(`${base}/events-v2/console/${item.view}/${a}/${item.issued.grantId}` + (item.issued.token ? '#token=' + item.issued.token : '')), { replaceState() {} });
    const access = createClient({ binding: link.binding, now: () => f.now().getTime(), requestTimeoutMs: 15000, retryDelayMs: 10,
      fetch: async (url, options) => { const r = await fetch(base + url, { ...options, headers: { ...options.headers, origin: base, ...(cookie ? { cookie } : {}) } }); if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0]; return r; },
      io: (ns, options) => { const socket = io(base + ns, { ...options, extraHeaders: { origin: base }, transports: ['websocket'], forceNew: true }); const emit = socket.emit.bind(socket);
        socket.emit = (name, ...args) => { commands.push(name); return emit(name, ...args); }; sockets.push(socket); return socket; },
      onState: state => { game.updateAccess(state); time.updateAccess(state); live.updateAccess(state); }, onEvent: (name, value) => { live.receive(name, value); game.receive(name, value); time.receive(name, value); } });
    live = createLive({ access, onState: state => { game?.updateLive(state); time?.updateLive(state); } }); game = createGameController({ access }); time = createTimeController({ access });
    const record = { access, live, game, time, sockets, commands, cookie: () => cookie,
      start: async () => { await access.start(link.token); await until(() => access.getState().status === 'ready', 'access');
        if (['stage', 'audience'].includes(item.view)) await live.select(targetKey(access.getState().targets.find(row => row.activityId === chosen))); await record.ready(); },
      ready: () => until(() => live.getState().status === 'live' && game.getState().status === 'ready' && !game.getState().pending && time.getState().status === 'ready' && !time.getState().pending, 'snapshot'),
      snapshot: () => game.getState().snapshot, run: () => game.getState().snapshot?.game };
    active.add(record); return record;
  }
  const speaker=open(await issue('speaker','SPEAKER',{activityId:activity}));
  const player=open(await issue('screen','PLAYER',{liveSessionId:liveId}));
  async function register(name){const registered=await request(null,'POST',`/api/events-v2/public/${f.publicId}/participants`,{name});assert.equal(registered.status,201);return {view:'audience',issued:{grantId:registered.body.context.grantId},cookie:registered.headers.get('set-cookie').split(';')[0]};}
  const attendeeItem=await register('Game participant'),attendee=open(attendeeItem);let second;
  async function act(client,action,input={},family='game'){await client.ready();const c=client[family];assert.equal(await c.operate(action,input),true,JSON.stringify({action,family,state:c.getState(),access:client.access.getState().status}));}
  async function playerAction(action,family='game',predicate=()=>true){await player.ready();const item=player[family].emergencyActions().find(x=>x.action===action&&predicate(x));assert.ok(item,action);await act(player,action,item.input,family);}
  async function read(client,family='game'){await client.ready();assert.equal(await client[family].refresh(),true);}
  try{
    await t.test('shipped Games/Time consoles keep reads private, recover a lost queue-start ack without replay and complete Breakout controls',async()=>{
      const beforeStates=[f.gameRuntime.states.size,f.timeRuntime.states.size];await speaker.start();await player.start();assert.deepEqual([f.gameRuntime.states.size,f.timeRuntime.states.size],beforeStates);
      assert.equal(player.time.getState().snapshot.speaker,undefined);assert.equal(player.run(),null);
      await act(speaker,'start',{target:'speaker'},'time');await act(speaker,'configure',{selected:['pong','breakout']});assert.deepEqual(speaker.snapshot().queue.selected,['breakout','pong']);
      const before={};for(const table of ['event_participants','event_access_grants','event_live_attendance','event_live_sessions'])before[table]=Number((await sql('SELECT COUNT(*) n FROM '+table))[0].n);
      const socket=speaker.sockets.at(-1),emit=socket.emit.bind(socket);let dropped=false;
      socket.emit=(name,...args)=>{if(name==='events:game:start_queue'&&!dropped){dropped=true;args.pop();return emit(name,...args,()=>{});}return emit(name,...args);};
      await speaker.game.operate('start_queue');await until(()=>speaker.sockets.at(-1)!==socket&&speaker.run()?.type==='breakout'&&speaker.game.getState().status==='ready','queue recovery');
      assert.equal(speaker.commands.filter(x=>x==='events:game:start_queue').length,1);for(const table of Object.keys(before))assert.equal(Number((await sql('SELECT COUNT(*) n FROM '+table))[0].n),before[table]);speaker.access.close();
      await attendee.start();assert.equal(attendee.snapshot().queue,undefined);assert.equal(attendee.run().ball,undefined);assert.equal(attendee.time.getState().snapshot.screen,null);
      assert.equal((await player.access.command('events:qna:open')).ok,true);assert.equal((await player.access.command('events:poll:launch',{interactionId:'poll'})).code,'INTERACTION_BUSY');
      await act(attendee,'input',{direction:'right'});await playerAction('start');clock=4001;f.setGameClockOffset(clock);await read(player);assert.equal(player.run().status,'running');
      await playerAction('pause');await playerAction('resume');await playerAction('skip');assert.equal(player.run().type,'pong');assert.equal(player.run().roster_counts,undefined);
    });
    await t.test('Pong console choices restore only own locked membership; Player renames, starts, pauses, resumes, finishes and ends the queue',async()=>{
      second=open(await register('Other game participant'));await second.start();await read(attendee);await act(player,'team_names',{left:'Blue <svg>',right:'Red'});
      await act(attendee,'join_team',{team:'left'});await act(second,'join_team',{team:'right'});await playerAction('start');await read(attendee);assert.equal(attendee.run().membership.team,'left');assert.equal(attendee.run().ball,undefined);
      const same=open({...attendeeItem,cookie:attendee.cookie()});await same.start();assert.equal(same.run().membership.team,'left');assert.equal(same.commands.includes('events:game:join_team'),false);same.access.close();
      assert.equal(await attendee.game.operate('join_team',{team:'right'}),false);await act(attendee,'input',{direction:'up'});await playerAction('pause');await playerAction('resume');
      clock+=1001;f.setGameClockOffset(clock);await read(player);assert.equal(player.run().status,'finished');assert.equal(player.snapshot().queue.status,'finished');await playerAction('end');assert.equal(player.run(),null);
      await grants.revoke(admin,o1,a,second.access.getState().context.grantId);await f.grantSockets.reviewAll();await until(()=>second.access.getState().status==='denied','revoke');assert.equal(second.snapshot(),null);
    });
    await t.test('Time console channels expire from server clock, fence revisions and survive independently until Stage finishes only their Live',async()=>{
      await playerAction('start','time',x=>x.input.mode==='countdown'&&x.input.minutes===1);await act(player,'stop',{target:'screen'},'time');await act(player,'resume',{target:'screen'},'time');
      const old=player.time.getState().snapshot;clock+=60001;f.setGameClockOffset(clock);await read(player,'time');assert.equal(player.time.getState().snapshot.screen.remainingMs,0);assert.equal(player.time.getState().snapshot.screen.running,false);assert.equal(player.time.getState().snapshot.speaker,undefined);
      await act(player,'reset',{target:'screen'},'time');assert.equal(await player.time.operate('hide',{target:'screen',expectedRevision:old.revision}),false);await playerAction('hide','time');await playerAction('start','time',x=>x.input.mode==='clock');
      await read(attendee,'time');assert.equal(attendee.time.getState().snapshot.screen,null);assert.deepEqual(attendee.time.availableActions(),[]);
      const other=open(await issue('screen','PLAYER',{liveSessionId:otherLive}),otherActivity);await other.start();await act(other,'start',{target:'screen',mode:'clock'},'time');const separate=other.time.getState().snapshot.timeRunId;
      const stage=open(await issue('stage','STAGE',{stageId}));await stage.start();assert.ok(stage.time.getState().snapshot.speaker.elapsedMs>0);await stage.live.operate('finish');await until(()=>player.snapshot()===null&&player.time.getState().snapshot===null,'finished');assert.equal((await sql('SELECT status FROM event_live_sessions WHERE id=?',[liveId]))[0].status,'FINISHED');assert.equal(stage.commands.filter(x=>x==='events:lifecycle:finish').length,1);assert.equal(other.time.getState().snapshot.timeRunId,separate);assert.equal(other.time.getState().snapshot.screen.visible,true);
    });
  }finally{close();f.setGameClockOffset(0);}
}
module.exports={consoleGameTimeSuite};
