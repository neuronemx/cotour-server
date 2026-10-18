const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');
const {EventMediaPrivateStore,container}=require('../events-v2/media-private-store');
const {digest}=require('../events-v2/deck-private-store');const {normalizeConfiguration}=require('../events-v2/deck-configuration');
const {configurationFixture}=require('./helpers/events-v2-configuration-fixture');const {wavFixture,mediaFixture}=require('./helpers/events-v2-media-fixture');
const scope=()=>({eventId:crypto.randomUUID(),deckId:crypto.randomUUID(),versionId:crypto.randomUUID(),id:crypto.randomUUID()});
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'event-media-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return new EventMediaPrivateStore({root});}
test('real MP3, WAV, MP4, M4A and alpha WebM probe into bounded server metadata without transcoding',async t=>{
  const store=await fixture(t);
  for(const kind of ['wav','mp3','mp4','m4a','webm']){
    const bytes=kind==='wav'?wavFixture():await mediaFixture(kind),s=scope(),m=await store.prepare(s,bytes);
    assert.ok(m.duration>0&&m.duration<2);assert.equal(m.type,['mp4','webm'].includes(kind)?'video':'audio');
    if(kind==='webm'){assert.equal(m.videoCodec,'vp9');assert.equal(m.alphaMetadata,true);assert.equal(m.contentType,'video/webm');}
    const handle=await store.verified({...s,size:bytes.length,sha256:digest(bytes)});const chunks=[];
    for await(const chunk of handle.createReadStream({start:0,end:bytes.length-1,autoClose:true}))chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks),bytes);assert.equal((await fs.stat(store.directory(s))).mode&511,448);
    assert.equal((await fs.stat(path.join(store.directory(s),'media.bin'))).mode&511,256);
  }
});
test('HTML, external playlists, fake containers and unsupported Matroska do not become prepared media',async t=>{
  const store=await fixture(t);
  for(const bytes of [Buffer.from('<html>not media</html>'),Buffer.from('#EXTM3U\nhttp://private.invalid/secret'),Buffer.from('RIFF0000WAVEbroken'),await mediaFixture('mkv')]){
    await assert.rejects(store.prepare(scope(),bytes),{code:'INVALID_MEDIA'});
  }
});
test('private media rejects size/hash tampering, symlinks and hardlinks before returning a verified descriptor',async t=>{
  const store=await fixture(t),s=scope(),bytes=wavFixture();await store.prepare(s,bytes);
  const row={...s,size:bytes.length,sha256:digest(bytes)},file=path.join(store.directory(s),'media.bin');
  await assert.rejects(store.verified({...row,size:row.size+1}),{code:'MEDIA_INTEGRITY_FAILED'});
  await assert.rejects(store.verified({...row,sha256:'0'.repeat(64)}),{code:'MEDIA_INTEGRITY_FAILED'});
  const other=file+'.other';await fs.rename(file,other);await fs.symlink(other,file);
  await assert.rejects(store.verified(row),{code:'MEDIA_INTEGRITY_FAILED'});await fs.unlink(file);await fs.link(other,file);
  await assert.rejects(store.verified(row),{code:'MEDIA_INTEGRITY_FAILED'});await fs.unlink(other);
  const handle=await store.verified(row);await fs.rename(file,other);await fs.writeFile(file,Buffer.alloc(bytes.length));
  const chunks=[];for await(const chunk of handle.createReadStream({start:0,end:bytes.length-1,autoClose:true}))chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks),bytes);
});
test('media paths are server UUIDs, exposed roots are forbidden, and preparation cannot overwrite bytes',async t=>{
  const store=await fixture(t),s=scope();
  assert.throws(()=>store.directory({...s,id:'../secret'}),{code:'PREPARATION_INTEGRITY_FAILED'});
  assert.throws(()=>new EventMediaPrivateStore({root:'/tmp/exposed/private',forbiddenRoots:['/tmp/exposed']}));
  await store.prepare(s,wavFixture());await assert.rejects(store.prepare(s,wavFixture()),e=>e.code==='EEXIST');
});
test('configuration accepts only unique event asset IDs and same-selection playlist references',()=>{
  const id=crypto.randomUUID(),input=configurationFixture();input.audiovisual={assetIds:[id],playlists:[{id:'list',name:'Playlist',type:'audio',resourceIds:[id]}]};
  assert.deepEqual(normalizeConfiguration(input,2).audiovisual,input.audiovisual);
  for(const edit of [x=>{x.audiovisual.resources=[];},x=>{x.audiovisual.assetIds=['/decks/foreign'];},x=>{x.audiovisual.assetIds=[id,id];},x=>{x.audiovisual.playlists[0].resourceIds=[crypto.randomUUID()];},x=>{x.audiovisual.playlists[0].url='https://foreign';}]){
    const x=structuredClone(input);edit(x);assert.throws(()=>normalizeConfiguration(x,2),{code:'INVALID_CONFIGURATION'});
  }
});
