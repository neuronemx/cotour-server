(function (root) {
  const path = root.location?.pathname || "";
  const role = /^\/stage(?:\/|$)/.test(path)
    ? "stage"
    : /^\/(?:screen|viewer)(?:\/|$)/.test(path) ? "screen" : "";
  if (!role) return;
  const liveSocket = typeof socket !== "undefined" ? socket : root.socket;
  if (!liveSocket) return;

  const BUILTIN_PACKS = {
    arcade: { label: "Arcade" },
    soft: { label: "Suave" }
  };
  const externalPacks = root.IMMERSA_PONG_AUDIO_PACKS && typeof root.IMMERSA_PONG_AUDIO_PACKS === "object"
    ? root.IMMERSA_PONG_AUDIO_PACKS
    : {};
  const packs = { ...BUILTIN_PACKS, ...externalPacks };
  const patterns = {
    arcade: {
      lobby: [[330, .08, 0, "square", .16], [495, .12, .09, "square", .18]],
      start: [[420, .08, 0, "sawtooth", .2], [620, .08, .09, "sawtooth", .22], [880, .16, .18, "square", .24]],
      paddle: [[310, .055, 0, "square", .13]],
      wall: [[690, .045, 0, "triangle", .1]],
      goal: [[440, .16, 0, "sawtooth", .22], [660, .2, .08, "square", .23], [880, .3, .16, "square", .25]],
      final: [[520, .14, 0, "sawtooth", .2], [350, .18, .12, "sawtooth", .2], [180, .36, .26, "sawtooth", .24]],
      transition: [[360, .1, 0, "triangle", .16], [540, .14, .1, "triangle", .18]]
    },
    soft: {
      lobby: [[392, .12, 0, "sine", .13], [523, .16, .1, "sine", .14]],
      start: [[392, .12, 0, "sine", .15], [523, .12, .11, "sine", .16], [659, .2, .22, "sine", .17]],
      paddle: [[260, .07, 0, "sine", .1]],
      wall: [[520, .06, 0, "sine", .08]],
      goal: [[523, .2, 0, "sine", .17], [659, .24, .1, "sine", .18], [784, .32, .2, "sine", .19]],
      final: [[440, .18, 0, "sine", .16], [330, .22, .15, "sine", .15], [220, .34, .32, "sine", .16]],
      transition: [[330, .14, 0, "sine", .13], [494, .2, .12, "sine", .14]]
    }
  };

  let config = { muted: false, volume: .7, pack: "arcade" };
  let previousState = null;
  let previousQueue = null;
  let lastGoalId = "";
  let context = null;
  let unlocked = false;
  let controls = null;
  const AudioContext = root.AudioContext || root.webkitAudioContext;

  function packId() {
    return packs[config.pack] ? config.pack : "arcade";
  }

  function externalCue(name) {
    const pack = packs[packId()];
    return pack?.cues?.[name] || null;
  }

  function synthCue(name) {
    if (!AudioContext) return;
    context = context || new AudioContext();
    const selected = patterns[packId()] || patterns.arcade;
    const custom = externalCue(name);
    const notes = Array.isArray(custom?.pattern) ? custom.pattern : selected[name] || patterns.arcade[name] || [];
    for (const note of notes) {
      const [frequency, duration = .08, delay = 0, type = "square", gain = .16] = note;
      const oscillator = context.createOscillator();
      const volume = context.createGain();
      const startsAt = context.currentTime + Math.max(0, Number(delay) || 0);
      const endsAt = startsAt + Math.max(.02, Number(duration) || .08);
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(Math.max(40, Number(frequency) || 440), startsAt);
      volume.gain.setValueAtTime(Math.max(.001, gain * config.volume), startsAt);
      volume.gain.exponentialRampToValueAtTime(.001, endsAt);
      oscillator.connect(volume).connect(context.destination);
      oscillator.start(startsAt);
      oscillator.stop(endsAt);
    }
  }

  function playCue(name) {
    if (role !== "screen" || config.muted || !unlocked) return;
    const cue = externalCue(name);
    const url = typeof cue === "string" ? cue : cue?.url;
    if (url && typeof root.Audio === "function") {
      const audio = new root.Audio(String(url));
      audio.volume = Math.max(0, Math.min(1, config.volume * Number(cue?.gain || 1)));
      const result = audio.play();
      result?.catch?.(() => synthCue(name));
      return;
    }
    synthCue(name);
  }

  function unlock() {
    if (AudioContext) {
      context = context || new AudioContext();
      context.resume?.();
    }
    unlocked = true;
    root.document.querySelector("[data-pong-audio-unlock]")?.remove();
    if (previousState?.status === "ready") playCue("lobby");
  }

  function bindSharedUnlock(button) {
    if (!button || button.dataset.pongAudioBound === "1") return;
    button.dataset.pongAudioBound = "1";
    button.addEventListener("click", unlock, { once: true });
  }

  function ensureUnlock(state) {
    if (role !== "screen" || unlocked || !["ready", "running", "paused", "finished"].includes(state?.status)) return;
    const ownButton = root.document.querySelector("[data-pong-audio-unlock]");
    const sharedButton = root.document.querySelector("[data-immersa-media-unlock]:not([hidden]), [data-breakout-audio-unlock]:not([hidden])");
    if (sharedButton) {
      ownButton?.remove();
      bindSharedUnlock(sharedButton);
      return;
    }
    if (ownButton) return;
    const button = root.document.createElement("button");
    button.type = "button";
    button.className = "pong-audio-unlock";
    button.dataset.pongAudioUnlock = "1";
    button.textContent = "🔊 Activar audio de Pong";
    bindSharedUnlock(button);
    root.document.body.appendChild(button);
  }

  function handleState(next) {
    ensureUnlock(next);
    if (controls) controls.hidden = !["ready", "running", "paused", "finished"].includes(next?.status);
    if (!previousState || previousState.id !== next?.id) {
      if (next?.status === "ready") playCue("lobby");
      previousState = next;
      return;
    }
    const goalChanged = Boolean(next?.last_goal?.id && next.last_goal.id !== previousState?.last_goal?.id);
    if (previousState.status !== "ready" && next?.status === "ready") playCue("lobby");
    if (previousState.status !== "running" && next?.status === "running") playCue("start");
    if (!goalChanged && previousState.status === "running" && next?.status === "running") {
      if (Number(previousState.ball?.vx || 0) * Number(next.ball?.vx || 0) < 0) playCue("paddle");
      else if (Number(previousState.ball?.vy || 0) * Number(next.ball?.vy || 0) < 0) playCue("wall");
    }
    if (previousState.status === "running" && next?.status === "finished") playCue("final");
    previousState = next;
  }

  function handleGoal(goal) {
    if (!goal?.id || goal.id === lastGoalId) return;
    lastGoalId = goal.id;
    playCue("goal");
  }

  function handleQueue(next) {
    if (previousQueue?.current_game_type === "pong" && next?.current_game_type && next.current_game_type !== "pong") {
      playCue("transition");
    }
    previousQueue = next;
  }

  function sendConfig() {
    liveSocket.emit("pong:audio:set", config);
  }

  function syncControls() {
    if (!controls) return;
    const mute = controls.querySelector("[data-pong-audio-mute]");
    const volume = controls.querySelector("[data-pong-audio-volume]");
    const pack = controls.querySelector("[data-pong-audio-pack]");
    if (mute) {
      mute.innerHTML = config.muted
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 11v8a.8.8 0 0 1-1.5.5L6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l1.3-1.7"/><path d="M3 3l18 18"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 8a5 5 0 0 1 0 8"/><path d="M17.7 5a9 9 0 0 1 0 14"/><path d="M6 15h-2a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5a.8.8 0 0 1 1.5.5v14a.8.8 0 0 1-1.5.5L6 15"/></svg>';
      mute.setAttribute("aria-label", config.muted ? "Activar audio de Pong" : "Silenciar audio de Pong");
    }
    if (volume) volume.value = String(Math.round(config.volume * 100));
    if (pack) {
      if (![...pack.options].some((option) => option.value === config.pack)) config.pack = "arcade";
      pack.value = config.pack;
    }
  }

  function mountStageControls() {
    if (role !== "stage" || controls) return;
    const host = root.document.getElementById("stageAudioControls");
    if (!host) return;
    controls = root.document.createElement("span");
    controls.className = "pong-audio-controls stage-audio-controls";
    controls.dataset.pongAudioControls = "1";
    controls.hidden = true;

    const mute = root.document.createElement("button");
    mute.type = "button";
    mute.dataset.pongAudioMute = "1";
    mute.setAttribute("aria-label", "Silenciar audio de Pong");

    const volume = root.document.createElement("input");
    volume.type = "range";
    volume.min = "0";
    volume.max = "100";
    volume.dataset.pongAudioVolume = "1";
    volume.setAttribute("aria-label", "Volumen de Pong");

    const select = root.document.createElement("select");
    select.dataset.pongAudioPack = "1";
    select.setAttribute("aria-label", "Paquete de audio de Pong");
    for (const [id, pack] of Object.entries(packs)) {
      if (!/^[a-z0-9_-]{1,32}$/.test(id)) continue;
      const option = root.document.createElement("option");
      option.value = id;
      option.textContent = String(pack?.label || id);
      select.appendChild(option);
    }

    mute.addEventListener("click", () => {
      config.muted = !config.muted;
      sendConfig();
      syncControls();
    });
    volume.addEventListener("input", () => {
      config.volume = Number(volume.value) / 100;
      config.muted = false;
      sendConfig();
      syncControls();
    });
    select.addEventListener("change", () => {
      config.pack = select.value;
      config.muted = false;
      sendConfig();
      syncControls();
    });

    controls.append(mute, volume, select);
    host.appendChild(controls);
    syncControls();
  }

  liveSocket.on("pong:audio:state", (next) => {
    config = { ...config, ...(next || {}) };
    syncControls();
  });
  liveSocket.on("pong:state", handleState);
  liveSocket.on("pong:goal", handleGoal);
  liveSocket.on("games:queue:state", handleQueue);
  liveSocket.on("connect", () => liveSocket.emit("pong:audio:request"));
  mountStageControls();
  liveSocket.emit("pong:audio:request");
})(window);
