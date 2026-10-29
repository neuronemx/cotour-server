const {Readable}=require('node:stream');
const {EventAccessError}=require('./authorization');
const {normalizeSlides}=require('./slides-runtime');
const {digest}=require('./deck-private-store');
const fail=(code='CONTENT_NOT_PREPARED',status=403)=>{throw new EventAccessError(code,status);};
function jpegSize(b){
 if(b.length<4 || b[0]!==255 || b[1]!==216) fail();let at=2;
 while(at+9<b.length){while(b[at]===255)at++;const marker=b[at++];if(marker===217||marker===218)break;
  if(at+2>b.length)break;const n=b.readUInt16BE(at);if(n<2||at+n>b.length)break;
  if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
   if(n<7)fail();
   const height=b.readUInt16BE(at+3),width=b.readUInt16BE(at+5);if(width<1||height<1||width>16384||height>16384)fail();return{width,height};
  }at+=n;
 }fail();
}
class EventApprovedContent {
 constructor({checks,interactionImages=false}){this.interactionImages=interactionImages;this.checks=checks;this.configurations=checks.configurations;this.preparations=checks.preparations;this.cache=new Map();}
 async version(db,scope){
  const snapshot=await this.checks.snapshot(db,scope),row=await this.checks.row(db,scope);if(!row)fail();
  this.checks.stored(row,snapshot);
  const {configuration}=await this.configurations.read(db,scope);
  // Image-bearing interactions need a typed delivery adapter, rather than
  // being silently normalized into text by the established engines.
  // Admission is enabled only with the server-installed typed adapter.
  if(snapshot.images.length&&!this.interactionImages)fail('CONTENT_RUNTIME_NOT_READY');
  return{snapshot,row,configuration};
 }
 async candidate(db,context,activity){
  const [rows]=await db.execute(`SELECT event_id AS eventId,activity_id AS activityId,deck_id AS deckId,version_id AS versionId,
    manifest_digest AS manifestDigest,slide_count AS slideCount,revision FROM event_activity_deck_bindings WHERE event_id=? AND activity_id=? FOR UPDATE`,[context.eventId,activity.id]);
  const binding=rows[0];if(!binding?.versionId)fail();
  const scope={eventId:context.eventId,deckId:binding.deckId,versionId:binding.versionId};
  const version=await this.version(db,scope);
  if(binding.manifestDigest!==version.snapshot.spanish.manifestDigest || binding.slideCount!==version.snapshot.spanish.slideCount)fail('CONTENT_VERSION_CHANGED');
  return{...version,binding,scope};
 }
 async verify(candidate){
  const report=await this.checks.verify(candidate.snapshot);this.checks.stored(candidate.row,candidate.snapshot,report);
  await this.slides(candidate);this.preparations.checkEnabled();
 }
 async pin(db,context,activity,ticket,liveId){
  const current=await this.candidate(db,context,activity);
  if(current.binding.revision!==ticket.binding.revision || current.row.approvalDigest!==ticket.row.approvalDigest
    || current.snapshot.bundleDigest!==ticket.snapshot.bundleDigest)fail('CONTENT_VERSION_CHANGED');
  await db.execute(`INSERT INTO event_live_content
    (live_session_id,event_id,deck_id,version_id,binding_revision,manifest_digest,configuration_digest,bundle_digest,approval_digest)
    VALUES (?,?,?,?,?,?,?,?,?)`,[liveId,context.eventId,current.scope.deckId,current.scope.versionId,current.binding.revision,
    current.binding.manifestDigest,current.row.configurationDigest,current.row.bundleDigest,current.row.approvalDigest]);
 }
 async load(live,db){
  this.preparations.checkEnabled();
  const [rows]=await db.execute(`SELECT p.event_id AS eventId,p.deck_id AS deckId,p.version_id AS versionId,
    p.manifest_digest AS manifestDigest,p.configuration_digest AS configurationDigest,p.bundle_digest AS bundleDigest,p.approval_digest AS approvalDigest
    FROM event_live_content p JOIN event_live_sessions l ON l.id=p.live_session_id AND l.event_workspace_id=p.event_id AND l.deck_id=p.deck_id
    WHERE p.live_session_id=? AND p.event_id=? AND l.status='LIVE' AND l.ended_at IS NULL`,[live.liveSessionId,live.eventId]);
  const pin=rows[0];if(!pin || pin.deckId!==live.deckId || (live.versionId&&pin.versionId!==live.versionId))fail();
  const current=await this.version(db,pin);
  if(['configurationDigest','bundleDigest','approvalDigest'].some(k=>pin[k]!==current.row[k]) || pin.manifestDigest!==current.snapshot.spanish.manifestDigest)fail('CONTENT_VERSION_CHANGED');
  return{...current,scope:pin};
 }
 async slides(current){
  const key=current.snapshot.bundleDigest;
  if(this.cache.has(key))return this.cache.get(key);
  const cfg=current.configuration,englishEnabled=cfg.language?.englishEnabled===true;
  const catalog={englishEnabled,presenterLanguage:cfg.language?.presenterLanguage||'es',slides:[]};
  for(let i=0;i<current.snapshot.spanish.slideCount;i++){
   const s={};for(const [language,row,service]of [['es',current.snapshot.spanish,this.preparations],['en',current.snapshot.english,this.configurations.translations]]){
    if(language==='en'&&!englishEnabled)continue;if(!row)fail();const id='slide-'+String(i+1).padStart(3,'0');
    const variant={notes:cfg.slides[i].notes[language]||''};
    for(const name of ['full','thumb']){this.preparations.checkEnabled();const bytes=await service.store.image(row,id,name);
     variant[name]={assetId:`${language}-${id}-${name}`,size:bytes.length,sha256:digest(bytes),contentType:'image/jpeg',...jpegSize(bytes)};
    }s[language]=variant;
   }catalog.slides.push(s);
  }
  const normalized=normalizeSlides(catalog,current.snapshot.spanish.slideCount);
  this.cache.set(key,normalized);if(this.cache.size>8)this.cache.delete(this.cache.keys().next().value);return normalized;
 }
 async readPreparation(live,db){const c=await this.load(live,db),s=await this.slides(c);return{...live,versionId:c.scope.versionId,slideCount:c.snapshot.spanish.slideCount,slideDigest:s.digest};}
 async readSlides(live,db){const c=await this.load(live,db);return{...live,versionId:c.scope.versionId,...await this.slides(c)};}
 async catalog(live,db,name){const c=await this.load(live,db);return{...live,versionId:c.scope.versionId,[name]:c.configuration[name]||[]};}
 async readAV(live,db){const c=await this.load(live,db),{publicId,...av}=c.configuration.av||{resources:[],playlists:[]};return{...live,versionId:c.scope.versionId,...av,...(publicId?{publicId}:{})};}
 async readImage(live,resource,db){return this.preparedImage(await this.load(live,db),resource);}
 async preparedImage(c,resource){
  const catalog=await this.slides(c),m=/^(es|en)-(slide-\d{3})-(full|thumb)$/.exec(resource.assetId);
  if(!m)fail();const index=Number(m[2].slice(6))-1,expected=catalog.slides[index]?.[m[1]]?.[m[3]];
  if(!expected||JSON.stringify(expected)!==JSON.stringify(resource))fail('CONTENT_VERSION_CHANGED');
  const service=m[1]==='es'?this.preparations:this.configurations.translations,row=m[1]==='es'?c.snapshot.spanish:c.snapshot.english;
  const bytes=await service.store.image(row,m[2],m[3]);if(bytes.length!==resource.size||digest(bytes)!==resource.sha256)fail();
  return{verified:true,size:bytes.length,sha256:resource.sha256,contentType:resource.contentType,open:async(start,end)=>Readable.from([bytes.subarray(start,end+1)])};
 }
 interactionImageMetadata(c){return c.snapshot.images.map(row=>this.configurations.images.metadata(row));}
 async imageResources(live,db){return this.interactionImageMetadata(await this.load(live,db));}
 async readInteractionImage(live,id,db){
  return this.preparedInteractionImage(await this.load(live,db),id);
 }
 async preparedInteractionImage(c,id){
  const row=c.snapshot.images.find(row=>row.id===id);if(!row)fail();
  const service=this.configurations.images,metadata=service.metadata(row),handle=await service.store.verified(row),parts=[];
  try{for await(const chunk of handle.createReadStream({start:0,end:row.size-1,autoClose:false}))parts.push(chunk);}finally{await handle.close();}
  const bytes=Buffer.concat(parts);if(bytes.length!==row.size||digest(bytes)!==row.sha256)fail();this.preparations.checkEnabled();
  return{verified:true,size:row.size,sha256:row.sha256,contentType:metadata.contentType,open:async(start,end)=>Readable.from([bytes.subarray(start,end+1)])};
 }
 async readAsset(live,resource,db){
  return this.preparedAsset(await this.load(live,db),resource);
 }
 async preparedAsset(c,resource){
  const row=c.snapshot.media.find(r=>r.id===resource.assetId);
  if(!row||row.size!==resource.size||row.sha256!==resource.sha256)fail();const service=this.configurations.media,m=service.metadata(row);
  if(m.contentType!==resource.contentType)fail();const checked=await service.store.verified(row);await checked.close();
  return{verified:true,size:row.size,sha256:row.sha256,contentType:m.contentType,open:async(start,end)=>{
   const handle=await service.store.verified(row);try{this.preparations.checkEnabled();return handle.createReadStream({start,end,autoClose:true});}catch(e){await handle.close();throw e;}
  }};
 }
}
module.exports={EventApprovedContent,jpegSize};
