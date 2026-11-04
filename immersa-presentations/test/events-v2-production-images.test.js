const test=require('node:test'),assert=require('node:assert/strict'),editor=require('../public/events-v2/production-images');
const image=()=>({id:require('node:crypto').randomUUID(),status:'READY_PENDING_DECK_CHECK',type:'image',name:'Imagen',contentType:'image/png',size:100,width:64,height:32});
test('private image library validates raster metadata, limits and status without accepting remote content',()=>{
 const m=image(),before=structuredClone(m);assert.deepEqual(editor.library([m]),[m]);assert.deepEqual(m,before);assert.notEqual(editor.library([m])[0],m);
 for(const mutate of [m=>m.id='https://foreign.invalid/image',m=>m.status='READY',m=>m.type='video',m=>m.contentType='image/svg+xml',m=>m.name='',m=>m.width=4097,m=>m.height=0,m=>m.size=5*1024*1024+1,m=>m.width=1.5]){const m=image();mutate(m);assert.throws(()=>editor.library([m]));}
 assert.throws(()=>editor.library(null));assert.throws(()=>editor.library([m,m]));assert.throws(()=>editor.library(Array(201).fill(m)));
 assert.deepEqual(editor.library([{id:m.id,status:'FAILED'}]),[{id:m.id,status:'FAILED'}]);assert.equal(editor.library([{id:m.id,status:'PROCESSING'}])[0].status,'PROCESSING');
 for(const contentType of ['image/png','image/jpeg','image/webp'])assert.equal(editor.library([{...m,contentType}])[0].contentType,contentType);
});
