const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {EventLiveRuntime}=require('../events-v2/live-runtime');
const {EventGameRuntime}=require('../events-v2/game-runtime');
const {EventTimeRuntime}=require('../events-v2/time-runtime');
const {createGameController,createTimeController}=require('../public/events-v2/game-time-console');
async function settle(){for(let i=0;i<80;i++)await Promise.resolve();}
async function harness(kind='PLAYER'){
 const eventId=crypto.randomUUID(),liveId=crypto.randomUUID(),stageId=crypto.randomUUID(),participantId=crypto.randomUUID();let now=100000,version='v1';
 const context=k=>({eventId,stageId,kind:k,participantId,purpose:k==='PLAYER'?'player':k==='PARTICIPANT'?'public':'live'});
 const db={execute:async()=>[[{id:liveId,deck_id:'private',event_activity_id:'a',event_stage_id:stageId,access_level:'FREE'}]]};
 const grants={withSession:async(c,fn)=>fn(context(c.kind),db)};const credentials=k=>({eventId,grantId:k,kind:k});
 const live=new EventLiveRuntime({enabled:()=>true,readPreparation:async p=>({...p,versionId:version,slideCount:5})});
 await live.operate(grants,credentials(kind),liveId);
 const games=new EventGameRuntime({liveRuntime:live,now:()=>now,readGames:async p=>({...p,games:[{id:'breakout',durationMs:1000},{id:'pong',durationMs:1000}]}),setTimeoutFn:()=>({}),clearTimeoutFn:()=>{}});
 games.connected=async()=>[participantId,'other'];const time=new EventTimeRuntime({liveRuntime:live,now:()=>now});const sent=[];
 const raw=family=>(family==='game'?games:time).projection(context(kind),db,liveId);
 const access={command:async(name,payload)=>{sent.push({name,payload});const [,family,action]=name.split(':');try{if(action!=='snapshot')await(family==='game'?games.operate(grants,credentials(kind),liveId,action,payload):time.operate(grants,credentials(kind),liveId,payload));return{ok:true,snapshot:await raw(family)};}catch(e){return{ok:false,code:e.code||e.message};}}};
 const game=createGameController({access}),timer=createTimeController({access});
 async function ready(generation=1){for(const c of [game,timer]){c.updateAccess({status:'ready',generation,context:context(kind)});c.updateLive({status:'live',snapshot:{eventId,liveSessionId:liveId}});}await settle();}
 await ready();return {eventId,liveId,participantId,games,time,game,timer,sent,raw,ready,context,db,grants,credentials,clock:ms=>now=ms,
 async configure(selected){await games.operate(grants,credentials('PLAYER'),liveId,'configure',{expectedRevision:games.states.get(eventId+':'+liveId)?.revision||0,selected});},
 async push(family='game'){(family==='game'?game:timer).receive('events:'+family+':state',await raw(family));},
 async command(action,payload){return games.operate(grants,credentials('PLAYER'),liveId,action,payload);}};
}
test('real engines project only allowed game geometry, own team and separate Time channels for each console',async()=>{
 for(const kind of ['STAGE','SPEAKER','PLAYER','PARTICIPANT']){const h=await harness(kind);assert.equal(h.game.getState().status,'ready');assert.equal(h.timer.getState().status,'ready');
   const revision=h.game.getState().snapshot.revision;await h.command('configure',{selected:['pong'],expectedRevision:revision});await h.command('start_queue',{expectedRevision:revision+1});await h.push();
   const g=h.game.getState().snapshot.game;assert.equal(g.roster,undefined);assert.equal(g.input,undefined);assert.equal(g.ball===undefined,kind==='PARTICIPANT');assert.equal(g.roster_counts===undefined,['PLAYER','PARTICIPANT'].includes(kind));
   assert.equal(h.game.getState().snapshot.queue===undefined,kind==='PARTICIPANT');assert.equal(h.timer.getState().snapshot.speaker===undefined,['PLAYER','PARTICIPANT'].includes(kind));assert.equal(h.timer.getState().snapshot.screen===null,kind==='PARTICIPANT');}
});
test('Player selection and complete Breakout/Pong queue cycle use canonical revisions and run IDs',async()=>{
 const h=await harness();for(const id of ['pong','breakout']){const a=h.game.emergencyActions().find(x=>x.action==='configure'&&x.input.selected.includes(id));assert.equal(await h.game.operate(a.action,a.input),true);}
 assert.deepEqual(h.game.getState().snapshot.queue.selected,['breakout','pong']);assert.equal(await h.game.operate('start_queue'),true);
 const first=h.game.getState().snapshot.game.id;assert.equal(await h.game.operate('configure',{selected:[]}),false);assert.equal(await h.game.operate('start'),true);
 h.clock(104001);await h.command('tick',{});await h.push();assert.equal(await h.game.operate('pause'),true);assert.equal(await h.game.operate('resume'),true);
 assert.equal(await h.game.operate('skip'),true);assert.equal(h.game.getState().snapshot.game.type,'pong');assert.notEqual(h.game.getState().snapshot.game.id,first);
 assert.equal(await h.game.operate('start',{gameRunId:first}),false);assert.equal(await h.game.operate('team_names',{left:'<svg>',right:'Red'}),true);
 const state=h.games.states.get(h.eventId+'\u001f'+h.liveId)||[...h.games.states.values()][0];const engine=state.pong,game=engine.getSession(state.key);engine.joinTeam(state.key,h.participantId,'left');engine.joinTeam(state.key,'other','right');
 await h.push();assert.equal(await h.game.operate('start'),true);assert.equal(await h.game.operate('pause'),true);assert.equal(await h.game.operate('resume'),true);assert.equal(await h.game.operate('end'),true);assert.equal(h.game.getState().snapshot.queue.status,'idle');
 assert.equal(h.sent.filter(x=>x.name.endsWith(':configure')).length,2);assert.ok(game.id);
});
test('physics frames do not retarget emergency consent; a new game does retire it',async()=>{
 const h=await harness();await h.game.operate('configure',{selected:['breakout','pong']});await h.game.operate('start_queue');const before=h.game.emergencyActions().find(a=>a.action==='skip');
 h.clock(100100);await h.command('tick',{});await h.push();const after=h.game.emergencyActions().find(a=>a.action==='skip');assert.deepEqual(before.input,after.input);assert.equal(await h.game.operate(before.action,before.input),true);assert.equal(await h.game.operate(before.action,before.input),false);
});
test('Público explicitly chooses team, recovers own locked membership and never controls the queue or spectator input',async()=>{
 const h=await harness('PARTICIPANT');await h.command('configure',{expectedRevision:0,selected:['pong']});await h.command('start_queue',{expectedRevision:1});await h.push();
 assert.equal(await h.game.operate('start'),false);assert.equal(await h.game.operate('input',{direction:'up'}),false);assert.equal(await h.game.operate('join_team',{team:'left'}),true);
 const state=[...h.games.states.values()][0];state.pong.joinTeam(state.key,'other','right');await h.command('start',{gameRunId:h.game.getState().snapshot.game.id});await h.push();assert.equal(await h.game.operate('join_team',{team:'right'}),false);assert.equal(await h.game.operate('input',{direction:'left'}),false);assert.equal(await h.game.operate('input',{direction:'up'}),true);
 await h.ready(2);assert.equal(h.game.getState().snapshot.game.membership.team,'left');assert.equal(h.sent.filter(x=>x.name.endsWith(':join_team')).length,1);
 const stateRaw=await h.raw('game');stateRaw.game.membership={team:'',spectator:true,roster_locked:true};h.game.receive('events:game:state',stateRaw);assert.deepEqual(h.game.availableActions(),[]);
});
test('Time keeps Speaker private while Player completes screen clock/countdown/stop/resume/reset/hide with stale fences',async()=>{
 const h=await harness();assert.equal(await h.timer.operate('start',{target:'speaker'}),false);assert.equal(await h.timer.operate('start',{target:'screen',mode:'countdown',hours:0,minutes:0,seconds:0}),false);
 assert.equal(await h.timer.operate('start',{target:'screen',mode:'countdown',hours:0,minutes:0,seconds:1}),true);const old=h.timer.emergencyActions().find(a=>a.action==='hide');
 assert.equal(await h.timer.operate('stop',{target:'screen'}),true);assert.equal(await h.timer.operate('hide',old.input),false);assert.equal(await h.timer.operate('resume',{target:'screen'}),true);
 h.clock(101001);await h.push('time');assert.equal(h.timer.getState().snapshot.screen.remainingMs,0);assert.equal(h.timer.availableActions().includes('screen:resume'),false);
 assert.equal(await h.timer.operate('reset',{target:'screen'}),true);assert.equal(await h.timer.operate('resume',{target:'screen'}),true);assert.equal(await h.timer.operate('hide',{target:'screen'}),true);
 for(const mode of ['clock','stopwatch'])assert.equal(await h.timer.operate('start',{target:'screen',mode}),true);
 const speaker=await harness('SPEAKER');assert.equal(await speaker.timer.operate('start',{target:'speaker'}),true);speaker.clock(101000);await speaker.push('time');assert.equal(speaker.timer.getState().snapshot.speaker.elapsedMs,1000);
});
test('stale command errors read without replay; access loss fences late acks and malformed geometry fails closed',async()=>{
 const h=await harness();await h.game.operate('configure',{selected:['breakout']});await h.game.operate('start_queue');const old=await h.raw('game');h.clock(100100);await h.command('tick',{});await h.push();h.game.receive('events:game:state',old);assert.ok(h.game.getState().snapshot.revision>old.revision);
 const bad=await h.raw('game');bad.game.ball.x=NaN;h.game.receive('events:game:state',bad);assert.equal(h.game.getState().snapshot,null);assert.equal(h.game.getState().status,'unavailable');
 let resolve;const sent=[];const c=createGameController({access:{command:(name)=>{sent.push(name);return name.endsWith(':snapshot')?Promise.resolve({ok:true,snapshot:old}):new Promise(r=>resolve=r);}}});c.updateAccess({status:'ready',generation:1,context:h.context('PLAYER')});c.updateLive({status:'live',snapshot:{eventId:h.eventId,liveSessionId:h.liveId}});await settle();const p=c.operate('end');c.updateAccess({status:'denied'});resolve({ok:true,snapshot:old});await p;assert.equal(c.getState().snapshot,null);assert.equal(sent.filter(x=>x.endsWith(':end')).length,1);
 const stale=[];let answer=old;const f=createGameController({access:{command:async(name)=>{stale.push(name);return name.endsWith(':snapshot')?{ok:true,snapshot:answer}:{ok:false,code:'GAME_STALE_REVISION'};}}});f.updateAccess({status:'ready',generation:1,context:h.context('PLAYER')});f.updateLive({status:'live',snapshot:{eventId:h.eventId,liveSessionId:h.liveId}});await settle();await f.operate('end');assert.equal(stale.filter(x=>x.endsWith(':end')).length,1);assert.equal(stale.filter(x=>x.endsWith(':snapshot')).length,2);
});
test('finish and unavailable preparation clear controls, while lower Time timestamps never regress a channel',async()=>{
 const h=await harness('SPEAKER');await h.timer.operate('start',{target:'screen',mode:'clock'});const older=await h.raw('time');h.clock(101000);await h.push('time');h.timer.receive('events:time:state',older);assert.equal(h.timer.getState().snapshot.serverNow,101000);
 for(const c of [h.game,h.timer]){c.updateLive({status:'finished',snapshot:null});assert.equal(c.getState().snapshot,null);assert.deepEqual(c.emergencyActions(),[]);}
});
