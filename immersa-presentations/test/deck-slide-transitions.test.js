const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Deck stores one global slide transition and exposes it in Home", () => {
  const server = read("server.js");
  const home = read("public/home/index.html");
  const homeScript = read("public/home/home.js");

  assert.match(server, /SLIDE_TRANSITIONS = new Set\(\["none", "dissolve", "wipe", "flash"\]\)/);
  assert.match(server, /if \(transition === "swipe"\) return "wipe"/);
  assert.match(server, /return SLIDE_TRANSITIONS\.has\(transition\) \? transition : "flash"/);
  assert.match(server, /slideTransition: normalizeSlideTransition\(manifest\.slideTransition\)/);
  assert.match(server, /\/api\/decks\/:deckId\/transition/);
  assert.match(server, /manifest\.slideTransition = transition/);
  assert.match(home, /data-deck-transition="none"/);
  assert.match(home, /data-deck-transition="dissolve"/);
  assert.match(home, /data-deck-transition="wipe"/);
  assert.match(home, /data-deck-transition="flash"/);
  assert.match(homeScript, /body: JSON\.stringify\(\{ slideTransition: transition \}\)/);
});

test("all live roles animate slide changes from the Deck manifest", () => {
  const transitionScript = read("public/shared/slide-transitions.js");
  const transitionCss = read("public/shared/slide-transitions.css");
  const roles = [
    "public/presenter/presenter.js",
    "public/stage/stage.js",
    "public/screen/screen.js",
    "public/audience/audience.js"
  ];

  assert.match(transitionScript, /if \(transition === "swipe"\) return "wipe"/);
  assert.match(transitionScript, /return ALLOWED\.has\(transition\) \? transition : "flash"/);
  assert.match(transitionScript, /if \(transition === "none"\) return/);
  assert.match(transitionCss, /immersa-slide-transition-dissolve/);
  assert.match(transitionCss, /immersa-slide-transition-wipe/);
  assert.match(transitionCss, /immersa-slide-outgoing/);
  assert.match(transitionCss, /immersa-slide-transition-flash/);
  assert.match(transitionCss, /prefers-reduced-motion: reduce/);
  assert.match(transitionScript, /await loadSource\(src\)[\s\S]*insertBefore\(layer, slide\)[\s\S]*slide\.src = src;[\s\S]*apply\(slide, transition, direction\)/);
  roles.forEach((file) => {
    const source = read(file);
    assert.match(source, /ImmersaSlideTransitions\?\.swap/);
    assert.match(source, /ImmersaSlideTransitions\?\.preload/);
  });
});

test("Público centers Texto en vivo", () => {
  const css = read("public/audience/audience.css");
  assert.match(css, /\.live-message \{[^}]*top: 50%;[^}]*transform: translate\(-50%, -50%\)/);
});
