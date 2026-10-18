const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {wavFixture,mediaFixture}=require('./events-v2-media-fixture');const {configurationFixture}=require('./events-v2-configuration-fixture');const {pdfFixture}=require('./events-v2-pdf-fixture');const {runMigrations}=require('../../db/migrate');
async function mediaSuite(t,f){
 const {request,sql,domain,ids,cookies,base,o1,o2,a,b,media}=f;const own=[];let deck,other,wav,webm,video;
 const root=(event=a,org=o1)=>`/api/events-v2/organizations/${org}/events/${event}/decks`;
 const url=(d=deck,v=d.version,event=a,org=o1)=>root(event,org)+`/${d.id}/versions/${v.id}`;
 const scope=v=>({organizationId:o1,eventId:a,deckId:deck.id,versionId:v.id});
 async function create(event=a){const r=await request('dual','POST',root(event),{title:'Private media fixture'});assert.equal(r.status,201);own.push(r.body.id);return r.body;}
 async function version(){const r=await request('producer','POST',root()+`/${deck.id}/versions`,{});assert.equal(r.status,201);return r.body;}
 async function upload(actor='producer',where=url(),bytes=wavFixture(),extra={}){const body=new FormData();body.append('media',new Blob([bytes],{type:'text/html'}),'../../untrusted.webm');body.append('name','Private media');if(extra.field)body.append('eventId',b);const r=await fetch(base+where+'/media',{method:'POST',headers:{origin:base,...(cookies.has(actor)?{cookie:cookies.get(actor)}:{}),...(extra.headers||{})},body});return{status:r.status,body:await r.json()};}
 async function content(actor,id,where=url(),headers={},method='GET'){const r=await fetch(base+where+`/media/${id}/content`,{method,headers:{...(cookies.has(actor)?{cookie:cookies.get(actor)}:{}),...headers}});return{status:r.status,headers:r.headers,bytes:Buffer.from(await r.arrayBuffer())};}
 try{
  await t.test('private media probes WAV and alpha WebM, ignores MIME/filename, persists server metadata and exact bytes',async()=>{
   deck=await create();other=await create(b);video=await mediaFixture();let r=await upload();assert.equal(r.status,201,JSON.stringify(r.body));wav=r.body;assert.equal(wav.contentType,'audio/wav');
   r=await upload('producer',url(),video);assert.equal(r.status,201,JSON.stringify(r.body));webm=r.body;assert.equal(webm.status,'READY_PENDING_DECK_CHECK');assert.equal(webm.alphaMetadata,true);
   const full=await content('producer',webm.id);assert.equal(full.status,200);assert.deepEqual(full.bytes,video);assert.equal(full.headers.get('content-type'),'video/webm');assert.equal(full.headers.get('cache-control'),'no-store');assert.equal(full.headers.get('x-content-type-options'),'nosniff');assert.equal(full.headers.get('cross-origin-resource-policy'),'same-origin');
   assert.equal((await media.list(ids.get('producer'),scope(deck.version))).media.length,2);assert.equal((await sql('SELECT status FROM event_deck_versions WHERE id=?',[deck.version.id]))[0].status,'DRAFT');
  });
  await t.test('media HTTP supports ranges and HEAD while rejecting unauthenticated, revoked and cross-event access',async()=>{
   for(const[range,start,end]of[['bytes=0-15',0,15],['bytes=-12',video.length-12,video.length-1],['bytes=10-',10,video.length-1]]){const r=await content('producer',webm.id,url(),{range});assert.equal(r.status,206);assert.deepEqual(r.bytes,video.subarray(start,end+1));assert.equal(r.headers.get('content-range'),`bytes ${start}-${end}/${video.length}`);}
   for(const range of['bytes=99999999-','bytes=0-2,4-6','bytes=-0'])assert.equal((await content('producer',webm.id,url(),{range})).status,416);
   const head=await content('producer',webm.id,url(),{},'HEAD');assert.equal(head.status,200);assert.equal(head.bytes.length,0);assert.equal(Number(head.headers.get('content-length')),video.length);
   for(const actor of[null,'platform','member','admin2']){const expected=actor===null?401:404;assert.equal((await content(actor,webm.id)).status,expected);assert.equal((await request(actor,'GET',url()+'/media')).status,expected);assert.equal((await upload(actor)).status,expected);}
   for(const where of[url(deck,deck.version,b),url(other,deck.version,b),url(deck,deck.version,a,o2)]){assert.equal((await content('dual',webm.id,where)).status,404);assert.equal((await request('dual','GET',where+'/media')).status,404);assert.equal((await upload('dual',where)).status,404);}
   assert.equal((await content('dual',webm.id,url(other,other.version,b))).status,404);
   await sql('UPDATE event_memberships SET active=0 WHERE event_id=? AND user_id=?',[a,ids.get('producer')]);try{assert.equal((await content('producer',webm.id)).status,404);}finally{await sql('UPDATE event_memberships SET active=1 WHERE event_id=? AND user_id=?',[a,ids.get('producer')]);}
   assert.equal((await fetch(base+`/decks/${deck.id}/media/${webm.id}`)).status,404);
  });
  await t.test('corrupted bytes or metadata never produce a successful private media response',async()=>{
   const file=path.join(media.store.directory({...scope(deck.version),id:webm.id}),'media.bin');await fs.chmod(file,384);await fs.writeFile(file,Buffer.alloc(video.length));try{assert.equal((await content('producer',webm.id)).status,409);assert.equal((await content('producer',webm.id,url(),{},'HEAD')).status,409);}finally{await fs.writeFile(file,video);await fs.chmod(file,256);}
   const[row]=await sql('SELECT metadata_json FROM event_deck_media WHERE id=?',[webm.id]);const changed=JSON.parse(row.metadata_json);changed.name='Tampered';await sql('UPDATE event_deck_media SET metadata_json=? WHERE id=?',[JSON.stringify(changed),webm.id]);try{assert.equal((await content('producer',webm.id)).status,409);assert.equal((await request('producer','GET',url()+'/media')).body.code,'MEDIA_INTEGRITY_FAILED');}finally{await sql('UPDATE event_deck_media SET metadata_json=? WHERE id=?',[row.metadata_json,webm.id]);}
  });
  await t.test('configuration selects same-version ready media, pins trusted metadata and seals further uploads',async()=>{
   const body=new FormData();body.append('pdf',new Blob([pdfFixture()]),'source.pdf');assert.equal((await fetch(base+url()+'/source',{method:'POST',headers:{origin:base,cookie:cookies.get('producer')},body})).status,201);
   const input=configurationFixture();input.audiovisual={assetIds:[wav.id,webm.id],playlists:[{id:'videos',name:'Videos',type:'video',resourceIds:[webm.id]}]};
   const foreign=await upload('dual',url(other,other.version,b));assert.equal(foreign.status,201);const bad=structuredClone(input);bad.audiovisual.assetIds=[foreign.body.id];bad.audiovisual.playlists=[];assert.equal((await request('producer','POST',url()+'/configuration',bad)).body.code,'MEDIA_NOT_READY');
   const mismatch=structuredClone(input);mismatch.audiovisual.playlists[0].type='audio';assert.equal((await request('producer','POST',url()+'/configuration',mismatch)).status,400);
   const result=await request('producer','POST',url()+'/configuration',input);assert.equal(result.status,201,JSON.stringify(result.body));const resource=result.body.configuration.av.resources.find(r=>r.id===webm.id);assert.equal(resource.sha256,webm.sha256);assert.equal(resource.duration,webm.duration);assert.equal(Object.hasOwn(resource,'url'),false);
   assert.equal((await upload()).body.code,'VERSION_CONFIGURATION_EXISTS');assert.equal((await content('producer',webm.id)).status,200);assert.equal((await request('producer','GET',url()+'/configuration')).body.status,'CONFIGURED_PENDING_DECK_CHECK');
  });
  await t.test('media origin/multipart injection, invalid files, dynamic flag and admission limits fail closed',async()=>{
   const v=await version(),where=url(deck,v);for(const origin of['','null','https://foreign.invalid'])assert.equal((await upload('producer',where,wavFixture(),{headers:{origin}})).status,403);
   assert.equal((await upload('producer',where,wavFixture(),{field:true})).status,400);assert.equal((await request('producer','GET',where+'/media?eventId='+b)).status,400);
   assert.equal((await upload('producer',where,Buffer.from('<html>not a media file</html>'))).body.code,'INVALID_MEDIA');const rows=await sql('SELECT id,status FROM event_deck_media WHERE version_id=?',[v.id]);assert.equal(rows.length,1);assert.equal(rows[0].status,'FAILED');assert.equal((await content('producer',rows[0].id,where)).status,409);
   f.setDomainEnabled(false);try{assert.equal((await request('producer','GET',url()+'/media')).body.code,'EVENTS_V2_DISABLED');await assert.rejects(media.list(ids.get('producer'),scope(deck.version)),{code:'EVENTS_V2_DISABLED'});}finally{f.setDomainEnabled(true);}
   const r1=media.acquireUpload(),r2=media.acquireUpload();try{assert.throws(()=>media.acquireUpload(),{code:'MEDIA_UPLOAD_BUSY'});}finally{r1();r1();r2();}assert.equal(media.uploads,0);
  });
  await t.test('upload completion revalidates current membership and a configuration sealed during probe',async()=>{
   for(const mode of ['seal','revoke']){
    const v=await version(),where=url(deck,v);let enter,release;
    const entered=new Promise(r=>{enter=r;}),gate=new Promise(r=>{release=r;}),original=media.store.prepare;
    media.store.prepare=async function(...args){enter();await gate;return original.apply(this,args);};
    const pending=upload('producer',where);
    try{
     await entered;
     if(mode==='seal'){
      const body=new FormData();body.append('pdf',new Blob([pdfFixture()]),'source.pdf');assert.equal((await fetch(base+where+'/source',{method:'POST',headers:{origin:base,cookie:cookies.get('producer')},body})).status,201);
      assert.equal((await request('producer','POST',where+'/configuration',configurationFixture())).status,201);
     }else await sql('UPDATE event_memberships SET active=0 WHERE event_id=? AND user_id=?',[a,ids.get('producer')]);
     release();const result=await pending;assert.equal(result.status,mode==='seal'?409:404);
     const rows=await sql('SELECT status FROM event_deck_media WHERE version_id=?',[v.id]);assert.deepEqual(rows,[{status:'FAILED'}]);
    }finally{release();media.store.prepare=original;await pending;if(mode==='revoke')await sql('UPDATE event_memberships SET active=1 WHERE event_id=? AND user_id=?',[a,ids.get('producer')]);}
   }
  });
  await t.test('version media budgets include failed reservations and do not allocate new uploads',async()=>{
   for(const[count,size]of[[200,1],[11,104857600]]){const v=await version(),values=Array.from({length:count},()=>[crypto.randomUUID(),a,deck.id,v.id,size,'0'.repeat(64),ids.get('producer')]);await sql(`INSERT INTO event_deck_media (id,event_id,deck_id,version_id,status,source_size,source_sha256,created_by_user_id,error_code,completed_at) VALUES ${values.map(()=>"(?,?,?,?,'FAILED',?,?,?,'INVALID_MEDIA',NOW())").join(',')}`,values.flat());assert.equal((await upload('producer',url(deck,v))).body.code,'VERSION_MEDIA_LIMIT');}
  });
  await t.test('audit rollback cannot publish media; composite FK and repeatable migration preserve valid rows',async()=>{
   const v=await version();await domain.pool.query("CREATE TRIGGER reject_media_audit BEFORE INSERT ON event_security_audit FOR EACH ROW BEGIN IF NEW.action='deck.media.complete' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRIVATE_MEDIA_FAILURE'; END IF; END");try{const r=await upload('producer',url(deck,v));assert.equal(r.status,503);assert.deepEqual(r.body,{code:'MEDIA_PREPARATION_FAILED'});}finally{await domain.pool.query('DROP TRIGGER reject_media_audit');}
   const failed=await sql('SELECT id,status FROM event_deck_media WHERE version_id=?',[v.id]);assert.equal(failed[0].status,'FAILED');assert.equal((await content('producer',failed[0].id,url(deck,v))).status,409);
   await assert.rejects(sql("INSERT INTO event_deck_media (id,event_id,deck_id,version_id,status,source_size,source_sha256,created_by_user_id) VALUES (?,?,?,?,'PROCESSING',1,?,?)",[crypto.randomUUID(),b,deck.id,v.id,'0'.repeat(64),ids.get('producer')]),e=>e.code==='ER_NO_REFERENCED_ROW_2');
   await sql("DELETE FROM schema_migrations WHERE id='047_event_deck_media.sql'");assert.deepEqual((await runMigrations(domain.pool)).executed,['047_event_deck_media.sql']);assert.equal((await content('producer',webm.id)).status,200);
  });
 }finally{await domain.pool.query('DROP TRIGGER IF EXISTS reject_media_audit');for(const id of own){await sql('DELETE FROM event_deck_configurations WHERE deck_id=?',[id]);await sql('DELETE FROM event_deck_media WHERE deck_id=?',[id]);await sql('DELETE FROM event_deck_preparations WHERE deck_id=?',[id]);await sql('DELETE FROM event_deck_versions WHERE deck_id=?',[id]);await sql('DELETE FROM event_decks WHERE id=?',[id]);}}
}
module.exports={mediaSuite};
