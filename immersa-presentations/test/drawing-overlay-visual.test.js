const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const drawingSource = fs.readFileSync(path.join(root, "public/shared/drawing-overlay.js"), "utf8");
const audienceCss = fs.readFileSync(path.join(root, "public/audience/audience.css"), "utf8");
const interactionsCss = fs.readFileSync(path.join(root, "public/shared/interactions.css"), "utf8");
const audienceIndex = fs.readFileSync(path.join(root, "public/audience/index.html"), "utf8");

function cssBlock(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} block exists`);
  return match[1];
}

function cssBlocks(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((match) => match[1]);
}

function lastCssBlock(source, selector) {
  const blocks = cssBlocks(source, selector);
  assert.ok(blocks.length > 0, `${selector} block exists`);
  return blocks[blocks.length - 1];
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
  assert.equal(mark.width, "42px");
  assert.equal(mark.height, "42px");
  assert.equal(mark.display, "block");
  assert.equal(mark["border-radius"], "13px");
  assert.equal(mark["object-fit"], "contain");
  assert.equal(mark["object-position"], "center");
  assert.equal(mark.flex, "0 0 auto");

  const lockup = declarations(cssBlock(audienceCss, ".brand-lockup"));
  assert.equal(lockup.width, "58px");
  assert.equal(lockup.height, "58px");
  assert.equal(lockup.padding, "8px");
  assert.equal(lockup["border-radius"], "20px");
  assert.equal(lockup.overflow, "visible");
  assert.equal(lockup["z-index"], "36");
  assert.equal(lockup["pointer-events"], "none");

  const topActions = declarations(cssBlock(audienceCss, ".top-actions"));
  assert.equal(topActions["z-index"], "36");
});

test("audience logo stays contained in compact mobile landscape", () => {
  assert.match(audienceCss, /@media \(orientation: landscape\) and \(max-height: 520px\) \{[\s\S]*?\.brand-lockup \{[^}]*width: 36px;[^}]*height: 36px;[^}]*padding: 3px;[^}]*overflow: hidden;[^}]*\}[\s\S]*?\.brand-mark \{[^}]*width: 28px;[^}]*height: 28px;[^}]*\}/);
  assert.match(audienceCss, /@media \(orientation: landscape\) and \(max-height: 520px\) \{[\s\S]*?\.brand-lockup \{[^}]*top: max\(9px, env\(safe-area-inset-top\)\);[^}]*left: max\(9px, env\(safe-area-inset-left\)\);/);
  assert.match(audienceIndex, /\/audience\/audience\.css\?v=11/);
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

test("audience public interactions are centered in the viewport", () => {
  const baseCard = declarations(cssBlock(interactionsCss, ".interaction-card"));
  assert.equal(baseCard.left, "50%");

  const finalCard = declarations(lastCssBlock(interactionsCss, ".interaction-card"));
  assert.equal(finalCard.position, "fixed");
  assert.equal(finalCard.top, "50%");
  assert.equal(finalCard.bottom, "auto");
  assert.equal(finalCard.transform, "translate(-50%, -50%)");
  assert.equal(finalCard["border-top-width"], "0 !important");
  assert.match(interactionsCss, /\.interaction-card::before \{[\s\S]+background: var\(--immersa-gradient\);[\s\S]+pointer-events: none;/);
  assert.match(interactionsCss, /\.interaction-card p \{[\s\S]+font-family: Poppins, Inter, "Segoe UI", Arial, sans-serif;[\s\S]+font-weight: 700;/);

  const raffleOverlay = declarations(cssBlock(audienceCss, ".raffle-public-overlay"));
  assert.equal(raffleOverlay["align-items"], "center");
  assert.equal(raffleOverlay["justify-items"], "center");
  assert.match(audienceCss, /@media \(orientation: landscape\) and \(max-height: 520px\) \{[\s\S]*?\.raffle-public-overlay \{[^}]*align-items: center;[^}]*\}/);
});


test("audience reuses the shared interaction slide scrim", () => {
  assert.equal((audienceIndex.match(/class="interaction-slide-scrim"/g) || []).length, 1);
  assert.match(audienceIndex, /<section id="slideViewport" class="slide-viewport"[^>]*>[\s\S]*?<\/section>\n    <div class="interaction-slide-scrim" aria-hidden="true"><\/div>\n    <div class="brand-lockup"/);

  const scrim = declarations(cssBlock(interactionsCss, ".interaction-slide-scrim"));
  assert.equal(scrim["z-index"], "2");
  assert.equal(scrim.background, "rgba(2, 4, 8, .22)");
  assert.equal(scrim["backdrop-filter"], "blur(4px)");
  assert.equal(scrim["-webkit-backdrop-filter"], "blur(4px)");

  assert.match(interactionsCss, /\.presenter-shell\.interaction-panel-open \.interaction-slide-scrim,\nbody\.stage-actions-open \.interaction-slide-scrim \{\n  opacity: 1;\n  visibility: visible;\n\}/);
  assert.match(interactionsCss, /\.audience:has\(\.interaction-card:not\(\.interaction-hidden\)\) > \.interaction-slide-scrim,\n\.audience:has\(\.raffle-public-overlay\) > \.interaction-slide-scrim \{\n  opacity: 1;\n  visibility: visible;\n\}/);
  assert.doesNotMatch(interactionsCss, /\.audience:has\(\.interaction-card\) > \.interaction-slide-scrim/);

  const raffleOverlay = declarations(cssBlock(audienceCss, ".raffle-public-overlay"));
  assert.equal(raffleOverlay.background, "transparent");
  assert.equal(raffleOverlay["align-items"], "center");
  assert.equal(raffleOverlay["justify-items"], "center");
  assert.equal(raffleOverlay["z-index"], "7");
});
