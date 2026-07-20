const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

test("Pong audio loads only on Screen and Stage", () => {
  const screen = read("../public/screen/index.html");
  const stage = read("../public/stage/index.html");
  const audience = read("../public/audience/index.html");
  assert.match(screen, /pong-audio\.js\?v=1/);
  assert.match(stage, /pong-audio\.js\?v=1/);
  assert.doesNotMatch(audience, /pong-audio\.js/);
});

test("Pong audio exposes every frozen cue and replaceable custom packs", () => {
  const audio = read("../public/shared/pong-audio.js");
  for (const cue of ["lobby", "start", "paddle", "wall", "goal", "final", "transition"]) {
    assert.match(audio, new RegExp(`${cue}: \\[`));
  }
  assert.match(audio, /IMMERSA_PONG_AUDIO_PACKS/);
  assert.match(audio, /pack\?\.cues\?\.\[name\]/);
  assert.match(audio, /cue\?\.url/);
  assert.match(audio, /Activar audio de Pong/);
  assert.match(audio, /role !== "screen"/);
});

test("Stage owns synchronized mute, volume, and pack controls", () => {
  const sockets = read("../pong-sockets.js");
  const audio = read("../public/shared/pong-audio.js");
  assert.match(sockets, /pong:audio:set/);
  assert.match(sockets, /context\.role !== "stage"/);
  assert.match(sockets, /pong:audio:state/);
  assert.match(audio, /data-pong-audio-mute/);
  assert.match(audio, /data-pong-audio-volume/);
  assert.match(audio, /data-pong-audio-pack/);
});

test("goal celebration combines dynamic team copy, confetti, and optional transparent video", () => {
  const ui = read("../public/shared/pong-ui.js");
  const css = read("../public/shared/pong-ui.css");
  assert.match(ui, /pong:goal/);
  assert.match(ui, /goal\.id === lastGoalId/);
  assert.match(ui, /IMMERSA_PONG_GOAL_VIDEO_URL/);
  assert.match(ui, /data-pong-goal-team/);
  assert.match(ui, /data-pong-goal-video/);
  assert.match(css, /pong-goal-confetti/);
  assert.match(css, /pong-goal-pop/);
});
