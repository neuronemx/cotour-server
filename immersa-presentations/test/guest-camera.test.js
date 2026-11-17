const test = require('node:test');
const assert = require('node:assert/strict');
const { createGuestCamera } = require('../guest-camera');

function fixture() {
  const snapshots = [];
  const room = { call: { id: 'main-call', phase: 'live' }, peers: {} };
  const control = createGuestCamera({ authorize: async socket => Boolean(socket?.connected), rtc: async () => ({ iceServers: [] }), publish: () => snapshots.push(room.camera?.ready || false) });
  for (const role of ['speaker', 'screen', 'guest', 'stage']) {
    const handlers = new Map(), messages = [];
    const socket = { data: { guestRole: role }, connected: true, messages,
      on(name, fn) { handlers.set(name, fn); }, emit(...args) { messages.push(args); }, receive(name, ...args) { return handlers.get(name)(...args); } };
    control.attach(socket, room); room.peers[role] = socket;
  }
  const start = () => new Promise(resolve => room.peers.speaker.receive('guest-camera:start', resolve));
  return { room, control, start, snapshots };
}

test('camera joins an existing LIVE, reaches only its two receivers and stops without touching the audio call', async () => {
  const { room, start, control } = fixture();
  const call = room.call;
  room.call.phase = 'ready';
  assert.equal((await start()).ok, false);
  room.call.phase = 'live';
  const { id, ok } = await start();
  assert.equal(ok, true);
  assert.equal((await start()).ok, false);
  assert.equal(room.peers.speaker.messages.length, 2);
  assert.equal(room.peers.stage.messages.length, 0);
  assert.equal(room.peers.guest.messages[0][1].offer, false);
  room.peers.guest.receive('guest-camera:ready', { id, target: 'screen' });
  assert.equal(room.camera.ready, false);
  for (const role of ['screen', 'guest']) room.peers[role].receive('guest-camera:ready', { id, target: role });
  assert.equal(room.camera.ready, true);
  control.renew(room);
  assert.ok(room.peers.guest.messages.some(([event]) => event === 'guest-camera:lease'));
  room.peers.speaker.receive('guest-camera:stop', { id: 'stale' });
  assert.ok(room.camera);
  room.peers.speaker.receive('guest-camera:stop', { id });
  assert.equal(room.camera, null);
  assert.equal(room.call, call);
  assert.equal(call.phase, 'live');
  assert.equal((await start()).ok, true);
});

test('camera signaling is video only, scoped to its target, and expires independently', async () => {
  const { room, start, control } = fixture();
  const { id } = await start();
  const message = { id, target: 'guest', description: { type: 'offer', sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' } };
  const count = () => room.peers.guest.messages.filter(([event]) => event === 'guest-camera:signal').length;
  room.peers.stage.receive('guest-camera:signal', message);
  room.peers.screen.receive('guest-camera:signal', message);
  room.peers.speaker.receive('guest-camera:signal', { ...message, id: 'stale' });
  room.peers.speaker.receive('guest-camera:signal', { ...message, description: { ...message.description, sdp: message.description.sdp + 'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' } });
  assert.equal(count(), 0);
  room.peers.speaker.receive('guest-camera:signal', message);
  assert.equal(count(), 1);
  room.camera.created = Date.now() - 16000;
  control.renew(room);
  assert.equal(room.camera, null);
  assert.equal(room.call.phase, 'live');
  room.peers.speaker.connected = false;
  assert.equal((await start()).ok, false);
});

test('receiver failure reaches Speaker with its source and leaves the guest call active', async () => {
  const { room, start } = fixture();
  const { id } = await start();
  room.peers.screen.receive('guest-camera:stop', { id, reason: 'playback:NotAllowedError' });
  const ended = room.peers.speaker.messages.find(([event]) => event === 'guest-camera:ended');
  assert.deepEqual(ended[1], { id, reason: 'screen:playback:NotAllowedError' });
  assert.equal(room.call.phase, 'live');
  assert.equal(room.camera, null);
});
