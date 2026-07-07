const params = new URLSearchParams(location.search);
const roleOpenContext = window.IMMERSA_ROLE_OPEN || {};
const sessionId = params.get("session") || roleOpenContext.session || roleOpenContext.session_id || "demo01";
const deckId = params.get("deck") || roleOpenContext.deck || roleOpenContext.deckId || "demo";
const socket = io();
let manifest = null;
const screenRoot = document.getElementById("screen");
const fullscreenToggle = document.getElementById("fullscreenToggle");
let screenUiTimer = null;
const slide = document.getElementById("slide");
const qr = document.getElementById("qr");
const message = document.getElementById("message");
const audienceUrl = roleOpenContext.public_url || "";
let activeAudienceUrl = audienceUrl;
let overlays = normalizeOverlayState();
let currentSlideIndex = 0;
let drawingOverlay = null;
let interactionOverlay = null;
document.getElementById("audienceUrl").textContent = activeAudienceUrl;
function normalizeOverlayState(next = {}) { const showReactions = next.showReactions ?? next.reactionsOnScreen ?? true; const showAudienceQr = next.showAudienceQr ?? next.qrVisible ?? false; return { ...next, showReactions, reactionsOnScreen: showReactions, showAudienceQr, qrVisible: showAudienceQr, audienceUrl: next.audienceUrl || activeAudienceUrl || audienceUrl, messageVisible: Boolean(next.messageVisible), messageText: next.messageText || "" }; }

function updateFullscreenButton() {
  const active = Boolean(document.fullscreenElement);
  if (!fullscreenToggle) return;
  fullscreenToggle.classList.toggle("is-active", active);
  fullscreenToggle.textContent = active ? "×" : "⛶";
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
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (screenRoot.requestFullscreen) await screenRoot.requestFullscreen();
  } catch (error) {
    console.warn("Fullscreen request failed", error);
  } finally {
    updateFullscreenButton();
    if (fullscreenToggle) fullscreenToggle.blur();
    showScreenUi();
  }
}

function makeQrPattern(text) { const grid = document.getElementById("qrPattern"); grid.innerHTML = ""; grid.classList.remove("qr-fallback"); document.getElementById("audienceUrl").textContent = text; if (!text) return; if (window.QRCode) { new window.QRCode(grid, { text, width: 188, height: 188, colorDark: "#111111", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M }); return; } grid.textContent = text; grid.classList.add("qr-fallback"); }
async function loadDeck() { const res = await fetch("/decks/" + deckId + "/manifest.json"); manifest = await res.json(); }
function applySlideOrientation(item, src) { const portrait = item?.orientation === "portrait"; screenRoot.classList.toggle("portrait-slide", portrait); if (portrait) screenRoot.style.setProperty("--slide-bg", "url('" + src.replace(/'/g, "%27") + "')"); else screenRoot.style.removeProperty("--slide-bg"); }
function applyOverlays(next) { overlays = normalizeOverlayState({ ...overlays, ...next }); if (overlays.audienceUrl !== activeAudienceUrl) { activeAudienceUrl = overlays.audienceUrl || ""; makeQrPattern(activeAudienceUrl); } qr.classList.toggle("hidden", !overlays.showAudienceQr || !activeAudienceUrl); message.textContent = overlays.messageText || ""; message.classList.toggle("hidden", !overlays.messageVisible || !overlays.messageText); }
function render(state) { const index = state.liveSlideIndex ?? state.slideIndex; currentSlideIndex = index; const item = manifest.slides[index]; const src = "/decks/" + deckId + "/" + item.src; slide.src = src; applySlideOrientation(item, src); applyOverlays(state.overlays || {}); drawingOverlay?.refresh(); }
function popReaction(emoji) { if (!overlays.showReactions) return; const node = document.createElement("span"); node.className = "reaction"; node.textContent = emoji; node.style.left = Math.round(18 + Math.random() * 64) + "vw"; node.style.setProperty("--x", Math.round(Math.random() * 220 - 110) + "px"); document.getElementById("reactions").appendChild(node); setTimeout(() => node.remove(), 3100); }
function initDrawingOverlay() { if (drawingOverlay || !window.ImmersaDrawingOverlay) return; drawingOverlay = window.ImmersaDrawingOverlay.create({ root: screenRoot, slide, getSlideIndex: () => currentSlideIndex, zIndex: 2 }); }
function ensureInteractionOverlay() { if (interactionOverlay) return interactionOverlay; interactionOverlay = document.createElement("section"); interactionOverlay.className = "interaction-results-overlay interaction-hidden"; interactionOverlay.setAttribute("aria-label", "Resultados de interacción"); screenRoot.appendChild(interactionOverlay); return interactionOverlay; }
function renderResultRows(results) { return '<div class="interaction-results-list">' + results.options.map((option) => '<div class="interaction-result-row"><div class="interaction-result-label"><span>' + option.label + '</span><strong>' + option.percentage + '%</strong></div><div class="interaction-result-bar"><span style="width:' + option.percentage + '%"></span></div></div>').join("") + '</div>'; }
function showInteractionResults(results) { if (!results) return; const overlay = ensureInteractionOverlay(); overlay.classList.remove("interaction-hidden"); overlay.innerHTML = '<h2>' + (results.title || 'Resultados') + '</h2><p>' + (results.prompt || '') + '</p>' + renderResultRows(results); }
function hideInteractionResults() { ensureInteractionOverlay().classList.add("interaction-hidden"); }

if (fullscreenToggle) fullscreenToggle.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFullscreenButton);
["mousemove", "mousedown", "touchstart", "pointermove"].forEach((eventName) => {
  screenRoot.addEventListener(eventName, showScreenUi, { passive: true });
});
showScreenUi();

socket.on("presentation_state", (state) => { if (manifest) render(state); });
socket.on("overlay_update", applyOverlays);
socket.on("clear_overlays", () => applyOverlays({ qrVisible: false, showAudienceQr: false, messageVisible: false, messageText: "" }));
socket.on("reaction", ({ emoji, target }) => { if (target === "screen") popReaction(emoji); });
socket.on("drawing_stroke", (stroke) => drawingOverlay?.addStroke(stroke));
socket.on("interaction:show_results", showInteractionResults);
socket.on("interaction:hide_results", hideInteractionResults);
socket.on("interaction:closed", hideInteractionResults);
makeQrPattern(activeAudienceUrl);
loadDeck().then(() => { initDrawingOverlay(); socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "screen" }); });
