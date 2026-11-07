(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImmersaAudiovisualFx = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeCue(value) {
    const match = /^(\d{1,5}):(\d{2,3})$/.exec(String(value?.timecode || "").trim());
    const fps = Number(value?.fps);
    if (!match || !Number.isFinite(fps) || fps < 1 || fps > 240) return null;
    const seconds = Number(match[1]);
    const frames = Number(match[2]);
    if (seconds >= 86400 || frames >= Math.ceil(fps)) return null;
    return { timecode: match[1].padStart(2, "0") + ":" + match[2], fps, seconds: seconds + frames / fps };
  }

  function parseCue(text) {
    const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const rate = /^FPS\s*=\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?$/i.exec(lines[1] || "");
    const cue = lines.length === 2 && rate ? normalizeCue({ timecode: lines[0], fps: Number(rate[1]) / (rate[2] ? Number(rate[2]) : 1) }) : null;
    if (!cue) throw new Error("TXT inválido: usa segundos:cuadros y FPS=30 (o los FPS del FX)");
    return cue;
  }

  function isFx(resource) {
    return resource?.category === "fx" && resource.type === "video" && resource.source === "local" && Boolean(normalizeCue(resource.fx));
  }

  // Frame callbacks use the video's own clock, including stalls and playback pauses.
  function createCueMonitor({ media, getPlayback, onCue }) {
    let frame = null;
    let sentId = "";
    let watchingId = "";
    function eligible() {
      const state = getPlayback();
      return isFx(state?.resource) && state.status === "playing" && state.fxPlayback?.id
        && !state.fxPlayback.consumed && state.fxPlayback.id === media.dataset.fxPlaybackId
        && String(state.resource.id) === media.dataset.resourceId ? state : null;
    }
    function stop() {
      if (frame !== null) media.cancelVideoFrameCallback?.(frame);
      frame = null;
    }
    function check(time) {
      const state = eligible();
      if (!state || media.seeking || (media.paused && !media.ended) || sentId === state.fxPlayback.id) return;
      if (!Number.isFinite(time) || time < state.resource.fx.seconds) return;
      if (onCue({ resourceId: state.resource.id, playbackId: state.fxPlayback.id, mediaTime: time }) !== false) sentId = state.fxPlayback.id;
    }
    function schedule() {
      const state = eligible();
      if (frame !== null || !state || sentId === state.fxPlayback.id || typeof media.requestVideoFrameCallback !== "function") return;
      const playbackId = state.fxPlayback.id;
      frame = media.requestVideoFrameCallback((_now, metadata) => {
        frame = null;
        if (eligible()?.fxPlayback.id === playbackId) check(metadata.mediaTime);
        schedule();
      });
    }
    function refresh() {
      const state = eligible();
      if (!state) { stop(); watchingId = ""; return; }
      if (watchingId !== state.fxPlayback.id) { stop(); watchingId = state.fxPlayback.id; }
      schedule();
    }
    const sample = () => {
      // Prefer the decoded frame clock; use currentTime on older browsers or at EOF.
      if (typeof media.requestVideoFrameCallback !== "function" || media.ended) check(media.currentTime);
      refresh();
    };
    ["playing", "timeupdate", "seeked", "ended"].forEach((event) => media.addEventListener(event, sample));
    return { refresh, stop, observe: check };
  }
  return { normalizeCue, parseCue, isFx, createCueMonitor };
});
