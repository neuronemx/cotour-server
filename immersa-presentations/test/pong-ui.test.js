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
  assert.doesNotMatch(html, /pong:start" disabled/);
});

test("lobby cannot start until Público has joined both teams", () => {
  const html = PongUi.controllerMarkup({
    ...runningState,
    status: "ready",
    roster_locked: false,
    roster_counts: { left: 1, right: 0 }
  });
  assert.match(html, /pong:start" disabled aria-disabled="true"/);
  assert.match(html, /Se necesita al menos 1 persona en cada equipo/);
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
  assert.match(html, /data-pong-goal-celebration/);
  assert.match(html, /data-pong-goal-video/);
  assert.equal((html.match(/<i style="--i:/g) || []).length, 24);
});

test("Screen lobby shows team selection counts without starting ball movement", () => {
  const html = PongUi.boardMarkup({ ...runningState, status: "ready", remaining_ms: 60000 }, "screen");
  assert.match(html, /ELIGE TU EQUIPO/);
  assert.match(html, /Desde tu teléfono/);
  assert.match(html, /data-pong-screen-roster="left">8/);
  assert.match(html, /data-pong-screen-roster="right">7/);
  assert.match(html, /pong-scoreboard is-lobby/);
  assert.doesNotMatch(html, />PONG</);
  assert.doesNotMatch(html, />LOBBY</);
  assert.doesNotMatch(html, /data-pong-ball/);
});

test("finished Screen names the winner and keeps the final score", () => {
  const html = PongUi.boardMarkup({ ...runningState, status: "finished", winner_team: "right" }, "screen");
  assert.match(html, /Tigres GANA/);
  assert.match(html, /3 — 2/);
});

test("Público chooses between real blue and orange team buttons in the lobby", () => {
  const html = PongUi.audienceMarkup(
    { ...runningState, status: "ready", remaining_ms: 60000, roster_locked: false },
    { team: "", spectator: false, roster_locked: false }
  );
  assert.equal((html.match(/data-pong-team-choice=/g) || []).length, 2);
  assert.match(html, /data-pong-team-choice="left"/);
  assert.match(html, /data-pong-team-choice="right"/);
  assert.match(html, /Ballenas/);
  assert.match(html, /Tigres/);
  assert.match(html, /8 personas/);
  assert.match(html, /7 personas/);
  assert.match(html, /pong-audience-header is-lobby/);
  assert.doesNotMatch(html, />LOBBY</);
  assert.doesNotMatch(html, /data-pong-audience-time/);
});

test("Público gets two same-team directional controls and may switch during lobby", () => {
  const left = PongUi.audienceMarkup(
    { ...runningState, status: "ready", remaining_ms: 60000, roster_locked: false },
    { team: "left", spectator: false, roster_locked: false }
  );
  const right = PongUi.audienceMarkup(runningState, { team: "right", spectator: false, roster_locked: true });
  assert.equal((left.match(/data-pong-direction=/g) || []).length, 2);
  assert.match(left, /pong-direction-pad is-left/);
  assert.match(left, /data-pong-audience-goal/);
  assert.match(left, /data-pong-change-team/);
  assert.match(left, /data-pong-fullscreen/);
  assert.equal((right.match(/data-pong-direction=/g) || []).length, 2);
  assert.match(right, /pong-direction-pad is-right/);
  assert.doesNotMatch(right, /data-pong-change-team/);
});

test("Público flashes only when its own team scores", () => {
  assert.equal(PongUi.isAudienceGoal({ team: "left" }, { scoring_team: "left" }), true);
  assert.equal(PongUi.isAudienceGoal({ team: "left" }, { scoring_team: "right" }), false);
  assert.equal(PongUi.isAudienceGoal({ team: "" }, { scoring_team: "left" }), false);
  const html = PongUi.audienceMarkup(runningState, { team: "left", spectator: false, roster_locked: true });
  assert.match(html, /pong-audience-goal-flash/);
  assert.match(html, /¡GOOOL!/);
  assert.match(html, /data-pong-audience-goal-team/);
});

test("late Público is a spectator after the roster locks", () => {
  const html = PongUi.audienceMarkup(runningState, { team: "", spectator: true, roster_locked: true });
  assert.match(html, /MIRA LA PARTIDA/);
  assert.match(html, /roster ya estaba cerrado/);
  assert.doesNotMatch(html, /data-pong-direction/);
  assert.doesNotMatch(html, /data-pong-team-choice/);
});

test("shared runtime loads the complete Pong UI and production enables its queue runtime", () => {
  const runtime = fs.readFileSync(path.join(__dirname, "../public/shared/presentation-runtime.js"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "../public/shared/pong-ui.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../public/shared/pong-ui.css"), "utf8");
  const interactionStore = fs.readFileSync(path.join(__dirname, "../interaction-store.js"), "utf8");
  assert.match(runtime, /\/shared\/pong-ui\.css/);
  assert.match(runtime, /\/shared\/pong-ui\.js/);
  assert.match(ui, /pong:request_state/);
  assert.match(ui, /button\.dataset\.pongEvent === "pong:start"[\s\S]+emitNames\(\)[\s\S]+socket\.emit\(button\.dataset\.pongEvent\)/);
  assert.match(ui, /data-pong-direction/);
  assert.match(ui, /pong:membership/);
  assert.match(ui, /IMMERSA_PONG_GOAL_VIDEO_URL/);
  assert.match(ui, /queueState\.revision[\s\S]*teamsReady\(state\)/);
  assert.match(interactionStore, /createPongSocketHandlers\(\{[\s\S]+queueAvailable: true/);
  assert.match(runtime, /pong-ui\.css\?v=6/);
  assert.match(runtime, /pong-ui\.js\?v=5/);
  assert.match(css, /#2f80ed/);
  assert.match(css, /#f2994a/);
  assert.match(css, /pong-goal-celebration/);
  assert.match(css, /\.pong-lobby-message\s*\{[\s\S]*?backdrop-filter:\s*none/);
  assert.match(css, /\.pong-board\s*\{[\s\S]*?width:\s*min\(94vw, 145vh\)/);
  assert.match(css, /\.pong-lobby-content\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(css, /\.pong-direction-pad\s*\{[\s\S]*?display:\s*flex[\s\S]*?flex-direction:\s*column/);
  assert.match(css, /pong-audience-goal-flash/);
  assert.match(ui, /isAudienceGoal\(membership, goal\)/);
  assert.match(css, /prefers-reduced-motion/);
});
