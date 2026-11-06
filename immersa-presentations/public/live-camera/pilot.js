(() => {
  const role = window.IMMERSA_ROLE_OPEN?.role;
  const host = document.querySelector({ speaker: ".top-actions", stage: ".stage-toolbar", screen: "#screen" }[role]);
  if (!host || !["speaker", "stage", "screen"].includes(role)) return;

  const socket = io("/live-camera", { auth: { role }, transports: ["websocket"], forceNew: true });
  const copy = {
    busy: "Pantalla ocupada o sin conexión",
    camera: "Cámara no disponible",
    event: "Stage debe iniciar la conferencia",
    production: "Pantalla está reproduciendo otro video",
    signal: "Se perdió la señal",
    stage: "Stage finalizó LIVE",
    timeout: "Pantalla no recibió video a tiempo",
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
  let camera;
  let reopen;
  let send;
  let close;
  let label;
  let video;

  if (role === "speaker") {
    toggle = document.createElement("button");
    toggle.className = "live-camera-toggle";
    toggle.type = "button";
    toggle.textContent = "LIVE";
    toggle.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    host.append(toggle);

    panel = document.createElement("section");
    panel.className = "live-camera-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "IMMERSA LIVE");
    panel.innerHTML = `<p role="status">Previsualización privada</p>
      <video muted autoplay playsinline aria-label="Previsualización privada"></video>
      <label>Cámara <select><option value="environment">Trasera</option><option value="user">Frontal</option></select></label>
      <div><button type="button" data-action="capture">Abrir cámara</button>
      <button type="button" data-action="send">Enviar a Pantalla</button>
      <button type="button" data-action="close">Cerrar cámara</button></div>`;
    (host.closest(".presenter-shell") || document.body).append(panel);
    video = panel.querySelector("video");
    camera = panel.querySelector("select");
    reopen = panel.querySelector('[data-action="capture"]');
    label = panel.querySelector("p");
    send = panel.querySelector('[data-action="send"]');
    close = panel.querySelector('[data-action="close"]');
    toggle.addEventListener("click", () => {
      if (!panel.hidden) return finishLocal("stopped", true);
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      void capture();
    });
    camera.addEventListener("change", () => void capture());
    reopen.addEventListener("click", () => void capture());
    close.addEventListener("click", () => finishLocal("stopped", true));
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
    panel = document.createElement("div");
    panel.className = "live-camera-stage";
    panel.hidden = true;
    panel.innerHTML = '<span role="status"></span><button type="button">Cortar LIVE</button>';
    label = panel.querySelector("span");
    close = panel.querySelector("button");
    host.append(panel);
    close.addEventListener("click", () => {
      if (socket.connected && status.id) socket.emit("live:stop", { id: status.id });
    });
  } else {
    video = document.createElement("video");
    video.className = "live-camera-program";
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("aria-label", "Cámara LIVE");
    host.append(video);
  }

  function render() {
    if (role === "speaker") {
      toggle.hidden = !socket.connected;
      toggle.classList.toggle("is-live", Boolean(attempt && status.phase === "live"));
      label.textContent = notice || (attempt && status.phase === "live" ? "En vivo en Pantalla"
        : attempt || sending ? "Conectando con Pantalla…"
        : capturing ? "Abriendo cámara…" : status.screenReady ? "Previsualización privada" : "Esperando Pantalla");
      camera.disabled = Boolean(attempt || sending);
      reopen.hidden = Boolean(stream || capturing || sending);
      send.disabled = !stream || capturing || sending || !socket.connected || !status.screenReady || status.phase !== "idle";
      close.textContent = attempt || sending ? "Finalizar LIVE" : "Cerrar cámara";
    } else if (role === "stage") {
      panel.hidden = !socket.connected;
      close.disabled = !status.id;
      const phase = status.phase === "live" ? "En vivo" : status.phase === "starting" ? "Conectando" : "En espera";
      label.textContent = "LIVE · " + phase + (notice ? " · " + notice : "");
    } else {
      video.classList.toggle("is-live", Boolean(attempt?.firstFrame && status.phase === "live" && status.id === attempt.id));
    }
  }

  function releaseCamera() {
    captureVersion++;
    capturing = false;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
  }

  async function capture() {
    releaseCamera();
    const version = captureVersion;
    notice = "";
    capturing = true;
    render();
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: camera.value }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        audio: false
      });
      if (version !== captureVersion) {
        next.getTracks().forEach(track => track.stop());
        return;
      }
      stream = next;
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        if (stream === next) finishLocal("camera");
      });
      video.srcObject = stream;
      await video.play();
    } catch {
      if (version !== captureVersion) return;
      releaseCamera();
      notice = copy.camera;
    }
    if (version === captureVersion) capturing = false;
    render();
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
    if (closePanel && panel) {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    }
    render();
  }

  function videoInProduction() {
    return Boolean(host.querySelector(".audiovisual-screen-layer.is-video, .immersa-video-slide:not([hidden]), .immersa-youtube-slide:not([hidden])"));
  }

  function watchFrame(current) {
    if (attempt !== current) return;
    current.lastFrame = performance.now();
    if (!current.firstFrame) {
      current.firstFrame = true;
      socket.emit("live:ready", current.id);
    }
    if (video.requestVideoFrameCallback) current.frameRequest = video.requestVideoFrameCallback(() => watchFrame(current));
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
      firstFrame: false, mediaTime: -1
    };
    attempt = current;
    peer.onicecandidate = ({ candidate }) => {
      if (candidate && attempt === current) socket.emit("live:signal", { id, candidate: candidate.toJSON() });
    };
    peer.onconnectionstatechange = () => {
      if (attempt === current && peer.connectionState === "failed") finishLocal("signal");
    };
    current.watchdog = setInterval(() => {
      if (attempt !== current) return;
      const now = performance.now();
      if (now >= current.deadline) return finishLocal("signal");
      if (role !== "screen") return;
      if (videoInProduction()) return finishLocal("production");
      if (!video.requestVideoFrameCallback && video.readyState >= 2 && video.currentTime !== current.mediaTime) {
        current.mediaTime = video.currentTime;
        watchFrame(current);
      }
      if (current.firstFrame && now - current.lastFrame > 2000) finishLocal("signal");
    }, 200);

    if (role === "screen") {
      peer.ontrack = ({ track }) => {
        if (attempt !== current || track.kind !== "video") return;
        video.srcObject = new MediaStream([track]);
        if (video.requestVideoFrameCallback) current.frameRequest = video.requestVideoFrameCallback(() => watchFrame(current));
        video.play().catch(() => { if (attempt === current) finishLocal("signal"); });
      };
      render();
      return;
    }

    try {
      peer.addTransceiver(stream.getVideoTracks()[0], {
        direction: "sendonly", streams: [stream], sendEncodings: [{ maxBitrate: 1800000 }]
      });
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
    } else if (role === "stage") {
      notice = copy[next.reason] || "";
    }
    render();
  });
  socket.on("live:lease", ({ id, duration }) => {
    if (attempt?.id === id) attempt.deadline = performance.now() + duration;
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
