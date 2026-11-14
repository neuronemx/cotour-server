(function (root) {
  function create({ context, document, onLost, mediaDevices = navigator.mediaDevices }) {
    const destination = context.createMediaStreamDestination();
    const media = new Map();
    let input, source, include = true, version = 0;
    function sync() {
      const active = new Set([...document.querySelectorAll("audio,video")].filter(element =>
        !element.closest(".guest-program") && !element.paused && !element.ended && !element.muted));
      for (const [element, entry] of media) {
        if (!active.has(element) || !include) {
          entry.source.disconnect();
          entry.gain.disconnect();
          entry.stream.getTracks().forEach(track => track.stop());
          media.delete(element);
        }
      }
      if (!include) return;
      for (const element of active) {
        try {
          if (!media.has(element)) {
            const capture = element.captureStream || element.mozCaptureStream;
            if (!capture) continue;
            const stream = capture.call(element);
            if (!stream.getAudioTracks().some(track => track.readyState === "live")) { stream.getTracks().forEach(track => track.stop()); continue; }
            // Only local media enters the return. The guest's WebRTC voice is excluded above.
            const node = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
            const gain = context.createGain();
            node.connect(gain).connect(destination);
            media.set(element, { stream, source: node, gain });
          }
          media.get(element).gain.gain.value = element.volume;
        } catch { /* Protected or unsupported media needs an external console return. */ }
      }
    }
    const timer = setInterval(sync, 200);
    return {
      stream: destination.stream,
      get ready() { return Boolean(input?.getAudioTracks().some(track => track.readyState === "live")); },
      setIncludeMedia(value) { include = Boolean(value); sync(); },
      async setInput(deviceId) {
        const requested = ++version;
        const next = await mediaDevices.getUserMedia({ video: false, audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true, noiseSuppression: false, autoGainControl: false
        } });
        if (requested !== version) { next.getTracks().forEach(track => track.stop()); return; }
        let node;
        try { node = context.createMediaStreamSource(next); node.connect(destination); }
        catch (error) { next.getTracks().forEach(track => track.stop()); throw error; }
        source?.disconnect();
        input?.getTracks().forEach(track => track.stop());
        input = next; source = node;
        next.getAudioTracks()[0].onended = () => { if (input === next) onLost(); };
      },
      stop() {
        version++;
        clearInterval(timer);
        source?.disconnect(); input?.getTracks().forEach(track => track.stop());
        for (const entry of media.values()) { entry.source.disconnect(); entry.gain.disconnect(); entry.stream.getTracks().forEach(track => track.stop()); }
        media.clear();
        destination.stream.getTracks().forEach(track => track.stop());
      }
    };
  }
  root.ImmersaGuestEventAudio = { create };
  if (typeof module === "object") module.exports = { create };
})(typeof window === "object" ? window : globalThis);
