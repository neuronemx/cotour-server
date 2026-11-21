(() => {
  function create({ role, socket, getState, button, toggleVoice, voiceActive }) {
    const peers = new Map();
    let stream, id, localVersion = 0, busy = false, facing = 'user', dialog, preview, remote, remoteTile, status;
    let audioOnly, audioVideo, cameraOff, voiceOff, switchButton, notice = '';
    function stop(notify = true, reason) {
      const previous = id || getState().camera?.id;
      localVersion++;
      id = null;
      for (const peer of peers.values()) { clearInterval(peer.timer); peer.cleanupPlayback?.(); peer.pc.close(); }
      peers.clear();
      stream?.getTracks().forEach(track => track.stop()); stream = null;
      if (preview) preview.srcObject = null;
      if (remote) { remote.srcObject = null; remote.hidden = true; }
      if (remoteTile) { remoteTile.hidden = true; remoteTile.classList.remove('is-landscape'); }
      document.querySelector('.guest-program')?.classList.remove('has-speaker-camera');
      document.getElementById('guestVisual')?.classList.remove('has-speaker-camera');
      if (notify && previous && socket.connected) socket.emit('guest-camera:stop', { id: previous, ...(reason ? { reason } : {}) });
    }
    function failure(stage, error, expectedId) {
      if (expectedId && id !== expectedId) return;
      const name = /^[A-Za-z]{1,40}$/.test(error?.name || '') ? ':' + error.name : '';
      notice = 'No se pudo compartir la cámara. ' + ({ speaker: 'Speaker', screen: 'Pantalla', guest: 'Invitado' }[role] || role) + ': ' + stage + name + '. El audio continúa.';
      stop(true, stage + name); render();
    }
    function playReceiver(peer, setup) {
      const media = peer.media;
      const version = peer.mediaVersion;
      const current = () => id === setup.id && peers.get(setup.target) === peer
        && peer.mediaVersion === version && remote?.srcObject === media;
      if (!media || !current() || peer.playPending || performance.now() < (peer.retryPlaybackAt || 0)) return;
      if (!remote.paused && remote.readyState >= 2) return;
      peer.playPending = true;
      const interrupted = error => {
        if (!current()) return;
        if (error?.name === 'AbortError') {
          // Loading/pausing a video may interrupt play without ending its WebRTC track.
          // Retry against the same current stream; the frame watchdog remains authoritative.
          peer.retryPlaybackAt = performance.now() + 200;
          return;
        }
        failure('playback', error, setup.id);
      };
      let request;
      try { request = remote.play(); }
      catch (error) { peer.playPending = false; interrupted(error); return; }
      Promise.resolve(request).catch(interrupted).finally(() => {
        if (peer.mediaVersion === version) peer.playPending = false;
      });
    }
    function render() {
      const state = getState();
      if (id && (state.camera?.id !== id || state.phase !== 'live')) {
        if (role === 'speaker' && !notice) notice = state.phase !== 'live' ? 'La cámara se retiró porque el enlace del Invitado dejó de estar EN VIVO.' : 'La conexión retiró la cámara. Puedes intentar Audio y video nuevamente.';
        stop(false);
      }
      if (role === 'speaker') {
        if (state.phase === 'ended') dialog.close();
        button.setAttribute('aria-pressed', String(Boolean(stream || voiceActive())));
        audioOnly.disabled = busy || (state.audioSource !== 'speaker' && !stream);
        cameraOff.hidden = !stream;
        cameraOff.disabled = busy;
        voiceOff.hidden = !voiceActive();
        voiceOff.disabled = busy;
        audioVideo.disabled = busy || state.phase !== 'live' || !socket.connected;
        switchButton.disabled = busy || !stream;
        preview.hidden = !stream;
        status.textContent = notice || (state.audioSource === 'speaker'
          ? (state.phase === 'live' ? (stream ? (state.camera?.ready ? 'Tu cámara se comparte con Invitado y Pantalla.' : 'Conectando tu cámara con Invitado y Pantalla…') : 'Pulsa Audio y video para compartir tu cámara.') : (voiceActive() ? 'Tu voz está preparada. Se enviará al Invitado desde el conteo de entrada.' : 'Pulsa Solo audio para preparar tu voz. El Invitado puede entrar a la sala de espera mientras tanto.'))
          : 'El audio viene de Pantalla / consola. Comparte tu cámara sin duplicar tu voz.');
        return;
      }
      if (role === 'stage') return;
      // A video must be visible to let the browser request/decode frames. Do not wait for
      // framesDecoded before revealing it: that creates a circular readiness dependency.
      const receiving = Boolean(id) && state.phase === 'live' && state.camera?.id === id
        && [...peers.values()].some(peer => peer.receiver);
      if (remote) { remote.hidden = !receiving; remote.style.visibility = 'visible'; }
      if (remoteTile) {
        remoteTile.hidden = !receiving;
        if (remote.videoWidth > 0 && remote.videoHeight > 0) {
          remoteTile.style.aspectRatio = remote.videoWidth + ' / ' + remote.videoHeight;
          remoteTile.classList.toggle('is-landscape', remote.videoWidth > remote.videoHeight);
        }
      }
      document.querySelector('.guest-program')?.classList.toggle('has-speaker-camera', Boolean(receiving));
      document.getElementById('guestVisual')?.classList.toggle('has-speaker-camera', Boolean(receiving));
    }
    async function capture() {
      const version = ++localVersion;
      // Stop the old lens first on phones, while keeping the independent microphone alive.
      stream?.getTracks().forEach(track => track.stop()); stream = null;
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        facingMode: { ideal: facing }, width: { ideal: 640, max: 640 }, height: { ideal: 360, max: 360 }, frameRate: { ideal: 15, max: 15 }
      } });
      if (version !== localVersion || getState().phase !== 'live' || !socket.connected) { next.getTracks().forEach(track => track.stop()); return false; }
      stream = next;
      const track = stream.getVideoTracks()[0];
      track.onended = () => { if (stream === next) failure('capture-ended', null, id); };
      preview.srcObject = next; preview.hidden = false; await preview.play();
      for (const peer of peers.values()) if (peer.sender) await peer.sender.replaceTrack(track);
      return true;
    }
    async function activate(withVideo) {
      busy = true; notice = ''; render();
      let step = 'voice';
      try {
        if (!withVideo && stream) return stop();
        if (getState().audioSource === 'speaker' && !voiceActive()) await toggleVoice();
        if (getState().audioSource === 'speaker' && !voiceActive()) return;
        if (!withVideo) return stop();
        if (stream) return;
        step = 'capture';
        if (!await capture()) return;
        const version = localVersion;
        step = 'request';
        const result = await socket.timeout(15000).emitWithAck('guest-camera:start');
        if (!result?.ok) throw Object.assign(new Error(), { name: result?.reason === 'service' ? 'ServiceUnavailable' : result?.reason === 'access' ? 'AccessDenied' : 'NotReady' });
        if (version !== localVersion || (id && id !== result.id)) return;
        if (getState().phase !== 'live') { stop(); return; }
        id = result.id;
      } catch (error) { failure(step, error); }
      finally { busy = false; render(); }
    }
    if (role === 'speaker') {
      dialog = document.createElement('dialog'); dialog.className = 'guest-production guest-speaker-dialog';
      dialog.innerHTML = '<header><h2>LIVE con Invitado</h2><button type="button" data-close aria-label="Cerrar panel">×</button></header><p class="guest-note" data-status></p><video muted autoplay playsinline aria-label="Tu cámara"></video><div class="guest-actions"><button type="button" data-audio>Solo audio</button><button type="button" data-video>Audio y video</button><button type="button" data-lens>Cambiar cámara</button><button type="button" data-camera-off>Apagar mi cámara</button><button type="button" data-voice-off>Apagar voz invitado</button></div>';
      document.body.append(dialog);
      preview = dialog.querySelector('video'); status = dialog.querySelector('[data-status]');
      audioOnly = dialog.querySelector('[data-audio]'); audioVideo = dialog.querySelector('[data-video]');
      cameraOff = dialog.querySelector('[data-camera-off]');
      cameraOff.onclick = () => { notice = ''; stop(); render(); };
      voiceOff = dialog.querySelector('[data-voice-off]');
      voiceOff.onclick = async () => { if (voiceActive()) await toggleVoice(); stop(); render(); };
      switchButton = dialog.querySelector('[data-lens]');
      button.onclick = () => { render(); dialog.showModal(); };
      dialog.querySelector('[data-close]').onclick = () => dialog.close();
      audioOnly.onclick = () => void activate(false);
      audioVideo.onclick = () => void activate(true);
      switchButton.onclick = async () => {
        busy = true; facing = facing === 'user' ? 'environment' : 'user'; render();
        try { await capture(); } catch { stop(); }
        finally { busy = false; render(); }
      };
    } else if (['screen', 'guest'].includes(role)) {
      remote = document.createElement('video'); remote.className = 'guest-speaker-feed';
      remote.autoplay = true; remote.muted = true; remote.playsInline = true; remote.hidden = true;
      remote.setAttribute('aria-label', 'Cámara del Speaker');
      remote.addEventListener('resize', render);
      remoteTile = document.createElement('section'); remoteTile.className = 'guest-speaker-tile'; remoteTile.hidden = true;
      remoteTile.setAttribute('aria-label', 'Speaker');
      const badge = document.createElement('img');
      badge.className = role === 'screen' ? 'guest-live-label' : 'guest-camera-live';
      badge.src = '/live-guests/live-badge.png'; badge.alt = 'LIVE';
      remoteTile.append(remote, badge);
      (role === 'screen' ? document.querySelector('.guest-program') : document.getElementById('guestVisual')).append(remoteTile);
    }
    async function prepare(setup) {
      if (!['speaker', setup.target].includes(role) || !['screen', 'guest'].includes(setup.target)) return;
      if (id && id !== setup.id) stop(false);
      if (role === 'speaker' && !stream) { socket.emit('guest-camera:stop', { id: setup.id }); return; }
      id = setup.id;
      if (peers.has(setup.target)) return;
      const pc = new RTCPeerConnection(setup.rtc);
      const peer = { pc, queue: Promise.resolve(), candidates: [], deadline: performance.now() + setup.duration, created: performance.now() };
      peers.set(setup.target, peer);
      pc.onicecandidate = ({ candidate }) => {
        if (candidate && id === setup.id) socket.emit('guest-camera:signal', { id, target: setup.target, candidate: candidate.toJSON() });
      };
      pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') failure('connection', null, setup.id); };
      pc.ontrack = ({ track, receiver }) => {
        if (track.kind !== 'video' || id !== setup.id) return;
        peer.receiver = receiver;
        if (peer.videoTrack === track) return playReceiver(peer, setup);
        peer.cleanupPlayback?.();
        peer.videoTrack = track;
        peer.media = new MediaStream([track]);
        peer.mediaVersion = (peer.mediaVersion || 0) + 1;
        peer.playPending = false;
        peer.retryPlaybackAt = 0;
        remote.srcObject = peer.media;
        remote.hidden = false;
        remote.style.visibility = 'visible';
        render();
        const retry = () => playReceiver(peer, setup);
        remote.addEventListener?.('loadedmetadata', retry);
        remote.addEventListener?.('canplay', retry);
        document.addEventListener?.('visibilitychange', retry);
        peer.cleanupPlayback = () => {
          remote.removeEventListener?.('loadedmetadata', retry);
          remote.removeEventListener?.('canplay', retry);
          document.removeEventListener?.('visibilitychange', retry);
        };
        retry();
      };
      peer.timer = setInterval(async () => {
        if (id !== setup.id) return;
        const now = performance.now();
        if (now > peer.deadline) { failure('lease', null, setup.id); return; }
        if (!peer.receiver || peer.checking) return;
        playReceiver(peer, setup);
        peer.checking = true;
        try {
          const stats = await peer.receiver.getStats();
          if (id !== setup.id) return;
          for (const report of stats.values()) if (report.type === 'inbound-rtp' && report.framesDecoded > (peer.frames || 0)) {
            peer.frames = report.framesDecoded; peer.lastFrame = now;
            if (!peer.ready) { peer.ready = true; socket.emit('guest-camera:ready', { id, target: setup.target }); }
          }
          if (now - (peer.lastFrame || peer.created) > (peer.ready ? 4000 : 12000)) { failure('frames', null, setup.id); }
          else render();
        } catch (error) { failure('stats', error, setup.id); }
        finally { peer.checking = false; }
      }, 250);
      if (setup.offer) {
        peer.sender = pc.addTransceiver(stream.getVideoTracks()[0], { direction: 'sendonly', streams: [stream], sendEncodings: [{ maxBitrate: 500000, maxFramerate: 15 }] }).sender;
        await pc.setLocalDescription(await pc.createOffer());
        socket.emit('guest-camera:signal', { id, target: setup.target, description: pc.localDescription.toJSON() });
      }
    }
    socket.on('guest-camera:prepare', setup => { void prepare(setup).catch(error => failure('prepare', error, setup.id)); });
    socket.on('guest-camera:signal', body => {
      const peer = peers.get(body.target);
      if (!peer || body.id !== id) return;
      peer.queue = peer.queue.then(async () => {
        if (body.id !== id) return;
        if (body.candidate) {
          if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(body.candidate); else peer.candidates.push(body.candidate);
          return;
        }
        await peer.pc.setRemoteDescription(body.description);
        for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate);
        if (body.description.type === 'offer') {
          for (const transceiver of peer.pc.getTransceivers()) transceiver.direction = 'recvonly';
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          socket.emit('guest-camera:signal', { id, target: body.target, description: peer.pc.localDescription.toJSON() });
        }
      }).catch(error => failure('signal', error, body.id));
    });
    socket.on('guest-camera:ended', value => {
      if (role !== 'speaker' || (id && value.id !== id)) return;
      notice = 'Cámara detenida: ' + String(value.reason || '').slice(0, 100) + '. El audio continúa.';
      stop(false); render();
    });
    socket.on('guest-camera:lease', value => { if (value.id === id) for (const peer of peers.values()) peer.deadline = performance.now() + value.duration; });
    socket.on('disconnect', () => { stop(false); dialog?.close(); });
    window.addEventListener('pagehide', () => stop());
    return { render, stop };
  }
  window.ImmersaGuestCamera = { create };
})();
