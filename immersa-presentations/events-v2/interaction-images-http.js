const express=require('express');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {EventAccessError}=require('./authorization');
const {isId}=require('./grant-repository');
const {browserToken}=require('./grant-http');
const {byteRange}=require('./asset-http');
const {visibleImages}=require('./interaction-images');
const deny=()=>{throw new EventAccessError('INTERACTION_IMAGE_ACCESS_DENIED',403);};
function createEventInteractionImageRouter({grants,images,knowledge,raffles,enabled=()=>false}){
 const router=express.Router(),prefix='/live/:eventId/:liveId/:grantId/interaction-images';
 router.use(prefix,(_req,res,next)=>{
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; sandbox"});
  if(!enabled())return res.status(404).json({code:'EVENTS_V2_DISABLED'});
  if(!grants||!images||!knowledge||!raffles)return res.status(503).json({code:'AUTHORIZATION_UNAVAILABLE'});next();
 });
 router.get(prefix+'/:kind/:runId/:assetId',async(req,res)=>{
  let size;
  try{
   const {eventId,liveId,grantId,kind,runId,assetId}=req.params;
   if(![eventId,liveId,grantId,assetId].every(isId)||!['knowledge','raffle'].includes(kind)||(!isId(runId)&&runId!=='catalog')||Object.keys(req.query).length||req.headers['sec-fetch-site']==='cross-site')deny();
   const runtime=kind==='knowledge'?knowledge:raffles;
   const descriptor=await grants.withBrowser({eventId,grantId,token:browserToken(req.headers,grantId)},async(context,db)=>{
    if(!enabled()||!runtime.live.enabled())deny();
    const prepared=await runtime.live.prepared(context,db,liveId),snapshot=await runtime.projection(context,db,liveId,prepared);
    const url=images.url(context,liveId,kind,runId,assetId);
    if(!visibleImages(snapshot,kind).some(image=>image.url===url))deny();
    const descriptor=await images.content.readInteractionImage(prepared,assetId,db);
    if(!descriptor?.verified||!Number.isSafeInteger(descriptor.size)||descriptor.size<1||descriptor.size>5*1024*1024||!/^[a-f0-9]{64}$/.test(descriptor.sha256)||!['image/png','image/jpeg','image/webp'].includes(descriptor.contentType)||typeof descriptor.open!=='function')deny();
    if(!enabled()||!runtime.live.enabled())deny();return descriptor;
   });
   if(!enabled()||!runtime.live.enabled())deny();size=descriptor.size;const etag='"'+descriptor.sha256+'"';
   res.set({ETag:etag,'Accept-Ranges':'bytes','Content-Type':descriptor.contentType});
   if(req.headers['if-none-match']===etag)return res.status(304).end();
   const range=byteRange(req.method==='HEAD'||(req.headers['if-range']&&req.headers['if-range']!==etag)?null:req.headers.range,size);
   res.set('Content-Length',String(range.end-range.start+1));if(range.partial)res.set('Content-Range',`bytes ${range.start}-${range.end}/${size}`);
   res.status(range.partial?206:200);if(req.method==='HEAD')return res.end();
   const body=await descriptor.open(range.start,range.end);if(!enabled()||!runtime.live.enabled()){body?.destroy?.();deny();}if(!(body instanceof Readable))deny();await pipeline(body,res);
  }catch(error){
   if(res.headersSent)return res.destroy();res.removeHeader('Content-Length');res.removeHeader('Content-Type');res.removeHeader('ETag');
   if(error.code==='AV_INVALID_RANGE'){if(Number.isSafeInteger(size))res.set('Content-Range',`bytes */${size}`);return res.status(416).json({code:'INTERACTION_IMAGE_INVALID_RANGE'});}
   if(error instanceof EventAccessError)return res.status(error.statusCode).json({code:error.code});
   return res.status(503).json({code:'AUTHORIZATION_UNAVAILABLE'});
  }
 });
 router.use(prefix,(_req,res)=>res.status(404).json({code:'RESOURCE_NOT_FOUND'}));return router;
}
module.exports={createEventInteractionImageRouter};
