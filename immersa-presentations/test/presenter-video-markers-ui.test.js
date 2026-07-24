const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Speaker tools render in the requested visual order", () => {
  const html = read("public/presenter/index.html");
  const css = read("public/presenter/presenter.css");
  const liveTextCss = read("public/shared/live-text-control.css");
  const controllerCss = read("public/shared/controller-tools.css");
  const liveTextIcon = read("public/assets/icons/texto-en-vivo.svg");
  const tools = html.match(/<div class="fx-module"[\s\S]*?<\/div>\s*<\/section>/)?.[0] || "";
  const domOrder = ["audienceQr", "localReactions", "liveTextToggle", "drawToggle", "interactionToggle"]
    .map((id) => [id, tools.indexOf(`id="${id}"`)])
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
  assert.deepEqual(domOrder, ["audienceQr", "localReactions", "liveTextToggle", "drawToggle", "interactionToggle"]);
  assert.match(css, /\.fx-module[\s\S]*?flex-direction:\s*column-reverse/);
  assert.match(html, /id="liveTextToggle"[\s\S]*?class="live-text-icon"/);
  assert.match(liveTextCss, /mask:\s*url\("\/assets\/icons\/texto-en-vivo\.svg"\)/);
  assert.match(controllerCss, /\.live-text-button\[aria-pressed="true"\],[\s\S]*?\.drawing-button\.active[\s\S]*?overflow:\s*hidden/);
  assert.match(liveTextIcon, /<path[^>]*stroke-width="1\.6"/);
  assert.equal((liveTextIcon.match(/<circle/g) || []).length, 3);
});

test("Speaker tools become horizontal in compact landscape", () => {
  const html = read("public/presenter/index.html");
  const presenterCss = read("public/presenter/presenter.css");
  const css = read("public/presenter/mobile-controls-tuning.css");
  const controllerCss = read("public/shared/controller-tools.css");

  assert.match(css, /@media \(orientation:\s*landscape\) and \(max-height:\s*520px\)[\s\S]*?\.fx-module\s*\{[\s\S]*?flex-direction:\s*row-reverse/);
  assert.match(html, /id="thumbsToggle"[\s\S]*?<rect x="9" y="4" width="6" height="16" rx="1\.5"><\/rect><path d="M4 8v8M20 8v8"><\/path>/);
  assert.match(presenterCss, /\.thumbs-toggle svg\s*\{\s*stroke-width:\s*1\.8/);
  assert.match(controllerCss, /\.thumbs-toggle\.is-active,[\s\S]*?\.thumbs-toggle\[aria-expanded="true"\][\s\S]*?background:[\s\S]*?linear-gradient\(135deg, #8b3dff 0%, #684cff 46%, #21b7ff 100%\)/);
  assert.match(controllerCss, /\.thumbs-toggle\.is-active svg,[\s\S]*?\.thumbs-toggle\[aria-expanded="true"\] svg[\s\S]*?stroke:\s*#fff/);
  assert.match(css, /\.thumbs\s*\{[\s\S]*?bottom:\s*calc\(66px \+ env\(safe-area-inset-bottom\)\)/);
});

test("Speaker fullscreen swaps to the supplied collapse icon without an active cyan fill", () => {
  const html = read("public/presenter/index.html");
  const css = read("public/presenter/presenter.css");
  const fullscreenButton = html.match(/<button id="fullscreenToggle"[\s\S]*?<\/button>/)?.[0] || "";

  assert.match(fullscreenButton, /class="fullscreen-expand-icon"/);
  assert.match(fullscreenButton, /class="fullscreen-collapse-icon" viewBox="0 0 48 48"/);
  assert.match(fullscreenButton, /M8,26a2,2,0,0,0-2,2\.3/);
  assert.match(fullscreenButton, /M43\.7,4\.8a2,2,0,0,0-3\.1-\.2/);
  assert.match(css, /\.fullscreen-button\[aria-pressed="true"\]\s*\{[\s\S]*?background:\s*linear-gradient\(180deg,\s*rgba\(35,43,47,\.54\),\s*rgba\(8,10,14,\.50\)\)/);
  assert.match(css, /\.fullscreen-button\[aria-pressed="true"\] \.fullscreen-expand-icon\s*\{\s*display:\s*none/);
  assert.match(css, /\.fullscreen-button\[aria-pressed="true"\] \.fullscreen-collapse-icon\s*\{[\s\S]*?display:\s*block[\s\S]*?fill:\s*currentColor[\s\S]*?stroke:\s*none/);
});

test("Speaker marks only video slides with the 80 percent Immersa gradient icon", () => {
  const script = read("public/presenter/presenter.js");
  const css = read("public/presenter/presenter.css");
  assert.match(script, /data\?\.videos/);
  assert.match(script, /video\?\.slide_id/);
  assert.match(script, /videoSlideIds\.has\(slideIdentity\(item, index\)\)/);
  assert.match(script, /class="thumb-video-mark"/);
  assert.match(script, /#68d8cc/);
  assert.match(script, /#4368f6/);
  assert.match(script, /#9b4cff/);
  assert.match(css, /\.thumb-video-mark\s*\{[\s\S]*?left:\s*50%[\s\S]*?top:\s*50%[\s\S]*?opacity:\s*\.8/);
  assert.match(css, /pointer-events:\s*none/);
});
