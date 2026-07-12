const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createInitialRaffleControllerState,
  createRaffleActionDispatcher,
  canDispatchRaffleAction,
  reduceRaffleControllerState
} = require("../public/shared/raffle-controller");
const { InteractionStore, createInteractionSocketHandlers } = require("../interaction-store");
const { RaffleStore, createRaffleSocketHandlers } = require("../raffle-store");

function readProjectFile(filePath) {
  return fs.readFileSync(path.join(__dirname, "..", filePath), "utf8");
}

function cssBlock(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(escaped + "\\s*\\{([\\s\\S]*?)\\}"))?.[1] || "";
}

function roleRoom(roomKey, role) {
  return roomKey + "::" + role;
}

function createFakeIo() {
  const emissions = [];
  return {
    emissions,
    to(room) {
      return {
        emit(event, payload) {
          emissions.push({ room, event, payload });
        }
      };
    }
  };
}

function createFakeSocket() {
  const handlers = new Map();
  const emissions = [];
  const broadcasts = [];
  return {
    emissions,
    broadcasts,
    on(event, handler) {
      handlers.set(event, handler);
    },
    emit(event, payload) {
      emissions.push({ event, payload });
    },
    to(room) {
      return {
        emit(event, payload) {
          broadcasts.push({ room, event, payload });
        }
      };
    },
    trigger(event, payload) {
      const handler = handlers.get(event);
      assert.equal(typeof handler, "function", "missing socket handler for " + event);
      return handler(payload);
    }
  };
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

test("interaction reveal results updates state and emits the Screen results event", async () => {
  const io = createFakeIo();
  const socket = createFakeSocket();
  const store = new InteractionStore();
  const sessionId = "session-interaction-reveal";
  const context = { roomKey: "room-1", sessionId, deckId: "deck-1", role: "presenter" };
  const poll = {
    id: "poll-1",
    type: "poll",
    title: "Encuesta preparada",
    prompt: "Elige una opción",
    options: [{ id: "a", label: "A" }, { id: "b", label: "B" }]
  };
  const handlers = createInteractionSocketHandlers({
    io,
    store,
    getRoleRoomKey: roleRoom,
    loadInteractionsForDeck: async () => [poll]
  });

  handlers.attach(socket, () => context);
  await socket.trigger("interaction:launch", { interactionId: "poll-1" });
  const response = store.submitResponse({ sessionId, interactionId: "poll-1", audienceId: "aud-1", optionId: "a" });
  assert.equal(response.ok, true);

  socket.trigger("interaction:reveal_results", { interactionId: "poll-1" });

  assert.equal(store.getSession(sessionId).resultsVisible, true);
  assert.ok(io.emissions.some((emission) => emission.room === roleRoom("room-1", "screen") && emission.event === "interaction:show_results" && emission.payload.interactionId === "poll-1" && emission.payload.totalResponses === 1));
  assert.ok(io.emissions.some((emission) => emission.room === roleRoom("room-1", "presenter") && emission.event === "interaction:results_updated"));
  assert.ok(io.emissions.some((emission) => emission.room === roleRoom("room-1", "stage") && emission.event === "interaction:results_updated"));
});

test("result and raffle reset controls stay wired after successive modal renders", () => {
  const presenter = readProjectFile("public/presenter/presenter.js");
  const stage = readProjectFile("public/stage/stage.js");
  const controller = readProjectFile("public/shared/raffle-controller.js");

  assert.match(presenter, /panel\.querySelector\("\[data-interaction-reveal\]"\)\?\.addEventListener\("click", \(\) => \{[\s\S]+socket\.emit\(eventName, \{ interactionId: activeInteraction\?\.id \}\);/);
  assert.match(stage, /content\.querySelector\("\[data-interaction-reveal\]"\)\?\.addEventListener\("click", \(\) => \{[\s\S]+socket\.emit\(eventName, \{ interactionId: activeInteraction\?\.id \}\);/);
  assert.match(controller, /panel\.querySelectorAll\("\[data-raffle-action\]"\)\.forEach\(\(button\) => button\.addEventListener\("click", \(\) => \{ dispatchRaffleAction\(button\.dataset\.raffleAction\); \}\)\);/);
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

test("raffle reset winners reaches the server, clears exclusions, and releases pending state", () => {
  const io = createFakeIo();
  const socket = createFakeSocket();
  const store = new RaffleStore(() => 0);
  const sessionId = "session-raffle-reset";
  const context = { roomKey: "room-2", sessionId, role: "presenter" };
  const connectedAudience = [{ audienceId: "aud-1", name: "Uno" }, { audienceId: "aud-2", name: "Dos" }];
  const handlers = createRaffleSocketHandlers({
    io,
    store,
    getRoleRoomKey: roleRoom,
    getConnectedAudience: () => connectedAudience
  });

  handlers.attach(socket, () => context);
  assert.equal(store.create({ sessionId, config: { mode: "free", title: "Sorteo" } }).ok, true);
  assert.equal(store.closeEntries(sessionId, connectedAudience).ok, true);
  assert.equal(store.drawWinner(sessionId, ["aud-1", "aud-2"], { revealDelayMs: 1, nowMs: 1000 }).ok, true);
  assert.equal(store.revealWinner(sessionId, { nowMs: 1001 }).ok, true);
  assert.equal(store.close(sessionId).ok, true);
  assert.equal(store.create({ sessionId, config: { mode: "free", title: "Sorteo" } }).ok, true);
  assert.equal(store.closeEntries(sessionId, connectedAudience).ok, true);

  const beforeReset = store.getControllerState(sessionId);
  assert.equal(beforeReset.previousWinnerCount, 1);
  assert.equal(beforeReset.active.entryCount, 2);
  assert.equal(beforeReset.active.eligibleCount, 1);

  socket.trigger("raffle:reset_winners");

  const directResponse = socket.emissions.find((emission) => emission.event === "raffle:winners_reset");
  assert.ok(directResponse, "reset should acknowledge the initiating controller");
  assert.equal(directResponse.payload.previousWinnerCount, 0);
  assert.equal(directResponse.payload.active.entryCount, 2);
  assert.equal(directResponse.payload.active.eligibleCount, 2);
  assert.ok(socket.broadcasts.some((emission) => emission.room === roleRoom("room-2", "presenter") && emission.event === "raffle:winners_reset"));
  assert.ok(socket.broadcasts.some((emission) => emission.room === roleRoom("room-2", "stage") && emission.event === "raffle:winners_reset"));
  assert.ok(io.emissions.some((emission) => emission.room === roleRoom("room-2", "presenter") && emission.event === "raffle:state"));
  assert.ok(io.emissions.some((emission) => emission.room === roleRoom("room-2", "stage") && emission.event === "raffle:state"));

  const pendingClientState = {
    ...createInitialRaffleControllerState(),
    active: beforeReset.active,
    pendingEvent: "raffle:reset_winners"
  };
  const releasedState = reduceRaffleControllerState(pendingClientState, "raffle:winners_reset", directResponse.payload);
  assert.equal(releasedState.pendingEvent, "");
  assert.equal(releasedState.previousWinnerCount, 0);
  assert.equal(releasedState.active.entryCount, 2);
  assert.equal(releasedState.active.eligibleCount, 2);
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
