const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {pdfFixture}=require('./events-v2-pdf-fixture'),{wavFixture}=require('./events-v2-media-fixture'),{imageFixture}=require('./events-v2-image-fixture');
const {configurationFixture}=require('./events-v2-configuration-fixture'),{runMigrations}=require('../../db/migrate');
const {EventDeckConfigurationService}=require('../../events-v2/deck-configuration'),{EventDeckCheckService}=require('../../events-v2/deck-check-service');
async function checkSuite(t,f){
 const {request,sql,domain,ids,cookies,base,o1,o2,a,b,deckPreparations:prep,deckTranslations:english,media,images}=f,own=[];let deck,other,configured,scope,paths;
 const root=(event=a,org=o1)=>`/api/events-v2/organizations/${org}/events/${event}/decks`;
 const url=(d=deck,v=d.version,event=a,org=o1)=>root(event,org)+`/${d.id}/versions/${v.id}`;
 const configs=new EventDeckConfigurationService({preparations:prep,translations:english,media,images});
 const checks=new EventDeckCheckService({configurations:configs});
 async function create(event=a){const r=await request('dual','POST',root(event),{title:'DeckCheck fixture'});assert.equal(r.status,201);own.push(r.body.id);return r.body;}
 async function version(){const r=await request('producer','POST',root()+`/${deck.id}/versions`,{});assert.equal(r.status,201);return r.body;}
 const scopeFor=v=>({organizationId:o1,eventId:a,deckId:deck.id,versionId:v.id});
 async function prepare(v=deck.version,rich=false){const s=scopeFor(v);await prep.upload(ids.get('producer'),s,pdfFixture());const input=configurationFixture();
  if(rich){await english.upload(ids.get('producer'),s,pdfFixture(2,[0,0,1]));const audio=await media.upload(ids.get('producer'),s,'WAV',wavFixture()),image=await images.upload(ids.get('producer'),s,'PNG',await imageFixture());input.audiovisual={assetIds:[audio.id],playlists:[]};input.language={englishEnabled:true,presenterLanguage:'es'};input.knowledge[0].questions[0].imageAssetId=image.id;paths={audio:path.join(media.store.directory({...s,id:audio.id}),'media.bin'),image:path.join(images.store.directory({...s,id:image.id}),'media.bin')};}
  return configs.create(ids.get('producer'),s,input);
 }
 async function approve(v=deck.version,digest=configured.configurationDigest,actor='producer',where=url(deck,v)){return request(actor,'POST',where+'/deck-check',{configurationDigest:digest});}
 async function noApproval(v){assert.equal((await sql('SELECT COUNT(*) n FROM event_deck_checks WHERE version_id=?',[v.id]))[0].n,0);}
 async function damage(file,operation){const bytes=await fs.readFile(file);await fs.chmod(file,384);await fs.writeFile(file,Buffer.alloc(bytes.length));try{await operation();}finally{await fs.writeFile(file,bytes);await fs.chmod(file,256);}}
 try{
  await t.test('DeckCheck needs sealed configuration and its exact digest, not legacy flags or client approval',async()=>{
   deck=await create();other=await create(b);scope=scopeFor(deck.version);
   assert.deepEqual((await request('producer','GET',url()+'/deck-check')).body,{status:'NOT_CHECKED'});
   assert.equal((await approve(deck.version,'0'.repeat(64))).body.code,'CONFIGURATION_NOT_READY');
   configured=await prepare(deck.version,true);
   assert.equal((await approve(deck.version,'0'.repeat(64))).body.code,'DECK_CHECK_SOURCE_CHANGED');
   for(const body of [{},{configurationDigest:'bad'},{configurationDigest:configured.configurationDigest,approved:true}])assert.equal((await request('producer','POST',url()+'/deck-check',body)).status,400);
   await noApproval(deck.version);
  });
  await t.test('DeckCheck enforces current event roles, scope and same origin before verification',async()=>{
   for(const actor of [null,'platform','member','admin2']){const expected=actor===null?401:404;assert.equal((await approve(deck.version,configured.configurationDigest,actor)).status,expected);assert.equal((await request(actor,'GET',url()+'/deck-check')).status,expected);}
   for(const where of [url(deck,deck.version,b),url(other,other.version,b),url(deck,deck.version,a,o2)])assert.equal((await approve(deck.version,configured.configurationDigest,'dual',where)).status,where===url(other,other.version,b)?409:404);
   const body=JSON.stringify({configurationDigest:configured.configurationDigest});for(const origin of ['', 'null','https://foreign.invalid']){const r=await fetch(base+url()+'/deck-check',{method:'POST',headers:{cookie:cookies.get('producer'),origin,'content-type':'application/json'},body});assert.equal(r.status,403);}
   assert.equal((await request('producer','GET',url()+'/deck-check?approved=true')).status,400);await noApproval(deck.version);
  });
  await t.test('DeckCheck verifies original ES/EN, all slide variants, AV and question image before approval',async()=>{
   const es=await prep.row(domain.pool,scope),en=await english.row(domain.pool,scope);
   for(const file of [path.join(prep.store.directory(es),'original.pdf'),path.join(prep.store.directory(es),'thumbs/slide-002.jpg'),path.join(english.store.directory(en),'slides/slide-002.jpg'),path.join(english.store.directory(en),'manifest.json'),paths.audio,paths.image]){
    await damage(file,async()=>{assert.equal((await approve()).status,409);await noApproval(deck.version);});
   }
   const result=await approve();assert.equal(result.status,201,JSON.stringify(result.body));assert.equal(result.body.status,'DECK_CHECK');assert.equal(result.body.configurationDigest,configured.configurationDigest);assert.equal(result.body.verified.pdfs,2);assert.equal(result.body.verified.slides,4);assert.equal(result.body.verified.files,14);assert.equal(result.body.verified.media,1);assert.equal(result.body.verified.images,1);assert.match(result.body.approvalDigest,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(result.body).includes('Apuntador privado'),false);
   assert.deepEqual((await request('producer','GET',url()+'/deck-check')).body,result.body);assert.deepEqual((await approve()).body,result.body);assert.equal((await sql('SELECT COUNT(*) n FROM event_deck_checks WHERE version_id=?',[deck.version.id]))[0].n,1);
   await damage(paths.image,async()=>{assert.equal((await request('producer','GET',url()+'/deck-check')).status,409);assert.equal((await approve()).status,409);});
  });
  await t.test('approval survives restart, detects record corruption and never transfers to a new version',async()=>{
   const restarted=new EventDeckCheckService({configurations:configs});assert.equal((await restarted.get(ids.get('producer'),scope)).status,'DECK_CHECK');
   const [row]=await sql('SELECT approval_json FROM event_deck_checks WHERE version_id=?',[deck.version.id]);const changed=JSON.parse(row.approval_json);changed.verified.files=0;await sql('UPDATE event_deck_checks SET approval_json=? WHERE version_id=?',[JSON.stringify(changed),deck.version.id]);try{assert.equal((await request('producer','GET',url()+'/deck-check')).body.code,'DECK_CHECK_INTEGRITY_FAILED');}finally{await sql('UPDATE event_deck_checks SET approval_json=? WHERE version_id=?',[row.approval_json,deck.version.id]);}
   const v=await version(),config=await prepare(v);assert.deepEqual((await request('producer','GET',url(deck,v)+'/deck-check')).body,{status:'NOT_CHECKED'});assert.equal((await approve(v,configured.configurationDigest)).body.code,'DECK_CHECK_SOURCE_CHANGED');await noApproval(v);assert.equal((await approve(v,config.configurationDigest)).status,201);
  });
  await t.test('long verification reauthorizes after revocation/flag and rejects a changed configuration snapshot',async()=>{
   for(const mode of ['revoke','flag','metadata']){
    const v=await version(),config=await prepare(v),original=prep.store.verify;let enter,release;const entered=new Promise(r=>{enter=r;}),gate=new Promise(r=>{release=r;});
    prep.store.verify=async function(...args){const report=await original.apply(this,args);enter();await gate;return report;};const pending=approve(v,config.configurationDigest);let stored;
    try{await entered;
     if(mode==='revoke')await sql('UPDATE event_memberships SET active=0 WHERE event_id=? AND user_id=?',[a,ids.get('producer')]);
     else if(mode==='flag')f.setDomainEnabled(false);
     else{stored=(await sql('SELECT configuration_json FROM event_deck_configurations WHERE version_id=?',[v.id]))[0].configuration_json;await sql('UPDATE event_deck_configurations SET configuration_json=? WHERE version_id=?',[JSON.stringify({...JSON.parse(stored),slideCount:99}),v.id]);}
     release();assert.equal((await pending).status,mode==='metadata'?409:404);await noApproval(v);
    }finally{release();prep.store.verify=original;await pending;f.setDomainEnabled(true);if(mode==='revoke')await sql('UPDATE event_memberships SET active=1 WHERE event_id=? AND user_id=?',[a,ids.get('producer')]);if(stored)await sql('UPDATE event_deck_configurations SET configuration_json=? WHERE version_id=?',[stored,v.id]);}
   }
  });
  await t.test('DeckCheck bounds concurrent HTTP verification; SQL approval is idempotent across service instances',async()=>{
   const v=await version(),config=await prepare(v),original=prep.store.verify;let enter,release;const entered=new Promise(r=>{enter=r;}),gate=new Promise(r=>{release=r;});
   prep.store.verify=async function(...args){enter();await gate;return original.apply(this,args);};const pending=approve(v,config.configurationDigest);
   try{await entered;assert.equal((await approve(v,config.configurationDigest)).body.code,'DECK_CHECK_BUSY');release();assert.equal((await pending).status,201);}finally{release();prep.store.verify=original;await pending;}
   const v2=await version(),config2=await prepare(v2),second=new EventDeckCheckService({configurations:configs});const results=await Promise.all([checks.approve(ids.get('producer'),scopeFor(v2),config2.configurationDigest),second.approve(ids.get('producer'),scopeFor(v2),config2.configurationDigest)]);assert.deepEqual(results[0],results[1]);assert.equal((await sql('SELECT COUNT(*) n FROM event_deck_checks WHERE version_id=?',[v2.id]))[0].n,1);
  });
  await t.test('DeckCheck audit rollback never leaves an approval and schema scope/re-run are enforced',async()=>{
   const v=await version(),config=await prepare(v);await domain.pool.query("CREATE TRIGGER reject_check_audit BEFORE INSERT ON event_security_audit FOR EACH ROW BEGIN IF NEW.action='deck.check.approve' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRIVATE_CHECK_FAILURE'; END IF; END");try{assert.equal((await approve(v,config.configurationDigest)).status,503);await noApproval(v);}finally{await domain.pool.query('DROP TRIGGER reject_check_audit');}
   await assert.rejects(sql("INSERT INTO event_deck_checks (version_id,event_id,deck_id,configuration_digest,bundle_digest,approval_digest,approval_json,approved_by_user_id) VALUES (?,?,?,?,?,?,?,?)",[v.id,b,deck.id,'0'.repeat(64),'0'.repeat(64),'0'.repeat(64),'{}',ids.get('producer')]),e=>e.code==='ER_NO_REFERENCED_ROW_2');
   await sql("DELETE FROM schema_migrations WHERE id='050_event_deck_checks.sql'");assert.deepEqual((await runMigrations(domain.pool)).executed,['050_event_deck_checks.sql']);assert.equal((await request('producer','GET',url()+'/deck-check')).body.status,'DECK_CHECK');
  });
 }finally{await domain.pool.query('DROP TRIGGER IF EXISTS reject_check_audit');for(const id of own){for(const table of ['event_deck_checks','event_deck_configurations','event_deck_translations','event_deck_media','event_deck_images','event_deck_preparations','event_deck_versions'])await sql('DELETE FROM '+table+' WHERE deck_id=?',[id]);await sql('DELETE FROM event_decks WHERE id=?',[id]);}}
}
module.exports={checkSuite};
