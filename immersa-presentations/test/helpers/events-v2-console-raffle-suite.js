const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { io } = require('socket.io-client');
const { createClient, consumeLink } = require('../../public/events-v2/access-client');
const { createController: createLive, targetKey } = require('../../public/events-v2/live-console');
const { createController: createRaffle } = require('../../public/events-v2/raffle-console');

// Shipped controllers with actual HTTP/SQL/Socket.IO, controlled private
// preparation and a fixed engine clock. This is not browser acceptance.
async function consoleRaffleSuite(t, f) {
  const { sql, request, grants, base, a, o1, preparations } = f;
  const admin = f.ids.get('admin1'), stageId = crypto.randomUUID(), otherStage = crypto.randomUUID();
  const activity = crypto.randomUUID(), otherActivity = crypto.randomUUID(), liveId = crypto.randomUUID(), otherLive = crypto.randomUUID();
  await grants.setWindow(admin, o1, a, new Date(f.now().getTime() + 2 * 86400000).toISOString());
  await sql('INSERT INTO event_stages (id,event_workspace_id,name) VALUES (?,?,?),(?,?,?)', [stageId, a, 'Raffle console', otherStage, a, 'Other Raffle console']);
  const definitions = [{id:'free',mode:'free',title:'Free',prompt:'Join',options:[]},
    {id:'poll',mode:'poll',title:'Poll raffle',prompt:'Choose',options:[{id:'a',label:'A'},{id:'b',label:'B'}]},
    {id:'visual',mode:'visual_key',title:'Visual',prompt:'Choose the marked option',entryKey:'a',options:['a','b','c','d'].map(id=>({id,label:id.toUpperCase()}))}];
  for (const [id, stage, run] of [[activity, stageId, liveId], [otherActivity, otherStage, otherLive]]) {
    await sql("INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title,deck_id,deck_check_status,access_level,status) VALUES (?,?,?,?,?,'DECK_CHECK','FREE','LIVE')", [id, a, stage, 'Raffle fixture', 'console-raffle-deck']);
    await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [run, a, stage, id, 'console-raffle-deck']);
    preparations.set(run, { eventId: a, liveSessionId: run, deckId: 'console-raffle-deck', versionId: 'console-raffle-v1', slideCount: 5,
      raffles: definitions, polls: [{ id: 'poll', type: 'poll', title: 'Poll', prompt: 'Choose', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }], knowledge: [], games: [], resources: [], playlists: [] });
  }
  let clock = 0; f.setRaffleClockOffset(clock);
  const active = new Set();
  const close = () => { for (const c of active) c.access.close(); };
  t.after(close);
  async function until(predicate, label) {
    const end = Date.now() + 25000;
    while (!predicate()) { if (Date.now() > end) throw new Error('Console Raffle timeout: ' + label); await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  async function issue(view, kind, scope) { return { view, issued: await grants.issue(admin, o1, a, { kind, purpose: kind === 'PLAYER' ? 'player' : 'live', ...scope }) }; }
  function open(item, chosen = activity) {
    let cookie = item.cookie, live, raffle; const sockets = [], commands = [];
    const link = consumeLink(new URL(`${base}/events-v2/console/${item.view}/${a}/${item.issued.grantId}` + (item.issued.token ? '#token=' + item.issued.token : '')), { replaceState() {} });
    const access = createClient({ binding: link.binding, now: () => f.now().getTime(), requestTimeoutMs: 15000, retryDelayMs: 10,
      fetch: async (url, options) => { const r = await fetch(base + url, { ...options, headers: { ...options.headers, origin: base, ...(cookie ? { cookie } : {}) } }); if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0]; return r; },
      io: (ns, options) => { const socket = io(base + ns, { ...options, extraHeaders: { origin: base }, transports: ['websocket'], forceNew: true }); const emit = socket.emit.bind(socket);
        socket.emit = (name, ...args) => { commands.push(name); return emit(name, ...args); }; sockets.push(socket); return socket; },
      onState: state => { raffle.updateAccess(state); live.updateAccess(state); }, onEvent: (name, value) => { live.receive(name, value); raffle.receive(name, value); } });
    live = createLive({ access, onState: state => raffle?.updateLive(state) }); raffle = createRaffle({ access });
    const record = { access, live, raffle, sockets, commands, cookie: () => cookie,
      start: async () => { await access.start(link.token); await until(() => access.getState().status === 'ready', 'access');
        if (['stage', 'audience'].includes(item.view)) await live.select(targetKey(access.getState().targets.find(row => row.activityId === chosen))); await record.ready(); },
      ready: () => until(() => live.getState().status === 'live' && raffle.getState().status === 'ready' && !raffle.getState().pending, 'snapshot'),
      snapshot: () => raffle.getState().snapshot, run: () => raffle.getState().snapshot?.active };
    active.add(record); return record;
  }
  const speaker=open(await issue('speaker','SPEAKER',{activityId:activity}));
  const player=open(await issue('screen','PLAYER',{liveSessionId:liveId}));
  const registered=await request(null,'POST',`/api/events-v2/public/${f.publicId}/participants`,{name:'Raffle registered name'});assert.equal(registered.status,201);
  const attendeeItem={view:'audience',issued:{grantId:registered.body.context.grantId},cookie:registered.headers.get('set-cookie').split(';')[0]},attendee=open(attendeeItem);
  async function operate(client,action,input={}){await client.ready();const ok=await client.raffle.operate(action,input);assert.equal(ok,true,JSON.stringify({action,state:client.raffle.getState(),access:client.access.getState().status}));}
  async function playerAction(action){await player.ready();const item=player.raffle.emergencyActions().find(x=>x.action===action);assert.ok(item,action);await operate(player,action,item.input);}
  async function publicRead(){await attendee.ready();assert.equal(await attendee.raffle.refresh(),true);}
  let first;
  try{
    await t.test('shipped raffle consoles keep idle reads private and recover a lost entry ack as one own ticket; Player completes timed free draw',async()=>{
      for(const c of [speaker,player,attendee])await c.start();assert.equal(player.run(),null);assert.equal(attendee.snapshot().available,undefined);
      await operate(speaker,'open',{definitionId:'free'});first=speaker.snapshot().raffleRunId;speaker.access.close();await publicRead();
      assert.equal((await player.access.command('events:qna:open')).ok,true);assert.equal((await player.access.command('events:poll:launch',{interactionId:'poll'})).code,'INTERACTION_BUSY');
      const socket=attendee.sockets.at(-1),emit=socket.emit.bind(socket);let dropped=false;
      const before={};for(const table of ['event_participants','event_access_grants','event_live_attendance','event_live_sessions'])before[table]=Number((await sql('SELECT COUNT(*) n FROM '+table))[0].n);
      socket.emit=(name,...args)=>{if(name==='events:raffle:enter'&&!dropped){dropped=true;args.pop();return emit(name,...args,()=>{});}return emit(name,...args);};
      await attendee.raffle.operate('enter',{name:'Corrected raffle name'});
      await until(()=>attendee.sockets.at(-1)!==socket&&attendee.run()?.ownEntry?.ticketNumber===1&&attendee.raffle.getState().status==='ready','lost ticket');
      assert.equal(attendee.commands.filter(x=>x==='events:raffle:enter').length,1);assert.equal(attendee.snapshot().displayName,'Corrected raffle name');
      for(const table of Object.keys(before))assert.equal(Number((await sql('SELECT COUNT(*) n FROM '+table))[0].n),before[table]);
      await playerAction('close_entries');await playerAction('draw');assert.equal(player.run().winner,null);assert.equal(player.run().pendingWinner,undefined);assert.equal(player.run().entries,undefined);
      clock+=5001;f.setRaffleClockOffset(clock);await player.raffle.refresh();await publicRead();assert.equal(player.run().winner.name,'Corrected raffle name');assert.equal(attendee.run().isWinner,true);await playerAction('close');
    });
    await t.test('visual-key choices remain changeable until close, Player resets excluded winners and manually reveals; poll entries are one-shot',async()=>{
      await operate(player,'configure_key',{definitionId:'visual',optionId:'b'});assert.equal(player.run(),null);await operate(player,'open',{definitionId:'visual'});await publicRead();
      assert.equal(player.run().displayOption.id,'b');assert.equal(attendee.run().entryKey,undefined);
      await operate(attendee,'enter',{optionId:'a'});assert.equal(attendee.run().ownEntry,null);await operate(attendee,'enter',{optionId:'b'});
      await playerAction('close_entries');assert.equal(await player.raffle.operate('draw',{raffleRunId:player.snapshot().raffleRunId}),false);
      assert.equal(player.raffle.getState().code,'RAFFLE_NO_ELIGIBLE_ENTRIES');await playerAction('reset_winners');await playerAction('draw');await playerAction('reveal');assert.equal(player.run().winner.name,'Corrected raffle name');await playerAction('close');
      await operate(player,'open',{definitionId:'poll'});await publicRead();await operate(attendee,'submit_poll_response',{optionId:'a'});
      assert.equal(await attendee.raffle.operate('submit_poll_response',{optionId:'b'}),false);assert.equal(attendee.run().ownEntry.selectedOptionId,'a');await playerAction('close_entries');await playerAction('close');
      const stale=await attendee.access.command('events:raffle:enter',{raffleRunId:first});assert.equal(stale.code,'RAFFLE_STALE_EXECUTION');
    });
    await t.test('raffle cookie receipt/name, grant revocation and Stage finish clear only their fixed Live without duplicate identities',async()=>{
      const same=open({...attendeeItem,cookie:attendee.cookie()});await same.start();assert.equal(same.snapshot().displayName,'Corrected raffle name');assert.equal(same.commands.includes('events:raffle:enter'),false);same.access.close();
      const other=open(await issue('screen','PLAYER',{liveSessionId:otherLive}),otherActivity);await other.start();await operate(other,'open',{definitionId:'free'});const separate=other.snapshot().raffleRunId;
      const stage=open(await issue('stage','STAGE',{stageId}));await stage.start();await operate(stage,'open',{definitionId:'free'});
      await grants.revoke(admin,o1,a,attendeeItem.issued.grantId);await f.grantSockets.reviewAll();await until(()=>attendee.access.getState().status==='denied','revoke');assert.equal(attendee.snapshot(),null);
      await stage.live.operate('finish');await until(()=>player.snapshot()===null,'finished');assert.equal((await sql('SELECT status FROM event_live_sessions WHERE id = ?',[liveId]))[0].status,'FINISHED');assert.equal(stage.commands.filter(x=>x==='events:lifecycle:finish').length,1);
      assert.equal(other.snapshot().raffleRunId,separate);assert.equal(other.run().state,'collecting');
    });
  }finally{close();f.setRaffleClockOffset(0);}
}
module.exports={consoleRaffleSuite};
