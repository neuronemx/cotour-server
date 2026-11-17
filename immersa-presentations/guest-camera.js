const { randomUUID } = require('node:crypto');

// Optional video only. Its lifetime never owns the guest's audio or program reservation.
function createGuestCamera({ authorize, rtc, publish }) {
  function stop(room) {
    if (!room.camera) return;
    room.camera = null;
    publish(room);
  }
  function renew(room) {
    const camera = room.camera;
    if (!camera) return;
    if (!camera.ready && Date.now() > camera.created + 15000) return stop(room);
    for (const peer of Object.values(room.peers)) peer.emit('guest-camera:lease', { id: camera.id, duration: 8000 });
  }
  function attach(socket, room) {
    const role = socket.data.guestRole;
    socket.on('guest-camera:start', async ack => {
      if (role !== 'speaker' || typeof ack !== 'function') return;
      if (room.call?.phase !== 'live' || room.camera || room.cameraStarting) return ack({ ok: false });
      const call = room.call;
      room.cameraStarting = true;
      try {
        const peers = ['speaker', 'screen', 'guest'].map(key => room.peers[key]);
        const valid = await Promise.all(peers.map(authorize));
        const configuration = await rtc();
        if (!valid.every(Boolean) || room.call !== call || call.phase !== 'live'
          || peers.some((peer, i) => room.peers[['speaker', 'screen', 'guest'][i]] !== peer || !peer?.connected)) return ack({ ok: false });
        const camera = room.camera = { id: randomUUID(), created: Date.now(), ready: false, receivers: new Set(), counts: {} };
        publish(room);
        for (const target of ['screen', 'guest']) for (const participant of ['speaker', target]) room.peers[participant].emit('guest-camera:prepare', {
          id: camera.id, target, rtc: configuration, duration: 8000, offer: participant === 'speaker'
        });
        ack({ ok: true, id: camera.id });
      } catch { ack({ ok: false }); }
      finally { room.cameraStarting = false; }
    });
    socket.on('guest-camera:stop', message => {
      if (['speaker', 'screen', 'guest'].includes(role) && room.camera?.id === message?.id) stop(room);
    });
    socket.on('guest-camera:ready', message => {
      const camera = room.camera;
      if (!camera || camera.id !== message?.id || !['screen', 'guest'].includes(role) || message.target !== role) return;
      camera.receivers.add(role);
      camera.ready = camera.receivers.size === 2;
      publish(room);
    });
    socket.on('guest-camera:signal', message => {
      const camera = room.camera;
      const target = message?.target;
      if (!camera || message.id !== camera.id || !['screen', 'guest'].includes(target) || !['speaker', target].includes(role)) return;
      const key = role + target;
      camera.counts[key] = (camera.counts[key] || 0) + 1;
      if (camera.counts[key] > 200) return;
      let body;
      if (message.description) {
        const { type, sdp } = message.description;
        if (type !== (role === 'speaker' ? 'offer' : 'answer') || typeof sdp !== 'string' || sdp.length > 64000
          || /^m=(?!video\s)/m.test(sdp) || (sdp.match(/^m=video\s/gm) || []).length !== 1) return;
        body = { description: { type, sdp } };
      } else if (typeof message.candidate?.candidate === 'string' && message.candidate.candidate.length <= 2048
        && (message.candidate.sdpMid == null || (typeof message.candidate.sdpMid === 'string' && message.candidate.sdpMid.length <= 64))
        && (message.candidate.sdpMLineIndex == null || message.candidate.sdpMLineIndex === 0)) {
        body = { candidate: { candidate: message.candidate.candidate, sdpMid: message.candidate.sdpMid, sdpMLineIndex: message.candidate.sdpMLineIndex } };
      }
      if (body) room.peers[role === 'speaker' ? target : 'speaker']?.emit('guest-camera:signal', { id: camera.id, target, ...body });
    });
    socket.on('disconnect', () => { if (['speaker', 'guest', 'screen', 'stage'].includes(role)) stop(room); });
  }
  return { attach, stop, renew };
}
module.exports = { createGuestCamera };
