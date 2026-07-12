const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

/*
 * IMMERSA — INTERACCIONES VISUAL FREEZE
 *
 * Reference state: PR #75, branch agent/interactions-home-modal,
 * immediately after commit f139042802ab96633f669c2623bfa5b63754ea16.
 *
 * These Git blob IDs are the exact approved visual files. Functional work must
 * not modify them unless Arturo explicitly approves a visual change and this
 * contract is intentionally updated in the same commit.
 */

const PROJECT_ROOT = path.join(__dirname, "..");

const FROZEN_VISUAL_FILES = {
  "public/shared/interactions.css": "a5aba78d7d0615e16fc91f5aecd4e241a1580d27",
  "public/shared/interactions-home.css": "a3736da613aa4f5265fcc7ca4516a69c0d30f998",
  "public/shared/interactions-home-recovery.css": "c99cc6e55a7a2ec5017093cc7de502b5a72347a7"
};

function gitBlobSha(relativePath) {
  return execFileSync("git", ["hash-object", relativePath], {
    cwd: PROJECT_ROOT,
    encoding: "utf8"
  }).trim();
}

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8");
}

test("approved Interacciones visual files remain byte-for-byte unchanged", () => {
  for (const [relativePath, expectedBlobSha] of Object.entries(FROZEN_VISUAL_FILES)) {
    assert.equal(
      gitBlobSha(relativePath),
      expectedBlobSha,
      `${relativePath} changed after the visual freeze. Restore it or update the contract only with explicit visual approval.`
    );
  }
});

test("approved Interacciones visual tokens and exact menu icons remain present", () => {
  const homeCss = read("public/shared/interactions-home.css");
  const recoveryCss = read("public/shared/interactions-home-recovery.css");
  const baseCss = read("public/shared/interactions.css");

  assert.match(homeCss, /--immersa-gradient:\s*linear-gradient\(135deg, #7f77dd 0%, #378add 55%, #5dcaa5 100%\)/);
  assert.match(homeCss, /--immersa-glass:\s*linear-gradient\(160deg, rgba\(30, 26, 48, \.96\), rgba\(18, 16, 30, \.98\)\)/);
  assert.match(baseCss, /font-family:\s*Inter, "Segoe UI", Arial, sans-serif/);
  assert.match(recoveryCss, /font-family:\s*Poppins, Inter, "Segoe UI", Arial, sans-serif/);
  assert.match(recoveryCss, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(recoveryCss, /min-height:\s*52px/);
  assert.match(recoveryCss, /border-radius:\s*9px !important/);
  assert.match(recoveryCss, /nth-child\(1\)[\s\S]*data:image\/svg\+xml/);
  assert.match(recoveryCss, /nth-child\(2\)[\s\S]*data:image\/svg\+xml/);
  assert.match(recoveryCss, /nth-child\(3\)[\s\S]*data:image\/svg\+xml/);
  assert.match(recoveryCss, /nth-child\(4\)[\s\S]*data:image\/svg\+xml/);
});
