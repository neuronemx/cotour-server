const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {EventDeckPrivateStore,digest}=require('../events-v2/deck-private-store');
const {EventDeckCheckService}=require('../events-v2/deck-check-service');
const {pdfFixture}=require('./helpers/events-v2-pdf-fixture');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'deck-check-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=new EventDeckPrivateStore({root}),scope={eventId:crypto.randomUUID(),deckId:crypto.randomUUID(),versionId:crypto.randomUUID(),attemptId:crypto.randomUUID()},bytes=pdfFixture(2),prepared=await store.prepare(scope,bytes);return{store,scope,row:{...scope,manifestJson:prepared.json,manifestDigest:prepared.digest,sourceSize:bytes.length,sourceSha256:digest(bytes),slideCount:2}};}
test('DeckCheck reads original, manifest, every full slide and every thumbnail',async t=>{
 const {store,row}=await fixture(t),report=await store.verify(row);assert.equal(report.slides,2);assert.equal(report.files,6);assert.ok(report.bytes>row.sourceSize);
 for(const file of ['original.pdf','slides/slide-002.jpg','thumbs/slide-002.jpg','manifest.json']){
  const absolute=path.join(store.directory(row),file),bytes=await fs.readFile(absolute);await fs.chmod(absolute,384);await fs.writeFile(absolute,Buffer.alloc(bytes.length));
  try{await assert.rejects(store.verify(row),{code:'PREPARATION_INTEGRITY_FAILED'});}finally{await fs.writeFile(absolute,bytes);await fs.chmod(absolute,256);}
 }
});
test('DeckCheck refuses noncanonical manifest variants, context substitution and inconsistent source metadata',async t=>{
 const {store,row}=await fixture(t);
 for(const change of [m=>{m.slides[1].thumb.file='thumbs/slide-001.jpg';},m=>{m.eventId=crypto.randomUUID();},m=>{m.source.sha256='0'.repeat(64);},m=>{m.slides.pop();}]){
  const m=JSON.parse(row.manifestJson);change(m);const json=JSON.stringify(m),file=path.join(store.directory(row),'manifest.json');await fs.chmod(file,384);await fs.writeFile(file,json);
  await assert.rejects(store.verify({...row,manifestJson:json,manifestDigest:digest(json)}),{code:'PREPARATION_INTEGRITY_FAILED'});
 }
});
test('DeckCheck admission allows one complete verification and releases once',()=>{
 const service=new EventDeckCheckService({configurations:{preparations:{},domain:{}}}),release=service.acquire();assert.throws(()=>service.acquire(),{code:'DECK_CHECK_BUSY'});release();release();assert.equal(service.running,0);service.acquire()();
});
