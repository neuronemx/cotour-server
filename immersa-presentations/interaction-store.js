const { TimeSyncStore, createTimeSyncSocketHandlers } = require("./time-sync-store");
const { BreakoutStore } = require("./breakout-store");
const { createBreakoutSocketHandlers } = require("./breakout-sockets");

const FALLBACK_DEMO_INTERACTION = {
  id: "demo-poll-1",
  type: "poll",
  title: "Encuesta demo",
  prompt: "¿Qué experiencia te gustaría probar primero en Immersa?