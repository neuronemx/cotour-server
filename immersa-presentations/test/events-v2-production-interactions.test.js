const test=require('node:test'),assert=require('node:assert/strict');
const editor=require('../public/events-v2/production-interactions'),{normalizeConfiguration}=require('../events-v2/deck-configuration');
const base=()=>({slides:[1,2].map(i=>({id:'slide-00'+i,notes:{es:'Apuntes '+i}})),polls:[],knowledge:[],raffles:[],games:[]});
function valid(type){const v=editor.create(type);v.title='<Título>';if(type==='free')v.prompt='Participa';else Object.assign(v.questions[0],{prompt:'Pregunta propia',options:'Una\nDos',correct:2});return v;}
test('editor maps multiple activities per slide, preserves notes and existing configuration without mutation or ID collisions',()=>{
 const input=base();input.polls.push({id:'interaction-1',type:'poll',title:'Encuesta',prompt:'¿Qué?',options:[{id:'a',label:'A'},{id:'b',label:'B'}]});input.slides[0].pollIds=['interaction-1'];input.language={englishEnabled:false,presenterLanguage:'es'};
 const original=structuredClone(input),out=editor.append(input,[[valid('contest'),valid('free')],[valid('assessment')]]);assert.deepEqual(input,original);
 const normalized=normalizeConfiguration(out,2);assert.equal(normalized.slides[0].notes.es,'Apuntes 1');assert.equal(normalized.slides[0].pollIds[0],'interaction-1');assert.equal(normalized.slides[0].knowledgeIds.length,1);assert.equal(normalized.slides[1].knowledgeIds.length,1);assert.equal(normalized.slides[1].raffleIds.length,0);assert.equal(normalized.knowledge[0].id,'interaction-2');assert.equal(normalized.language.englishEnabled,false);
 assert.equal(editor.read(normalized,0).length,2);assert.equal(editor.read(normalized,1)[0].seconds,900);assert.equal(editor.read(normalized,0)[0].questions[0].correct,2);
});
test('editor rejects unsupported types, missing correct options, question limits and out of range or fractional times',()=>{
 assert.throws(()=>editor.create('game'));assert.throws(()=>editor.create('poll'));
 for(const mutate of [v=>v.questions=[],v=>v.questions=Array(101).fill(v.questions[0]),v=>v.questions[0].correct=3,v=>v.questions[0].options='Sólo una',v=>v.questions[0].options='a\nb\nc\nd\ne\nf\ng',v=>v.questions[0].options='a'.repeat(501)+'\nb',v=>v.seconds=4,v=>v.seconds=301,v=>v.seconds=5.5,v=>v.identificationMode='public']){const v=valid('contest');mutate(v);assert.throws(()=>editor.append(base(),[[v],[]]));}
 for(const seconds of [29,10801,30.5]){const v=valid('assessment');v.seconds=seconds;assert.throws(()=>editor.append(base(),[[],[v]]));}
 assert.throws(()=>editor.append(base(),[[{type:'visual_key',title:'Deferred'}],[]]));assert.throws(()=>editor.append(base(),[[]]));
 for(const seconds of [5,300]){const v=valid('contest');v.seconds=seconds;normalizeConfiguration(editor.append(base(),[[v],[]]),2);}
 for(const seconds of [30,10800]){const v=valid('assessment');v.seconds=seconds;normalizeConfiguration(editor.append(base(),[[],[v]]),2);}
});
