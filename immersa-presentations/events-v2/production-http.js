const express=require('express'),path=require('node:path');
const {EventProductionRepository}=require('./production-repository');
const {requireOrigin}=require('./grant-http');
function attachProductionRoutes(router,{repository,handle,requirePlatformAdmin}){
 if(!repository)return;const production=new EventProductionRepository(repository),root='/organizations/:orgId/events/:eventId';
 const args=req=>[req.params.orgId,req.params.eventId];
 router.post('/platform/pilot-organization',requirePlatformAdmin,requireOrigin,handle((req,actor)=>repository.createOrganization(actor,{name:req.body.name,adminUserId:actor,createEventsEnabled:true}),['name'],201));
 router.get(root+'/production',handle((req,actor)=>production.snapshot(actor,...args(req))));
 router.post(root+'/stages',requireOrigin,handle((req,actor)=>production.stage(actor,...args(req),req.body.name),['name'],201));
 router.post(root+'/activities',requireOrigin,handle((req,actor)=>production.activity(actor,...args(req),req.body),['title','stageId','accessLevel'],201));
 router.post(root+'/public-access',requireOrigin,handle((req,actor)=>production.publicAccess(actor,...args(req),req.body.audienceLevel),['audienceLevel'],201));
}
function createProductionPages({enabled,requireAccount}){
 const router=express.Router();
 router.use(['/production','/join'],(_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});if(!enabled())return res.status(404).json({code:'EVENTS_V2_DISABLED'});next();});
 router.get('/production',requireAccount,(_req,res)=>res.sendFile(path.join(__dirname,'production.html')));
 router.get('/join/:publicId',(req,res)=>/^[A-Za-z0-9_-]{1,96}$/.test(req.params.publicId)&&!Object.keys(req.query).length?res.sendFile(path.join(__dirname,'join.html')):res.sendStatus(404));
 return router;
}
module.exports={attachProductionRoutes,createProductionPages};
