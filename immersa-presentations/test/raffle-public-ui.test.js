const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { RaffleStore } = require("../raffle-store");
const { renderAudienceRaffle, renderScreenRaffle, remainingSeconds } = require("../public/shared/raffle-public-ui");
const { adjustRaffleHtml } = require("../public/shared/raffle-ux-adjustments");

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
  assert.match(renderAudienceRaffle(store.getAudienceState("s1", "a2")), /La tómbola ya está cerrada :\(/);
});

test("Audience visual key collecting uses neutral copy and editable selected option", () => {
  const store = new RaffleStore();
  store.create({ sessionId: "s1", config: visualKeyConfig });

  const before = renderAudienceRaffle(store.getAudienceState("s1", "a1"));
  assert.match(before, /Elige una opción/);
  assert.match(before, /El presentador te dirá la correcta/);
  assert.doesNotMatch(before, /Clave visual|Elige la clave visual correcta|Boleto activo|incorrecta|acertaste|fallaste|error/i);

  assert.equal(store.enter({ sessionId: "s1", audienceId: "a1", optionId: "a" }).ok, true);
  const wrongHtml = renderAudienceRaffle(store.getAudienceState("s1", "a1"));
  assert.match(wrongHtml, /data-raffle-option="a" aria-pressed="true"/);
  assert.equal((wrongHtml.match(/aria-pressed="true"/g) || []).length, 1);
  assert.doesNotMatch(wrongHtml, /Boleto activo|incorrecta|acertaste|fallaste|error/i);

  assert.equal(store.enter({ sessionId: "s1", audienceId: "a1", optionId: "b" }).ok, true);
  const changedHtml = renderAudienceRaffle(store.getAudienceState("s1", "a1"));
  assert.match(changedHtml, /data-raffle-option="b" aria-pressed="true"/);
  assert.equal((changedHtml.match(/aria-pressed="true"/g) || []).length, 1);
  assert.doesNotMatch(changedHtml, /Boleto activo/);
});

test("Audience visual key refresh preserves last collecting selection", () => {
  const store = new RaffleStore();
  store.create({ sessionId: "s1", config: visualKeyConfig });
  store.enter({ sessionId: "s1", audienceId: "a1", optionId: "c" });

  const refreshed = store.getAudienceState("s1", "a1");
  assert.equal(refreshed.active.ownSelection.selectedOptionId, "c");
  assert.equal(refreshed.active.ownEntry, null);
  assert.match(renderAudienceRaffle(refreshed), /data-raffle-option="c" aria-pressed="true"/);
});

test("Audience visual key locks after close and distinguishes ticket, participant, and late entry", () => {
  const store = new RaffleStore();
  store.create({ sessionId: "s1", config: visualKeyConfig });
  store.enter({ sessionId: "s1", audienceId: "correct", optionId: "b" });
  store.enter({ sessionId: "s1", audienceId: "wrong", optionId: "a" });
  store.closeEntries("s1", [{ audienceId: "correct" }, { audienceId: "wrong" }]);

  assert.equal(store.enter({ sessionId: "s1", audienceId: "correct", optionId: "a" }).reason, "entries_not_collecting");
  assert.match(renderAudienceRaffle(store.getAudienceState("s1", "correct")), /Boleto activo/);
  assert.match(renderAudienceRaffle(store.getAudienceState("s1", "wrong")), /Gracias por participar :\)/);

  const lateHtml = renderAudienceRaffle(store.getAudienceState("s1", "late"));
  assert.match(lateHtml, /La tómbola ya está cerrada :\(/);
  assert.match(lateHtml, /Mantente atento a próximos sorteos/);
  assert.doesNotMatch(lateHtml, /data-raffle-option|La tómbola está cerrada/);
});

test("Audience poll locks after authoritative ownEntry", () => {
  const store = new RaffleStore();
  store.create({ sessionId: "s1", config: pollConfig() });
  assert.equal(store.submitPollResponse({ sessionId: "s1", audienceId: "a1", optionId: "yes" }).ok, true);
  assert.equal(store.submitPollResponse({ sessionId: "s1", audienceId: "a1", optionId: "no" }).reason, "duplicate_entry");
  const pollHtml = renderAudienceRaffle(store.getAudienceState("s1", "a1"));
  assert.match(pollHtml, /Boleto activo/);
  assert.doesNotMatch(pollHtml, /data-raffle-option/);
});

test("Audience drawing uses revealAt and refresh does not restart countdown", () => {
  const active = { mode: "free", state: "drawing", revealAt: new Date(10_000).toISOString() };
  const first = adjustRaffleHtml(renderAudienceRaffle({ active }, false, 6_100));
  const refreshed = adjustRaffleHtml(renderAudienceRaffle({ active }, false, 8_900));

  assert.equal(remainingSeconds(active, 6_100), 4);
  assert.match(first, /Revelación en<\/span><strong>4<\/strong>/);
  assert.match(refreshed, /Revelación en<\/span><strong>2<\/strong>/);
  assert.doesNotMatch(first + refreshed, /<strong>\d+s<\/strong>/);
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

test("Screen visual key collecting shows only the selected public option", () => {
  const store = new RaffleStore();
  store.create({ sessionId: "s1", config: visualKeyConfig });
  const screen = store.getScreenState("s1");
  const audience = store.getAudienceState("s1", "a1");
  const screenHtml = renderScreenRaffle(screen);

  assert.equal("entryKey" in screen.active, false);
  assert.equal(screen.active.displayOptionId, "b");
  assert.equal(screen.active.displayOption.label, "B");
  assert.equal(screen.active.options.length, 0);
  assert.equal("entryKey" in audience.active, false);
  assert.equal("displayOptionId" in audience.active, false);
  assert.equal("displayOption" in audience.active, false);
  assert.match(screenHtml, /Elige en tu pantalla:/);
  assert.match(screenHtml, /raffle-screen-display-option[\s\S]*<strong>B<\/strong>/);
  assert.doesNotMatch(screenHtml, /<span>A<\/span>|<span>C<\/span>|<span>D<\/span>|data-raffle-option/);
  assert.doesNotMatch(screenHtml, /entryKey|audienceId|winner|correcta|respuesta|clave visual/i);
});

test("Screen visual key option follows selected Speaker config and stays frozen", () => {
  const store = new RaffleStore();
  assert.equal(store.configureVisualKey("s1", "c").ok, true);
  assert.equal(store.create({ sessionId: "s1", config: { ...visualKeyConfig, entryKey: store.getControllerState("s1").visualKeyDraftEntryKey } }).ok, true);

  const screen = store.getScreenState("s1");
  assert.equal(screen.active.displayOptionId, "c");
  assert.match(renderScreenRaffle(screen), /<strong>C<\/strong>/);

  assert.equal(store.configureVisualKey("s1", "d").reason, "active_raffle_exists");
  const refreshed = store.getScreenState("s1");
  assert.equal(refreshed.active.displayOptionId, "c");
  assert.match(renderScreenRaffle(refreshed), /<strong>C<\/strong>/);

  store.enter({ sessionId: "s1", audienceId: "a1", optionId: "c" });
  store.enter({ sessionId: "s1", audienceId: "a2", optionId: "b" });
  store.closeEntries("s1", [{ audienceId: "a1" }, { audienceId: "a2" }]);
  const closed = store.getControllerState("s1").active;
  assert.equal(closed.entryCount, 1);
  assert.equal(closed.entries[0].selectedOptionId, "c");
});

test("Screen drawing and winner keep identity private", () => {
  const store = new RaffleStore(() => 0);
  store.create({ sessionId: "s1", config: freeConfig() });
  store.closeEntries("s1", [{ audienceId: "a1", label: "Mesa 1" }, { audienceId: "a2", label: "Mesa 2" }]);
  store.drawWinner("s1", ["a1", "a2"], { nowMs: 1000 });

  const drawingHtml = adjustRaffleHtml(renderScreenRaffle(store.getScreenState("s1"), 3000));
  assert.match(drawingHtml, /Sorteando/);
  assert.match(drawingHtml, /<strong>3<\/strong>/);
  assert.doesNotMatch(drawingHtml, /<strong>\d+s<\/strong>/);
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

test("Screen styles include visual key display treatment and reduced-motion fallback", () => {
  const css = readProjectFile("public/screen/screen.css");
  assert.match(css, /raffle-screen-display-option/);
  assert.match(css, /rgba\(82,31,137/);
  assert.match(css, /rgba\(27,61,149/);
  assert.match(css, /rgba\(104,216,204/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
