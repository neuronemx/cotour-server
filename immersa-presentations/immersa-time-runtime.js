"use strict";

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function durationFromParts(hours, minutes, seconds) {
  const h = Math.max(0, Math.min(99, Math.trunc(finite(hours))));
  const m = Math.max(0, Math.min(59, Math.trunc(finite(minutes))));
  const s = Math.max(0, Math.min(59, Math.trunc(finite(seconds))));
  return ((h * 3600) + (m * 60) + s) * 1000;
}

function stopwatchSnapshot(channel, now) {
  const elapsedMs = Math.max(0, finite(channel.elapsedMs));
  return {
    running: Boolean(channel.running),
    elapsedMs: channel.running
      ? elapsedMs + Math.max(0, now - finite(channel.startedAtServerMs, now))
      : elapsedMs
  };
}

function countdownSnapshot(channel, now) {
  const remainingMs = Math.max(0, finite(channel.remainingMs));
  const current = channel.running
    ? Math.max(0, remainingMs - Math.max(0, now - finite(channel.startedAtServerMs, now)))
    : remainingMs;
  return {
    running: Boolean(channel.running && current > 0),
    remainingMs: current,
    durationMs: Math.max(0, finite(channel.durationMs))
  };
}

function emptyScreen() {
  return {
    mode: null,
    visible: false,
    running: false,
    elapsedMs: 0,
    remainingMs: 0,
    durationMs: 0,
    startedAtServerMs: null
  };
}

function createImmersaTimeState() {
  return {
    revision: 0,
    speaker: {
      running: false,
      elapsedMs: 0,
      startedAtServerMs: null
    },
    screen: emptyScreen()
  };
}

function freezeStopwatch(channel, now) {
  const snapshot = stopwatchSnapshot(channel, now);
  channel.elapsedMs = snapshot.elapsedMs;
  channel.running = false;
  channel.startedAtServerMs = null;
}

function freezeCountdown(channel, now) {
  const snapshot = countdownSnapshot(channel, now);
  channel.remainingMs = snapshot.remainingMs;
  channel.running = false;
  channel.startedAtServerMs = null;
}

function snapshot(state, now = Date.now()) {
  const speaker = stopwatchSnapshot(state.speaker || {}, now);
  const source = state.screen || emptyScreen();
  const screen = {
    mode: source.mode || null,
    visible: Boolean(source.visible),
    running: false,
    elapsedMs: 0,
    remainingMs: 0,
    durationMs: Math.max(0, finite(source.durationMs))
  };

  if (screen.mode === "stopwatch") Object.assign(screen, stopwatchSnapshot(source, now));
  if (screen.mode === "countdown") Object.assign(screen, countdownSnapshot(source, now));
  if (screen.mode === "clock") screen.visible = Boolean(source.visible);

  return {
    revision: Math.max(0, Math.trunc(finite(state.revision))),
    serverNow: now,
    speaker,
    screen
  };
}

function applyCommand(state, payload = {}, now = Date.now()) {
  const target = String(payload.target || "");
  const action = String(payload.action || "");
  let changed = false;

  if (target === "speaker") {
    const timer = state.speaker;
    if (action === "start" && !timer.running) {
      timer.running = true;
      timer.startedAtServerMs = now;
      changed = true;
    } else if (action === "stop" && timer.running) {
      freezeStopwatch(timer, now);
      changed = true;
    } else if (action === "reset" && (timer.running || timer.elapsedMs > 0)) {
      timer.running = false;
      timer.elapsedMs = 0;
      timer.startedAtServerMs = null;
      changed = true;
    }
  }

  if (target === "screen") {
    const timer = state.screen;
    if (action === "start") {
      const mode = String(payload.mode || "");
      if (mode === "stopwatch") {
        state.screen = {
          mode,
          visible: true,
          running: true,
          elapsedMs: 0,
          remainingMs: 0,
          durationMs: 0,
          startedAtServerMs: now
        };
        changed = true;
      } else if (mode === "countdown") {
        const durationMs = durationFromParts(payload.hours, payload.minutes, payload.seconds);
        if (durationMs > 0) {
          state.screen = {
            mode,
            visible: true,
            running: true,
            elapsedMs: 0,
            remainingMs: durationMs,
            durationMs,
            startedAtServerMs: now
          };
          changed = true;
        }
      } else if (mode === "clock") {
        state.screen = {
          ...emptyScreen(),
          mode: "clock",
          visible: true
        };
        changed = true;
      }
    } else if (action === "stop" && timer.visible && timer.running) {
      if (timer.mode === "countdown") freezeCountdown(timer, now);
      else if (timer.mode === "stopwatch") freezeStopwatch(timer, now);
      changed = true;
    } else if (action === "resume" && timer.visible && !timer.running) {
      if (timer.mode === "stopwatch" || (timer.mode === "countdown" && countdownSnapshot(timer, now).remainingMs > 0)) {
        timer.running = true;
        timer.startedAtServerMs = now;
        changed = true;
      }
    } else if (action === "reset" && timer.visible) {
      if (timer.mode === "stopwatch" && (timer.running || timer.elapsedMs > 0)) {
        timer.running = false;
        timer.elapsedMs = 0;
        timer.startedAtServerMs = null;
        changed = true;
      }
      if (timer.mode === "countdown" && (timer.running || timer.remainingMs !== timer.durationMs)) {
        timer.running = false;
        timer.remainingMs = Math.max(0, finite(timer.durationMs));
        timer.startedAtServerMs = null;
        changed = true;
      }
    } else if (action === "hide" && timer.visible) {
      state.screen = emptyScreen();
      changed = true;
    }
  }

  if (changed) state.revision = Math.max(0, Math.trunc(finite(state.revision))) + 1;
  return { changed, state };
}

module.exports = {
  createImmersaTimeState,
  applyCommand,
  snapshot
};
