const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {imageFixture}=require('./events-v2-image-fixture'),{pdfFixture}=require('./events-v2-pdf-fixture');
const {configurationFixture}=require('./events-v2-configuration-fixture'),{runMigrations}=require('../../db/migrate');
async function imageSuite(t,f){
 const {request,sql,domain,ids,cookies,base,o1,o2,a,b,images,media}=f,own=[];let deck,other,png,prepared;const assets=[];
 const root=(event=a,org=o1)=>`/api/events-v2/organizations/${org}/events/${event}/decks`;
 const url=(d=deck,v=d.version,event=a,org=o1)=>root(event,org)+`/${d.id}/versions/${v.id}`;
 const scope=v=>({organizationId:o1,eventId:a,deckId:deck.id,versionId:v.id});
 async function create(event=a){const r=await request('dual','POST',root(event),{title:'Private raster fixture'});assert.equal(r.status,201);own.push(r.body.id);return r.body;}
 async function version(){const r=await request('producer','POST',root()+`/${deck.id}/versions`,{});assert.equal(r.status,201);return r.body;}
 async function upload(actor='producer',where=url(),bytes=png,extra={}){const body=new FormData();body.append('image',new Blob([bytes],{type:'text/html'}),'../../untrusted.svg');body.append('name','Private image');if(extra.field)body.append('eventId',b);const r=await fetch(base+where+'/images',{method:'POST',headers:{origin:base,...(cookies.has(actor)?{cookie:cookies.get(actor)}:{}),...(extra.headers||{})},body});return{status:r.status,body:await r.json()};}
 async function content(actor,id,where=url(),headers={},method='GET'){const r=await fetch(base+where+`/images/${id}/content`,{method,headers:{...(cookies.has(actor)?{cookie:cookies.get(actor)}:{}),...headers}});return{status:r.status,headers:r.headers,bytes:Buffer.from(await r.arrayBuffer())};}
 async function spanish(where=url()){const body=new FormData();body.append('pdf',new Blob([pdfFixture()]),'source.pdf');const r=await fetch(base+where+'/source',{method:'POST',headers:{origin:base,cookie:cookies.get('producer')},body});assert.equal(r.status,201);}
 try{
  await t.test('private images decode three formats with trusted metadata, exact bytes and DRAFT status',async()=>{
   deck=await create();other=await create(b);png=await imageFixture();
   for(const kind of ['png','jpg','webp']){const bytes=kind==='png'?png:await imageFixture(kind),r=await upload('producer',url(),bytes);assert.equal(r.status,201,JSON.stringify(r.body));assets.push(r.body);assert.equal(r.body.type,'image');assert.equal(r.body.width,16);assert.equal(r.body.height,16);assert.equal(r.body.contentType,'image/'+(kind==='jpg'?'jpeg':kind));const full=await content('producer',r.body.id);assert.equal(full.status,200);assert.deepEqual(full.bytes,bytes);assert.equal(full.headers.get('cache-control'),'no-store');assert.equal(full.headers.get('x-content-type-options'),'nosniff');assert.equal(full.headers.get('cross-origin-resource-policy'),'same-origin');}
   prepared=assets[0];assert.equal((await images.list(ids.get('producer'),scope(deck.version))).images.length,3);assert.equal((await sql('SELECT status FROM event_deck_versions WHERE id=?',[deck.version.id]))[0].status,'DRAFT');
  });
  await t.test('private image GET/HEAD/ranges enforce account, current role, exact event and version',async()=>{
   const head=await content('producer',prepared.id,url(),{},'HEAD');assert.equal(head.status,200);assert.equal(head.bytes.length,0);assert.equal(Number(head.headers.get('content-length')),png.length);
   const part=await content('producer',prepared.id,url(),{range:'bytes=0-7'});assert.equal(part.status,206);assert.deepEqual(part.bytes,png.subarray(0,8));assert.equal((await content('producer',prepared.id,url(),{range:'bytes=9999999-'})).status,416);
   for(const actor of[null,'platform','member','admin2']){const expected=actor===null?401:404;assert.equal((await content(actor,prepared.id)).status,expected);assert.equal((await request(actor,'GET',url()+'/images')).status,expected);assert.equal((await upload(actor)).status,expected);}
   for(const where of[url(deck,deck.version,b),url(other,other.version,b),url(deck,deck.version,a,o2),url(deck,await version())])assert.equal((await content('dual',prepared.id,where)).status,404);
   await sql('UPDATE event_memberships SET active=0 WHERE event_id=? AND user_id=?',[a,ids.get('producer')]);try{assert.equal((await content('producer',prepared.id)).status,404);}finally{await sql('UPDATE event_memberships SET active=1 WHERE event_id=? AND user_id=?',[a,ids.get('producer')]);}
   assert.equal((await content('producer',prepared.id,url(),{'sec-fetch-site':'cross-site'})).status,403);assert.equal((await fetch(base+`/decks/${deck.id}/images/${prepared.id}`)).status,404);
  });
  await t.test('image byte and metadata corruption fail closed including HEAD',async()=>{
   const file=path.join(images.store.directory({...scope(deck.version),id:prepared.id}),'media.bin');await fs.chmod(file,384);await fs.writeFile(file,Buffer.alloc(png.length));try{assert.equal((await content('producer',prepared.id)).status,409);assert.equal((await content('producer',prepared.id,url(),{},'HEAD')).status,409);}finally{await fs.writeFile(file,png);await fs.chmod(file,256);}
   const[row]=await sql('SELECT metadata_json FROM event_deck_images WHERE id=?',[prepared.id]);const changed=JSON.parse(row.metadata_json);changed.width=99;await sql('UPDATE event_deck_images SET metadata_json=? WHERE id=?',[JSON.stringify(changed),prepared.id]);try{assert.equal((await content('producer',prepared.id)).status,409);assert.equal((await request('producer','GET',url()+'/images')).body.code,'IMAGE_INTEGRITY_FAILED');}finally{await sql('UPDATE event_deck_images SET metadata_json=? WHERE id=?',[row.metadata_json,prepared.id]);}
  });
  await t.test('configuration pins only same-version ready question and visual raffle images; sealing closes uploads',async()=>{
   await spanish();const input=configurationFixture();input.knowledge[0].questions[0].imageAssetId=prepared.id;
   input.raffles[0]={id:'raffle-a',mode:'visual_key',title:'Visual',prompt:'Elige',entryKey:'a',options:['a','b','c','d'].map((id,i)=>({id,label:id,imageAssetId:assets[i%3].id}))};
   const foreign=await upload('dual',url(other,other.version,b));assert.equal(foreign.status,201);
   for(const id of[foreign.body.id,crypto.randomUUID()]){const bad=structuredClone(input);bad.knowledge[0].questions[0].imageAssetId=id;assert.equal((await request('producer','POST',url()+'/configuration',bad)).body.code,'IMAGE_NOT_READY');}
   const v=await version(),fromVersion=await upload('producer',url(deck,v));const bad=structuredClone(input);bad.knowledge[0].questions[0].imageAssetId=fromVersion.body.id;assert.equal((await request('producer','POST',url()+'/configuration',bad)).body.code,'IMAGE_NOT_READY');
   const result=await request('producer','POST',url()+'/configuration',input);assert.equal(result.status,201,JSON.stringify(result.body));assert.equal(result.body.status,'CONFIGURED_PENDING_DECK_CHECK');assert.equal(result.body.configuration.images.length,3);assert.equal(result.body.configuration.knowledge[0].questions[0].imageAssetId,prepared.id);assert.equal(result.body.configuration.images.find(x=>x.id===prepared.id).sha256,prepared.sha256);assert.equal(Object.hasOwn(result.body.configuration.images[0],'url'),false);
   assert.equal((await upload()).body.code,'VERSION_CONFIGURATION_EXISTS');assert.equal((await content('producer',prepared.id)).status,200);assert.deepEqual((await request('producer','GET',url()+'/configuration')).body,result.body);
   const[row]=await sql('SELECT metadata_json FROM event_deck_images WHERE id=?',[prepared.id]);await sql('UPDATE event_deck_images SET metadata_json=? WHERE id=?',[JSON.stringify({...JSON.parse(row.metadata_json),width:99}),prepared.id]);try{assert.equal((await request('producer','GET',url()+'/configuration')).status,409);}finally{await sql('UPDATE event_deck_images SET metadata_json=? WHERE id=?',[row.metadata_json,prepared.id]);}
  });
  await t.test('image multipart, source, origin, dynamic flag and shared HTTP admission fail before allocating',async()=>{
   const v=await version(),where=url(deck,v);for(const origin of['','null','https://foreign.invalid'])assert.equal((await upload('producer',where,png,{headers:{origin}})).status,403);
   assert.equal((await upload('producer',where,png,{field:true})).status,400);assert.equal((await request('producer','GET',where+'/images?eventId='+b)).status,400);assert.equal((await upload('producer',where,Buffer.alloc(5*1024*1024+1))).status,413);
   const failed=await upload('producer',where,Buffer.from('<svg/>'));assert.equal(failed.body.code,'INVALID_IMAGE');const rows=await sql('SELECT id,status FROM event_deck_images WHERE version_id=?',[v.id]);assert.deepEqual(rows.map(x=>x.status),['FAILED']);assert.equal((await content('producer',rows[0].id,where)).status,409);
   const release1=media.acquireUpload(),release2=images.acquireUpload();try{const r=await fetch(base+where+'/images',{method:'POST',headers:{origin:base,cookie:cookies.get('producer'),'content-type':'multipart/form-data; boundary=bad'},body:'invalid'});assert.equal(r.status,429);assert.equal((await r.json()).code,'IMAGE_UPLOAD_BUSY');}finally{release1();release2();}assert.equal(media.uploads,0);
   f.setDomainEnabled(false);try{assert.equal((await request('producer','GET',where+'/images')).body.code,'EVENTS_V2_DISABLED');await assert.rejects(images.list(ids.get('producer'),scope(v)),{code:'EVENTS_V2_DISABLED'});}finally{f.setDomainEnabled(true);}
  });
  await t.test('image completion rechecks sealing, revocation and flag changes after decoding',async()=>{
   for(const mode of ['seal','revoke','flag']){
    const v=await version(),where=url(deck,v);let enter,release;const entered=new Promise(r=>{enter=r;}),gate=new Promise(r=>{release=r;}),original=images.store.prepare;
    images.store.prepare=async function(...args){const info=await original.apply(this,args);enter();await gate;return info;};const pending=upload('producer',where);
    try{await entered;if(mode==='seal'){await spanish(where);assert.equal((await request('producer','POST',where+'/configuration',configurationFixture())).status,201);}else if(mode==='revoke')await sql('UPDATE event_memberships SET active=0 WHERE event_id=? AND user_id=?',[a,ids.get('producer')]);else f.setDomainEnabled(false);
     release();const result=await pending;assert.equal(result.status,mode==='seal'?409:404);assert.deepEqual(await sql('SELECT status FROM event_deck_images WHERE version_id=?',[v.id]),[{status:'FAILED'}]);
    }finally{release();images.store.prepare=original;await pending;f.setDomainEnabled(true);if(mode==='revoke')await sql('UPDATE event_memberships SET active=1 WHERE event_id=? AND user_id=?',[a,ids.get('producer')]);}
   }
  });
  await t.test('image version budgets include failed reservations and reject missing/failed references',async()=>{
   for(const[count,size]of[[200,1],[52,5242880]]){const v=await version(),values=Array.from({length:count},()=>[crypto.randomUUID(),a,deck.id,v.id,size,'0'.repeat(64),ids.get('producer')]);await sql(`INSERT INTO event_deck_images (id,event_id,deck_id,version_id,status,source_size,source_sha256,created_by_user_id,error_code,completed_at) VALUES ${values.map(()=>"(?,?,?,?,'FAILED',?,?,?,'INVALID_IMAGE',NOW())").join(',')}`,values.flat());assert.equal((await upload('producer',url(deck,v))).body.code,'VERSION_IMAGE_LIMIT');await spanish(url(deck,v));const input=configurationFixture();input.knowledge[0].questions[0].imageAssetId=values[0][0];assert.equal((await request('producer','POST',url(deck,v)+'/configuration',input)).body.code,'IMAGE_NOT_READY');}
  });
  await t.test('image audit rollback, scoped foreign key and repeatable migration preserve private boundaries',async()=>{
   const v=await version();await domain.pool.query("CREATE TRIGGER reject_image_audit BEFORE INSERT ON event_security_audit FOR EACH ROW BEGIN IF NEW.action='deck.image.complete' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRIVATE_IMAGE_FAILURE'; END IF; END");try{const r=await upload('producer',url(deck,v));assert.equal(r.status,503);assert.deepEqual(r.body,{code:'IMAGE_PREPARATION_FAILED'});}finally{await domain.pool.query('DROP TRIGGER reject_image_audit');}
   assert.deepEqual(await sql('SELECT status FROM event_deck_images WHERE version_id=?',[v.id]),[{status:'FAILED'}]);
   await assert.rejects(sql("INSERT INTO event_deck_images (id,event_id,deck_id,version_id,status,source_size,source_sha256,created_by_user_id) VALUES (?,?,?,?,'PROCESSING',1,?,?)",[crypto.randomUUID(),b,deck.id,v.id,'0'.repeat(64),ids.get('producer')]),e=>e.code==='ER_NO_REFERENCED_ROW_2');
   await sql("DELETE FROM schema_migrations WHERE id='049_event_deck_images.sql'");assert.deepEqual((await runMigrations(domain.pool)).executed,['049_event_deck_images.sql']);assert.equal((await content('producer',prepared.id)).status,200);
  });
 }finally{await domain.pool.query('DROP TRIGGER IF EXISTS reject_image_audit');for(const id of own){for(const table of ['event_deck_configurations','event_deck_images','event_deck_preparations','event_deck_versions'])await sql('DELETE FROM '+table+' WHERE deck_id=?',[id]);await sql('DELETE FROM event_decks WHERE id=?',[id]);}}
}
module.exports={imageSuite};
