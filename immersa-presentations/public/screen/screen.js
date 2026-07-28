const params = new URLSearchParams(location.search);
const roleOpenContext = window.IMMERSA_ROLE_OPEN || {};
const sessionId = params.get("session") || roleOpenContext.session || roleOpenContext.session_id || "demo01";
const deckId = params.get("deck") || roleOpenContext.deck || roleOpenContext.deckId || "demo";
const socket = io();
let knowledgeActivityScreen = null;
try {
  knowledgeActivityScreen = window.ImmersaKnowledgeActivities?.createScreen({
    socket,
    root: document.getElementById("knowledgeActivityScreen")
  }) || null;
} catch (error) {
  console.error("Unable to initialize Screen knowledge activities", error);
}
let manifest = null;
let pendingPresentationState = null;
let manifestRetryTimer = null;
const screenRoot = document.getElementById("screen");
const fullscreenToggle = document.getElementById("fullscreenToggle");
let screenUiTimer = null;
const slide = document.getElementById("slide");
const qr = document.getElementById("qr");
const message = document.getElementById("message");
const qnaOverlay = document.getElementById("qnaOverlay");
const qnaQuestion = document.getElementById("qnaQuestion");
const qnaName = document.getElementById("qnaName");
const audienceUrl = roleOpenContext.public_url || "";
let activeAudienceUrl = audienceUrl;
let overlays = normalizeOverlayState();
let currentSlideIndex = 0;
let drawingOverlay = null;
let interactionOverlay = null;
document.getElementById("audienceUrl").textContent = activeAudienceUrl;
function normalizeOverlayState(next = {}) { const showReactions = next.showReactions ?? next.reactionsOnScreen ?? true; const showAudienceQr = next.showAudienceQr ?? next.qrVisible ?? false; return { ...next, showReactions, reactionsOnScreen: showReactions, showAudienceQr, qrVisible: showAudienceQr, audienceUrl: next.audienceUrl || activeAudienceUrl || audienceUrl, messageVisible: Boolean(next.messageVisible), messageText: next.messageText || "" }; }

function getFullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
function updateFullscreenButton() {
  const active = Boolean(getFullscreenElement());
  if (!fullscreenToggle) return;
  fullscreenToggle.classList.toggle("is-active", active);
  fullscreenToggle.setAttribute("aria-pressed", String(active));
  fullscreenToggle.title = active ? "Salir de pantalla completa" : "Pantalla completa";
  fullscreenToggle.setAttribute("aria-label", fullscreenToggle.title);
}
function showScreenUi() {
  screenRoot.classList.add("ui-visible");
  clearTimeout(screenUiTimer);
  screenUiTimer = setTimeout(() => {
    screenRoot.classList.remove("ui-visible");
    if (fullscreenToggle) fullscreenToggle.blur();
  }, 2200);
}
async function toggleFullscreen() {
  try {
    if (getFullscreenElement()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
    } else if (screenRoot.requestFullscreen) {
      await screenRoot.requestFullscreen();
    } else if (screenRoot.webkitRequestFullscreen) {
      await screenRoot.webkitRequestFullscreen();
    }
  } catch (error) {
    console.warn("Fullscreen request failed", error);
  } finally {
    updateFullscreenButton();
    if (fullscreenToggle) fullscreenToggle.blur();
    showScreenUi();
  }
}

function makeQrPattern(text) { const grid = document.getElementById("qrPattern"); grid.innerHTML = ""; grid.classList.remove("qr-fallback"); document.getElementById("audienceUrl").textContent = text; if (!text) return; if (window.QRCode) { new window.QRCode(grid, { text, width: 188, height: 188, colorDark: "#111111", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M }); return; } grid.textContent = text; grid.classList.add("qr-fallback"); }
async function loadDeck() {
  const res = await fetch("/decks/" + encodeURIComponent(deckId) + "/manifest.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Screen manifest unavailable (" + res.status + ")");
  const nextManifest = await res.json();
  if (!Array.isArray(nextManifest?.slides) || !nextManifest.slides.length) {
    throw new Error("Screen manifest has no slides");
  }
  manifest = nextManifest;
  if (pendingPresentationState) render(pendingPresentationState);
  return manifest;
}
function loadDeckWithRetry(attempt = 0) {
  loadDeck().catch((error) => {
    if (attempt >= 3) {
      console.error("Unable to load Screen deck", error);
      return;
    }
    clearTimeout(manifestRetryTimer);
    manifestRetryTimer = setTimeout(() => loadDeckWithRetry(attempt + 1), 350 * (attempt + 1));
  });
}
function applySlideOrientation(item, src) { const portrait = item?.orientation === "portrait"; screenRoot.classList.toggle("portrait-slide", portrait); if (portrait) screenRoot.style.setProperty("--slide-bg", "url('" + src.replace(/'/g, "%27") + "')"); else screenRoot.style.removeProperty("--slide-bg"); }
function applyOverlays(next) { overlays = normalizeOverlayState({ ...overlays, ...next }); if (overlays.audienceUrl !== activeAudienceUrl) { activeAudienceUrl = overlays.audienceUrl || ""; makeQrPattern(activeAudienceUrl); } qr.classList.toggle("hidden", !overlays.showAudienceQr || !activeAudienceUrl); message.textContent = overlays.messageText || ""; message.classList.toggle("hidden", !overlays.messageVisible || !overlays.messageText); }
function render(state) {
  pendingPresentationState = state;
  applyOverlays(state?.overlays || {});
  if (!manifest?.slides?.length) return;
  const index = state?.liveSlideIndex ?? state?.slideIndex ?? 0;
  const item = manifest.slides[index];
  if (!item?.src) return;
  currentSlideIndex = index;
  const src = "/decks/" + encodeURIComponent(deckId) + "/" + String(item.src).replace(/^\/+/, "");
  slide.src = src;
  applySlideOrientation(item, src);
  drawingOverlay?.refresh();
}
function popReaction(emoji) { if (!overlays.showReactions) return; const node = document.createElement("span"); node.className = "reaction"; node.textContent = emoji; node.style.left = Math.round(18 + Math.random() * 64) + "vw"; node.style.setProperty("--x", Math.round(Math.random() * 220 - 110) + "px"); document.getElementById("reactions").appendChild(node); setTimeout(() => node.remove(), 3100); }
function initDrawingOverlay() { if (drawingOverlay || !window.ImmersaDrawingOverlay) return; drawingOverlay = window.ImmersaDrawingOverlay.create({ root: screenRoot, slide, getSlideIndex: () => currentSlideIndex, zIndex: 2 }); }
function ensureInteractionOverlay() { if (interactionOverlay) return interactionOverlay; interactionOverlay = document.createElement("section"); interactionOverlay.className = "interaction-results-overlay interaction-hidden"; interactionOverlay.setAttribute("aria-label", "Resultados de interacción"); screenRoot.appendChild(interactionOverlay); return interactionOverlay; }
function renderResultRows(results) { return '<div class="interaction-results-list">' + results.options.map((option) => '<div class="interaction-result-row"><div class="interaction-result-label"><span>' + option.label + '</span><strong>' + option.percentage + '%</strong></div><div class="interaction-result-bar"><span style="width:' + option.percentage + '%"></span></div></div>').join("") + '</div>'; }
function showInteractionResults(results) { if (!results) return; const overlay = ensureInteractionOverlay(); overlay.classList.remove("interaction-hidden"); overlay.innerHTML = '<h2>' + (results.title || 'Resultados') + '</h2><p>' + (results.prompt || '') + '</p>' + renderResultRows(results); }
function hideInteractionResults() { ensureInteractionOverlay().classList.add("interaction-hidden"); }
function renderQnaScreen(payload = {}) {
  const question = payload.visible ? payload.question : null;
  const text = String(question?.text || "").trim();
  if (!question || !text) {
    qnaOverlay.hidden = true;
    qnaQuestion.textContent = "";
    qnaName.textContent = "";
    qnaName.hidden = true;
    return;
  }
  const name = String(question.name || "").trim();
  qnaQuestion.textContent = text;
  qnaName.textContent = name;
  qnaName.hidden = !name;
  qnaOverlay.hidden = false;
}

if (fullscreenToggle) fullscreenToggle.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const tagName = String(event.target?.tagName || "").toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select" || event.target?.isContentEditable) return;
  if (event.key === "ArrowRight") {
    event.preventDefault();
    if (socket.connected !== false) (socket.volatile || socket).emit("slide_next");
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (socket.connected !== false) (socket.volatile || socket).emit("slide_prev");
  }
});
["mousemove", "mousedown", "touchstart", "pointermove"].forEach((eventName) => {
  screenRoot.addEventListener(eventName, showScreenUi, { passive: true });
});
showScreenUi();

socket.on("presentation_state", render);
socket.on("overlay_update", applyOverlays);
socket.on("clear_overlays", () => applyOverlays({ qrVisible: false, showAudienceQr: false, messageVisible: false, messageText: "" }));
socket.on("reaction", ({ emoji, target }) => { if (target === "screen") popReaction(emoji); });
socket.on("drawing_stroke", (stroke) => drawingOverlay?.addStroke(stroke));
socket.on("interaction:show_results", showInteractionResults);
socket.on("interaction:hide_results", hideInteractionResults);
socket.on("interaction:closed", hideInteractionResults);
socket.on("qna:screen", renderQnaScreen);
makeQrPattern(activeAudienceUrl);
socket.on("connect", () => {
  socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "screen" });
});
if (socket.connected) {
  socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "screen" });
}
loadDeckWithRetry();
initDrawingOverlay();
