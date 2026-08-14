const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const TimeSync = require("../public/shared/time-sync-client");
const Connection = require("../public/shared/presentation-connection");

function fakeSocket() {
  const handlers = new Map();
  const emissions = [];
  return {
    id: "socket-1",
    connected: true,
    emissions,
    on(event, handler) { if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push(handler); },
    emit(event, payload) { emissions.push({ event, payload }); },
    trigger(event, payload) { for (const handler of handlers.get(event) || []) handler(payload); }
  };
}

test("clock sample uses midpoint and chooses the lowest RTT", () => {
  const slow = TimeSync.estimateSample(1000, 1100, 10, 110, 2050);
  const fast = TimeSync.estimateSample(2000, 2020, 200, 220, 3010);
  assert.equal(slow.rttMs, 100);
  assert.equal(fast.rttMs, 20);
  assert.equal(TimeSync.chooseBestSample([slow, fast]), fast);
  assert.equal(fast.offsetMs, 1000);
});

test("remaining time uses the authoritative server deadline", () => {
  assert.equal(TimeSync.remainingMs({ timer: { status: "running", ends_at_server_ms: 9000 } }, 6500), 2500);
  assert.equal(TimeSync.remainingMs({ visible: false, timer: { status: "running", ends_at_server_ms: 9000 } }, 6500), null);
  assert.equal(TimeSync.remainingMs({ timer: { status: "paused", remaining_ms: 4200 } }, 9000), 4200);
});

test("disconnect rejects an active clock sample", async () => {
  const socket = fakeSocket();
  let rejectPending;
  const client = TimeSync.create(socket, {
    setTimeoutFn(fn) { rejectPending = fn; return 1; },
    clearTimeoutFn() {},
    document: { addEventListener() {} }
  });
  const pending = client.handlePresentationJoin(1);
  socket.connected = false;
  socket.trigger("disconnect");
  assert.equal(await pending, null);
  assert.equal(typeof rejectPending, "function");
});

test("presentation connection rejoins once for every new socket id", () => {
  const socket = fakeSocket();
  let timeSyncJoins = 0;
  const connection = Connection.create(socket, {
    getJoinPayload: () => ({ session: "abc", deck: "deck", role: "presenter" }),
    timeSync: { handlePresentationJoin() { timeSyncJoins += 1; }, handleDisconnect() {} }
  });
  connection.start();
  assert.equal(socket.emissions.filter(item => item.event === "join_presentation").length, 1);
  assert.equal(connection.join(), false);
  socket.trigger("disconnect");
  socket.connected = true;
  socket.id = "socket-2";
  socket.trigger("connect");
  assert.equal(socket.emissions.filter(item => item.event === "join_presentation").length, 2);
  assert.equal(timeSyncJoins, 2);
});

test("adoptCurrentConnection avoids duplicating the legacy initial join", () => {
  const socket = fakeSocket();
  const connection = Connection.create(socket, { getJoinPayload: () => ({ session: "abc", deck: "deck", role: "screen" }) });
  connection.start({ adoptCurrentConnection: true });
  assert.equal(socket.emissions.length, 0);
  socket.trigger("connect");
  assert.equal(socket.emissions.length, 0);
  socket.trigger("disconnect");
  socket.connected = true;
  socket.id = "socket-2";
  socket.trigger("connect");
  assert.equal(socket.emissions.filter(item => item.event === "join_presentation").length, 1);
});

test("runtime and Time Sync UI are loaded for shared roles", () => {
  const drawing = fs.readFileSync(path.join(__dirname, "../public/shared/drawing-overlay.js"), "utf8");
  const runtime = fs.readFileSync(path.join(__dirname, "../public/shared/presentation-runtime.js"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "../public/shared/time-sync-ui.js"), "utf8");
  assert.match(drawing, /\/shared\/time-sync-client\.js/);
  assert.match(drawing, /\/shared\/presentation-connection\.js/);
  assert.match(drawing, /\/shared\/presentation-runtime\.js/);
  assert.match(runtime, /\/shared\/time-sync-ui\.css/);
  assert.match(runtime, /\/shared\/time-sync-ui\.js/);
  assert.match(runtime, /speaker\|presenter/);
  assert.match(runtime, /role\s*===\s*["']audience["']/);
  assert.match(runtime, /adoptCurrentConnection\s*:\s*true/);
  assert.match(ui, /Mostrar en Pantalla/);
  assert.match(ui, /Mostrar en Público/);
});
