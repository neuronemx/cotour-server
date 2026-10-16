const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {EventSlidesRuntime,normalizeSlides}=require('../events-v2/slides-runtime');
const {normalize}=require('../public/events-v2/slides-console');
const {executionKey}=require('../events-v2/live-runtime');
function fixture(){
 const resource={assetId:'image',size:5,sha256:crypto.createHash('sha256').update('image').digest('hex'),contentType:'image/png',width:1,height:1};
 const data={englishEnabled:true,presenterLanguage:'en',slides:[{es:{full:resource,notes:'Español <b>literal</b>'},en:{full:resource,notes:'English'}},{es:{full:resource,notes:'Después'}}]};
 const p={eventId:'e',liveSessionId:'l',stageId:'s',activityId:'a',deckId:'d',versionId:'v',slideCount:2,slideDigest:normalizeSlides(data,2).digest};
 const state={...p,liveSlideIndex:0,presenterSlideIndex:0,revision:3};
 const live={enabled:()=>true,states:new Map([[executionKey('e','l'),state]]),prepared:async()=>p};
 return {data,p,state,runtime:new EventSlidesRuntime({liveRuntime:live,readSlides:async()=>({...p,...data})})};
}
test('private prepared notes are bounded literal data pinned by the image/language digest',async()=>{
 const h=fixture(),c={eventId:'e',grantId:'g',kind:'SPEAKER'};
 const first=await h.runtime.projection(c,null,'l',h.p);assert.equal(first.prompter.current.text,'English');assert.equal(first.prompter.next.text,'Después');
 for(const notes of ['Changed',undefined]){h.data.slides[0].en.notes=notes;if(notes===undefined)delete h.data.slides[0].en.notes;await assert.rejects(h.runtime.projection(c,null,'l',h.p),/CONTENT_VERSION_CHANGED/);}
 for(const notes of [null,{},'a'.repeat(8001),'bad\u0000text']){const d=fixture().data;d.slides[0].es.notes=notes;assert.throws(()=>normalizeSlides(d,2),/SLIDES_CONTENT_NOT_PREPARED/);}
});
test('Speaker and Stage follow paused control, fall back per note and never share notes with Público or Player',async()=>{
 const h=fixture();h.data.slides[0].en.notes=' ';h.p.slideDigest=h.state.slideDigest=normalizeSlides(h.data,2).digest;
 for(const kind of ['STAGE','SPEAKER','PLAYER','PARTICIPANT']){
  const c={eventId:'e',grantId:'g',kind},s=await h.runtime.projection(c,null,'l',h.p,'en');
  if(['STAGE','SPEAKER'].includes(kind)){assert.equal(s.preview.language,'en');assert.deepEqual(s.prompter.current,{index:0,language:'es',text:'Español <b>literal</b>'});}
  else {assert.equal(s.prompter,undefined);assert.equal(JSON.stringify(s).includes('literal'),false);}
 }
 h.state.presenterSlideIndex=1;h.state.transmissionPaused=true;
 const s=await h.runtime.projection({eventId:'e',grantId:'g',kind:'SPEAKER'},null,'l',h.p);
 assert.equal(s.slide.index,0);assert.equal(s.prompter.current.index,1);assert.equal(s.prompter.current.text,'Después');assert.equal(s.prompter.next,null);
});
test('client refuses malformed private notes and strips unexpected participant-only projection fields',async()=>{
 const h=fixture(),c={eventId:'e',grantId:'g',kind:'SPEAKER'},s=await h.runtime.projection(c,null,'l',h.p);
 assert.equal(normalize(s,c,'l').prompter.current.text,'English');assert.equal(normalize(s,{...c,kind:'PLAYER'},'l').prompter,undefined);
 for(const mutate of [s=>s.prompter.current.index++,s=>s.prompter.current.language='de',s=>s.prompter.current.text='a'.repeat(8001),s=>s.prompter.current.text='bad\u0000text',s=>s.prompter.next.index=0]){const bad=structuredClone(s);mutate(bad);assert.throws(()=>normalize(bad,c,'l'),/INVALID_SLIDES_RESPONSE/);}
});
