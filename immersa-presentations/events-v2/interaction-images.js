const {EventAccessError}=require('./authorization');
const {isId}=require('./grant-repository');
const fail=()=>{throw new EventAccessError('INTERACTION_IMAGE_NOT_PREPARED',403);};
function imageBindings(definitions,kind){
 const bindings=[];
 for(const d of definitions)for(const item of kind==='knowledge'?d.questions:d.options){
  if(item.imageAssetId===undefined)continue;
  if(!isId(item.imageAssetId)||(kind==='raffle'&&d.mode!=='visual_key'))fail();
  bindings.push({definitionId:d.id,itemId:item.id,assetId:item.imageAssetId});
 }
 return bindings;
}
function visibleImages(snapshot,kind){
 const r=kind==='knowledge'?snapshot.execution:snapshot.active;
 const items=kind==='knowledge'?[r?.currentQuestion,...(r?.questions||[]),...(r?.definitionsSnapshot?.questions||[])]:
  [...(r?.options||[]),r?.displayOption,...(snapshot.available||[]).flatMap(d=>d.keyOptions||[])];
 return items.map(item=>item?.image).filter(Boolean);
}
class EventInteractionImages{
 constructor({content}){this.content=content;}
 url(context,liveId,kind,runId,assetId){return `/api/events-v2/live/${context.eventId}/${liveId}/${context.grantId}/interaction-images/${kind}/${runId}/${assetId}`;}
 async project(context,db,scoped,snapshot,kind){
  if(!scoped.imageBindings.length)return snapshot;
  // Engine views can contain references to their private definitions/options.
  // Decorate an isolated DTO, never persisted grading or raffle state.
  const out=structuredClone(snapshot),resources=await this.content.imageResources(scoped.prepared,db);
  const attach=(item,definitionId,runId)=>{
   if(!item)return item;const b=scoped.imageBindings.find(b=>b.definitionId===definitionId&&b.itemId===item.id);
   if(!b)return item;const resource=resources.find(r=>r.id===b.assetId);if(!resource)fail();
   return{...item,image:{url:this.url(context,scoped.prepared.liveSessionId,kind,runId,b.assetId),width:resource.width,height:resource.height}};
  };
  if(kind==='knowledge'){
   const r=out.execution;if(!r)return out;const id=scoped.run.definitionId;
   const controller=['STAGE','SPEAKER'].includes(context.kind);
   if(controller||(r.state==='ACTIVE'&&r.category==='contest'))r.currentQuestion=attach(r.currentQuestion,id,r.executionId);
   if(controller||(r.state==='ACTIVE'&&r.category==='assessment'&&!r.participant?.submittedAt))if(r.questions)r.questions=r.questions.map(q=>attach(q,id,r.executionId));
   if(r.definitionsSnapshot)r.definitionsSnapshot.questions=r.definitionsSnapshot.questions.map(q=>attach(q,id,r.executionId));
  }else{
   const r=out.active;
   if(r){if(r.options)r.options=r.options.map(option=>attach(option,scoped.body.definitionId,r.id));r.displayOption=attach(r.displayOption,scoped.body.definitionId,r.id);}
   // Only human controllers preview the catalog before opening a round.
   if(['STAGE','SPEAKER'].includes(context.kind))for(const d of out.available||[])if(d.keyOptions)d.keyOptions=d.keyOptions.map(option=>attach(option,d.id,'catalog'));
  }
  return out;
 }
 knowledge(context,db,scoped,snapshot){return this.project(context,db,scoped,snapshot,'knowledge');}
 raffle(context,db,scoped,snapshot){return this.project(context,db,scoped,snapshot,'raffle');}
}
module.exports={EventInteractionImages,imageBindings,visibleImages};
