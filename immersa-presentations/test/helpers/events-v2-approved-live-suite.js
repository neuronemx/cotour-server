const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {pdfFixture}=require('./events-v2-pdf-fixture'),{wavFixture}=require('./events-v2-media-fixture'),{imageFixture}=require('./events-v2-image-fixture'),{configurationFixture}=require('./events-v2-configuration-fixture');
const {EventDeckConfigurationService}=require('../../events-v2/deck-configuration'),{EventDeckCheckService}=require('../../events-v2/deck-check-service'),{EventApprovedContent}=require('../../events-v2/approved-content'),{runMigrations}=require('../../db/migrate');
async function approvedLiveSuite(t,f){
 const {request,sql,domain,ids,base,o1,a,b,deckPreparations:prep,deckTranslations:english,media,images,runtime,lifecycle,grants,slidesRuntime,AV:av,pollRuntime,knowledgeRuntime,raffleRuntime,gameRuntime}=f;
 const stageId=crypto.randomUUID(),activity=crypto.randomUUID(),own=[],sessions=[],lives=[];
 const configs=new EventDeckConfigurationService({preparations:prep,translations:english,media,images}),checks=new EventDeckCheckService({configurations:configs}),content=new EventApprovedContent({checks});
 const saved=[];function replace(object,key,value){saved.push(()=>{object[key]=value;});object[key]=value;}
 replace(lifecycle,'content',content);replace(runtime,'readPreparation',content.readPreparation.bind(content));
 for(const [engine,key,name]of [[pollRuntime,'readPolls','polls'],[knowledgeRuntime,'readKnowledge','knowledge'],[raffleRuntime,'readRaffles','raffles'],[gameRuntime,'readGames','games']])replace(engine,key,(live,db)=>content.catalog(live,db,name));
 for(const [engine,key]of [[slidesRuntime,'readSlides'],[slidesRuntime,'readImage'],[av,'readAV'],[av,'readAsset']])replace(engine,key,content[key].bind(content));
 const root=`/api/events-v2/organizations/${o1}/events/${a}`;
 const scope=d=>({organizationId:o1,eventId:a,deckId:d.id,versionId:d.version.id});
 async function prepare(rich=false){const r=await request('producer','POST',root+'/decks',{title:'Approved live fixture'});assert.equal(r.status,201);const d=r.body;own.push(d.id);const s=scope(d);
  await prep.upload(ids.get('producer'),s,pdfFixture());await english.upload(ids.get('producer'),s,pdfFixture(2,[0,0,1]));const audio=await media.upload(ids.get('producer'),s,'WAV',wavFixture());
  const input=configurationFixture();input.language={englishEnabled:true,presenterLanguage:'es'};input.slides[0].notes.en='Private English notes';input.audiovisual={assetIds:[audio.id],playlists:[]};
  if(rich){const image=await images.upload(ids.get('producer'),s,'PNG',await imageFixture());input.knowledge[0].questions[0].imageAssetId=image.id;}
  d.configuration=await configs.create(ids.get('producer'),s,input);d.audio=audio;return d;
 }
 async function bind(d){const r=await request('producer','GET',root+`/activities/${activity}/deck-binding`);const reply=await request('producer','PUT',root+`/activities/${activity}/deck-binding`,{deckId:d.id,versionId:d.version.id,expectedRevision:r.body.revision});assert.equal(reply.status,200,JSON.stringify(reply.body));return reply.body;}
 async function approve(d){return checks.approve(ids.get('producer'),scope(d),d.configuration.configurationDigest);}
 const cookie=r=>r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 async function issue(kind,fields={}){const r=await request('admin1','POST',root+'/grants',{kind,purpose:kind==='PLAYER'?'player':'live',...fields});assert.equal(r.status,201,JSON.stringify(r.body));const x=await request(null,'POST','/api/events-v2/access/exchange',{eventId:a,token:r.body.token});assert.equal(x.status,200);const s={...x.body,cookie:cookie(x)};sessions.push(s);return s;}
 const credentials=s=>({eventId:a,grantId:s.context.grantId,sessionToken:s.sessionToken});
 const browser=(s,fn)=>grants.withSession(credentials(s),fn);
 const access=s=>`/api/events-v2/access/${a}/${s.context.grantId}`;
 const start=s=>request(null,'POST',access(s)+`/activities/${activity}/start`,{},{cookie:s.cookie});
 async function finish(s,id){return request(null,'POST',access(s)+`/live-sessions/${id}/finish`,{},{cookie:s.cookie});}
 async function bytes(s,url,options={}){const r=await fetch(base+url,{method:options.method||'GET',headers:{cookie:s?.cookie||'',...options.headers}});return{status:r.status,headers:r.headers,bytes:Buffer.from(await r.arrayBuffer())};}
 const count=async()=>Number((await sql('SELECT COUNT(*) n FROM event_live_content WHERE live_session_id IN (SELECT id FROM event_live_sessions WHERE event_stage_id=?)',[stageId]))[0].n);
 async function damage(file,operation){const original=await fs.readFile(file);await fs.chmod(file,384);await fs.writeFile(file,Buffer.alloc(original.length));try{await operation();}finally{await fs.writeFile(file,original);await fs.chmod(file,256);}}
 await sql('INSERT INTO event_stages (id,event_workspace_id,name) VALUES (?,?,?)',[stageId,a,'Approved runtime']);
 await sql("INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title,deck_id,deck_check_status,access_level) VALUES (?,?,?,?,?,'DECK_CHECK','FREE')",[activity,a,stageId,'Approved runtime','legacy-sentinel']);
 let deck,stage,liveId,participant,slideUrl,assetUrl,approval;
 try{
  await t.test('approved start rejects legacy approval, an unapproved version, unsupported image adapters and corrupted source',async()=>{
   stage=await issue('STAGE',{stageId});assert.equal((await start(stage)).body.code,'CONTENT_NOT_PREPARED');
   deck=await prepare();await bind(deck);assert.equal((await start(stage)).body.code,'CONTENT_NOT_PREPARED');assert.equal(await count(),0);
   approval=await approve(deck);const rich=await prepare(true);await approve(rich);await bind(rich);assert.equal((await start(stage)).body.code,'CONTENT_RUNTIME_NOT_READY');assert.equal(await count(),0);await bind(deck);
   const row=await prep.row(domain.pool,scope(deck));await damage(path.join(prep.store.directory(row),'original.pdf'),async()=>{assert.notEqual((await start(stage)).status,201);assert.equal(await count(),0);});
  });
  await t.test('start reauthorizes after long verification and releases admission after revoke, flag, rebind and audit failure',async()=>{
   const other=await prepare();await approve(other);
   for(const mode of ['revoke','flag','rebind']){const session=await issue('STAGE',{stageId}),original=content.verify.bind(content);let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
    content.verify=async c=>{await original(c);enter();await gate;};const pending=start(session);
    try{await entered;if(mode==='revoke')await grants.revoke(ids.get('admin1'),o1,a,session.context.grantId);if(mode==='flag')f.setDomainEnabled(false);if(mode==='rebind')await bind(other);
     release();assert.notEqual((await pending).status,201);assert.equal(await count(),0);
    }finally{release();content.verify=original;await pending;f.setDomainEnabled(true);if(mode==='rebind')await bind(deck);}
    assert.equal(checks.running,0);
   }
   await domain.pool.query("CREATE TRIGGER reject_approved_live_audit BEFORE INSERT ON event_security_audit FOR EACH ROW BEGIN IF NEW.action='live.start' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRIVATE_LIVE_FAILURE'; END IF; END");
   try{assert.equal((await start(stage)).status,503);assert.equal(await count(),0);assert.equal((await sql('SELECT status FROM event_activities WHERE id=?',[activity]))[0].status,'SCHEDULED');}finally{await domain.pool.query('DROP TRIGGER reject_approved_live_audit');}
  });
  await t.test('bounded concurrent starts install one committed session pinned to version, binding revision and DeckCheck',async()=>{
   const original=content.verify.bind(content);let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);content.verify=async c=>{await original(c);enter();await gate;};const pending=start(stage);
   try{await entered;assert.equal((await start(stage)).body.code,'DECK_CHECK_BUSY');release();const r=await pending;assert.equal(r.status,201,JSON.stringify(r.body));liveId=r.body.liveSessionId;lives.push(liveId);}finally{release();content.verify=original;await pending;}
   assert.equal((await start(stage)).body.code,'STAGE_ALREADY_LIVE');assert.equal(await count(),1);
   const [pin]=await sql('SELECT * FROM event_live_content WHERE live_session_id=?',[liveId]);assert.equal(pin.version_id,deck.version.id);assert.equal(pin.deck_id,deck.id);assert.equal(pin.approval_digest,approval.approvalDigest);assert.ok(pin.binding_revision>0);
   assert.equal((await sql('SELECT deck_id FROM event_live_sessions WHERE id=?',[liveId]))[0].deck_id,deck.id);
  });
  await t.test('real ES/EN readers serve private notes only to controllers and text catalogs to their engines',async()=>{
   const registration=await request(null,'POST',`/api/events-v2/public/${f.publicId}/participants`,{name:'Approved reader attendee'});assert.equal(registration.status,201);participant={...registration.body,cookie:cookie(registration)};sessions.push(participant);
   const controller=await browser(stage,(c,db)=>slidesRuntime.projection(c,db,liveId));assert.equal(controller.prompter.current.text,'Apuntador privado.\nSegunda línea.');slideUrl=controller.slide.url;
   const publicView=await browser(participant,(c,db)=>slidesRuntime.projection(c,db,liveId,undefined,'en'));assert.equal(publicView.language,'en');assert.equal(publicView.prompter,undefined);assert.equal(JSON.stringify(publicView).includes('Private'),false);assert.equal((await bytes(participant,publicView.slide.url)).status,200);
   for(const [engine,method]of [[pollRuntime,'prepared'],[knowledgeRuntime,'scope'],[raffleRuntime,'scope'],[gameRuntime,'prepared']])await browser(stage,(c,db)=>engine[method](c,db,liveId));
   const projection=await browser(stage,(c,db)=>av.projection(c,db,liveId));assert.equal(projection.available.length,1);assetUrl=projection.available[0].assetUrl;
   const restarted=new EventApprovedContent({checks});const result=await browser(stage,async(c,db)=>restarted.readPreparation(await runtime.resolve(c,db,liveId),db));assert.equal(result.versionId,deck.version.id);
  });
  await t.test('live image and AV HTTP verify actual bytes, ranges, HEAD and cached responses before returning data',async()=>{
   for(const [url,expected]of [[slideUrl,null],[assetUrl,wavFixture()]]){const full=await bytes(stage,url);assert.equal(full.status,200);assert.ok(full.bytes.length>0);if(expected)assert.deepEqual(full.bytes,expected);
    assert.equal((await bytes(stage,url,{method:'HEAD'})).bytes.length,0);const range=await bytes(stage,url,{headers:{range:'bytes=2-9'}});assert.equal(range.status,206);assert.deepEqual(range.bytes,full.bytes.subarray(2,10));assert.equal((await bytes(stage,url,{headers:{'if-none-match':full.headers.get('etag')}})).status,304);
   }
   const row=await prep.row(domain.pool,scope(deck));await damage(path.join(prep.store.directory(row),'slides/slide-001.jpg'),async()=>{assert.notEqual((await bytes(stage,slideUrl,{method:'HEAD'})).status,200);});
   await damage(path.join(media.store.directory({...scope(deck),id:deck.audio.id}),'media.bin'),async()=>{assert.notEqual((await bytes(stage,assetUrl,{headers:{'if-none-match':'"'+deck.audio.sha256+'"'}})).status,304);});
  });
  await t.test('every delivery enforces current cookies, role, event and pin integrity despite warmed content',async()=>{
   assert.equal((await bytes(null,slideUrl)).status,401);assert.equal((await bytes(null,assetUrl)).status,401);
   const publicAsset=assetUrl.replace(stage.context.grantId,participant.context.grantId);assert.equal((await bytes(participant,publicAsset)).status,403);
   assert.notEqual((await bytes(stage,slideUrl.replace('/live/'+a+'/','/live/'+b+'/'))).status,200);
   await sql('UPDATE event_live_content SET approval_digest=? WHERE live_session_id=?',['0'.repeat(64),liveId]);try{assert.equal((await bytes(stage,slideUrl)).status,403);}finally{await sql('UPDATE event_live_content SET approval_digest=? WHERE live_session_id=?',[approval.approvalDigest,liveId]);}
   const revoked=await issue('STAGE',{stageId});const revokedURL=slideUrl.replace(stage.context.grantId,revoked.context.grantId);await grants.revoke(ids.get('admin1'),o1,a,revoked.context.grantId);assert.equal((await bytes(revoked,revokedURL)).status,401);
  });
  await t.test('new versions cannot retarget an active session; finish retains its pin and closes all readers',async()=>{
   const v=await request('producer','POST',root+`/decks/${deck.id}/versions`,{});assert.equal(v.status,201);assert.equal((await browser(stage,(c,db)=>runtime.prepared(c,db,liveId))).versionId,deck.version.id);
   const binding=await request('producer','GET',root+`/activities/${activity}/deck-binding`);assert.equal((await request('producer','DELETE',root+`/activities/${activity}/deck-binding`,{expectedRevision:binding.body.revision})).status,409);
   assert.equal((await finish(stage,liveId)).status,200);assert.equal(await count(),1);assert.equal((await bytes(stage,slideUrl)).status,403);assert.equal((await bytes(stage,assetUrl)).status,403);
  });
  await t.test('live pin schema enforces scope, preserves indexes and recovers a migration rerun',async()=>{
   const [pin]=await sql('SELECT * FROM event_live_content WHERE live_session_id=?',[liveId]);await assert.rejects(sql('UPDATE event_live_content SET event_id=? WHERE live_session_id=?',[b,liveId]),e=>e.code==='ER_NO_REFERENCED_ROW_2');
   await sql("DELETE FROM schema_migrations WHERE id='051_event_live_content.sql'");assert.deepEqual((await runMigrations(domain.pool)).executed,['051_event_live_content.sql']);assert.equal((await sql('SELECT approval_digest FROM event_live_content WHERE live_session_id=?',[liveId]))[0].approval_digest,pin.approval_digest);
   assert.equal((await sql("SELECT COUNT(*) n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='event_live_sessions' AND INDEX_NAME='uq_event_live_v2_scope' AND NON_UNIQUE=0"))[0].n,2);
  });
 }finally{
  f.setDomainEnabled(true);await domain.pool.query('DROP TRIGGER IF EXISTS reject_approved_live_audit');
  for(const s of sessions){await sql('DELETE FROM event_grant_sessions WHERE grant_id=?',[s.context.grantId]);await sql('DELETE FROM event_access_grants WHERE id=?',[s.context.grantId]);}
  for(const id of lives){lifecycle.discard(`evt:${a}:live:${id}`);await sql('DELETE FROM event_live_content WHERE live_session_id=?',[id]);}
  await sql('DELETE FROM event_live_sessions WHERE event_stage_id=?',[stageId]);await sql('DELETE FROM event_activity_deck_bindings WHERE activity_id=?',[activity]);await sql('DELETE FROM event_activities WHERE id=?',[activity]);await sql('DELETE FROM event_stages WHERE id=?',[stageId]);
  for(const id of own){for(const table of ['event_deck_checks','event_deck_configurations','event_deck_translations','event_deck_media','event_deck_images','event_deck_preparations','event_deck_versions'])await sql('DELETE FROM '+table+' WHERE deck_id=?',[id]);await sql('DELETE FROM event_decks WHERE id=?',[id]);}
  for(const restore of saved.reverse())restore();
 }
}
module.exports={approvedLiveSuite};
