(() => {
  const { role, access_token: accessToken } = window.IMMERSA_ROLE_OPEN || {};
  const host = document.querySelector({ speaker: ".top-actions", stage: ".stage-toolbar", screen: "#screen" }[role]);
  if (!host || !accessToken || !["speaker", "stage", "screen"].includes(role)) return;

  const demo = document.currentScript?.dataset?.liveCameraNamespace === "/live-camera-demo";
  const socket = io(demo ? "/live-camera-demo" : "/live-camera", { auth: { role, accessToken }, transports: ["websocket"], forceNew: true });
  const copy = {
    busy: "Pantalla ocupada o sin conexión",
    camera: "Cámara no disponible",
    "camera-switch": "No se pudo cambiar de cámara. Seguimos al aire con la anterior.",
    event: "Stage debe iniciar la conferencia",
    "speaker-access": "El enlace de Speaker LIVE ya no es válido. " + (demo ? "Abre Speaker desde el Deck." : "Abre el enlace desde Event Hub."),
    "screen-access": "El enlace de Pantalla LIVE ya no es válido. " + (demo ? "Abre Pantalla desde el Deck." : "Abre el enlace desde Event Hub."),
    service: "No se pudo comprobar el estado de LIVE. Intenta de nuevo.",
    production: "Pantalla está reproduciendo otro video",
    signal: "Se perdió la señal",
    stage: "Stage finalizó LIVE",
    timeout: "LIVE tardó demasiado en iniciar. Intenta de nuevo.",
    network: "No se pudo conectar con Pantalla. Revisa que ambos equipos estén en la misma red.",
    video: "Pantalla no pudo reproducir el video de LIVE.",
    stopped: "LIVE finalizado"
  };

  let status = { phase: "idle", screenReady: false };
  let attempt = null;
  let stream = null;
  let captureVersion = 0;
  let capturing = false;
  let sending = false;
  let notice = "";
  let panel;
  let toggle;
  let facingMode = "environment";
  let cameraButtons;
  let monitorBar;
  let cameraPicker;
  let monitorFeed;
  let switchStatus;
  let reopen;
  let send;
  let actions;
  let label;
  let video;
  let program;
  let setMonitorOpen;

  if (role === "speaker") {
    const streamArea = host.closest(".stream-area");
    const shell = streamArea?.closest(".presenter-shell");
    if (!shell) return;
    const header = document.createElement("header");
    header.className = "live-camera-speaker-header";
    header.append(streamArea.querySelector(".brand-lockup"), streamArea.querySelector(".speaker-timer-stack"), host);
    streamArea.prepend(header);

    toggle = document.createElement("button");
    toggle.className = "live-camera-toggle";
    toggle.type = "button";
    toggle.textContent = "LIVE";
    toggle.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "live-camera-monitor");
    host.prepend(toggle);

    panel = document.createElement("section");
    panel.id = "live-camera-monitor";
    panel.className = "live-camera-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "Monitor LIVE");
    panel.innerHTML = `<div class="live-camera-monitor-bar">
      <h2>Preview</h2>
      <div class="live-camera-camera-picker" role="group" aria-label="Cámara">
        <button type="button" data-facing="environment" aria-pressed="true">Trasera</button>
        <button type="button" data-facing="user" aria-pressed="false">Frontal</button>
      </div>
      <button type="button" class="live-camera-close" aria-label="Cerrar cámara" title="Cerrar cámara">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
      </button>
    </div>
    <div class="live-camera-monitor-feed">
      <video muted autoplay playsinline aria-label="Preview de cámara"></video>
      <p class="live-camera-switch-status" role="status" hidden></p>
    </div>
    <div class="live-camera-monitor-actions">
      <p role="status"></p>
      <button type="button" data-action="capture">Abrir cámara</button>
      <button type="button" data-action="send">Enviar a Pantalla</button>
    </div>`;
    shell.append(panel);
    video = panel.querySelector("video");
    monitorBar = panel.querySelector(".live-camera-monitor-bar");
    cameraPicker = panel.querySelector(".live-camera-camera-picker");
    monitorFeed = panel.querySelector(".live-camera-monitor-feed");
    switchStatus = panel.querySelector(".live-camera-switch-status");
    cameraButtons = panel.querySelectorAll("[data-facing]");
    reopen = panel.querySelector('[data-action="capture"]');
    label = panel.querySelector(".live-camera-monitor-actions p");
    send = panel.querySelector('[data-action="send"]');
    actions = panel.querySelector(".live-camera-monitor-actions");
    const close = panel.querySelector(".live-camera-close");
    const inertControls = new Set();
    setMonitorOpen = open => {
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      shell.classList.toggle("live-camera-monitor-open", open);
      if (!open) {
        for (const element of inertControls) element.inert = false;
        inertControls.clear();
        return;
      }
      for (const element of [...shell.children, ...streamArea.children]) {
        if (element === streamArea || element === header || element === panel || element.inert) continue;
        element.inert = true;
        inertControls.add(element);
      }
    };
    toggle.addEventListener("click", () => {
      if (!panel.hidden) return finishLocal("stopped", true);
      setMonitorOpen(true);
      void capture();
    });
    for (const button of cameraButtons) {
      button.addEventListener("click", () => {
        const nextFacing = button.dataset.facing;
        if (capturing || sending || facingMode === nextFacing) return;
        if (isOnAir()) return void switchCamera(nextFacing);
        facingMode = nextFacing;
        void capture();
      });
    }
    reopen.addEventListener("click", () => void capture());
    close.addEventListener("click", () => {
      finishLocal("stopped", true);
      toggle.focus();
    });
    send.addEventListener("click", () => {
      if (!stream || !socket.connected || status.phase !== "idle" || sending) return;
      sending = true;
      notice = "";
      render();
      socket.timeout(6000).emit("live:start", (error, result) => {
        sending = false;
        if (error) {
          finishLocal("signal");
        } else if (!result?.ok) {
          notice = copy[result?.reason] || copy.signal;
        }
        render();
      });
    });
  } else if (role === "stage") {
    toggle = document.createElement("button");
    toggle.className = "live-camera-stage";
    toggle.type = "button";
    toggle.hidden = true;
    toggle.textContent = "Cortar LIVE";
    host.prepend(toggle);
    toggle.addEventListener("click", () => {
      if (socket.connected && status.phase === "live" && status.id) socket.emit("live:stop", { id: status.id });
    });
  } else {
    const slide = host.querySelector("#slide");
    if (slide) {
      const updateSlideAspect = () => {
        if (slide.naturalWidth && slide.naturalHeight) {
          slide.style.setProperty("--live-camera-slide-aspect", slide.naturalWidth / slide.naturalHeight);
        }
      };
      slide.addEventListener("load", updateSlideAspect);
      updateSlideAspect();
    }
    program = document.createElement("div");
    program.className = "live-camera-program";
    const sticker = document.createElement("img");
    sticker.className = "live-camera-sticker";
    sticker.src = "/live-camera/live-sticker.png";
    sticker.alt = "";

    video = document.createElement("video");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("aria-label", "Cámara LIVE");
    video.addEventListener("resize", render);
    program.append(video, sticker);
    host.append(program);
  }

  function isOnAir() {
    return Boolean(attempt && status.phase === "live" && status.id === attempt.id);
  }

  function render() {
    if (role === "speaker") {
      const onAir = isOnAir();
      toggle.hidden = !socket.connected;
      toggle.textContent = onAir ? "Cortar LIVE" : panel.hidden ? "LIVE" : "CERRAR";
      toggle.classList.toggle("is-live", onAir);
      label.textContent = onAir ? "" : notice || (attempt || sending ? "Conectando con Pantalla…"
        : capturing ? "Abriendo cámara…" : status.screenReady ? "" : "Esperando Pantalla");
      for (const button of cameraButtons) {
        button.disabled = capturing || sending || Boolean(attempt && !onAir);
        button.setAttribute("aria-pressed", String(button.dataset.facing === facingMode));
      }
      reopen.hidden = Boolean(stream || capturing || sending);
      send.disabled = !stream || capturing || sending || !socket.connected || !status.screenReady || status.phase !== "idle";
      actions.hidden = onAir;
      panel.classList.toggle("is-on-air", onAir);
      monitorBar.hidden = onAir;
      if (onAir && cameraPicker.parentElement !== monitorFeed) monitorFeed.append(cameraPicker);
      else if (!onAir && cameraPicker.parentElement !== monitorBar) monitorBar.insertBefore(cameraPicker, monitorBar.lastElementChild);
      switchStatus.textContent = onAir ? (capturing ? "Cambiando cámara…" : notice) : "";
      switchStatus.hidden = !switchStatus.textContent;
    } else if (role === "stage") {
      toggle.hidden = !socket.connected || status.phase !== "live" || !status.id;
    } else {
      const projecting = Boolean(attempt?.firstFrame && isOnAir());
      const portrait = projecting && video.videoWidth > 0 && video.videoHeight > video.videoWidth;
      program.classList.toggle("is-live", projecting);
      host.classList.toggle("live-camera-portrait", portrait);
      if (projecting && video.videoWidth && video.videoHeight) {
        host.style.setProperty("--live-camera-aspect", video.videoWidth / video.videoHeight);
      } else host.style.removeProperty("--live-camera-aspect");
    }
  }

  function releaseCamera() {
    captureVersion++;
    capturing = false;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
  }

  function openCamera(facing) {
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
      audio: false
    });
  }

  function showCamera(next) {
    const track = next.getVideoTracks()[0];
    stream = next;
    track.addEventListener("ended", () => {
      if (stream === next) finishLocal("camera");
    });
    video.srcObject = next;
    return video.play();
  }

  async function capture() {
    releaseCamera();
    const version = captureVersion;
    notice = "";
    capturing = true;
    render();
    try {
      const next = await openCamera(facingMode);
      if (version !== captureVersion) {
        next.getTracks().forEach(track => track.stop());
        return;
      }
      await showCamera(next);
    } catch {
      if (version !== captureVersion) return;
      releaseCamera();
      notice = copy.camera;
    }
    if (version === captureVersion) capturing = false;
    render();
  }

  async function switchCamera(nextFacing) {
    const current = attempt;
    const version = ++captureVersion;
    const previousFacing = facingMode;
    capturing = true;
    notice = "";
    render();
    socket.emit("live:camera-switch", { id: current.id, switching: true });
    stream?.getTracks().forEach(track => track.stop());

    async function replaceCamera(facing) {
      const next = await openCamera(facing);
      try {
        if (version !== captureVersion) return false;
        const track = next.getVideoTracks()[0];
        const actualFacing = track?.getSettings().facingMode;
        if (!track || (actualFacing && actualFacing !== facing)) throw new Error("Camera unavailable");
        await current.sender.replaceTrack(track);
        if (version !== captureVersion) return false;
        facingMode = facing;
        void showCamera(next).catch(() => {});
        return true;
      } finally {
        if (stream !== next) next.getTracks().forEach(track => track.stop());
      }
    }

    try {
      await replaceCamera(nextFacing);
    } catch {
      if (version !== captureVersion) return;
      try {
        if (await replaceCamera(previousFacing)) notice = copy["camera-switch"];
      } catch {
        if (version === captureVersion) finishLocal("camera");
      }
    } finally {
      if (version === captureVersion) {
        capturing = false;
        socket.emit("live:camera-switch", { id: current.id, switching: false });
        render();
      }
    }
  }

  function teardown() {
    if (attempt) {
      const previous = attempt;
      attempt = null;
      clearInterval(previous.watchdog);
      if (previous.frameRequest != null) video.cancelVideoFrameCallback?.(previous.frameRequest);
      previous.peer.close();
    }
    if (role === "speaker") releaseCamera();
    if (role === "screen") video.srcObject = null;
  }

  function finishLocal(reason, closePanel = false) {
    if (attempt && socket.connected) socket.emit("live:stop", { id: attempt.id, reason });
    teardown();
    notice = copy[reason] || "";
    if (closePanel) setMonitorOpen(false);
    render();
  }

  function videoInProduction() {
    return Boolean(host.querySelector(".audiovisual-screen-layer.is-video, .immersa-video-slide:not([hidden]), .immersa-youtube-slide:not([hidden])"));
  }

  function confirmFrame(current) {
    if (attempt !== current) return;
    current.lastFrame = performance.now();
    if (!current.firstFrame) {
      current.firstFrame = true;
      socket.emit("live:ready", current.id);
    }
  }

  function watchFrame(current) {
    current.frameRequest = video.requestVideoFrameCallback(() => {
      if (attempt !== current) return;
      current.receivedFrameCallback = true;
      confirmFrame(current);
      watchFrame(current);
    });
  }

  async function checkDecodedFrames(current) {
    if (!current.receiver?.getStats || current.checkingFrames) return;
    current.checkingFrames = true;
    try {
      const stats = await current.receiver.getStats();
      if (attempt !== current || current.receivedFrameCallback) return;
      for (const report of stats.values()) {
        if (report.type === "inbound-rtp" && report.framesDecoded > (current.decodedFrames.get(report.id) || 0)) {
          current.decodedFrames.set(report.id, report.framesDecoded);
          confirmFrame(current);
        }
      }
    } catch {
      // Frame callbacks still work when playback statistics are unavailable.
    } finally {
      current.checkingFrames = false;
    }
  }

  async function setUp({ id, rtc, duration }) {
    if (role === "stage" || attempt) return;
    if ((role === "speaker" && !stream) || (role === "screen" && videoInProduction())) {
      socket.emit("live:stop", { id, reason: role === "screen" ? "production" : "camera" });
      return;
    }
    let peer;
    try {
      peer = new RTCPeerConnection(rtc);
    } catch {
      socket.emit("live:stop", { id, reason: "signal" });
      return;
    }
    const current = {
      id, peer, candidates: [], signals: Promise.resolve(), deadline: performance.now() + duration,
      firstFrame: false, lastFrame: -Infinity, decodedFrames: new Map(), mediaTime: -1, switchUntil: 0
    };
    attempt = current;
    peer.onicecandidate = ({ candidate }) => {
      if (candidate && attempt === current) socket.emit("live:signal", { id, candidate: candidate.toJSON() });
    };
    peer.onconnectionstatechange = () => {
      if (attempt !== current) return;
      if (role === "screen" && peer.connectionState === "connected" && !current.firstFrame) socket.emit("live:connected", id);
      if (peer.connectionState === "failed") {
        finishLocal(!isOnAir() && peer.iceConnectionState === "failed" ? "network" : "signal");
      }
    };
    current.watchdog = setInterval(() => {
      if (attempt !== current) return;
      const now = performance.now();
      if (now >= current.deadline) return finishLocal("signal");
      if (role !== "screen") return;
      if (videoInProduction()) return finishLocal("production");
      if (video.readyState >= 2 && video.videoWidth && !video.paused) {
        if (video.requestVideoFrameCallback) {
          if (!current.receivedFrameCallback) void checkDecodedFrames(current);
        } else if (video.currentTime !== current.mediaTime) {
          current.mediaTime = video.currentTime;
          confirmFrame(current);
        }
      }
      if (current.firstFrame && now >= current.switchUntil && now - current.lastFrame > 2000) finishLocal("signal");
    }, 200);

    if (role === "screen") {
      peer.ontrack = ({ track, receiver }) => {
        if (attempt !== current || track.kind !== "video") return;
        current.receiver = receiver;
        video.srcObject = new MediaStream([track]);
        if (video.requestVideoFrameCallback) watchFrame(current);
        video.play().catch(() => { if (attempt === current) finishLocal("video"); });
      };
      render();
      return;
    }

    try {
      current.sender = peer.addTransceiver(stream.getVideoTracks()[0], {
        direction: "sendonly", streams: [stream], sendEncodings: [{ maxBitrate: 1800000 }]
      }).sender;
      await peer.setLocalDescription(await peer.createOffer());
      if (attempt === current) socket.emit("live:signal", { id, description: peer.localDescription.toJSON() });
    } catch {
      if (attempt === current) finishLocal("signal");
    }
    render();
  }

  async function receiveSignal(current, { description, candidate }) {
    const { peer, id, candidates } = current;
    if (attempt !== current) return;
    if (candidate) {
      if (peer.remoteDescription) await peer.addIceCandidate(candidate);
      else candidates.push(candidate);
      return;
    }
    await peer.setRemoteDescription(description);
    for (const waiting of candidates.splice(0)) await peer.addIceCandidate(waiting);
    if (role !== "screen" || attempt !== current) return;
    await peer.setLocalDescription(await peer.createAnswer());
    if (attempt === current) socket.emit("live:signal", { id, description: peer.localDescription.toJSON() });
  }

  socket.on("live:prepare", setup => void setUp(setup));
  socket.on("live:signal", message => {
    const current = attempt;
    if (!current || current.id !== message.id) return;
    current.signals = current.signals.then(() => receiveSignal(current, message)).catch(() => {
      if (attempt === current) finishLocal("signal");
    });
  });
  socket.on("live:status", next => {
    status = next;
    if (attempt && next.id !== attempt.id) {
      teardown();
      notice = copy[next.reason] || "";
    }
    render();
  });
  socket.on("live:lease", ({ id, duration }) => {
    if (attempt?.id === id) attempt.deadline = performance.now() + duration;
  });
  socket.on("live:camera-switch", ({ id, switching }) => {
    if (role !== "screen" || attempt?.id !== id || !isOnAir()) return;
    const now = performance.now();
    if (!switching) attempt.switchUntil = Math.min(attempt.switchUntil, now + 2000);
    else if (now - attempt.lastFrame <= 2000) attempt.switchUntil = now + 6500;
  });
  socket.on("connect", render);
  socket.on("disconnect", () => {
    status = { phase: "idle", screenReady: false };
    sending = false;
    if (role !== "stage") finishLocal("signal", role === "speaker");
    else render();
  });
  if (role === "speaker") {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && !panel.hidden) finishLocal("camera", true);
    });
    window.addEventListener("pagehide", () => finishLocal("camera", true));
  }
  render();
})();
