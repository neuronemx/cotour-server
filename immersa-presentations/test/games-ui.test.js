const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const GamesUi = require("../public/shared/games-ui");

test("games selector renders only available games with real checkboxes", () => {
  const html = GamesUi.queueMarkup({
    status: "idle",
    selected: ["breakout"],
    catalog: [
      { id: "breakout", title: "Breakout", mode: "Colaborativo", difficulty: 1, available: true },
      { id: "pong", title: "Pong", mode: "Competitivo", difficulty: 2, available: false }
    ]
  });

  assert.match(html, /type="checkbox"/);
  assert.match(html, /Breakout/);
  assert.match(html, /Colaborativo · Nivel 1/);
  assert.match(html, /Iniciar juegos/);
  assert.doesNotMatch(html, /Pong/);
});

test("games selector preserves server difficulty order and disables empty start", () => {
  const html = GamesUi.queueMarkup({
    status: "idle",
    selected: [],
    catalog: [
      { id: "breakout", title: "Breakout", mode: "Colaborativo", difficulty: 1, available: true },
      { id: "pong", title: "Pong", mode: "Competitivo", difficulty: 2, available: true }
    ]
  });

  assert.ok(html.indexOf("Breakout") < html.indexOf("Pong"));
  assert.match(html, /data-games-queue-start disabled/);
});

test("shared presentation runtime loads queue UI for every presentation role", () => {
  const runtime = fs.readFileSync(path.join(__dirname, "../public/shared/presentation-runtime.js"), "utf8");
  const gamesUi = fs.readFileSync(path.join(__dirname, "../public/shared/games-ui.js"), "utf8");
  assert.match(runtime, /\/shared\/games-ui\.css/);
  assert.match(runtime, /\/shared\/games-ui\.js/);
  assert.match(gamesUi, /typeof socket !== "undefined" \? socket : root\.socket/);
  assert.doesNotMatch(gamesUi, /games\.disabled = false|games\.removeAttribute\("aria-disabled"\)/);
});
