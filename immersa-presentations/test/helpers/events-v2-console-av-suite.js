const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { io } = require('socket.io-client');
const { createClient, consumeLink } = require('../../public/events-v2/access-client');
const { createController: createLive, targetKey } = require('../../public/events-v2/live-console');
const {createController:createAV}=require('../../public/events-v2/av-console');

// Shipped controllers with actual HTTP/SQL/Socket.IO, controlled private
// preparation and a fixed engine clock. This is not browser acceptance.
async function consoleAVSuite(t, f) {
  const { sql, request, grants, base, a, o1, preparations } = f;
  const admin = f.ids.get('admin1'), stageId = crypto.randomUUID(), otherStage = crypto.randomUUID();
  const activity = crypto.randomUUID(), otherActivity = crypto.randomUUID(), liveId = crypto.randomUUID(), otherLive = crypto.randomUUID();
  await grants.setWindow(admin, o1, a, new Date(f.now().getTime() + 2 * 86400000).toISOString());
  await sql('INSERT INTO event_stages (id,event_workspace_id,name) VALUES (?,?,?),(?,?,?)', [stageId, a, 'AV console', otherStage, a, 'Other AV console']);
  for (const [id, stage, run] of [[activity, stageId, liveId], [otherActivity, otherStage, otherLive]]) {
    await sql("INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title,deck_id,deck_check_status,access_level,status) VALUES (?,?,?,?,?,'DECK_CHECK','FREE','LIVE')", [id, a, stage, 'AV fixture', 'console-avConsole-deck']);
    await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)', [run, a, stage, id, 'console-avConsole-deck']);
    preparations.set(run, { eventId: a, liveSessionId: run, deckId: 'console-avConsole-deck', versionId: 'console-avConsole-v1', slideCount: 5,
      raffles: [], polls: [{ id: 'poll', type: 'poll', title: 'Poll', prompt: 'Choose', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }], knowledge: [], games: [], resources: [{id:'song',assetId:'song',name:'Song <img>',type:'audio',duration:6,size:5,sha256:crypto.createHash('sha256').update('audio').digest('hex'),contentType:'audio/mpeg'},{id:'film',assetId:'film',name:'Film',type:'video',duration:6,size:5,sha256:crypto.createHash('sha256').update('video').digest('hex'),contentType:'video/mp4'}], playlists: [{id:'films',name:'Films',type:'video',resourceIds:['film']}] });
  }
  for(const run of [liveId,otherLive])f.avAssets.set(run,new Map([['song',Buffer.from('audio')],['film',Buffer.from('video')]]));
  const active = new Set();
  const close = () => { for (const c of active) c.access.close(); };
  t.after(close);
  async function until(predicate, label) {
    const end = Date.now() + 25000;
    while (!predicate()) { if (Date.now() > end) throw new Error('Console AV timeout: ' + label); await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  async function issue(view, kind, scope) { return { view, issued: await grants.issue(admin, o1, a, { kind, purpose: kind === 'PLAYER' ? 'player' : 'live', ...scope }) }; }
  function open(item, chosen = activity) {
    let cookie = item.cookie, live, av; const sockets = [], commands = [];
    const link = consumeLink(new URL(`${base}/events-v2/console/${item.view}/${a}/${item.issued.grantId}` + (item.issued.token ? '#token=' + item.issued.token : '')), { replaceState() {} });
    const access = createClient({ binding: link.binding, now: () => f.now().getTime(), requestTimeoutMs: 15000, retryDelayMs: 10,
      fetch: async (url, options) => { const r = await fetch(base + url, { ...options, headers: { ...options.headers, origin: base, ...(cookie ? { cookie } : {}) } }); if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0]; return r; },
      io: (ns, options) => { const socket = io(base + ns, { ...options, extraHeaders: { origin: base }, transports: ['websocket'], forceNew: true }); const emit = socket.emit.bind(socket);
        socket.emit = (name, ...args) => { commands.push(name); return emit(name, ...args); }; sockets.push(socket); return socket; },
      onState: state => { av.updateAccess(state); live.updateAccess(state); }, onEvent: (name, value) => { live.receive(name, value); av.receive(name, value); } });
    live = createLive({ access, onState: state => { av?.updateLive(state); } }); av=createAV({access});
    const record = { access, live, av, sockets, commands, cookie: () => cookie,
      start: async () => { await access.start(link.token); await until(() => access.getState().status === 'ready', 'access');
        if (['stage', 'audience'].includes(item.view)) await live.select(targetKey(access.getState().targets.find(row => row.activityId === chosen))); await record.ready(); },
      ready: () => until(() => live.getState().status === 'live' && av.getState().status==='ready'&&!av.getState().pending, 'snapshot'),
      snapshot:()=>av.getState().snapshot };
    active.add(record); return record;
  }
  const speaker=open(await issue('speaker','SPEAKER',{activityId:activity})),player=open(await issue('screen','PLAYER',{liveSessionId:liveId}));
  const registered=await request(null,'POST',`/api/events-v2/public/${f.publicId}/participants`,{name:'AV attendee'});assert.equal(registered.status,201);const attendee=open({view:'audience',issued:{grantId:registered.body.context.grantId},cookie:registered.headers.get('set-cookie').split(';')[0]});
  async function act(c,action,input={}){await c.ready();assert.equal(await c.av.operate(action,input),true,JSON.stringify({action,state:c.av.getState()}));}
  try{
    await t.test('shipped AV consoles recover a lost select acknowledgement once, serve only private scoped bytes and keep channels independent',async()=>{
      const size=f.avRuntime.states.size;await speaker.start();await player.start();assert.equal(f.avRuntime.states.size,size);assert.equal(player.snapshot().channels.audio.resource,null);
      const socket=speaker.sockets.at(-1),emit=socket.emit.bind(socket);let dropped=false;socket.emit=(name,...args)=>{if(name==='events:av:control'&&!dropped){dropped=true;args.pop();return emit(name,...args,()=>{});}return emit(name,...args);};
      await speaker.av.operate('control',{action:'select',resourceId:'song',loop:false});await until(()=>speaker.sockets.at(-1)!==socket&&speaker.snapshot()?.channels.audio.resource?.id==='song','select recovery');assert.equal(speaker.commands.filter(x=>x==='events:av:control').length,1);speaker.access.close();
      await player.av.refresh();const selected=player.snapshot().channels.audio,oldId=selected.playbackId;const bytes=await fetch(base+selected.resource.assetUrl,{headers:{cookie:player.cookie(),range:'bytes=1-3'}});assert.equal(bytes.status,206);assert.equal(await bytes.text(),'udi');const denied=await fetch(base+selected.resource.assetUrl);assert.equal(denied.status,403);
      const select=player.av.emergencyActions().find(x=>x.input.resourceId==='film');assert.ok(select);await act(player,select.action,select.input);assert.equal(player.snapshot().channels.audio.playbackId,oldId);assert.equal(player.snapshot().channels.video.resource.id,'film');await act(player,'control',{action:'pause',type:'audio',playbackId:oldId});assert.equal(player.snapshot().channels.video.status,'playing');
    });
    await t.test('shipped AV consoles keep own reactions private, render-ready overlays literal, reject stale playback and clear after revoke or finish',async()=>{
      await attendee.start();assert.equal(attendee.snapshot().available,undefined);assert.equal(attendee.snapshot().channels,undefined);await act(attendee,'react',{emoji:'❤️'});assert.equal(attendee.av.getState().ownReaction.emoji,'❤️');await player.av.refresh();assert.equal(player.snapshot().reactionCounts,undefined);assert.equal(player.snapshot().reactions.length,1);
      await act(player,'overlay',{messageVisible:true,messageText:'<script>literal</script>'});await attendee.av.refresh();assert.equal(attendee.snapshot().overlays.messageText,'<script>literal</script>');assert.equal(attendee.snapshot().overlays.publicId,undefined);
      const id=player.snapshot().channels.video.playbackId;await act(player,'ended',{type:'video',playbackId:id});assert.equal(player.snapshot().channels.video.status,'stopped');assert.equal(await player.av.operate('ended',{type:'video',playbackId:crypto.randomUUID()}),false);
      await grants.revoke(admin,o1,a,attendee.access.getState().context.grantId);await f.grantSockets.reviewAll();await until(()=>attendee.access.getState().status==='denied','revoke');assert.equal(attendee.snapshot(),null);assert.equal(attendee.av.getState().ownReaction,null);
      const stage=open(await issue('stage','STAGE',{stageId}));await stage.start();assert.equal(stage.snapshot().reactionCounts['❤️'],1);await stage.live.operate('finish');await until(()=>player.snapshot()===null,'finish');assert.equal(player.commands.filter(x=>x==='events:av:ended').length,1);
    });
  }finally{close();}
}
module.exports={consoleAVSuite};
