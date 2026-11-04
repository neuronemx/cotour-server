const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createSelfieRuntime } = require('../selfie-runtime');
const { createSelfieCollectionStore, createSelfieCollectionHttp } = require('../selfie-collection');
const { ActiveInteractionCoordinator } = require('../active-interaction-coordinator');

function socket() {
  const handlers = {}, events = [];
  return { handlers, events, on: (event, handler) => { handlers[event] = handler; }, emit: (event, data) => events.push({ event, data }), last: () => events.at(-1)?.data };
}
function fixture() {
  const messages = [], members = Array.from({ length: 103 }, (_, i) => ({ audienceId: 'a' + i }));
  const coordinator = new ActiveInteractionCoordinator({});
  const images = [{url:'/one.png'},{url:'/two.png'},{url:'/three.png'}];
  const runtime = createSelfieRuntime({
    io: { to: room => ({ emit: (event, data) => messages.push({room,event,data}) }) }, coordinator,
    loadCollection: async () => ({ images }), getRoleRoomKey: (room, role) => room + ':' + role, getConnectedAudience: () => members
  });
  const context = { sessionId: 's', roomKey: 's::deck', deckId: 'deck', role: 'presenter' };
  const controller = socket(); runtime.attach(controller, () => context);
  return { runtime, coordinator, context, controller, messages, images };
}

test('Selfie balances images, survives reconnect and collection edits, admits late arrivals, and closes everyone', async () => {
  const f = fixture();
  await f.controller.handlers['selfie:start']();
  const assigned = f.messages.filter(message => message.room.includes(':audience:'));
  assert.equal(assigned.length, 103);
  const counts = f.images.map(image => assigned.filter(message => message.data.image.url === image.url).length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  const first = assigned[0].data;
  f.images.splice(0, 3, { url: '/new.png' });
  const audience = socket();
  f.runtime.sendCurrentState(audience, {...f.context, role:'audience', audienceId:'a0'});
  assert.deepEqual(audience.last(), first);
  f.runtime.sendCurrentState(audience, {...f.context, role:'audience', audienceId:'late'});
  assert.ok(['/one.png','/two.png','/three.png'].includes(audience.last().image.url));
  assert.equal(f.coordinator.hasAnyActive('s'), true);
  await f.controller.handlers['selfie:close']();
  assert.equal(f.coordinator.hasAnyActive('s'), false);
  assert.equal(f.messages.at(-1).data.active, false);
  f.runtime.sendCurrentState(audience, {...f.context, role:'audience', audienceId:'a0'});
  assert.equal(audience.last().active, false);
});

test('Selfie enforces controller permissions, competing interactions and room isolation', async () => {
  const f = fixture(), outsider = socket();
  f.runtime.attach(outsider, () => ({...f.context, role:'audience'}));
  await outsider.handlers['selfie:start']();
  assert.equal(outsider.last().reason, 'forbidden');
  let active = true;
  f.coordinator.registerGame('test', {hasActive: () => active});
  await f.controller.handlers['selfie:start']();
  assert.equal(f.controller.last().reason, 'active_interaction_exists');
  active = false;
  await Promise.all([f.controller.handlers['selfie:start'](), f.controller.handlers['selfie:start']()]);
  f.runtime.sendCurrentState(outsider, {...f.context, roomKey:'other', role:'audience', audienceId:'a0'});
  assert.equal(outsider.last().active, false);
  assert.equal(f.coordinator.hasAnyActive('s', 'activity:selfie'), false);
  f.runtime.resetSession(f.context);
  assert.equal(f.runtime.hasActive('s'), false);
});

test('collection HTTP validates uploads, persists revisions, rejects stale edits and protects writes', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'selfie-'));
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const store = createSelfieCollectionStore({ findDeckDir: async () => dir });
  const app = express(); app.use(express.json());
  const owner = (req,res,next) => req.headers.authorization === 'test' ? next() : res.sendStatus(403);
  app.use(createSelfieCollectionHttp({store, owner:[owner]}));
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
  t.after(() => server.close());
  const origin = 'http://127.0.0.1:' + server.address().port, url = origin + '/api/decks/deck/selfie';
  assert.equal((await fetch(url)).status,403);
  const headers = {authorization:'test',origin};
  const initial = await (await fetch(url,{headers})).json();
  assert.equal(initial.provisional,true);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII=','base64');
  const form = (revision, image = png) => {
    const body = new FormData(); body.append('revision',String(revision));body.append('replace','true');
    body.append('images',new Blob([image],{type:'image/png'}),'face.png');return body;
  };
  const saved = await (await fetch(url,{method:'POST',headers,body:form(0)})).json();
  assert.equal(saved.custom,true); assert.equal(saved.images.length,1); assert.equal(saved.revision,1);
  const freshStore = createSelfieCollectionStore({ findDeckDir: async () => dir });
  assert.deepEqual(await freshStore.read('deck'),saved);
  assert.equal((await fetch(url,{method:'POST',headers,body:form(0)})).status,409);
  assert.equal((await fetch(url,{method:'POST',headers:{authorization:'test',origin:'https://other.test'},body:form(1)})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers,body:form(1,Buffer.from('<svg/>'))})).status,400);
  const removed = await (await fetch(url+'/image',{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({revision:1,url:saved.images[0].url})})).json();
  assert.equal(removed.provisional,true);
  // A collection edit cannot break a running round's image URLs.
  const imagePath = path.join(dir,'selfie-assets',path.basename(saved.images[0].url));
  assert.deepEqual(await fs.readFile(imagePath),png);
  await assert.rejects(store.read('../escape'));
});
