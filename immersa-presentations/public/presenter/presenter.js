const params = new URLSearchParams(location.search);
const sessionId = params.get("session") || "demo01";
const deckId = params.get("deck") || "demo";
const publicId = params.get("public_id") || "";
const screenAccessToken = params.get("screen_access_token") || "";
const stageAccessToken = params.get("stage_access_token") || "";
const socket = io();
const overlaySocket = io();
let overlaySocketJoined = false;
let manifest = null;
let currentState = null;
const slide = document.getElementById("slide");
const presenterShell = document.querySelector(".presenter-shell");
const streamArea = document.querySelector(".stream-area");
const current = document.getElementById("current");
const total = document.getElementById("total");
const audience = document.getElementById("audience");
const playPause = document.getElementById("playPause");
const localReactions = document.getElementById("localReactions");
const audienceQr = document.getElementById("audienceQr");
const fullscreenToggle = document.getElementById("fullscreenToggle");
const deckNotice = document.getElementById("deckNotice");
const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" class="pause-icon"><path d="M9 6V18"></path><path d="M15 6V18"></path></svg>';
const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" class="play-icon"><path d="M9 6L18 12L9 18Z"></path></svg>';
function renderDeckNotice() {
  const pending = manifest && (manifest.status === "uploaded" || manifest.conversion?.status === "pending");
  deckNotice.hidden = !pending;
}
function legacyRoleUrl(role) { return location.origin + "/" + role + "?session=" + encodeURIComponent(sessionId) + "&deck=" + encodeURIComponent(deckId); }
function roleUrl(role) {
  if (role === "audience" && publicId) return location.origin + "/" + encodeURIComponent(publicId);
  if (role === "screen" && screenAccessToken) return location.origin + "/screen/" + encodeURIComponent(screenAccessToken);
  if (role === "stage" && stageAccessToken) return location.origin + "/stage/" + encodeURIComponent(stageAccessToken);
  return legacyRoleUrl(role);
}
function audienceQrVisible(state) { return Boolean(state?.overlays?.showAudienceQr ?? state?.overlays?.qrVisible); }
function updateAudienceQrButton(state) { const active = audienceQrVisible(state); audienceQr.classList.toggle("is-active", active); audienceQr.classList.toggle("active", active); audienceQr.setAttribute("aria-pressed", String(active)); audienceQr.title = active ? "Ocultar QR de audiencia" : "Mostrar QR de audiencia"; }
function publishAudienceQr(visible) { if (!overlaySocketJoined) { overlaySocket.emit("join_presentation", { session: sessionId, deck: deckId, role: "stage" }); overlaySocketJoined = true; } overlaySocket.emit("overlay_update", { overlays: { showAudienceQr: visible, qrVisible: visible, audienceUrl: roleUrl("audience") } }); }

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
function renderThumbs() { const thumbs = document.getElementById("thumbs"); thumbs.innerHTML = ""; manifest.slides.forEach((item, index) => { const slideNumber = index + 1; const button = document.createElement("button"); button.type = "button"; button.className = "thumb"; button.setAttribute("aria-label", "Ir a lámina " + slideNumber + (item.title ? ": " + item.title : "")); button.title = item.title ? "Lámina " + slideNumber + " · " + item.title : "Lámina " + slideNumber; button.innerHTML = '<span class="thumb-number">' + slideNumber + '</span><img alt="" src="' + assetSrc(item, "thumb") + '">'; button.addEventListener("click", () => socket.emit("slide_go", { slideIndex: index })); thumbs.appendChild(button); }); }
function render(state) { currentState = state; const index = state.presenterSlideIndex ?? state.slideIndex; const item = manifest.slides[index]; const src = slideSrc(index); slide.src = src; applySlideOrientation(streamArea, item, src); current.textContent = index + 1; audience.textContent = state.audienceCount || 0; playPause.innerHTML = state.transmissionPaused ? playIcon : pauseIcon; playPause.classList.toggle("is-paused", state.transmissionPaused); playPause.title = state.transmissionPaused ? "Reanudar transmisión" : "Pausar transmisión"; playPause.setAttribute("aria-label", playPause.title); updateAudienceQrButton(state); document.querySelectorAll(".thumb").forEach((node, i) => { node.classList.toggle("active", i === index); node.classList.toggle("live", i === state.liveSlideIndex); }); }
function popReaction(emoji) { if (!localReactions.checked) return; const node = document.createElement("span"); node.className = "reaction"; node.textContent = emoji; node.style.left = Math.round(20 + Math.random() * 60) + "%"; node.style.setProperty("--x", Math.round(Math.random() * 240 - 120) + "px"); document.getElementById("reactions").appendChild(node); setTimeout(() => node.remove(), 2900); }
document.getElementById("prev").addEventListener("click", () => socket.emit("slide_prev"));
document.getElementById("next").addEventListener("click", () => socket.emit("slide_next"));
playPause.addEventListener("click", () => socket.emit(currentState?.transmissionPaused ? "transmission_play" : "transmission_pause"));
audienceQr.addEventListener("click", () => publishAudienceQr(!audienceQrVisible(currentState)));
if (fullscreenToggle) fullscreenToggle.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
socket.on("presentation_state", (state) => { if (manifest) render(state); });
socket.on("audience_count", (count) => { audience.textContent = count; });
socket.on("reaction", ({ emoji, target }) => { if (target === "presenter") popReaction(emoji); });
loadDeck().then(() => socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "presenter" }));
