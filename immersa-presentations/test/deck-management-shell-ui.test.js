const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Deck detail exposes the approved management sections", () => {
  const html = read("public/home/index.html");

  assert.match(html, /deck-management-shell\.css\?v=12/);
  assert.match(html, /deck-management-shell\.js\?v=7/);
  assert.match(html, /data-deck-tab="links">[\s\S]*?<span>Enlaces<\/span>/);
  assert.match(html, /data-deck-tab="interactions">[\s\S]*?<span>Interacciones<\/span>/);
  assert.match(html, /data-deck-tab="video">[\s\S]*?<span>Video<\/span>/);
  assert.match(html, /data-deck-tab="brands">[\s\S]*?<span>Marcas<\/span>/);
  assert.match(html, /data-deck-tab="history">[\s\S]*?<span>Historial<\/span>/);
  assert.match(html, /data-deck-editor-host="interactions"/);
  assert.match(html, /data-deck-editor-host="brands"/);
  assert.match(html, /data-deck-editor-host="video"/);
  assert.match(html, /id="deckEditorLaunchers" hidden/);
  assert.doesNotMatch(html, /id="detailDelete"/);
  assert.match(html, /data-deck-panel="history"[\s\S]+id="qnaHistory"/);
  assert.doesNotMatch(html, /deck-detail-kicker/);
  assert.doesNotMatch(html, /Enlaces de presentación/);
  assert.doesNotMatch(html, />Business</);
  assert.doesNotMatch(html, /id="detailStatus"/);
  assert.match(html, /data-deck-tab="interactions">[\s\S]*?deck-detail-tab-rocket[\s\S]*?<span>Interacciones<\/span>/);
  assert.match(read("public/assets/icons/Interacciones_cohete.svg"), /M 463\.19 589\.25/);
});

test("Deck management shell reuses existing actions without parallel state", () => {
  const source = read("public/home/deck-management-shell.js");

  assert.match(source, /const original = window\.renderDetailActions/);
  assert.match(source, /original\(deck\)/);
  assert.match(source, /\.role-interactions/);
  assert.match(source, /\.role-brand-mentions/);
  assert.match(source, /\.role-videos/);
  assert.match(source, /launchers\.appendChild\(button\)/);
  assert.match(source, /launcher\.click\(\)/);
  assert.match(source, /host\.replaceChildren\(editor\)/);
  assert.match(source, /editor\.setAttribute\("role", "region"\)/);
  assert.match(source, /immersa:deck-detail-close/);
  assert.match(source, /immersa:deck-detail-open/);
  assert.match(source, /ArrowLeft/);
  assert.match(source, /ArrowRight/);
  assert.match(source, /const shell = modal\?\.querySelector\("\.deck-detail-modal"\)/);
  assert.match(source, /shell\.classList\.toggle\("is-compact-header", name !== "links"\)/);
  assert.doesNotMatch(source, /modal\.classList\.toggle\("is-compact-header"/);
  assert.doesNotMatch(source, /MutationObserver|setInterval|setTimeout/);
});

test("Deck shell uses Immersa tokens, responsive layout, and reduced motion", () => {
  const css = read("public/home/deck-management-shell.css");

  assert.match(css, /background: var\(--grad\)/);
  assert.match(css, /background: var\(--grad-soft\)/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.deck-detail-header[\s\S]+grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.deck-detail-header \.deck-detail-thumb[\s\S]+width: 100%/);
  assert.match(css, /\.deck-detail-editor-host \.is-deck-inline/);
  assert.match(css, /\.deck-detail-tab svg/);
  assert.match(css, /justify-content: space-between/);
  assert.match(css, /\.deck-detail-modal \.deck-detail-actions[\s\S]+grid-auto-rows: 51px/);
  assert.match(css, /\.deck-detail-panel\[data-deck-panel="links"\][\s\S]+align-content: start/);
  assert.match(css, /\.deck-detail-modal \.detail-role-action[\s\S]+height: 51px/);
  assert.match(css, /\.deck-detail-modal\.is-compact-header \.deck-detail-header/);
  assert.match(css, /\.deck-detail-modal\.is-compact-header \.deck-detail-slide-strip[\s\S]+display: none/);
  assert.match(css, /\.interactions-status:empty \{ display: none; \}/);
  assert.match(css, /\.interactions-header,[\s\S]+display: none/);
  assert.match(css, /max-height: none/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /linear-gradient\(/);
});

test("Deck detail provides visual slide navigation and direct video editing without changing the show", () => {
  const html = read("public/home/index.html");
  const source = read("public/home/home.js");
  const css = read("public/home/deck-management-shell.css");

  assert.match(html, /id="detailSlideStrip"[^>]+aria-label="Miniaturas del deck"[^>]+hidden/);
  assert.match(html, /id="detailPreviousSlide"[^>]+aria-label="Ver slide anterior"/);
  assert.match(html, /id="detailNextSlide"[^>]+aria-label="Ver slide siguiente"/);
  assert.match(html, /id="detailVideoAction"[^>]+hidden/);
  assert.match(html, /home\.js\?v=\d+/);
  assert.match(source, /fetch\("\/decks\/" \+ encodeURIComponent\(deck\.deckId\) \+ "\/manifest\.json"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /slide\?\.thumb/);
  assert.match(source, /function selectDetailSlide\(index/);
  assert.match(source, /detailThumb\.replaceChildren\(renderDetailSlide\(navigation\.deck, navigation\.slides\[nextIndex\], nextIndex\)\)/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /immersa:deck-video-slide-request/);
  assert.match(source, /immersa:deck-videos-changed/);
  assert.match(source, /detailSlideStrip\?\.addEventListener\("wheel"/);
  assert.match(source, /passive: false/);
  assert.match(source, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowRight"/);
  assert.match(source, /detailSlidesRequestId/);
  assert.doesNotMatch(source, /slide_go|socket\.emit/);
  assert.match(css, /\.deck-detail-slide-strip[\s\S]+overflow-x: auto/);
  assert.match(css, /\.deck-detail-slide-strip[\s\S]+position: absolute[\s\S]+bottom: 0/);
  assert.match(css, /\.deck-detail-slide-strip[\s\S]+gap: 5px/);
  assert.match(css, /\.deck-detail-slide-strip[\s\S]+padding: 5px/);
  assert.match(css, /\.deck-detail-slide-thumb[\s\S]+flex: 0 0 88px[\s\S]+width: 88px/);
  assert.match(css, /\.deck-detail-slide-strip[\s\S]+background: rgba\(10, 10, 30, \.58\)/);
  assert.match(css, /\.deck-detail-slide-strip[\s\S]+backdrop-filter: blur\(12px\)/);
  assert.match(css, /\.deck-detail-slide-thumb \{[\s\S]+padding: 1px[\s\S]+background: rgba\(255, 255, 255, \.3\)/);
  assert.match(css, /\.deck-detail-slide-thumb\.is-active[\s\S]+padding: 2px[\s\S]+background: var\(--grad\)/);
  assert.match(css, /\.deck-detail-slide-arrow/);
  assert.match(css, /\.deck-detail-video-action/);
  assert.match(css, /\.deck-detail-slide-video-mark/);
  assert.match(html, /deck-management-shell\.css\?v=12/);
});

test("Direct video action reuses the current editor with the selected slide", () => {
  const shell = read("public/home/deck-management-shell.js");
  const videos = read("public/home/video-editor.js");
  const html = read("public/home/index.html");

  assert.match(shell, /immersa:deck-video-slide-request/);
  assert.match(shell, /ImmersaVideoEditor\?\.selectSlide\(slideId, event\.detail\?\.deck\?\.deckId\)/);
  assert.match(shell, /activateTab\("video", true\)/);
  assert.match(videos, /window\.ImmersaVideoEditor/);
  assert.match(videos, /selectSlide\(slideId, deckId\)/);
  assert.match(videos, /String\(currentDeck\.deckId\) !== String\(deckId \|\| ""\)/);
  assert.match(videos, /renderForm\(config\.videos\.find/);
  assert.match(videos, /else if \(selectedSlideId\) slideSelect\.value = selectedSlideId/);
  assert.match(videos, /immersa:deck-videos-changed/);
  assert.match(html, /video-editor\.js\?v=109/);
});

test("Deck access actions keep iPhone Speaker tabs and provide a clipboard fallback", () => {
  const source = read("public/home/home.js");

  assert.match(source, /speakerWindow = window\.open\("about:blank", "_blank"\)/);
  assert.match(source, /speakerWindow\.location\.replace\(url\)/);
  assert.match(source, /speakerWindow\.opener = null/);
  assert.match(source, /document\.execCommand\("copy"\)/);
  assert.match(source, /window\.prompt\("Copia este link:", value\)/);
  assert.doesNotMatch(source, /window\.open\(url, "_blank"/);
  assert.doesNotMatch(source, /setUploadStatus\("Error: " \+ \(error\.message \|\| "No se pudo generar el link/);
});

test("Deck pages use lists, bottom actions, and real local video thumbnails", () => {
  const interactions = read("public/home/interactions-editor.js");
  const interactionsCss = read("public/home/interactions-editor.css");
  const brands = read("public/home/brand-mentions-editor.js");
  const brandsCss = read("public/home/brand-mentions-editor.css");
  const videos = read("public/home/video-editor.js");
  const videosCss = read("public/home/video-editor.css");

  assert.match(interactions, /Disponibles para este deck/);
  assert.match(interactions, /interaction-module-list/);
  assert.doesNotMatch(interactions, /interaction-module-grid/);
  assert.match(interactions, /pollsButton\?\.after\(renderPollPanel\(\)\)/);
  assert.match(interactions, /activeModule = activeModule === kind \? null : kind/);
  assert.match(interactions, /renderKnowledgePanel\(category\)/);
  assert.doesNotMatch(interactions, /moduleCardMarkup\("raffles"/);
  assert.doesNotMatch(interactions, /moduleCardMarkup\("games"/);
  assert.match(interactions, /aria-expanded/);
  assert.match(interactions, /section\.appendChild\(makeButton\("Crear encuesta", "interactions-create-action"/);
  assert.doesNotMatch(interactions, /interaction-form-header"><span>Encuesta<\/span>/);
  assert.match(interactionsCss, /grid-template-columns: 42px minmax\(0, 1fr\) auto/);
  assert.match(interactionsCss, /\.interactions-create-action[\s\S]+background: var\(--grad\)/);

  assert.match(brands, /bodyNode\.appendChild\(list\)[\s\S]+bodyNode\.appendChild\(add\)/);
  assert.match(brandsCss, /aspect-ratio:4\/3/);

  assert.match(videos, /function captureFirstFrame\(file\)/);
  assert.match(videos, /canvas\.toDataURL\("image\/jpeg", \.76\)/);
  assert.match(videos, /video\?\.preview\?\.url/);
  assert.match(videos, /duration_seconds: sourceType === "local" \? selectedDuration : null/);
  assert.match(videos, /orderedVideos/);
  assert.match(videos, /image\.draggable = false/);
  assert.match(videos, /bodyNode\.appendChild\(add\)/);
  assert.match(videos, /Link de YouTube/);
  assert.match(videos, /parseYouTubeUrl/);
  assert.match(videos, /source_type/);
  assert.match(videosCss, /video-editor-item-thumbnail/);
  assert.match(videosCss, /video-editor-youtube/);
  assert.match(videosCss, /aspect-ratio:16\/9/);
  assert.match(videosCss, /pointer-events:none/);
});
