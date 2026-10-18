const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {EventImagePrivateStore,MAX_IMAGE_BYTES}=require('../events-v2/image-private-store');
const {EventMediaService,EventImageService}=require('../events-v2/media-service');
const {normalizeConfiguration}=require('../events-v2/deck-configuration');
const {digest}=require('../events-v2/deck-private-store');
const {imageFixture}=require('./helpers/events-v2-image-fixture');
const {configurationFixture}=require('./helpers/events-v2-configuration-fixture');
const scope=()=>({eventId:crypto.randomUUID(),deckId:crypto.randomUUID(),versionId:crypto.randomUUID(),id:crypto.randomUUID()});
async function store(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'private-images-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return new EventImagePrivateStore({root});}
test('private raster preparation decodes PNG, JPEG, WebP, preserves original bytes and verifies descriptors',async t=>{
 const s=await store(t);
 for(const kind of ['png','jpg','webp']){
  const bytes=await imageFixture(kind),context=scope(),m=await s.prepare(context,bytes);
  assert.equal(m.type,'image');assert.equal(m.width,16);assert.equal(m.height,16);assert.equal(m.contentType,'image/'+(kind==='jpg'?'jpeg':kind));
  const handle=await s.verified({...context,size:bytes.length,sha256:digest(bytes)}),chunks=[];
  for await(const b of handle.createReadStream({start:0,end:bytes.length-1,autoClose:true}))chunks.push(b);
  assert.deepEqual(Buffer.concat(chunks),bytes);assert.equal((await fs.stat(path.join(s.directory(context),'media.bin'))).mode&511,256);
 }
});
test('image preparation rejects markup, playlists, truncated rasters, oversized dimensions and image sequences',async t=>{
 const s=await store(t),png=await imageFixture();
 for(const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),Buffer.from('#EXTM3U\nhttp://private.invalid'),png.subarray(0,60),await imageFixture('png','4100x2'),Buffer.concat([png,png])]){
  await assert.rejects(s.prepare(scope(),bytes),{code:'INVALID_IMAGE'});
 }
 await assert.rejects(s.prepare(scope(),Buffer.alloc(MAX_IMAGE_BYTES+1)),{code:'INVALID_IMAGE_SIZE'});
});
test('image byte corruption, symlinks and hardlinks fail before reads',async t=>{
 const s=await store(t),context=scope(),bytes=await imageFixture();await s.prepare(context,bytes);
 const row={...context,size:bytes.length,sha256:digest(bytes)},file=path.join(s.directory(context),'media.bin');
 await assert.rejects(s.verified({...row,sha256:'0'.repeat(64)}),{code:'IMAGE_INTEGRITY_FAILED'});
 const old=file+'.original';await fs.rename(file,old);await fs.symlink(old,file);
 await assert.rejects(s.verified(row),{code:'IMAGE_INTEGRITY_FAILED'});await fs.unlink(file);await fs.link(old,file);
 await assert.rejects(s.verified(row),{code:'IMAGE_INTEGRITY_FAILED'});
});
test('image and audiovisual routes share two admission slots with idempotent release',()=>{
 const preparations={domain:{}},media=new EventMediaService({preparations,root:'/tmp/events-av'}),images=new EventImageService({preparations,root:'/tmp/events-images',admission:media});
 const a=media.acquireUpload(),b=images.acquireUpload();try{assert.throws(()=>images.acquireUpload(),{code:'IMAGE_UPLOAD_BUSY'});assert.throws(()=>media.acquireUpload(),{code:'MEDIA_UPLOAD_BUSY'});}finally{a();a();b();}assert.equal(media.uploads,0);
});
test('private question and visual raffle references accept UUIDs and reject forged URLs and descriptors',()=>{
 const input=configurationFixture(),id=crypto.randomUUID();input.knowledge[0].questions[0].imageAssetId=id;
 input.raffles[0]={id:'raffle-a',mode:'visual_key',title:'Visual',prompt:'Elige',entryKey:'a',options:['a','b','c','d'].map(id=>({id,label:id,imageAssetId:crypto.randomUUID()}))};
 const result=normalizeConfiguration(input,2);assert.equal(result.knowledge[0].questions[0].imageAssetId,id);assert.deepEqual(result.raffles[0].options.map(o=>o.imageAssetId),input.raffles[0].options.map(o=>o.imageAssetId));
 for(const change of [x=>{x.knowledge[0].questions[0].imageAssetId='/decks/foreign';},x=>{x.knowledge[0].questions[0].imageAssetId={id};},x=>{x.images=[];},x=>{x.raffles[0].options[0].url='https://foreign';},x=>{x.raffles[0].mode='poll';}]){
  const x=structuredClone(input);change(x);assert.throws(()=>normalizeConfiguration(x,2),{code:'INVALID_CONFIGURATION'});
 }
});
