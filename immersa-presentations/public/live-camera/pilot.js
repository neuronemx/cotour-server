(() => {
  const { role, access_token: accessToken } = window.IMMERSA_ROLE_OPEN || {};
  const host = document.querySelector({ speaker: ".top-actions", stage: ".stage-toolbar", screen: "#screen" }[role]);
  if (!host || !accessToken || !["speaker", "stage", "screen"].includes(role)) return;

  const socket = io("/live-camera", { auth: { role, accessToken }, transports: ["websocket"], forceNew: true });
  const copy = {
    busy: "Pantalla ocupada o sin conexión",
    camera: "Cámara no disponible",
    event: "Stage debe iniciar la conferencia",
    "speaker-access": "El enlace de Speaker LIVE ya no es válido. Abre el enlace desde Event Hub.",
    "screen-access": "El enlace de Pantalla LIVE ya no es válido. Abre el enlace desde Event Hub.",
    service: "No se pudo comprobar el estado de LIVE. Intenta de nuevo.",
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
  let facingMode = "environment";
  let cameraButtons;
  let reopen;
  let send;
  let actions;
  let label;
  let video;
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
    panel.setAttribute("aria-labelledby", "live-camera-preview-title");
    panel.innerHTML = `<div class="live-camera-monitor-bar">
      <h2 id="live-camera-preview-title">Preview</h2>
      <div class="live-camera-camera-picker" role="group" aria-label="Cámara">
        <button type="button" data-facing="environment" aria-pressed="true">Trasera</button>
        <button type="button" data-facing="user" aria-pressed="false">Frontal</button>
      </div>
      <button type="button" class="live-camera-close" aria-label="Cerrar cámara" title="Cerrar cámara">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
      </button>
    </div>
    <div class="live-camera-monitor-feed"><video muted autoplay playsinline aria-label="Preview de cámara"></video></div>
    <div class="live-camera-monitor-actions">
      <p role="status"></p>
      <button type="button" data-action="capture">Abrir cámara</button>
      <button type="button" data-action="send">Enviar a Pantalla</button>
    </div>`;
    shell.append(panel);
    video = panel.querySelector("video");
    cameraButtons = panel.querySelectorAll("[data-facing]");
    reopen = panel.querySelector('[data-action="capture"]');
    label = panel.querySelector("p");
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
        if (facingMode === button.dataset.facing) return;
        facingMode = button.dataset.facing;
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
      const onAir = Boolean(attempt && status.phase === "live" && status.id === attempt.id);
      toggle.hidden = !socket.connected;
      toggle.textContent = onAir ? "Cortar LIVE" : panel.hidden ? "LIVE" : "CERRAR";
      toggle.classList.toggle("is-live", onAir);
      label.textContent = notice || (attempt || sending ? "Conectando con Pantalla…"
        : capturing ? "Abriendo cámara…" : status.screenReady ? "" : "Esperando Pantalla");
      for (const button of cameraButtons) {
        button.disabled = Boolean(attempt || sending);
        button.setAttribute("aria-pressed", String(button.dataset.facing === facingMode));
      }
      reopen.hidden = Boolean(stream || capturing || sending);
      send.disabled = !stream || capturing || sending || !socket.connected || !status.screenReady || status.phase !== "idle";
      actions.hidden = onAir;
    } else if (role === "stage") {
      toggle.hidden = !socket.connected || status.phase !== "live" || !status.id;
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
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
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
    if (closePanel) setMonitorOpen(false);
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
