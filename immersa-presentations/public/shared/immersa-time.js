(function () {
  "use strict";

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalize(snapshot) {
    const source = snapshot || {};
    return {
      revision: Math.max(0, Math.trunc(finite(source.revision, 0))),
      serverNow: finite(source.serverNow, Date.now()),
      receivedAt: Date.now(),
      speaker: source.speaker || { running: false, elapsedMs: 0 },
      screen: source.screen || { mode: null, visible: false, running: false }
    };
  }

  function now(state) {
    return finite(state?.serverNow, Date.now()) + (Date.now() - finite(state?.receivedAt, Date.now()));
  }

  function elapsed(channel, state) {
    const base = Math.max(0, finite(channel?.elapsedMs, 0));
    return channel?.running ? base + Math.max(0, now(state) - finite(state?.serverNow, now(state))) : base;
  }

  function remaining(channel, state) {
    const base = Math.max(0, finite(channel?.remainingMs, 0));
    return channel?.running ? Math.max(0, base - Math.max(0, now(state) - finite(state?.serverNow, now(state)))) : base;
  }

  function duration(value) {
    const total = Math.max(0, Math.floor(finite(value, 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function clock(state) {
    const date = new Date(now(state));
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }).formatToParts(date);
    return parts.map((part) => part.value).join("");
  }

  window.ImmersaTime = { normalize, now, elapsed, remaining, duration, clock };
}());
