const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {io}=require('socket.io-client');
const {pdfFixture}=require('./events-v2-pdf-fixture'),{imageFixture}=require('./events-v2-image-fixture'),{configurationFixture}=require('./events-v2-configuration-fixture');
const {visibleImages}=require('../../events-v2/interaction-images');
const engine=require('../../knowledge-activity-engine');
async function interactionImagesSuite(t,f){
 const {request,sql,domain,ids,base,o1,a,b,deckPreparations:prep,images,runtime,lifecycle,grants,slidesRuntime,avRuntime,pollRuntime,knowledgeRuntime:knowledge,raffleRuntime:raffles,gameRuntime,content,delivery}=f;
 const stages=[crypto.randomUUID(),crypto.randomUUID()],activities=stages.map(()=>crypto.randomUUID()),sessions=[],liveIds=[],clients=[],saved=[],timers=new Map();let clock=Date.now(),deck,scope,assets=[],stage,secondStage,player,speaker,participant,unjoined,firstURL,raffleURL,runId;
 const replace=(object,key,value)=>{const previous=object[key];saved.push(()=>{object[key]=previous;});object[key]=value;};
 replace(lifecycle,'content',content);replace(runtime,'readPreparation',content.readPreparation.bind(content));
 for(const [e,key,name]of [[pollRuntime,'readPolls','polls'],[knowledge,'readKnowledge','knowledge'],[raffles,'readRaffles','raffles'],[gameRuntime,'readGames','games']])replace(e,key,(live,db)=>content.catalog(live,db,name));
 for(const [e,key]of [[slidesRuntime,'readSlides'],[slidesRuntime,'readImage'],[avRuntime,'readAV'],[avRuntime,'readAsset']])replace(e,key,content[key].bind(content));
 replace(knowledge,'projectImages',delivery.knowledge.bind(delivery));replace(raffles,'projectImages',delivery.raffle.bind(delivery));
 for(const e of [knowledge,raffles]){replace(e,'now',()=>clock);replace(e,'setTimeoutFn',fn=>{const handle={};timers.set(handle,fn);return handle;});replace(e,'clearTimeoutFn',handle=>timers.delete(handle));}replace(knowledge,'random',()=>0.999);
 const root=`/api/events-v2/organizations/${o1}/events/${a}`,cookie=r=>r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),cred=s=>({eventId:a,grantId:s.context.grantId,sessionToken:s.sessionToken});
 const access=s=>`/api/events-v2/access/${a}/${s.context.grantId}`;
 async function issue(kind,fields){const r=await request('admin1','POST',root+'/grants',{kind,purpose:kind==='PLAYER'?'player':'live',...fields});assert.equal(r.status,201,JSON.stringify(r.body));const x=await request(null,'POST','/api/events-v2/access/exchange',{eventId:a,token:r.body.token});assert.equal(x.status,200);const s={...x.body,cookie:cookie(x)};sessions.push(s);return s;}
 async function register(name){const r=await request(null,'POST',`/api/events-v2/public/${f.publicId}/participants`,{name});assert.equal(r.status,201);const s={...r.body,cookie:cookie(r)};sessions.push(s);return s;}
 async function bytes(s,url,options={}){const r=await fetch(base+url,{method:options.method||'GET',headers:{cookie:s?.cookie||'',...options.headers}});return{status:r.status,headers:r.headers,bytes:Buffer.from(await r.arrayBuffer())};}
 const snap=(kind,s=stage,id=liveIds[0])=>grants.withSession(cred(s),(context,db)=>(kind==='knowledge'?knowledge:raffles).projection(context,db,id));
 const op=(kind,command,payload={},s=stage,id=liveIds[0])=>(kind==='knowledge'?knowledge:raffles).operate(grants,cred(s),id,command,payload);
 async function control(action){const s=await snap('knowledge');return op('knowledge',action,{executionId:s.execution.executionId,expectedRevision:s.execution.revision});}
 async function openQuiz(id){await op('knowledge','open',{definitionId:id});const r=(await snap('knowledge')).execution;runId=r.executionId;return r;}
 async function startQuiz(){await op('knowledge','join',{executionId:runId,tabId:'image-tab',name:'Image attendee'},participant);await control('start');clock+=engine.COUNTDOWN_MS+1;await op('knowledge','tick');}
 async function damage(file,operation){const before=await fs.readFile(file);await fs.chmod(file,384);await fs.writeFile(file,Buffer.alloc(before.length));try{await operation();}finally{await fs.writeFile(file,before);await fs.chmod(file,256);}}
 const ack=(client,name,payload={})=>new Promise((resolve,reject)=>client.timeout(6000).emit(name,payload,(error,result)=>error?reject(error):resolve(result)));
 async function connect(s){const client=io(base+'/events-v2',{auth:cred(s),extraHeaders:{origin:base},transports:['websocket'],forceNew:true,reconnection:false});clients.push(client);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Image socket context timeout')),6000);client.once('events:context',()=>{clearTimeout(timer);resolve();});client.once('connect_error',e=>{clearTimeout(timer);reject(e);});});const joined=await ack(client,'events:live:join',{liveSessionId:liveIds[0]});assert.equal(joined.ok,true,JSON.stringify(joined));return client;}
 try{
  assert.equal((await sql('SELECT COUNT(*) n FROM event_operational_windows WHERE event_id=?',[a]))[0].n,0);await grants.setWindow(ids.get('admin1'),o1,a,new Date(grants.now().getTime()+3600000).toISOString());
  for(let i=0;i<2;i++){await sql('INSERT INTO event_stages (id,event_workspace_id,name) VALUES (?,?,?)',[stages[i],a,'Image Stage '+i]);await sql("INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title,access_level) VALUES (?,?,?,?,'FREE')",[activities[i],a,stages[i],'Private image activity']);}
  const created=await request('producer','POST',root+'/decks',{title:'Private interaction images'});assert.equal(created.status,201);deck=created.body;scope={organizationId:o1,eventId:a,deckId:deck.id,versionId:deck.version.id};await prep.upload(ids.get('producer'),scope,pdfFixture());
  for(const [kind,size]of [['png','16x16'],['jpg','16x16'],['webp','16x16'],['png','32x16']]){const data=await imageFixture(kind,size),asset=await images.upload(ids.get('producer'),scope,'Image '+assets.length,data);assets.push({...asset,bytes:data});}
  const cfg=configurationFixture();cfg.knowledge[0].questionDurationSeconds=5;cfg.knowledge[0].questions[0].imageAssetId=assets[0].id;cfg.knowledge[0].questions.push({...structuredClone(cfg.knowledge[0].questions[0]),id:'q-next',prompt:'Next image?',imageAssetId:assets[1].id});
  cfg.knowledge.push({...structuredClone(cfg.knowledge[0]),id:'eval-image',category:'assessment',questionDurationSeconds:undefined,durationSeconds:30,identificationMode:'required_name'});cfg.slides[0].knowledgeIds.push('eval-image');
  cfg.raffles=[{id:'visual',mode:'visual_key',title:'Visual images',prompt:'Choose the projected image',entryKey:'b',options:['a','b','c','d'].map((id,i)=>({id,label:id.toUpperCase(),imageAssetId:assets[i].id}))}];cfg.slides[0].raffleIds=['visual'];
  const config=await content.configurations.create(ids.get('producer'),scope,cfg);await content.checks.approve(ids.get('producer'),scope,config.configurationDigest);
  for(const activity of activities){const r=await request('producer','PUT',root+`/activities/${activity}/deck-binding`,{deckId:deck.id,versionId:deck.version.id,expectedRevision:0});assert.equal(r.status,200);}
  stage=await issue('STAGE',{stageId:stages[0]});secondStage=await issue('STAGE',{stageId:stages[1]});speaker=await issue('SPEAKER',{activityId:activities[0]});participant=await register('Image attendee');unjoined=await register('Not admitted');
  for(const [i,s]of [stage,secondStage].entries()){const r=await request(null,'POST',access(s)+`/activities/${activities[i]}/start`,{},{cookie:s.cookie});assert.equal(r.status,201,JSON.stringify(r.body));liveIds.push(r.body.liveSessionId);}player=await issue('PLAYER',{liveSessionId:liveIds[0]});
  await t.test('approved image bundles start and controller previews cannot authorize public or Player image guessing',async()=>{
   const r=await openQuiz('quiz-a');firstURL=r.definitionsSnapshot.questions[0].image.url;assert.equal((await bytes(stage,firstURL)).status,200);assert.equal((await bytes(speaker,firstURL.replace(stage.context.grantId,speaker.context.grantId))).status,200);
   assert.equal((await bytes(participant,firstURL.replace(stage.context.grantId,participant.context.grantId))).status,403);assert.equal((await bytes(player,firstURL.replace(stage.context.grantId,player.context.grantId))).status,403);assert.equal(visibleImages(await snap('knowledge',participant),'knowledge').length,0);
   await op('knowledge','join',{executionId:runId,tabId:'image-tab'},participant);await control('start');assert.equal((await snap('knowledge',participant)).execution.state,'COUNTDOWN');assert.equal(visibleImages(await snap('knowledge',participant),'knowledge').length,0);clock+=engine.COUNTDOWN_MS+1;await op('knowledge','tick');
  });
  await t.test('Trivia delivers only the current admitted question and Socket.IO emits the same private image contract',async()=>{
   const pub=await snap('knowledge',participant),q=pub.execution.currentQuestion;assert.equal(q.id,'q-a');firstURL=q.image.url;const full=await bytes(participant,firstURL);assert.equal(full.status,200);assert.deepEqual(full.bytes,assets[0].bytes);assert.equal(pub.execution.definitionsSnapshot,undefined);assert.equal(JSON.stringify(pub).includes('correctOptionId'),false);
   const future=delivery.url(participant.context,liveIds[0],'knowledge',runId,assets[1].id);assert.equal((await bytes(participant,future)).status,403);assert.equal((await bytes(unjoined,firstURL.replace(participant.context.grantId,unjoined.context.grantId))).status,403);
   const client=await connect(participant),snapshot=await ack(client,'events:knowledge:snapshot');assert.equal(snapshot.ok,true);assert.equal(snapshot.snapshot.execution.currentQuestion.image.url,firstURL);
   assert.equal((await bytes(player,firstURL.replace(participant.context.grantId,player.context.grantId))).status,200);
  });
  await t.test('private interaction images enforce cookies, scope, query, Fetch Metadata, byte ranges and cache revalidation',async()=>{
   const full=await bytes(participant,firstURL);assert.equal(full.headers.get('content-type'),'image/png');assert.equal(full.headers.get('cache-control'),'no-store');
   const head=await bytes(participant,firstURL,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.bytes.length,0);
   const range=await bytes(participant,firstURL,{headers:{range:'bytes=2-8'}});assert.equal(range.status,206);assert.deepEqual(range.bytes,assets[0].bytes.subarray(2,9));assert.equal((await bytes(participant,firstURL,{headers:{'if-none-match':full.headers.get('etag')}})).status,304);
   assert.equal((await bytes(participant,firstURL,{headers:{range:'bytes=9999999-'}})).status,416);assert.equal((await bytes(null,firstURL)).status,401);
   for(const url of [firstURL+'?role=STAGE',firstURL.replace('/live/'+a+'/','/live/'+b+'/'),firstURL.replace(liveIds[0],liveIds[1]),firstURL.replace(runId,crypto.randomUUID()),firstURL.replace('/knowledge/','/raffle/')])assert.notEqual((await bytes(participant,url)).status,200);
   assert.equal((await bytes(participant,firstURL,{headers:{'sec-fetch-site':'cross-site'}})).status,403);
  });
  await t.test('HEAD and conditional responses reverify actual image bytes and approved pin with warm projections',async()=>{
   const full=await bytes(participant,firstURL),file=path.join(images.store.directory({...scope,id:assets[0].id}),'media.bin');
   await damage(file,async()=>{assert.notEqual((await bytes(participant,firstURL,{method:'HEAD'})).status,200);assert.notEqual((await bytes(participant,firstURL,{headers:{'if-none-match':full.headers.get('etag')}})).status,304);});
   const [pin]=await sql('SELECT approval_digest FROM event_live_content WHERE live_session_id=?',[liveIds[0]]);await sql('UPDATE event_live_content SET approval_digest=? WHERE live_session_id=?',['0'.repeat(64),liveIds[0]]);try{assert.equal((await bytes(participant,firstURL)).status,403);}finally{await sql('UPDATE event_live_content SET approval_digest=? WHERE live_session_id=?',[pin.approval_digest,liveIds[0]]);}
   f.setDomainEnabled(false);try{assert.equal((await bytes(participant,firstURL)).status,404);}finally{f.setDomainEnabled(true);}
   const revoked=await issue('STAGE',{stageId:stages[0]});await grants.revoke(ids.get('admin1'),o1,a,revoked.context.grantId);assert.equal((await bytes(revoked,firstURL.replace(participant.context.grantId,revoked.context.grantId))).status,401);
  });
  await t.test('question changes and a separate live cannot reuse an old public image URL',async()=>{
   clock+=5001;await op('knowledge','tick');assert.equal((await snap('knowledge',participant)).execution.substate,'REVEAL');clock+=engine.REVEAL_MS+1;await op('knowledge','tick');const q=(await snap('knowledge',participant)).execution.currentQuestion;assert.equal(q.id,'q-next');assert.equal((await bytes(participant,firstURL)).status,403);assert.deepEqual((await bytes(participant,q.image.url)).bytes,assets[1].bytes);
   const other=await snap('knowledge',secondStage,liveIds[1]);assert.equal(other.execution,null);await control('cancel');
  });
  await t.test('assessment images follow own assigned questions and become unavailable after submission; Player sees no assessment images',async()=>{
   await openQuiz('eval-image');await startQuiz();const pub=await snap('knowledge',participant);assert.equal(pub.execution.questions.length,2);for(const q of pub.execution.questions)assert.equal((await bytes(participant,q.image.url)).status,200);
   const ownURL=pub.execution.questions[0].image.url;assert.equal((await bytes(player,ownURL.replace(participant.context.grantId,player.context.grantId))).status,403);
   await op('knowledge','answer',{executionId:runId,tabId:'image-tab',questionId:'q-a',optionId:'a',attemptId:crypto.randomUUID()},participant);await op('knowledge','submit',{executionId:runId,tabId:'image-tab'},participant);assert.equal((await bytes(participant,ownURL)).status,403);await control('cancel');
  });
  await t.test('visual raffle controllers preview catalog images while Público receives four options and Player only the chosen key',async()=>{
   const idle=await snap('raffle');const catalogURL=idle.available.find(d=>d.id==='visual').keyOptions[0].image.url;assert.equal((await bytes(stage,catalogURL)).status,200);assert.equal((await bytes(participant,catalogURL.replace(stage.context.grantId,participant.context.grantId))).status,403);
   await op('raffle','configure_key',{definitionId:'visual',optionId:'d'});await op('raffle','open',{definitionId:'visual'});const pub=await snap('raffle',participant);assert.equal(pub.active.options.length,4);assert.equal(pub.active.entryKey,undefined);assert.equal(pub.active.displayOption,undefined);
   for(let i=0;i<4;i++){const r=await bytes(participant,pub.active.options[i].image.url);assert.equal(r.status,200);assert.deepEqual(r.bytes,assets[i].bytes);}raffleURL=pub.active.options[0].image.url;
   const screen=await snap('raffle',player);assert.equal(screen.active.displayOption.id,'d');assert.equal(visibleImages(screen,'raffle').length,1);assert.equal((await bytes(player,screen.active.displayOption.image.url)).status,200);assert.equal((await bytes(player,raffleURL.replace(participant.context.grantId,player.context.grantId))).status,403);
   const stored=(await sql('SELECT snapshot_json FROM event_v2_raffle_sessions WHERE id=?',[liveIds[0]]))[0].snapshot_json;assert.equal(JSON.stringify(stored).includes('/interaction-images/'),false);
  });
  await t.test('closing and reopening a raffle fences old round URLs and finish prevents all image delivery',async()=>{
   const current=await snap('raffle');await op('raffle','close_entries',{raffleRunId:current.raffleRunId});assert.equal((await bytes(participant,raffleURL)).status,403);await op('raffle','close',{raffleRunId:current.raffleRunId});await op('raffle','open',{definitionId:'visual'});assert.notEqual((await snap('raffle')).raffleRunId,current.raffleRunId);assert.equal((await bytes(participant,raffleURL)).status,403);
   const fresh=(await snap('raffle',participant)).active.options[0].image.url;assert.equal((await bytes(participant,fresh)).status,200);
   const finished=await request(null,'POST',access(stage)+`/live-sessions/${liveIds[0]}/finish`,{},{cookie:stage.cookie});assert.equal(finished.status,200);assert.equal((await bytes(participant,fresh)).status,403);assert.equal((await snap('knowledge',secondStage,liveIds[1])).execution,null);
  });
 }finally{
  for(const c of clients)c.close();f.setDomainEnabled(true);
  for(const id of liveIds){lifecycle.discard(`evt:${a}:live:${id}`);await sql('DELETE FROM event_v2_knowledge_sessions WHERE id=?',[id]);await sql('DELETE FROM event_v2_raffle_sessions WHERE id=?',[id]);await sql('DELETE FROM event_live_content WHERE live_session_id=?',[id]);}
  for(const s of sessions){await sql('DELETE FROM event_grant_sessions WHERE grant_id=?',[s.context.grantId]);await sql('DELETE FROM event_access_grants WHERE id=?',[s.context.grantId]);}
  for(let i=0;i<2;i++){await sql('DELETE FROM event_live_sessions WHERE event_stage_id=?',[stages[i]]);await sql('DELETE FROM event_activity_deck_bindings WHERE activity_id=?',[activities[i]]);await sql('DELETE FROM event_activities WHERE id=?',[activities[i]]);await sql('DELETE FROM event_stages WHERE id=?',[stages[i]]);}
  if(deck){for(const table of ['event_deck_checks','event_deck_configurations','event_deck_images','event_deck_preparations','event_deck_versions'])await sql('DELETE FROM '+table+' WHERE deck_id=?',[deck.id]);await sql('DELETE FROM event_decks WHERE id=?',[deck.id]);}
  await sql('DELETE FROM event_operational_windows WHERE event_id=?',[a]);for(const restore of saved.reverse())restore();
 }
}
module.exports={interactionImagesSuite};
