const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/*
 * IMMERSA — INTERACCIONES VISUAL FREEZE
 *
 * Source-of-truth snapshot: PR #75, branch agent/interactions-home-modal,
 * immediately after commit f139042802ab96633f669c2623bfa5b63754ea16.
 *
 * This contract protects the approved