const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TEMP_VISUAL_KEY_OPTIONS,
  createInitialRaffleControllerState,
  createRaffleConfig,
  reduceRaffleControllerState,
  renderRaffleController,
  canCreateMode
} = require("../public/shared/raffle-controller");

test("visual key controller starts without a default correct option", () => {
  const state = createInitialRaffleControllerState();
  const config = createRaffleConfig("visual_key", state);

  assert.equal(state.visualKeyDraftEntryKey, "");
  assert.equal(config.entryKey, "");
  assert.equal(TEMP_VISUAL_KEY_OPTIONS.some((option) => option.correct), false);
  assert.equal(canCreateMode(state, "visual_key"), false);
});

test("visual key setup buttons show only A, B, C, and D", () => {
  const html = renderRaffleController(createInitialRaffleControllerState());

  assert.match(html, /data-raffle-key-label="A"/);
  assert.match(html, /data-raffle-key-label="B"/);
  assert.match(html, /data-raffle-key-label="C"/);
  assert.match(html, /data-raffle-key-label="D"/);
  assert.match(html, /<span>A<\/span>/);
  assert.match(html, /<span>B<\/span>/);
  assert.match(html, /<span>C<\/span>/);
  assert.match(html, /<span>D<\/span>/);
  assert.doesNotMatch(html, /<span>Clave A<\/span>|<span>Clave B<\/span>|<span>Clave C<\/span>|<span>Clave D<\/span>/);
});

test("visual key selection enables create and stays private to controller config", () => {
  const state = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:state", {
    visualKeyDraftEntryKey: "visual_key_2",
    active: null
  });
  const html = renderRaffleController(state);
  const config = createRaffleConfig("visual_key", state);

  assert.equal(canCreateMode(state, "visual_key"), true);
  assert.match(html, /data-raffle-key-option="visual_key_2"[^>]+is-selected/);
  assert.match(html, /data-raffle-key-option="visual_key_2"[^>]+aria-pressed="true"/);
  assert.match(html, /data-raffle-key-option="visual_key_2"[^>]+box-shadow/);
  assert.doesNotMatch(html, /data-raffle-create="visual_key" disabled/);
  assert.equal(config.entryKey, "visual_key_2");
  assert.equal(config.options.length, 4);
  assert.equal("entryKey" in config.options[0], false);
});

test("visual key create is disabled and non-startable without entryKey", () => {
  const state = createInitialRaffleControllerState();
  const html = renderRaffleController(state);

  assert.equal(canCreateMode(state, "visual_key"), false);
  assert.match(html, /class="primary raffle-create-visual is-disabled"/);
  assert.match(html, /data-raffle-create="visual_key" disabled/);
  assert.match(html, /cursor:not-allowed/);
});

test("Speaker and Stage synchronize visual key draft through controller state", () => {
  const speaker = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:state", {
    visualKeyDraftEntryKey: "visual_key_3",
    active: null
  });
  const stage = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:state", {
    visualKeyDraftEntryKey: speaker.visualKeyDraftEntryKey,
    active: null
  });

  assert.equal(stage.visualKeyDraftEntryKey, "visual_key_3");
  assert.match(renderRaffleController(stage), /data-raffle-key-option="visual_key_3"[^>]+aria-pressed="true"/);
});
