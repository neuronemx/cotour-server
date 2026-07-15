const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { BreakoutStore } = require("../breakout-store");

function advanceReadyPaddle(store, sessionId, direction, audienceId, startAt) {
  store.input(sessionId, audienceId, direction, startAt + 100);
  store.step(sessionId, 50