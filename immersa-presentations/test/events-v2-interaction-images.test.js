const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {EventInteractionImages,imageBindings,visibleImages}=require('../events-v2/interaction-images');
const ui=require('../public/events-v2/interaction-images');
const id=()=>crypto.randomUUID();
function fixture(){const eventId=id(),liveSessionId=id(),grantId=id(),assetId=id(),runId=id(),otherId=id();
 const context={eventId,grantId,kind:'STAGE'},prepared={eventId,liveSessionId},imageBindings=[{definitionId:'quiz',itemId:'q',assetId},{definitionId:'visual',itemId:'a',assetId}];
 const content={imageResources:async()=>[{id:assetId,width:64,height:32}]},delivery=new EventInteractionImages({content});
 return{context,prepared,assetId,runId,otherId,delivery,scoped:{prepared,imageBindings,run:{definitionId:'quiz'},body:{definitionId:'visual'}}};}
test('private image references reject URLs and non-visual raffle assets',()=>{
 assert.throws(()=>imageBindings([{id:'q',questions:[{id:'1',imageAssetId:'/decks/secret.png'}]}],'knowledge'),{code:'INTERACTION_IMAGE_NOT_PREPARED'});
 assert.throws(()=>imageBindings([{id:'r',mode:'poll',options:[{id:'a',imageAssetId:id()}]}],'raffle'),{code:'INTERACTION_IMAGE_NOT_PREPARED'});
});
test('knowledge images decorate isolated role DTOs without changing persisted engine definitions',async()=>{
 const f=fixture(),q={id:'q',prompt:'Question',image:null},snapshot={execution:{executionId:f.runId,state:'LOBBY',category:'contest',currentQuestion:q,definitionsSnapshot:{questions:[q]}}};
 const before=structuredClone(snapshot),out=await f.delivery.knowledge(f.context,{},f.scoped,snapshot);assert.deepEqual(snapshot,before);assert.match(out.execution.currentQuestion.image.url,/interaction-images\/knowledge/);assert.equal(out.execution.definitionsSnapshot.questions[0].image.width,64);
 assert.equal(visibleImages(out,'knowledge').length,2);
 const publicOut=await f.delivery.knowledge({...f.context,kind:'PARTICIPANT'},{},f.scoped,{execution:{executionId:f.runId,state:'LOBBY',category:'contest',currentQuestion:q}});assert.equal(visibleImages(publicOut,'knowledge').length,0);
});
test('raffle preview is controller-only and active images never mutate source options',async()=>{
 const f=fixture(),option={id:'a',label:'A'},snapshot={active:{id:f.runId,options:[option],displayOption:option},available:[{id:'visual',keyOptions:[option]}]};
 const out=await f.delivery.raffle(f.context,{},f.scoped,snapshot);assert.match(out.available[0].keyOptions[0].image.url,/\/catalog\//);assert.equal(option.image,undefined);
 const player=await f.delivery.raffle({...f.context,kind:'PLAYER'},{},f.scoped,{active:{id:f.runId,options:[],displayOption:option},available:snapshot.available});assert.equal(player.available[0].keyOptions[0].image,undefined);assert.match(player.active.displayOption.image.url,new RegExp(f.runId));
});
test('missing approved descriptor fails instead of publishing a guessed or legacy URL',async()=>{
 const f=fixture();f.scoped.imageBindings[0].assetId=f.otherId;
 await assert.rejects(f.delivery.knowledge(f.context,{},f.scoped,{execution:{executionId:f.runId,state:'ACTIVE',category:'contest',currentQuestion:{id:'q'}}}),{code:'INTERACTION_IMAGE_NOT_PREPARED'});
});
test('UI accepts only typed same-origin image URLs and clears stale images on authority loss',()=>{
 class Element{constructor(){this.children=[];this.handlers={};}append(x){this.children.push(x);}replaceChildren(){this.children=[];}addEventListener(k,v){this.handlers[k]=v;}}
 const document={createElement:()=>new Element()},parent=new Element(),f=fixture(),image={url:f.delivery.url(f.context,f.prepared.liveSessionId,'knowledge',f.runId,f.assetId),width:64,height:32};
 for(const url of ['https://foreign.invalid/x','javascript:alert(1)','/decks/x.jpg',image.url+'?token=secret',image.url+'#x'])assert.equal(Boolean(ui.valid({...image,url})),false);
 ui.render(document,parent,image);const first=parent.children[0];ui.render(document,parent,image);assert.equal(parent.children[0],first);assert.equal(first.referrerPolicy,'no-referrer');assert.equal(first.alt,'');
 ui.render(document,parent,null);assert.equal(parent.hidden,true);assert.equal(parent.children.length,0);first.handlers.error();assert.equal(parent.hidden,true);
});
