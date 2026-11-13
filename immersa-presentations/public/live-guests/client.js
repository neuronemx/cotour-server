(() => {
  const context = window.IMMERSA_ROLE_OPEN;
  const role = document.body.dataset.liveGuest ? "guest" : context?.role;
  if (!["guest", "stage", "screen"].includes(role)) return;
  const token = role === "guest" ? location.pathname.split("/").pop() : context.access_token;
  const socket = io("/live-guests", { auth: { role, token }, transports: ["websocket"], forceNew: true });
  const peers = new Map();
  let state = { phase: "waiting" };
  let capture;
  let productionAudio;
  let stageAudio;
  let audioContext;
  let video;
  let dialog;
  let overlay;
  let screenHost;
  let message;
  let enter;
  let phaseLabel;
  let connect;
  let take;
  let end;
  let mute;
  let invite;
  let startAudio;
  let microphone;
  let returnInput;
  let link;
  let guestName;
  let slideVersion = 0;
  let slideSource = "";
  let audioUnlocked = false;
  let busy = false;
  let taking = false;
  let captureVersion = 0;
  let notice = "";
  const errors = {
    busy: "Espera a que el invitado, el audio de producción y Pantalla estén listos.",
    access: "El enlace ya no está autorizado. Abre los enlaces actuales del Deck.",
    service: "No se pudo preparar la conexión. Intenta nuevamente.",
    signal: "Se perdió la conexión. Puedes preparar el enlace nuevamente.",
    timeout: "No se recibió la señal a tiempo. Prepara el enlace nuevamente.",
    production: "Pantalla está ocupada con otro LIVE o video. Córtalo antes de dar entrada al invitado."
  };

  function initAudio() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    return audioContext.resume();
  }

  function stopStreams() {
    captureVersion++;
    const hadMedia = Boolean(capture || productionAudio || stageAudio);
    for (const stream of new Set([capture, productionAudio, stageAudio])) stream?.getTracks().forEach(track => track.stop());
    capture = productionAudio = stageAudio = null;
    if (hadMedia && socket.connected) socket.emit("guest:media-ready", false);
    if (role === "guest") { video.srcObject = null; clearGuestSlide(); }
  }

  function clearGuestSlide() {
    if (role !== "guest") return;
    slideVersion++;
    slideSource = "";
    const image = document.getElementById("guestSlide");
    image.hidden = true;
    image.removeAttribute("src");
    document.getElementById("guestSlidePlaceholder").hidden = false;
  }

  function receiveGuestSlide(slide) {
    if (role !== "guest" || !capture || !socket.connected || state.phase === "ended") return;
    if (typeof slide?.src !== "string" || !slide.src.startsWith("/decks/") || slide.src.includes("\\")) return clearGuestSlide();
    if (slide.src === slideSource) return;
    const version = ++slideVersion;
    slideSource = slide.src;
    const next = new Image();
    next.onload = () => {
      if (version !== slideVersion || !capture || !socket.connected || state.phase === "ended") return;
      const image = document.getElementById("guestSlide");
      image.src = slide.src;
      image.alt = slide.title || "Slide en curso";
      image.dataset.slideIndex = String(slide.index);
      image.hidden = false;
      document.getElementById("guestSlidePlaceholder").hidden = true;
    };
    next.onerror = () => { if (version === slideVersion) clearGuestSlide(); };
    next.src = slide.src;
  }

  function clearPeers() {
    for (const peer of peers.values()) {
      clearInterval(peer.watchdog);
      if (peer.frameRequest != null) video.cancelVideoFrameCallback?.(peer.frameRequest);
      peer.connection.close();
      peer.source?.disconnect();
      peer.gain?.disconnect();
    }
    peers.clear();
    if (role !== "guest") video.srcObject = null;
  }

  function audioGain(peer) {
    if (!peer.gain) return;
    const audible = role === "guest" || (role === "stage" && state.phase !== "live")
      || (role === "screen" && state.phase === "live" && !state.muted);
    peer.gain.gain.value = audible && socket.connected ? 1 : 0;
  }

  async function updateReturn() {
    const peer = peers.get("monitor");
    if (role !== "stage" || !peer?.sender) return;
    const stream = taking || ["starting", "live"].includes(state.phase) ? stageAudio : productionAudio;
    const track = stream?.getAudioTracks()[0];
    if (peer.sender.track !== track) await peer.sender.replaceTrack(track || null);
  }

  function render() {
    for (const peer of peers.values()) audioGain(peer);
    if (role === "screen") {
      const projecting = state.phase === "live" && Boolean(peers.get("program")?.ready);
      overlay.hidden = !projecting;
      overlay.classList.toggle("is-live", projecting);
      const portrait = projecting && video.videoWidth > 0 && video.videoHeight > video.videoWidth;
      screenHost.classList.toggle("guest-camera-portrait", portrait);
      if (portrait) screenHost.style.setProperty("--guest-camera-aspect", video.videoWidth / video.videoHeight);
      else screenHost.style.removeProperty("--guest-camera-aspect");
      overlay.querySelector(".guest-name").textContent = state.guestName || "Invitado";
      return;
    }
    if (role === "guest") {
      const showingPresentation = Boolean(capture) && state.phase !== "ended";
      document.getElementById("guestVisual").hidden = state.phase === "ended";
      document.getElementById("guestVisual").classList.toggle("has-presentation", showingPresentation);
      document.getElementById("guestSlideView").hidden = !showingPresentation;
      phaseLabel.textContent = state.phase === "ended" ? "ENLACE TERMINADO" : state.phase === "live" ? "EN VIVO" : "EN ESPERA";
      phaseLabel.parentElement.classList.toggle("is-live", state.phase === "live");
      message.textContent = state.phase === "ended" ? "Gracias por acompañarnos."
        : state.phase === "live" ? "Estás participando en el evento."
        : notice || (capture ? "Producción te dará la indicación de entrada." : "Entra para que producción prepare tu participación.");
      enter.hidden = Boolean(capture) || state.phase === "ended";
      enter.disabled = busy || !socket.connected;
      return;
    }
    const descriptions = {
      waiting: state.guestConnected ? "Invitado conectado · En espera" : "Esperando al invitado",
      preparing: "Conectando con el invitado…", ready: "En espera · Comunicación privada con producción",
      starting: "Enviando a Pantalla…", live: "EN VIVO", ended: "ENLACE TERMINADO"
    };
    message.textContent = notice || descriptions[state.phase] || "En espera";
    invite.disabled = busy || Boolean(state.id) || !socket.connected;
    startAudio.disabled = busy || Boolean(state.id);
    microphone.disabled = returnInput.disabled = busy || Boolean(state.id);
    connect.disabled = busy || Boolean(state.id) || !state.stageReady || !state.guestConnected;
    take.disabled = busy || state.phase !== "ready" || !state.screenReady;
    end.disabled = busy || (!state.id && !state.guestConnected);
    mute.hidden = state.phase !== "live";
    mute.textContent = state.muted ? "Abrir audio del invitado" : "Silenciar invitado";
  }

  async function command(event, input) {
    busy = true;
    notice = "";
    render();
    try {
      const result = await socket.timeout(12000).emitWithAck(event, ...input);
      if (!result?.ok) throw new Error(errors[result?.reason] || errors.service);
      return result;
    } catch (error) {
      notice = error.message?.startsWith("operation has timed out") ? errors.timeout : error.message || errors.service;
      return null;
    } finally { busy = false; render(); }
  }

  async function startGuest() {
    const version = ++captureVersion;
    busy = true;
    notice = "";
    render();
    try {
      await initAudio();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      if (version !== captureVersion || state.phase === "ended") { stream.getTracks().forEach(track => track.stop()); return; }
      capture = stream;
      video.srcObject = capture;
      await video.play();
      for (const track of stream.getTracks()) track.onended = () => fail(state.id);
      socket.emit("guest:media-ready");
    } catch { notice = "Permite la cámara y el micrófono para entrar."; stopStreams(); }
    finally { busy = false; render(); }
  }

  function audioOptions(select) {
    return { deviceId: select.value ? { exact: select.value } : undefined, echoCancellation: true, noiseSuppression: true };
  }

  async function startProduction() {
    busy = true;
    notice = "";
    render();
    try {
      await initAudio();
      stopStreams();
      productionAudio = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioOptions(microphone) });
      stageAudio = microphone.value === returnInput.value ? productionAudio
        : await navigator.mediaDevices.getUserMedia({ video: false, audio: { ...audioOptions(returnInput), echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      for (const stream of new Set([productionAudio, stageAudio])) {
        stream.getTracks()[0].onended = () => { fail(state.id); stopStreams(); };
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      for (const select of [microphone, returnInput]) {
        const current = select.value;
        select.replaceChildren(new Option("Predeterminado", ""));
        for (const device of devices.filter(item => item.kind === "audioinput")) select.add(new Option(device.label || "Entrada de audio", device.deviceId));
        select.value = current;
      }
      audioUnlocked = true;
      socket.emit("guest:media-ready");
    } catch { notice = "Permite el micrófono y comprueba las entradas de audio."; stopStreams(); }
    finally { busy = false; render(); }
  }

  if (role === "guest") {
    video = document.getElementById("guestPreview");
    message = document.getElementById("guestMessage");
    phaseLabel = document.getElementById("guestState");
    enter = document.getElementById("guestEnter");
    enter.addEventListener("click", () => void startGuest());
  } else if (role === "stage") {
    const button = document.createElement("button");
    button.className = "guest-open";
    button.textContent = "Invitados LIVE";
    document.querySelector(".stage-toolbar").append(button);
    dialog = document.createElement("dialog");
    dialog.className = "guest-production";
    dialog.innerHTML = `<header><h2>Invitados LIVE</h2><button type="button" data-close aria-label="Cerrar panel">×</button></header>
      <div class="guest-grid"><section>
        <label>Invitado<input data-name placeholder="Nombre del invitado" maxlength="100"></label>
        <button type="button" data-invite>Crear enlace</button>
        <label>Enlace del invitado<input data-link readonly placeholder="Crea el enlace para compartirlo"></label>
        <button type="button" data-copy>Copiar enlace</button>
        <hr><label>Micrófono de producción<select data-microphone><option value="">Predeterminado</option></select></label>
        <label>Audio del escenario<select data-return><option value="">Predeterminado</option></select></label>
        <button type="button" data-audio>Activar / actualizar audio</button>
        <p class="guest-note">Usa Stage con audífonos en un equipo distinto al de Pantalla. Conecta el retorno de consola sin la voz del invitado en «Audio del escenario».</p>
      </section><section>
        <video autoplay muted playsinline aria-label="Monitor privado del invitado"></video>
        <p class="guest-status" data-status aria-live="polite"></p>
        <div class="guest-actions"><button type="button" data-connect>Preparar conexión</button>
        <button type="button" data-take>Enviar a Pantalla</button>
        <button type="button" data-mute hidden>Silenciar invitado</button>
        <button type="button" class="guest-cut" data-end>Terminar enlace</button></div>
      </section></div>`;
    document.body.append(dialog);
    button.onclick = () => dialog.showModal();
    dialog.querySelector("[data-close]").onclick = () => dialog.close();
    const find = selector => dialog.querySelector(selector);
    video = find("video");
    message = find("[data-status]");
    guestName = find("[data-name]");
    microphone = find("[data-microphone]");
    returnInput = find("[data-return]");
    link = find("[data-link]");
    invite = find("[data-invite]");
    startAudio = find("[data-audio]");
    connect = find("[data-connect]");
    take = find("[data-take]");
    end = find("[data-end]");
    mute = find("[data-mute]");
    invite.onclick = async () => {
      const result = await command("guest:invite", [{ name: guestName.value }]);
      if (result) link.value = result.url;
    };
    find("[data-copy]").onclick = async () => {
      if (!link.value) return;
      try { await navigator.clipboard.writeText(link.value); }
      catch { link.select(); }
    };
    startAudio.onclick = () => void startProduction();
    connect.onclick = () => void command("guest:connect", []);
    take.onclick = async () => {
      taking = true;
      try {
        await updateReturn();
        if (!await command("guest:take", [])) { taking = false; await updateReturn(); }
      } catch { taking = false; fail(state.id); }
    };
    end.onclick = () => void command("guest:end", []);
    mute.onclick = () => socket.emit("guest:mute", !state.muted);
  } else {
    screenHost = document.getElementById("screen");
    overlay = document.createElement("div");
    overlay.className = "guest-program live-camera-program";
    overlay.hidden = true;
    overlay.innerHTML = '<video autoplay muted playsinline aria-label="Invitado LIVE"></video><img class="guest-live-label" src="/live-camera/live-sticker.png" alt="LIVE"><span class="guest-name"></span>';
    screenHost.append(overlay);
    video = overlay.querySelector("video");
    video.addEventListener("resize", render);
    let unlock;
    function ensureSharedUnlock() {
      if (audioUnlocked) return;
      const shared = [...document.querySelectorAll("[data-immersa-media-unlock]:not([hidden])")]
        .some(button => button !== unlock);
      if (shared) { unlock?.remove(); return; }
      if (!unlock) {
        unlock = document.createElement("button");
        unlock.type = "button";
        unlock.className = "guest-audio-unlock";
        unlock.dataset.immersaMediaUnlock = "1";
        unlock.textContent = "Activar audio";
      }
      if (!unlock.isConnected) screenHost.append(unlock);
    }
    const unlockObserver = new MutationObserver(ensureSharedUnlock);
    unlockObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    async function unlockGuestAudio() {
      try {
        await initAudio();
        if (!audioUnlocked) {
          audioUnlocked = true;
          socket.emit("guest:media-ready");
        }
        unlockObserver.disconnect();
        unlock?.remove();
        const first = !window.__immersaMediaUnlocked;
        window.__immersaMediaUnlocked = true;
        if (first) document.dispatchEvent(new Event("immersa:media-unlocked"));
      } catch {
        ensureSharedUnlock();
        if (unlock?.isConnected) unlock.textContent = "Reintentar audio";
      }
    }
    document.addEventListener("click", event => {
      if (event.target.closest?.("[data-immersa-media-unlock]")) void unlockGuestAudio();
    }, true);
    document.addEventListener("immersa:media-unlocked", () => {
      if (!audioUnlocked) void unlockGuestAudio();
    });
    if (window.__immersaMediaUnlocked) void unlockGuestAudio();
    else ensureSharedUnlock();
  }

  function fail(id) {
    clearPeers();
    if (overlay) {
      overlay.hidden = true;
      overlay.classList.remove("is-live");
      screenHost.classList.remove("guest-camera-portrait");
      screenHost.style.removeProperty("--guest-camera-aspect");
    }
    if (id && socket.connected) socket.emit("guest:failed", { id });
  }

  async function checkFrames(peer) {
    if (!peer.receiver || video.readyState < 2 || !video.videoWidth || video.paused) return;
    peer.checkingFrames = true;
    try {
      const reports = await peer.receiver.getStats();
      if (peers.get(peer.channel) !== peer) return;
      for (const report of reports.values()) {
        if (report.type !== "inbound-rtp" || !(report.framesDecoded > (peer.decodedFrames || 0))) continue;
        peer.decodedFrames = report.framesDecoded;
        peer.lastFrame = performance.now();
        if (!peer.ready && peer.remote.getAudioTracks().some(track => !track.muted)) {
          peer.ready = true;
          socket.emit("guest:ready", { id: peer.id, channel: peer.channel });
        }
      }
    } catch {
      // Without fresh decoded video the monitor stays private or the program watchdog cuts it.
    } finally { peer.checkingFrames = false; }
  }

  async function prepare(setup) {
    if (peers.has(setup.channel)) return;
    if (role === "guest" && !capture) return fail(setup.id);
    if (role !== "guest" && !audioUnlocked) return fail(setup.id);
    const connection = new RTCPeerConnection(setup.rtc);
    const peer = {
      connection, id: setup.id, channel: setup.channel, remote: new MediaStream(), candidates: [],
      queue: Promise.resolve(), deadline: performance.now() + setup.duration, lastFrame: 0, ready: false
    };
    peers.set(setup.channel, peer);
    connection.onicecandidate = ({ candidate }) => {
      if (candidate && peers.get(setup.channel) === peer) socket.emit("guest:signal", {
        id: peer.id, channel: peer.channel, candidate: candidate.toJSON()
      });
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "failed") fail(peer.id);
    };
    connection.ontrack = ({ track, receiver }) => {
      if (peers.get(peer.channel) !== peer) return;
      peer.remote.addTrack(track);
      if (track.kind === "video") peer.receiver = receiver;
      if (role !== "guest" && video.srcObject !== peer.remote) {
        video.srcObject = peer.remote;
        void video.play().catch(() => fail(peer.id));
      }
      if (track.kind === "audio") {
        peer.source = audioContext.createMediaStreamSource(new MediaStream([track]));
        peer.gain = audioContext.createGain();
        peer.gain.gain.value = 0;
        peer.source.connect(peer.gain).connect(audioContext.destination);
        audioGain(peer);
      }
    };
    peer.watchdog = setInterval(() => {
      if (peers.get(peer.channel) !== peer) return;
      if (performance.now() >= peer.deadline) return fail(peer.id);
      if (role === "screen" && document.querySelector(".audiovisual-screen-layer.is-video, .immersa-video-slide:not([hidden]), .immersa-youtube-slide:not([hidden])")) return fail(peer.id);
      if (role === "guest") return;
      if (!peer.checkingFrames) void checkFrames(peer);
      if (peer.ready && performance.now() - peer.lastFrame > 3000) fail(peer.id);
    }, 250);
    if (setup.offer) {
      const stream = role === "guest" ? capture : peers.get("monitor")?.remote;
      if (!stream?.getAudioTracks().length || !stream.getVideoTracks().length) return fail(peer.id);
      for (const track of stream.getTracks()) connection.addTransceiver(track, {
        direction: role === "guest" && track.kind === "audio" ? "sendrecv" : "sendonly",
        streams: [stream], sendEncodings: track.kind === "video" ? [{ maxBitrate: 1800000 }] : undefined
      });
      await connection.setLocalDescription(await connection.createOffer());
      socket.emit("guest:signal", { id: peer.id, channel: peer.channel, description: connection.localDescription.toJSON() });
    }
  }

  async function signal(peer, body) {
    const connection = peer.connection;
    if (body.candidate) {
      if (connection.remoteDescription) await connection.addIceCandidate(body.candidate);
      else peer.candidates.push(body.candidate);
      return;
    }
    await connection.setRemoteDescription(body.description);
    for (const candidate of peer.candidates.splice(0)) await connection.addIceCandidate(candidate);
    if (body.description.type === "offer") {
      for (const transceiver of connection.getTransceivers()) {
        transceiver.direction = "recvonly";
        if (role === "stage" && transceiver.receiver.track.kind === "audio") {
          transceiver.direction = "sendrecv";
          peer.sender = transceiver.sender;
          await peer.sender.replaceTrack(productionAudio.getAudioTracks()[0]);
        }
      }
      await connection.setLocalDescription(await connection.createAnswer());
      socket.emit("guest:signal", { id: peer.id, channel: peer.channel, description: connection.localDescription.toJSON() });
    }
  }

  socket.on("guest:prepare", setup => { void prepare(setup).catch(() => fail(setup.id)); });
  socket.on("guest:slide", receiveGuestSlide);
  socket.on("guest:signal", body => {
    const peer = peers.get(body.channel);
    if (!peer || peer.id !== body.id) return;
    peer.queue = peer.queue.then(() => signal(peer, body)).catch(() => fail(peer.id));
  });
  socket.on("guest:lease", ({ id, duration }) => {
    for (const peer of peers.values()) if (peer.id === id) peer.deadline = performance.now() + duration;
  });
  socket.on("guest:state", next => {
    const changed = state.id !== next.id;
    state = next;
    notice = errors[next.reason] || "";
    if (changed) { clearPeers(); taking = false; }
    if (next.phase === "ended" && role === "guest") stopStreams();
    void updateReturn().catch(() => fail(state.id));
    render();
  });
  socket.on("connect", () => {
    if (capture || (role !== "guest" && audioUnlocked && (role === "screen" || productionAudio))) socket.emit("guest:media-ready");
    render();
  });
  socket.on("disconnect", () => {
    clearGuestSlide();
    fail();
    if (state.phase === "ended") return render();
    state = { ...state, id: null, phase: "waiting" };
    notice = "Reconectando con producción…";
    render();
  });
  socket.on("connect_error", () => {
    fail();
    stopStreams();
    notice = "Este enlace no está disponible. Solicita a producción un enlace nuevo.";
    render();
  });
  window.addEventListener("pagehide", () => { socket.disconnect(); fail(); stopStreams(); });
  render();
})();
