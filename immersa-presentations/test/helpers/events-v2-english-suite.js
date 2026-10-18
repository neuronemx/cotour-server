const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {pdfFixture}=require('./events-v2-pdf-fixture');const {configurationFixture}=require('./events-v2-configuration-fixture');const {runMigrations}=require('../../db/migrate');
async function englishSuite(t,f){
 const {request,sql,domain,ids,cookies,base,o1,o2,a,b,deckPreparations:es,deckTranslations:en}=f;const own=[];let deck,other,enMeta,esMeta,configured;
 const root=(event=a,org=o1)=>`/api/events-v2/organizations/${org}/events/${event}/decks`;
 const url=(v=deck.version,event=a,org=o1,d=deck)=>root(event,org)+`/${d.id}/versions/${v.id}`;
 const trans=(v=deck.version,event=a,org=o1,d=deck)=>url(v,event,org,d)+'/translations/en';
 const scope=v=>({organizationId:o1,eventId:a,deckId:deck.id,versionId:v.id});
 async function create(event=a){const r=await request('dual','POST',root(event),{title:'Private English fixture'});assert.equal(r.status,201);own.push(r.body.id);return r.body;}
 async function version(){const r=await request('producer','POST',root()+`/${deck.id}/versions`,{});assert.equal(r.status,201);return r.body;}
 async function upload(where,actor='producer',bytes=pdfFixture(2,[0,0,1]),headers={},extra=false){const body=new FormData();body.append('pdf',new Blob([bytes]),'../../untrusted.pdf');if(extra)body.append('language','fr');const r=await fetch(base+where+'/source',{method:'POST',headers:{origin:base,...(cookies.has(actor)?{cookie:cookies.get(actor)}:{}),...headers},body});return{status:r.status,body:await r.json()};}
 async function spanish(v){const r=await upload(url(v),'producer',pdfFixture(2,[1,0,0]));assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
 async function image(where=trans(),actor='producer',method='GET'){const r=await fetch(base+where+'/slides/slide-001/full',{method,headers:cookies.has(actor)?{cookie:cookies.get(actor)}:{}});return{status:r.status,headers:r.headers,bytes:Buffer.from(await r.arrayBuffer())};}
 try{
  await t.test('English PDF requires converted Spanish source and produces distinct private images pinned to that source',async()=>{
   deck=await create();other=await create(b);assert.equal((await upload(trans())).body.code,'PREPARATION_NOT_READY');
   esMeta=await spanish(deck.version);assert.deepEqual((await request('producer','GET',trans()+'/preparation')).body,{status:'NOT_UPLOADED',language:'en'});
   const r=await upload(trans());assert.equal(r.status,201,JSON.stringify(r.body));enMeta=r.body;assert.equal(enMeta.language,'en');assert.equal(enMeta.status,'CONVERTED');assert.equal(enMeta.baseManifestDigest,esMeta.manifestDigest);assert.equal(enMeta.slideCount,2);
   const english=await image(),spanishPreview=await image(url());assert.equal(english.status,200);assert.equal(english.headers.get('cache-control'),'no-store');assert.equal(english.headers.get('x-content-type-options'),'nosniff');assert.notDeepEqual(english.bytes,spanishPreview.bytes);
   const row=await en.row(domain.pool,scope(deck.version));assert.equal(crypto.createHash('sha256').update(english.bytes).digest('hex'),JSON.parse(row.manifestJson).slides[0].full.sha256);
   assert.deepEqual(await es.get(ids.get('producer'),scope(deck.version)),esMeta);assert.equal((await sql('SELECT status FROM event_deck_versions WHERE id=?',[deck.version.id]))[0].status,'DRAFT');
  });
  await t.test('translated images/metadata require current account permissions and exact event, Deck and version',async()=>{
   assert.equal((await image(trans(),'producer','HEAD')).status,200);
   for(const actor of[null,'platform','member','admin2']){const expected=actor===null?401:404;assert.equal((await image(trans(),actor)).status,expected);assert.equal((await request(actor,'GET',trans()+'/preparation')).status,expected);assert.equal((await upload(trans(),actor)).status,expected);}
   for(const where of[trans(deck.version,b),trans(other.version,a),trans(deck.version,a,o2),trans(deck.version,b,o1,other)]){assert.equal((await image(where,'dual')).status,404);assert.equal((await request('dual','GET',where+'/preparation')).status,404);assert.equal((await upload(where,'dual')).status,404);}
   const v=await version();await spanish(v);for(const origin of['','null','https://foreign.invalid'])assert.equal((await upload(trans(v),'producer',pdfFixture(),{origin})).status,403);
   assert.equal((await upload(trans(v),'producer',pdfFixture(),{},true)).status,400);assert.equal((await request('producer','GET',url(v)+'/translations/fr/preparation')).status,404);
   assert.equal((await fetch(base+`/decks/${deck.id}/translations/en/slides/slide-001.jpg`)).status,404);
  });
  await t.test('mismatched English pages fail before conversion, failed attempts cannot overwrite, concurrent uploads have one winner',async()=>{
   const v=await version();await spanish(v);const mismatch=await upload(trans(v),'producer',pdfFixture(1,[0,0,1]));assert.equal(mismatch.status,422);assert.equal(mismatch.body.code,'LOCALE_SLIDE_COUNT_MISMATCH');assert.equal((await request('producer','GET',trans(v)+'/preparation')).body.status,'FAILED');assert.equal((await upload(trans(v))).body.code,'VERSION_TRANSLATION_EXISTS');
   const fresh=await version();await spanish(fresh);const results=await Promise.all([upload(trans(fresh)),upload(trans(fresh),'dual')]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal((await es.get(ids.get('producer'),scope(fresh))).status,'CONVERTED');
  });
  await t.test('language/notes require prepared English and immutable configuration pins both source fingerprints',async()=>{
   const v=await version();await spanish(v);const input=configurationFixture();input.language={englishEnabled:true,presenterLanguage:'en'};input.slides[0].notes.en='English support';input.slides[1].notes.en='';
   assert.equal((await request('producer','POST',url(v)+'/configuration',input)).body.code,'TRANSLATION_NOT_READY');assert.equal((await request('producer','GET',url(v)+'/configuration')).body.status,'NOT_CONFIGURED');
   const forged={...input,englishSource:{manifestDigest:'0'.repeat(64)}};assert.equal((await request('producer','POST',url(v)+'/configuration',forged)).status,400);
   const current=await request('producer','POST',url()+'/configuration',input);assert.equal(current.status,201,JSON.stringify(current.body));configured=current.body;assert.equal(configured.configuration.englishSource.manifestDigest,enMeta.manifestDigest);assert.equal(configured.configuration.englishSource.baseManifestDigest,esMeta.manifestDigest);assert.equal(configured.configuration.slides[1].notes.en,'');assert.equal(configured.status,'CONFIGURED_PENDING_DECK_CHECK');
   assert.equal((await upload(trans())).body.code,'VERSION_CONFIGURATION_EXISTS');assert.deepEqual((await request('producer','GET',url()+'/configuration')).body,configured);assert.equal((await image()).status,200);assert.equal((await request('producer','GET',trans(v)+'/preparation')).body.status,'NOT_UPLOADED');
  });
  await t.test('corrupt English bytes or source fingerprints fail integrity without substituting Spanish images',async()=>{
   const row=await en.row(domain.pool,scope(deck.version)),file=path.join(en.store.directory(row),'slides/slide-001.jpg'),original=await fs.readFile(file);await fs.chmod(file,384);await fs.writeFile(file,Buffer.alloc(original.length));try{assert.equal((await image()).status,409);}finally{await fs.writeFile(file,original);await fs.chmod(file,256);}
   await sql('UPDATE event_deck_translations SET manifest_digest=? WHERE version_id=?',['0'.repeat(64),deck.version.id]);try{assert.equal((await request('producer','GET',url()+'/configuration')).body.code,'CONFIGURATION_INTEGRITY_FAILED');assert.equal((await image()).status,409);}finally{await sql('UPDATE event_deck_translations SET manifest_digest=? WHERE version_id=?',[row.manifestDigest,deck.version.id]);}
   assert.deepEqual((await request('producer','GET',url()+'/configuration')).body,configured);assert.equal((await image(url())).status,200);
  });
  await t.test('translation completion revalidates seal, membership, source fingerprint and feature flag after rendering',async()=>{
   for(const mode of['seal','revoke','source','flag']){
    const v=await version(),source=await spanish(v);let enter,release;const entered=new Promise(r=>{enter=r;}),gate=new Promise(r=>{release=r;}),original=en.store.prepare;
    en.store.prepare=async function(...args){enter();await gate;return original.apply(this,args);};const pending=upload(trans(v));
    try{await entered;
     if(mode==='seal')assert.equal((await request('producer','POST',url(v)+'/configuration',configurationFixture())).status,201);
     if(mode==='revoke')await sql('UPDATE event_memberships SET active=0 WHERE event_id=? AND user_id=?',[a,ids.get('producer')]);
     if(mode==='source')await sql('UPDATE event_deck_preparations SET manifest_digest=? WHERE version_id=?',['0'.repeat(64),v.id]);
     if(mode==='flag')f.setDomainEnabled(false);
     release();const result=await pending;assert.equal(result.status,['revoke','flag'].includes(mode)?404:409);assert.equal((await sql('SELECT status FROM event_deck_translations WHERE version_id=?',[v.id]))[0].status,'FAILED');
    }finally{release();en.store.prepare=original;await pending;f.setDomainEnabled(true);if(mode==='revoke')await sql('UPDATE event_memberships SET active=1 WHERE event_id=? AND user_id=?',[a,ids.get('producer')]);if(mode==='source')await sql('UPDATE event_deck_preparations SET manifest_digest=? WHERE version_id=?',[source.manifestDigest,v.id]);}
   }
  });
  await t.test('Spanish and English routes share admission limits before multipart parsing',async()=>{
   const v=await version();await spanish(v);const r1=es.acquireUpload(),r2=en.acquireUpload();try{assert.equal((await upload(trans(v))).status,429);assert.equal((await sql('SELECT COUNT(*) n FROM event_deck_translations WHERE version_id=?',[v.id]))[0].n,0);}finally{r1();r2();}
   assert.equal(es.uploads,0);assert.equal((await upload(trans(v))).status,201);
  });
  await t.test('translation audit rollback is private; scope FK and idempotent migration preserve converted rows',async()=>{
   const v=await version();await spanish(v);await domain.pool.query("CREATE TRIGGER reject_translation_audit BEFORE INSERT ON event_security_audit FOR EACH ROW BEGIN IF NEW.action='deck.translation.complete' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRIVATE_TRANSLATION_FAILURE'; END IF; END");try{const r=await upload(trans(v));assert.equal(r.status,503);assert.deepEqual(r.body,{code:'PDF_CONVERSION_FAILED'});}finally{await domain.pool.query('DROP TRIGGER reject_translation_audit');}
   assert.equal((await sql('SELECT status FROM event_deck_translations WHERE version_id=?',[v.id]))[0].status,'FAILED');
   await assert.rejects(sql("INSERT INTO event_deck_translations (version_id,event_id,deck_id,attempt_id,status,source_size,source_sha256,base_manifest_digest) VALUES (?,?,?,?,'PROCESSING',1,?,?)",[other.version.id,a,deck.id,crypto.randomUUID(),'0'.repeat(64),esMeta.manifestDigest]),e=>e.code==='ER_NO_REFERENCED_ROW_2');
   await sql("DELETE FROM schema_migrations WHERE id='048_event_deck_translations.sql'");assert.deepEqual((await runMigrations(domain.pool)).executed,['048_event_deck_translations.sql']);assert.equal((await image()).status,200);
  });
 }finally{await domain.pool.query('DROP TRIGGER IF EXISTS reject_translation_audit');for(const id of own){await sql('DELETE FROM event_deck_configurations WHERE deck_id=?',[id]);await sql('DELETE FROM event_deck_translations WHERE deck_id=?',[id]);await sql('DELETE FROM event_deck_preparations WHERE deck_id=?',[id]);await sql('DELETE FROM event_deck_versions WHERE deck_id=?',[id]);await sql('DELETE FROM event_decks WHERE id=?',[id]);}}
}
module.exports={englishSuite};
