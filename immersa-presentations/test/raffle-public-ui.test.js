const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { RaffleStore } = require("../raffle-store");
const { renderAudienceRaffle, renderScreenRaffle, remainingSeconds } = require("../public/shared/raffle-public-ui");

const visualKeyConfig = {
  mode: "visual_key",
  title: "Sorteo",
  prompt: "Elige la clave visual correcta",
  entryKey: "b",
  options: [
    { id: "a", label: "A", thumbnail: "/future/a.png" },
    { id: "b", label: "B", thumbnail: "/future/b.png" },
    { id: "c", label: "C", thumbnail: "/future/c.png" },
    { id: "d", label: "D", thumbnail: "/future/d.png" }
  ]
};

function pollConfig() {
  return { mode: "poll", title: "Sorteo", prompt: "Elige una opción", options: [{ id: "yes", label: "Sí" }, { id: "no", label: "No" }] };
}

function freeConfig() {
  return { mode: "free", title: "Sorteo" };
}

function readProjectFile(filePath) {
  return fs.readFileSync(path.join(__dirname, "..", filePath), "utf8");
}

test("Audience free collecting shows visual participation without creating fake ownEntry", () => {
  const store = new RaffleStore();
  store.create({ sessionId: "s1", config: freeConfig() });
  const state = store.getAudienceState("s1", "a1");
  const html = renderAudienceRaffle(state);

  assert.equal(state.active.ownEntry, null);
  assert.match(html, /Ya estás participando/);
  assert.match(html, /Tu boleto está dentro de la tómbola/);
  assert.equal(store.enter({ sessionId: "s1", audienceId: "a1" }).reason, "free_mode_does_not_use_entries");
});

test("Audience free entries_closed distinguishes real ownEntry from closed tombola", () => {
  const store = new RaffleStore();
  store.create({ sessionId: "s1", config: freeConfig() });
  store.closeEntries("s1", [{ audienceId: "a1" }]);

  assert.match(renderAudienceRaffle(store.getAudienceState("s1", "a1")), /Boleto activo/);
  assert.match(renderAudienceRaffle(store.getAudienceState("s1", "a2")), /La tómbola está cerrada/);
});

test("Audience visual key incorrect answer stays quiet and allows retry", () => {
  const store = new RaffleStore();
  store.create({ sessionId: "s1", config: visualKeyConfig });
  const before = renderAudienceRaffle(store.getAudienceState("s1", "a1"));
  const wrong = store.enter({ sessionId: "s1", audienceId: "a1", optionId: "a" });
  const after = renderAudienceRaffle(store.getAudienceState("s1", "a1"));

  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, "incorrect_option");
  assert.equal(after, before);
  assert.doesNotMatch(after, /incorrecta|Intenta|error|rojo|perdiste/i);
  assert.doesNotMatch(after, /disabled/);

  assert.equal(store.enter({ sessionId: "s1", audienceId: "a1", optionId: "b" }).ok, true);
  assert.match(renderAudienceRaffle(store.getAudienceState("s1", "a1")), /Boleto activo/);
});

test("Audience visual key and poll lock after authoritative ownEntry", () => {
  const store = new RaffleStore();
  store.create({ sessionId: "s1", config: visualKeyConfig });
  store.enter({ sessionId: "s1", audienceId: "a1", optionId: "b" });
  const visualHtml = renderAudienceRaffle(store.getAudienceState("s1", "a1"));
  assert.match(visualHtml, /Boleto activo/);
  assert.doesNotMatch(visualHtml, /data-raffle-option/);

  store.close("s1");
  store.create({ sessionId: "s1", config: pollConfig() });
  assert.equal(store.submitPollResponse({ sessionId: "s1", audienceId: "a1", optionId: "yes" }).ok, true);
  assert.equal(store.submitPollResponse({ sessionId: "s1", audienceId: "a1", optionId: "no" }).reason, "duplicate_entry");
  const pollHtml = renderAudienceRaffle(store.getAudienceState("s1", "a1"));
  assert.match(pollHtml, /Boleto activo/);
  assert.doesNotMatch(pollHtml, /data-raffle-option/);
});

test("Audience drawing uses revealAt and refresh does not restart countdown", () => {
  const active = { mode: "free", state: "drawing", revealAt: new Date(10_000).toISOString() };

  assert.equal(remainingSeconds(active, 6_100), 4);
  assert.match(renderAudienceRaffle({ active }, false, 6_100), /Revelación en<\/span><strong>4s/);
  assert.match(renderAudienceRaffle({ active }, false, 8_900), /Revelación en<\/span><strong>2s/);
});

test("Audience winner is private and non-winner stays positive without identity", () => {
  const winnerHtml = renderAudienceRaffle({ active: { mode: "free", state: "winner", isWinner: true } });
  const otherHtml = renderAudienceRaffle({ active: { mode: "free", state: "winner", isWinner: false } });

  assert.match(winnerHtml, /¡GANASTE!/);
  assert.match(winnerHtml, /Levanta tu teléfono/);
  assert.match(otherHtml, /Gracias por participar :\)/);
  assert.doesNotMatch(otherHtml, /Tenemos ganador|Perdiste|audienceId|socketId|Mesa/);
});

test("Closed raffle clears public overlays", () => {
  assert.equal(renderAudienceRaffle({ active: null }), "");
  assert.equal(renderScreenRaffle({ active: null }), "");
  assert.equal(renderAudienceRaffle({ active: { state: "closed", mode: "free" } }), "");
});

test("Screen collecting uses safe public payload and never receives entryKey", () => {
  const store = new RaffleStore();
  store.create({ sessionId: "s1", config: visualKeyConfig });
  const screen = store.getScreenState("s1");
  const audience = store.getAudienceState("s1", "a1");

  assert.equal("entryKey" in screen.active, false);
  assert.equal("entries" in screen.active, false);
  assert.equal("eligibleCount" in screen.active, false);
  assert.equal(screen.active.options.length, 4);
  assert.equal(screen.active.options[0].thumbnail, "/future/a.png");
  assert.equal("entryKey" in audience.active, false);
  assert.equal("entryCount" in audience.active, false);
  assert.match(renderScreenRaffle(screen), /Clave visual/);
  assert.doesNotMatch(renderScreenRaffle(screen), /entryKey|audienceId|winner/);
});

test("Screen drawing and winner keep identity private", () => {
  const store = new RaffleStore(() => 0);
  store.create({ sessionId: "s1", config: freeConfig() });
  store.closeEntries("s1", [{ audienceId: "a1", label: "Mesa 1" }, { audienceId: "a2", label: "Mesa 2" }]);
  store.drawWinner("s1", ["a1", "a2"], { nowMs: 1000 });

  const drawingHtml = renderScreenRaffle(store.getScreenState("s1"), 3000);
  assert.match(drawingHtml, /Sorteando/);
  assert.match(drawingHtml, /<strong>3<\/strong>/);
  assert.doesNotMatch(drawingHtml, /PARTICIPANTES|ELEGIBLES|Mesa|audienceId|pendingWinner/);

  store.revealWinner("s1", { nowMs: 6000 });
  const winnerHtml = renderScreenRaffle(store.getScreenState("s1"));
  assert.match(winnerHtml, /¡TENEMOS GANADOR!/);
  assert.doesNotMatch(winnerHtml, /Mesa|audienceId|ticket|Ganador seleccionado/);
});

test("Public raffle runtime uses existing entry events and closes Audience explicitly", () => {
  const publicUi = readProjectFile("public/shared/raffle-public-ui.js");
  const storeSource = readProjectFile("raffle-store.js");

  assert.match(publicUi, /socket\.emit\("raffle:enter", \{ optionId \}\)/);
  assert.match(publicUi, /socket\.emit\("raffle:submit_poll_response", \{ optionId \}\)/);
  assert.match(publicUi, /socket\.on\("raffle:closed", clearOverlay\)/);
  assert.match(storeSource, /getRoleRoomKey\(context\.roomKey, "audience"\)\)\.emit\("raffle:closed"/);
});

test("Screen styles include reduced-motion fallback", () => {
  const css = readProjectFile("public/screen/screen.css");
  assert.match(css, /prefers-reduced-motion: reduce/);
});
