const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { renderRaffleController, createInitialRaffleControllerState, reduceRaffleControllerState } = require("../public/shared/raffle-controller");
const { renderAudienceRaffle, renderScreenRaffle } = require("../public/shared/raffle-public-ui");
const { CONTROLLER_MODE_TITLES, adjustRaffleHtml, stripCountdownSuffix } = require("../public/shared/raffle-ux-adjustments");

function readProjectFile(filePath) {
  return fs.readFileSync(path.join(__dirname, "..", filePath), "utf8");
}

function scriptSources(html) {
  return [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
}

test("countdown suffix is removed from Sorteos views without changing remaining value", () => {
  assert.equal(stripCountdownSuffix("5s"), "5");
  assert.equal(stripCountdownSuffix("4"), "4");

  const revealAt = new Date(Date.now() + 5_000).toISOString();
  const controllerHtml = adjustRaffleHtml(renderRaffleController({
    ...createInitialRaffleControllerState(),
    active: { id: "r1", mode: "free", state: "drawing", revealAt }
  }));
  const audienceHtml = adjustRaffleHtml(renderAudienceRaffle({ active: { id: "r2", mode: "free", state: "drawing", revealAt } }));
  const screenHtml = adjustRaffleHtml(renderScreenRaffle({ active: { id: "r3", mode: "free", state: "drawing", revealAt } }));

  assert.doesNotMatch(controllerHtml, /<strong>\d+s<\/strong>/);
  assert.doesNotMatch(audienceHtml, /<strong>\d+s<\/strong>/);
  assert.doesNotMatch(screenHtml, /<strong>\d+s<\/strong>/);
  assert.match(controllerHtml + audienceHtml + screenHtml, /<strong>\d<\/strong>/);
});

test("free collecting controls render Sorteo Libre with connected count and no tickets", () => {
  let state = reduceRaffleControllerState(createInitialRaffleControllerState(), "state", { audienceCount: 2 });
  state = reduceRaffleControllerState(state, "raffle:state", {
    active: { id: "r-free", mode: "free", state: "collecting", entryCount: 0, eligibleCount: 0 }
  });

  const html = adjustRaffleHtml(renderRaffleController(state));
  assert.match(html, /<h2>Sorteo Libre<\/h2><p>Participación abierta<\/p>/);
  assert.match(html, /CONECTADOS<\/span><strong>2<\/strong>/);
  assert.doesNotMatch(html, /BOLETOS/);
  assert.match(html, /Cerrar tómbola/);
  assert.match(html, /Cancelar sorteo/);
});

test("non-free collecting keeps ticket metric", () => {
  let state = reduceRaffleControllerState(createInitialRaffleControllerState(), "state", { audienceCount: 2 });
  state = reduceRaffleControllerState(state, "raffle:state", {
    active: { id: "r-poll", mode: "poll", state: "collecting", entryCount: 1, eligibleCount: 1 }
  });

  const html = adjustRaffleHtml(renderRaffleController(state));
  assert.match(html, /<h2>Sorteo Encuesta<\/h2><p>Participación abierta<\/p>/);
  assert.match(html, /BOLETOS<\/span><strong>1<\/strong>/);
});

test("Speaker and Stage active states render full raffle mode titles", () => {
  const modes = [
    ["free", CONTROLLER_MODE_TITLES.free, "Libre"],
    ["visual_key", CONTROLLER_MODE_TITLES.visual_key, "Clave visual"],
    ["poll", CONTROLLER_MODE_TITLES.poll, "Encuesta"]
  ];
  const states = ["collecting", "entries_closed", "drawing", "winner"];
  const revealAt = new Date(Date.now() + 5_000).toISOString();

  modes.forEach(([mode, expectedTitle, rawTitle]) => {
    states.forEach((raffleState) => {
      const html = adjustRaffleHtml(renderRaffleController({
        ...createInitialRaffleControllerState(),
        active: {
          id: `r-${mode}-${raffleState}`,
          mode,
          state: raffleState,
          entryCount: 2,
          eligibleCount: 1,
          revealAt,
          winner: { label: "Ganador seleccionado" }
        }
      }));

      assert.match(html, new RegExp(`<h2>${expectedTitle}<\\/h2>`));
      assert.doesNotMatch(html, new RegExp(`<h2>${rawTitle}<\\/h2>`));
    });
  });
});

test("raffle UX adjustments load in Speaker, Stage, Audience, and Screen", () => {
  const speaker = readProjectFile("public/presenter/index.html");
  const stage = readProjectFile("public/stage/index.html");
  const audience = scriptSources(readProjectFile("public/audience/index.html"));
  const screen = scriptSources(readProjectFile("public/screen/index.html"));
  const slideConfirm = readProjectFile("public/shared/slide-confirm.js");

  assert.match(slideConfirm, /\/shared\/raffle-ux-adjustments\.js/);
  assert.equal(audience.includes("/shared/raffle-ux-adjustments.js"), true);
  assert.equal(screen.includes("/shared/raffle-ux-adjustments.js"), true);
  assert.match(speaker, /\/shared\/slide-confirm\.js/);
  assert.match(stage, /\/shared\/slide-confirm\.js/);
});
