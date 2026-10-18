const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {normalizeConfiguration}=require('../events-v2/deck-configuration');const {configurationFixture}=require('./helpers/events-v2-configuration-fixture');
const {EventDeckPrivateStore}=require('../events-v2/deck-private-store');const {EventDeckPreparationService}=require('../events-v2/deck-preparation-service');const {pdfFixture}=require('./helpers/events-v2-pdf-fixture');
test('configuration preserves English notes and requires coherent explicit language selection',()=>{
 const x=configurationFixture();x.language={englishEnabled:true,presenterLanguage:'en'};x.slides[0].notes.en='Speaker notes';x.slides[1].notes.en='';
 const out=normalizeConfiguration(x,2);assert.deepEqual(out.language,x.language);assert.deepEqual(out.slides[0].notes,x.slides[0].notes);assert.equal(out.slides[1].notes.en,'');
 for(const edit of [x=>{x.language.englishEnabled='true';},x=>{x.language={englishEnabled:false,presenterLanguage:'en'};},x=>{x.language.presenterLanguage='fr';},x=>{x.language.source='foreign';},x=>{x.slides[0].notes.en='x'.repeat(8001);},x=>{x.slides[0].notes.fr='foreign';}]){const b=structuredClone(x);edit(b);assert.throws(()=>normalizeConfiguration(b,2),{code:'INVALID_CONFIGURATION'});}
});
test('translated PDF rejects a page-count mismatch before running conversion and retains bytes only in private storage',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'event-english-count-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let calls=0;
 const store=new EventDeckPrivateStore({root,convert:async()=>{calls++;throw new Error('must not convert');}}),scope=Object.fromEntries(['eventId','deckId','versionId','attemptId'].map(k=>[k,crypto.randomUUID()]));
 await assert.rejects(store.prepare(scope,pdfFixture(1,[0,0,1]),{expectedSlideCount:2}),{code:'LOCALE_SLIDE_COUNT_MISMATCH',statusCode:422});assert.equal(calls,0);
 assert.ok((await fs.stat(path.join(store.directory(scope),'original.pdf'))).size>0);await assert.rejects(fs.stat(path.join(store.directory(scope),'manifest.json')),{code:'ENOENT'});
});
test('Spanish and English PDF HTTP work share one two-upload admission budget',()=>{
 const base=new EventDeckPreparationService({domain:null,root:'/tmp/base-english-budget'}),en=new EventDeckPreparationService({domain:null,root:'/tmp/en-english-budget',basePreparations:base});
 const a=base.acquireUpload(),b=en.acquireUpload();assert.equal(base.uploads,2);assert.throws(()=>base.acquireUpload(),{code:'PDF_PREPARATION_BUSY'});assert.throws(()=>en.acquireUpload(),{code:'PDF_PREPARATION_BUSY'});a();a();b();assert.equal(base.uploads,0);
});
