const params = new URLSearchParams(location.search);
const roleOpenContext = window.IMMERSA_ROLE_OPEN || {};
const sessionId = params.get("session") || roleOpenContext.session || roleOpenContext.session_id || "demo01";
const deckId = params.get("deck") || roleOpenContext.deck || roleOpenContext.deckId || "demo";
const socket = io();
const overlaySocket = io();
let overlaySocketJoined = false;
let manifest = null;
let currentState = null;
let currentSlideIndex = 0;
let drawingOverlay = null;
let drawingMode = false;
const slide = document.getElementById("slide");
const presenterShell = document.querySelector(".presenter-shell");
const streamArea = document.querySelector(".stream-area");
const current = document.getElementById("current");
const total = document.getElementById("total");
const audience = document.getElementById("audience");
const playPause = document.getElementById("playPause");
const localReactions = document.getElementById("localReactions");
const audienceQr = document.getElementById("audienceQr");
const drawToggle = document.getElementById("drawToggle");
const fullscreenToggle = document.getElementById("fullscreenToggle");
const thumbsToggle = document.getElementById("thumbsToggle");
const thumbs = document.getElementById("thumbs");
const deckNotice = document.getElementById("deckNotice");
const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" class="pause-icon"><path d="M9 6V18"></path><path d="M15 6V18"></path></svg>';
const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" class="play-icon"><path d="M9 6L18 12L9 18Z"></path></svg>';
const compactLandscapeQuery = window.matchMedia ? window.matchMedia("(orientation: landscape) and (max-height: 520px)") : null;
function renderDeckNotice() {
  const pending = manifest && (manifest.status === "uploaded" || manifest.conversion?.status === "pending");
  deckNotice.hidden = !pending;
}
function legacyRoleUrl(role) { return location.origin + "/" + role + "?session=" + encodeURIComponent(sessionId) + "&deck=" + encodeURIComponent(deckId); }
function roleUrl(role) {
  if (role === "audience") return roleOpenContext.public_url || "";
  if (role === "screen" && roleOpenContext.screen_url) return roleOpenContext.screen_url;
  if (role === "stage" && roleOpenContext.stage_url) return roleOpenContext.stage_url;
  return legacyRoleUrl(role);
}
function audienceQrVisible(state) { return Boolean(state?.overlays?.showAudienceQr ?? state?.overlays?.qrVisible); }
function updateAudienceQrButton(state) { const active = audienceQrVisible(state); audienceQr.classList.toggle("is-active", active); audienceQr.classList.toggle("active", active); audienceQr.setAttribute("aria-pressed", String(active)); audienceQr.title = active ? "Ocultar QR de público" : "Mostrar QR de público"; }
function publishAudienceQr(visible) {
  const audienceUrl = roleUrl("audience");
  if (visible && !audienceUrl) return;
  if (!overlaySocketJoined) { overlaySocket.emit("join_presentation", { session: sessionId, deck: deckId, role: "stage" }); overlaySocketJoined = true; }
  overlaySocket.emit("overlay_update", { overlays: { showAudienceQr: visible, qrVisible: visible, audienceUrl } });
}

function getFullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
function isFullscreen() { return Boolean(getFullscreenElement()); }
function updateFullscreenButton() {
  if (!fullscreenToggle) return;
  const active = isFullscreen();
  fullscreenToggle.classList.toggle("is-active", active);
  fullscreenToggle.setAttribute("aria-pressed", String(active));
  fullscreenToggle.title = active ? "Salir de pantalla completa" : "Pantalla completa";
  fullscreenToggle.setAttribute("aria-label", fullscreenToggle.title);
}
function isCompactLandscape() { return Boolean(compactLandscapeQuery?.matches); }
function setThumbsPanelOpen(open) {
  if (!presenterShell || !thumbsToggle) return;
  const active = Boolean(open && isCompactLandscape());
  presenterShell.classList.toggle("thumbs-panel-open", active);
  thumbsToggle.classList.toggle("is-active", active);
  thumbsToggle.setAttribute("aria-expanded", String(active));
  thumbsToggle.title = active ? "Ocultar miniaturas" : "Mostrar miniaturas";
  thumbsToggle.setAttribute("aria-label", thumbsToggle.title);
}
function closeThumbsPanel() { setThumbsPanelOpen(false); }
function toggleThumbsPanel() { setThumbsPanelOpen(!presenterShell?.classList.contains("thumbs-panel-open")); }
function syncThumbsPanelMode() { if (!isCompactLandscape()) closeThumbsPanel(); }
async function toggleFullscreen() {
  if (!fullscreenToggle) return;
  try {
    if (isFullscreen()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      return;
    }
    const target = presenterShell || document.documentElement;
    if (target.requestFullscreen) await target.requestFullscreen();
    else if (target.webkitRequestFullscreen) await target.webkitRequestFullscreen();
  } catch (_error) {
    // Fullscreen is a progressive enhancement; keep Presenter usable if denied.
  } finally {
    updateFullscreenButton();
  }
}
document.getElementById("screenUrl").value = roleUrl("screen");
document.getElementById("stageUrl").value = roleUrl("stage");
document.getElementById("audienceUrl").value = roleUrl("audience");
async function loadDeck() { const res = await fetch("/decks/" + deckId + "/manifest.json"); manifest = await res.json(); renderDeckNotice(); total.textContent = manifest.slides.length; renderThumbs(); }
function assetSrc(item, kind = "src") { return "/decks/" + deckId + "/" + (kind === "thumb" && item.thumb ? item.thumb : item.src); }
function slideSrc(index) { return assetSrc(manifest.slides[index]); }
function applySlideOrientation(container, item, src) { const portrait = item?.orientation === "portrait"; container.classList.toggle("portrait-slide", portrait); if (portrait) container.style.setProperty("--slide-bg", "url('" + src.replace(/'/g, "%27") + "')"); else container.style.removeProperty("--slide-bg"); }
function renderThumbs() { thumbs.innerHTML = ""; manifest.slides.forEach((item, index) => { const slideNumber = index + 1; const button = document.createElement("button"); button.type = "button"; button.className = "thumb"; button.setAttribute("aria-label", "Ir a lámina " + slideNumber + (item.title ? ": " + item.title : "")); button.title = item.title ? "Lámina " + slideNumber + " · " + item.title : "Lámina " + slideNumber; button.innerHTML = '<span class="thumb-number">' + slideNumber + '</span><img alt="" src="' + assetSrc(item, "thumb") + '">'; button.addEventListener("click", () => { socket.emit("slide_go", { slideIndex: index }); closeThumbsPanel(); }); thumbs.appendChild(button); }); }
function render(state) { currentState = state; const index = state.presenterSlideIndex ?? state.slideIndex; currentSlideIndex = index; const item = manifest.slides[index]; const src = slideSrc(index); slide.src = src; applySlideOrientation(streamArea, item, src); drawingOverlay?.refresh(); current.textContent = index + 1; audience.textContent = state.audienceCount || 0; playPause.innerHTML = state.transmissionPaused ? playIcon : pauseIcon; playPause.classList.toggle("is-paused", state.transmissionPaused); playPause.title = state.transmissionPaused ? "Reanudar transmisión" : "Pausar transmisión"; playPause.setAttribute("aria-label", playPause.title); updateAudienceQrButton(state); document.querySelectorAll(".thumb").forEach((node, i) => { node.classList.toggle("active", i === index); node.classList.toggle("live", i === state.liveSlideIndex); }); }
function popReaction(emoji) { if (!localReactions.checked) return; const node = document.createElement("span"); node.className = "reaction"; node.textContent = emoji; node.style.left = Math.round(20 + Math.random() * 60) + "%"; node.style.setProperty("--x", Math.round(Math.random() * 240 - 120) + "px"); document.getElementById("reactions").appendChild(node); setTimeout(() => node.remove(), 2900); }
function updateDrawingMode() { if (!drawToggle) return; drawToggle.classList.toggle("is-active", drawingMode); drawToggle.classList.toggle("active", drawingMode); drawToggle.setAttribute("aria-pressed", String(drawingMode)); drawToggle.title = drawingMode ? "Desactivar dibujo" : "Dibujar sobre slide"; streamArea.classList.toggle("is-drawing", drawingMode); drawingOverlay?.setInteractive(drawingMode); }
function initDrawingOverlay() { if (drawingOverlay || !window.ImmersaDrawingOverlay) return; drawingOverlay = window.ImmersaDrawingOverlay.create({ root: streamArea, slide, getSlideIndex: () => currentSlideIndex, emitStroke: (stroke) => socket.emit("drawing_stroke", stroke), zIndex: 2 }); drawingOverlay.setInteractive(drawingMode); }
document.getElementById("prev").addEventListener("click", () => socket.emit("slide_prev"));
document.getElementById("next").addEventListener("click", () => socket.emit("slide_next"));
playPause.addEventListener("click", () => socket.emit(currentState?.transmissionPaused ? "transmission_play" : "transmission_pause"));
audienceQr.addEventListener("click", () => publishAudienceQr(!audienceQrVisible(currentState)));
if (drawToggle) drawToggle.addEventListener("click", () => { drawingMode = !drawingMode; updateDrawingMode(); });
if (fullscreenToggle) fullscreenToggle.addEventListener("click", toggleFullscreen);
if (thumbsToggle) thumbsToggle.addEventListener("click", toggleThumbsPanel);
if (compactLandscapeQuery?.addEventListener) compactLandscapeQuery.addEventListener("change", syncThumbsPanelMode);
else if (compactLandscapeQuery?.addListener) compactLandscapeQuery.addListener(syncThumbsPanelMode);
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
socket.on("presentation_state", (state) => { if (manifest) render(state); });
socket.on("audience_count", (count) => { audience.textContent = count; });
socket.on("reaction", ({ emoji, target }) => { if (target === "presenter") popReaction(emoji); });
syncThumbsPanelMode();
loadDeck().then(() => { initDrawingOverlay(); updateDrawingMode(); socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "presenter" }); });
