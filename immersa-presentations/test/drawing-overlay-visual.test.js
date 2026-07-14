const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const drawingSource = fs.readFileSync(path.join(root, "public/shared/drawing-overlay.js"), "utf8");
const audienceCss = fs.readFileSync(path.join(root, "public/audience/audience.css"), "utf8");

function cssBlock(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} block exists`);
  return match[1];
}

function declarations(block) {
  return Object.fromEntries(
    block
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const separator = item.indexOf(":");
        return [item.slice(0, separator).trim(), item.slice(separator + 1).trim()];
      })
  );
}

test("drawing overlay keeps approved visual constants and normal blending", () => {
  assert.match(drawingSource, /const DEFAULT_COLOR = "#b20de9";/);
  assert.match(drawingSource, /const DEFAULT_WIDTH = 0\.018;/);
  assert.match(drawingSource, /const DEFAULT_OPACITY = 0\.85;/);
  assert.match(drawingSource, /const DEFAULT_TTL = 4200;/);
  assert.match(drawingSource, /const FADE_MS = 1000;/);
  assert.match(drawingSource, /canvas\.style\.mixBlendMode = "normal";/);
  assert.doesNotMatch(drawingSource, /mixBlendMode\s*=\s*"multiply"/);
  assert.match(drawingSource, /context\.shadowColor = "rgba\(255, 255, 255, \.24\)";/);
  assert.match(drawingSource, /context\.shadowBlur = 3 \* ratio;/);
});

test("drawPath preserves a single stroke pass and existing coordinate, TTL, and fade flow", () => {
  const drawPath = drawingSource.match(/function drawPath\(points, stroke, alpha\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(drawPath, "drawPath exists");
  assert.equal((drawPath.match(/context\.stroke\(\)/g) || []).length, 1);
  assert.equal((drawPath.match(/context\.beginPath\(\)/g) || []).length, 1);
  assert.match(drawingSource, /points: currentPoints\.map\(normalizePoint\),[\s\S]*?ttl\n\s*\};/);
  assert.match(drawingSource, /ttl: Math\.max\(1200, Math\.min\(8000, Number\(stroke\.ttl\) \|\| ttl\)\)/);
  assert.match(drawingSource, /const fadeStart = stroke\.ttl - FADE_MS;/);
  assert.match(drawingSource, /const alpha = age <= fadeStart \? 1 : Math\.max\(0, 1 - \(age - fadeStart\) \/ FADE_MS\);/);
});

test("audience logo uses contained inner mark while preserving lockup capsule", () => {
  const mark = declarations(cssBlock(audienceCss, ".brand-mark"));
  assert.equal(mark.width, "100%");
  assert.equal(mark.height, "100%");
  assert.equal(mark.display, "block");
  assert.equal(mark["object-fit"], "contain");
  assert.equal(mark["object-position"], "center");
  assert.equal(mark.flex, "0 0 auto");

  const lockup = declarations(cssBlock(audienceCss, ".brand-lockup"));
  assert.equal(lockup.width, "44px");
  assert.equal(lockup.height, "44px");
  assert.equal(lockup.overflow, "hidden");
});

test("hotfix stays scoped away from speaker logo css and PNG assets", () => {
  const presenterCss = fs.readFileSync(path.join(root, "public/presenter/presenter.css"), "utf8");
  assert.doesNotMatch(presenterCss, /\.brand-mark\s*\{[^}]*width:\s*88%/);
  assert.doesNotMatch(presenterCss, /\.brand-mark\s*\{[^}]*object-fit:\s*contain/);

  const audienceLogo = path.join(root, "public/audience/immersa-mark.png");
  const presenterLogo = path.join(root, "public/presenter/immersa-mark.png");
  assert.ok(fs.existsSync(audienceLogo), "audience logo PNG remains in place");
  assert.ok(fs.existsSync(presenterLogo), "speaker logo PNG remains in place");
});
