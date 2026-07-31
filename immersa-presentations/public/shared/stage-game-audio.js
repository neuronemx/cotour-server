(function (root) {
  if (!/^\/stage(?:\/|$)/.test(root.location?.pathname || "")) return;

  const liveSocket = typeof socket !== "undefined" ? socket : root.socket;
  const host = root.document?.getElementById("stageAudioControls");
  if (!liveSocket || !host) return;

  let config = { muted: false, volume: 0.7 };
  const volumeOn = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 8a5 5 0 0 1 0 8"/><path d="M17.7 5a9 9 0 0 1 0 14"/><path d="M6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5a.8.8 0 0 1 1.5.5v14a.8.8 0 0 1-1.5.5L6 15"/></svg>';
  const volumeOff = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 11v8a.8.8 0 0 1-1.5.5L6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l1.3-1.7"/><path d="M3 3l18 18"/></svg>';

  const controls = root.document.createElement("span");
  controls.className = "stage-audio-controls";
  controls.innerHTML = '<button type="button" data-stage-game-audio-mute aria-label="Silenciar audio"></button>'
    + '<input data-stage-game-audio-volume aria-label="Volumen de juegos" type="range" min="0" max="100" value="70">';
  host.replaceChildren(controls);

  const mute = controls.querySelector("[data-stage-game-audio-mute]");
  const volume = controls.querySelector("[data-stage-game-audio-volume]");

  function syncUi() {
    mute.innerHTML = config.muted ? volumeOff : volumeOn;
    mute.setAttribute("aria-label", config.muted ? "Activar audio" : "Silenciar audio");
    volume.value = String(Math.round(config.volume * 100));
  }

  function broadcast() {
    const shared = { muted: config.muted, volume: config.volume };
    liveSocket.emit("breakout:audio:set", shared);
    liveSocket.emit("pong:audio:set", shared);
  }

  function receive(next) {
    if (!next || typeof next !== "object") return;
    const nextVolume = Number(next.volume);
    config = {
      muted: Boolean(next.muted),
      volume: Number.isFinite(nextVolume)
        ? Math.max(0, Math.min(1, nextVolume))
        : config.volume,
    };
    syncUi();
  }

  mute.addEventListener("click", () => {
    config.muted = !config.muted;
    broadcast();
    syncUi();
  });
  volume.addEventListener("input", () => {
    config.volume = Number(volume.value) / 100;
    config.muted = false;
    broadcast();
    syncUi();
  });

  liveSocket.on("breakout:audio:state", receive);
  liveSocket.on("pong:audio:state", receive);
  liveSocket.on("connect", () => {
    liveSocket.emit("breakout:audio:request");
    liveSocket.emit("pong:audio:request");
  });

  syncUi();
  liveSocket.emit("breakout:audio:request");
  liveSocket.emit("pong:audio:request");
})(window);
