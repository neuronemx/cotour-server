const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createInitialRaffleControllerState,
  createRaffleActionDispatcher,
  canDispatchRaffleAction
} = require("../public/shared/raffle-controller");

function readProjectFile(filePath) {
  return fs.readFileSync(path.join(__dirname, "..", filePath), "utf8");
}

function cssBlock(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(escaped + "\\s*\\{([\\s\\S]*?)\\}"))?.[1] || "";
}

test("poll selection after returning from raffles renders inside preserved poll content", () => {
  const presenter = readProjectFile("public/presenter/presenter.js");
  const stage = readProjectFile("public/stage/stage.js");
  const controller = readProjectFile("public/shared/raffle-controller.js");

  assert.match(presenter, /function interactionPanelContentRoot\(\) \{ const panel = ensureInteractionPanel\(\); return panel\.querySelector\("\.raffle-existing-content"\) \|\| panel; \}/);
  assert.match(presenter, /const panel = interactionPanelContentRoot\(\);[\s\S]+panel\.querySelectorAll\("\[data-interaction-select\]"\)/);
  assert.match(stage, /function stageActionsContentRoot\(\) \{\s*return stageActionsContent\?\.querySelector\("\.raffle-existing-content"\) \|\| stageActionsContent;\s*\}/);
  assert.match(stage, /const content = stageActionsContentRoot\(\);[\s\S]+content\.querySelectorAll\("\[data-interaction-select\]"\)/);
  assert.match(controller, /while \(host\.firstChild\) existing\.appendChild\(host\.firstChild\);/);
  assert.doesNotMatch(controller, /isModalToggleOrCloseTarget\(event\.target\)\) setTimeout/);
});

test("first poll click after raffle close is not followed by delayed modal reset", () => {
  const controller = readProjectFile("public/shared/raffle-controller.js");
  assert.match(controller, /eventName === "raffle:closed"\) currentTab = "home"/);
  assert.match(controller, /if \(!state\.active && !state\.activeInteraction && isModalToggleOrCloseTarget\(event\.target\)\) \{ currentTab = "home"; clearLocalSetup\(\); scheduleRender\(\); \}/);
  assert.doesNotMatch(controller, /currentTab = "home"; clearLocalSetup\(\); scheduleRender\(\); \}, 0\)/);
});

test("reset winners dispatch emits exactly raffle:reset_winners in entries_closed", () => {
  const emitted = [];
  let pendingEvent = "";
  const state = {
    ...createInitialRaffleControllerState(),
    active: { id: "r-reset", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 1 }
  };
  const dispatch = createRaffleActionDispatcher({
    getState: () => ({ ...state, pendingEvent }),
    emit: (eventName) => emitted.push(eventName),
    setPending: (eventName) => { pendingEvent = eventName; }
  });

  assert.equal(canDispatchRaffleAction(state, "raffle:reset_winners"), true);
  assert.equal(dispatch("raffle:reset_winners"), true);
  assert.equal(dispatch("raffle:reset_winners"), false);
  assert.deepEqual(emitted, ["raffle:reset_winners"]);
  assert.equal(pendingEvent, "raffle:reset_winners");
});

test("poll launch CTA hover keeps the primary Immersa gradient", () => {
  const css = readProjectFile("public/shared/interactions-home.css");
  const base = cssBlock(css, ".interaction-panel button[data-interaction-launch],\n.stage-actions-card button[data-interaction-launch]");
  const hover = cssBlock(css, ".interaction-panel button[data-interaction-launch]:hover:not(:disabled),\n.stage-actions-card button[data-interaction-launch]:hover:not(:disabled)");

  assert.match(base, /background: var\(--immersa-gradient\)/);
  assert.match(hover, /background: var\(--immersa-gradient\)/);
  assert.match(hover, /box-shadow:/);
  assert.doesNotMatch(hover, /background:\s*rgba\(255, 255, 255/);
  assert.doesNotMatch(hover, /background:\s*rgba\(0, 0, 0/);
});
