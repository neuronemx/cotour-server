const multer = require('multer');
const { pipeline } = require('node:stream/promises');
const { EventAccessError, accountActor } = require('./authorization');
const { requireOrigin } = require('./grant-http');
const { byteRange } = require('./asset-http');
function attachMediaRoutes(router,service,eventPath) {
  if (!service) return;
  const base=eventPath+'/decks/:deckId/versions/:versionId/'+service.collection;
  const scope=req=>({organizationId:req.params.orgId,eventId:req.params.eventId,deckId:req.params.deckId,versionId:req.params.versionId});
  const noQuery=req=>{if(Object.keys(req.query).length)throw new EventAccessError('INVALID_FIELDS',400);};
  const reply=(res,e)=>e instanceof EventAccessError?res.status(e.statusCode).json({code:e.code}):res.status(503).json({code:service.code('MEDIA_UNAVAILABLE')});
  const multipart=multer({storage:multer.memoryStorage(),limits:{fileSize:service.maxBytes,files:1,fields:service.kind==='media'?3:1,parts:service.kind==='media'?5:3,fieldNameSize:32,fieldSize:480,headerPairs:32}}).single(service.kind);
  router.post(base,requireOrigin,async(req,res)=>{
    let release;
    try {
      noQuery(req);const actor=accountActor(req);await service.authorize(actor,scope(req));release=service.acquireUpload();
      await new Promise((resolve,reject)=>multipart(req,res,e=>e?reject(e):resolve()));
      const fields=Object.keys(req.body||{}),fx=service.kind==='media'&&req.body?.category==='fx';
      if(!req.file||fields.length!==(fx?3:1)||fields.some(k=>!(fx?['name','category','cue']:['name']).includes(k))||typeof req.body.name!=='string')throw new EventAccessError(service.code('INVALID_MEDIA_UPLOAD'),400);
      return res.status(201).json(await service.upload(actor,scope(req),req.body.name,req.file.buffer,fx?{category:'fx',cue:req.body.cue}:{}));
    }catch(e){if(e instanceof multer.MulterError)return res.status(e.code==='LIMIT_FILE_SIZE'?413:400).json({code:service.code('INVALID_MEDIA_UPLOAD')});return reply(res,e);}
    finally{release?.();}
  });
  router.get(base,async(req,res)=>{try{noQuery(req);return res.json(await service.list(accountActor(req),scope(req)));}catch(e){return reply(res,e);}});
  router.get(base+'/:assetId/content',async(req,res)=>{
    let handle,size;
    try {
      noQuery(req);if(req.headers['sec-fetch-site']==='cross-site')throw new EventAccessError('ORIGIN_DENIED',403);
      const opened=await service.open(accountActor(req),scope(req),req.params.assetId);handle=opened.handle;
      const m=opened.metadata;size=m.size;let range;
      try{range=byteRange(req.method==='HEAD'?null:req.headers.range,size);}catch(_){res.set('Content-Range',`bytes */${size}`);throw new EventAccessError(service.kind === 'image' ? 'IMAGE_INVALID_RANGE' : 'AV_INVALID_RANGE',416);}
      service.preparations.checkEnabled();
      res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        'Cross-Origin-Resource-Policy':'same-origin','Content-Type':m.contentType,'Accept-Ranges':'bytes','Content-Length':String(range.end-range.start+1)});
      if(range.partial)res.set('Content-Range',`bytes ${range.start}-${range.end}/${size}`);
      res.status(range.partial?206:200);if(req.method==='HEAD')return res.end();
      const body=handle.createReadStream({start:range.start,end:range.end,autoClose:true});handle=null;
      await pipeline(body,res);
    }catch(e){if(res.headersSent)return res.destroy();res.removeHeader('Content-Length');return reply(res,e);}
    finally{await handle?.close();}
  });
}
module.exports={attachMediaRoutes};
