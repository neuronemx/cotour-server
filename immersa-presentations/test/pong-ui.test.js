const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const PongUi = require("../public/shared/pong-ui");

const runningState = {
  id: "pong-1",
  status: "running",
  remaining_ms: 42000,
  speed_multiplier: 1.18,
  roster_locked: true,
  roster_counts: { left: 8, right: 7 },
  teams: {
    left: { id: "left", name: "Ballenas", color: "#2f80ed", score: 3 },
    right: { id: "right", name: "Tigres", color: "#f2994a", score: 2 }
  },
  paddles: {
    left: { x: 0.055, y: 0.42, width: 0.025, height: 0.22 },
    right: { x: 0.945, y: 0.61, width: 0.025, height: 0.22 }
  },
  ball: { x: 0.57, y: 0.36, radius: 0.014 },
  winner_team: ""
};

test("Pong role detection covers controllers, Screen, Viewer, and Público", () => {
  assert.equal(PongUi.roleFromPath("/speaker/a_1"), "presenter");
  assert.equal(PongUi.roleFromPath("/stage/a_1"), "stage");
  assert.equal(PongUi.roleFromPath("/screen/a_1"), "screen");
  assert.equal(PongUi.roleFromPath("/viewer/a_1"), "viewer");
  assert.equal(PongUi.roleFromPath("/p_abcd"), "audience");
});

test("lobby controller edits both team names and exposes authoritative actions", () => {
  const html = PongUi.controllerMarkup({
    ...runningState,
    status: "ready",
    remaining_ms: 60000,
    roster_locked: false
  });
  assert.equal((html.match(/data-pong-team-name=/g) || []).length, 2);
  assert.match(html, /maxlength="24"/);
  assert.match(html, /Izquierdo · Azul/);
  assert.match(html, /Derecho · Naranja/);
  assert.match(html, /8 personas/);
  assert.match(html, /pong:start/);
});

test("team names are escaped before controller and Screen markup", () => {
  const unsafe = {
    ...runningState,
    status: "ready",
    teams: {
      ...runningState.teams,
      left: { ...runningState.teams.left, name: '<img src=x onerror="alert(1)">' }
    }
  };
  const controller = PongUi.controllerMarkup(unsafe);
  const screen = PongUi.boardMarkup(unsafe, "screen");
  assert.doesNotMatch(controller, /<img/);
  assert.doesNotMatch(screen, /<img/);
  assert.match(controller, /&lt;img/);
  assert.match(screen, /&lt;img/);
});

test("queued Pong uses queue controls and preserves final result until sequence end", () => {
  const queue = {
    status: "finished",
    current_game_type: "pong",
    next_game_type: "",
    transition_at_ms: null
  };
  const html = PongUi.controllerMarkup({ ...runningState, status: "finished", winner_team: "left" }, queue);
  assert.match(html, /Ballenas gana/);
  assert.match(html, /games:queue:end/);
  assert.doesNotMatch(html, /Preparar otra vez/);
});

test("Screen renders two colored teams, authoritative field objects, score, and time", () => {
  const html = PongUi.boardMarkup(runningState, "screen");
  assert.match(html, /pong-screen running/);
  assert.match(html, /Ballenas/);
  assert.match(html, /Tigres/);
  assert.match(html, /data-pong-screen-score="left">3/);
  assert.match(html, /data-pong-screen-score="right">2/);
  assert.match(html, /data-pong-screen-time>42/);
  assert.equal((html.match(/data-pong-paddle=/g) || []).length, 2);
  assert.match(html, /data-pong-ball/);
  assert.match(html, /--x:0\.57/);
});

test("Screen lobby shows team selection counts without starting ball movement", () => {
  const html = PongUi.boardMarkup({ ...runningState, status: "ready", remaining_ms: 60000 }, "screen");
  assert.match(html, /ELIGE TU EQUIPO/);
  assert.match(html, /Desde tu teléfono/);
  assert.match(html, /data-pong-screen-roster="left">8/);
  assert.match(html, /data-pong-screen-roster="right">7/);
  assert.doesNotMatch(html, /data-pong-ball/);
});

test("finished Screen names the winner and keeps the final score", () => {
  const html = PongUi.boardMarkup({ ...runningState, status: "finished", winner_team: "right" }, "screen");
  assert.match(html, /Tigres GANA/);
  assert.match(html, /3 — 2/);
});

test("shared runtime loads Pong UI while this PR leaves Público controls and queue activation out", () => {
  const runtime = fs.readFileSync(path.join(__dirname, "../public/shared/presentation-runtime.js"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "../public/shared/pong-ui.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../public/shared/pong-ui.css"), "utf8");
  const sockets = fs.readFileSync(path.join(__dirname, "../pong-sockets.js"), "utf8");
  assert.match(runtime, /\/shared\/pong-ui\.css/);
  assert.match(runtime, /\/shared\/pong-ui\.js/);
  assert.match(ui, /pong:request_state/);
  assert.match(ui, /button\.dataset\.pongEvent === "pong:start"[\s\S]+emitNames\(\)[\s\S]+socket\.emit\(button\.dataset\.pongEvent\)/);
  assert.doesNotMatch(ui, /data-pong-direction/);
  assert.match(sockets, /queueAvailable = false/);
  assert.match(css, /#2f80ed/);
  assert.match(css, /#f2994a/);
  assert.match(css, /prefers-reduced-motion/);
});
