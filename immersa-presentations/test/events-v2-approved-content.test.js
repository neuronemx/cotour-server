const test=require('node:test'),assert=require('node:assert/strict');
const {EventApprovedContent,jpegSize}=require('../events-v2/approved-content');
const {normalizeAV}=require('../events-v2/av-runtime');
const {digest}=require('../events-v2/deck-private-store');
function fixture(){
 const jpeg=Buffer.from('ffd8ffc00011080010002003012200021101031100ffd9','hex');let enabled=true,reads=0;
 const row={eventId:'event',deckId:'deck',versionId:'v1',manifestDigest:'manifest',configurationDigest:'cfg',bundleDigest:'bundle',approvalDigest:'approval'};
 const snapshot={spanish:{slideCount:1,manifestDigest:'manifest'},english:{slideCount:1},images:[],media:[],bundleDigest:'bundle'};
 const configuration={language:{englishEnabled:true,presenterLanguage:'es'},slides:[{notes:{es:'PRIVATE',en:'PRIVATE EN'}}],av:{resources:[],playlists:[],publicId:null},polls:[]};
 const preparations={checkEnabled(){if(!enabled)throw Object.assign(new Error(),{code:'EVENTS_V2_DISABLED'});},store:{image:async()=>{reads++;return jpeg;}}};
 const checks={preparations,configurations:{preparations,translations:preparations,read:async()=>({configuration})},snapshot:async()=>snapshot,row:async()=>row,stored(){},verify:async()=>({})};
 const content=new EventApprovedContent({checks}),live={eventId:'event',deckId:'deck',liveSessionId:'live',versionId:'v1'};
 let pin={...row};const db={execute:async()=>[[pin].filter(Boolean)]};
 return{content,checks,live,db,row,snapshot,configuration,jpeg,reads:()=>reads,disable:()=>{enabled=false;},pin:v=>{pin=v;}};
}
test('approved reader pins the SQL version and approval, including on cache hits',async()=>{
 const f=fixture();const first=await f.content.readPreparation(f.live,f.db);assert.equal(first.versionId,'v1');assert.match(first.slideDigest,/^[a-f0-9]{64}$/);assert.equal(f.reads(),4);
 await f.content.readPreparation(f.live,f.db);assert.equal(f.reads(),4);
 for(const key of ['versionId','deckId','manifestDigest','configurationDigest','bundleDigest','approvalDigest']){
  f.pin({...f.row,[key]:'other'});await assert.rejects(f.content.readPreparation(f.live,f.db));
 }
 f.pin(null);await assert.rejects(f.content.readSlides(f.live,f.db),{code:'CONTENT_NOT_PREPARED'});
 f.pin(f.row);f.disable();await assert.rejects(f.content.readSlides(f.live,f.db),{code:'EVENTS_V2_DISABLED'});
});
test('approved reader compiles both languages and verifies image bytes even with a warm catalog',async()=>{
 const f=fixture(),catalog=await f.content.readSlides(f.live,f.db);assert.equal(catalog.slides[0].es.notes,'PRIVATE');assert.equal(catalog.slides[0].en.notes,'PRIVATE EN');
 const resource=catalog.slides[0].en.full,descriptor=await f.content.readImage(f.live,resource,f.db);assert.equal(f.reads(),5);
 const chunks=[];for await(const c of await descriptor.open(2,8))chunks.push(c);assert.deepEqual(Buffer.concat(chunks),f.jpeg.subarray(2,9));
 await assert.rejects(f.content.readImage(f.live,{...resource,sha256:'0'.repeat(64)},f.db),{code:'CONTENT_VERSION_CHANGED'});
 f.checks.preparations.store.image=async()=>Buffer.alloc(f.jpeg.length);
 await assert.rejects(f.content.readImage(f.live,resource,f.db),{code:'CONTENT_NOT_PREPARED'});
});
test('image interactions are denied at admission; absent QR compiles into a valid AV catalog',async()=>{
 const f=fixture();assert.deepEqual(normalizeAV(await f.content.readAV(f.live,f.db)),{resources:[],playlists:[],publicId:null});
 f.snapshot.images.push({id:'pending-adapter'});await assert.rejects(f.content.readPreparation(f.live,f.db),{code:'CONTENT_RUNTIME_NOT_READY'});
});
test('media descriptors close verification handles before HEAD and reverify the streamed file',async()=>{
 const f=fixture(),bytes=Buffer.from('media'),resource={assetId:'asset',size:bytes.length,sha256:digest(bytes),contentType:'audio/wav'};let closes=0,opens=0;
 f.snapshot.media=[{id:'asset',size:resource.size,sha256:resource.sha256}];
 f.checks.configurations.media={metadata:()=>({contentType:'audio/wav'}),store:{verified:async()=>{opens++;return{close:async()=>{closes++;},createReadStream:options=>({options})};}}};
 const descriptor=await f.content.readAsset(f.live,resource,f.db);assert.equal(closes,1);assert.equal(opens,1);
 assert.deepEqual((await descriptor.open(1,3)).options,{start:1,end:3,autoClose:true});assert.equal(opens,2);
 f.disable();await assert.rejects(descriptor.open(0,2),{code:'EVENTS_V2_DISABLED'});assert.equal(closes,2);
});
test('malformed and oversized JPEG dimensions fail closed',()=>{
 for(const bytes of [Buffer.alloc(30),Buffer.from('ffd8ffc0000208001000200000000000000000','hex'),Buffer.from('ffd8ffc00011080000400103012200021101031100ffd9','hex')])assert.throws(()=>jpegSize(bytes),{code:'CONTENT_NOT_PREPARED'});
 assert.deepEqual(jpegSize(fixture().jpeg),{width:32,height:16});
});
