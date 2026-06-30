const params = new URLSearchParams(location.search);
const sessionId = params.get("session") || "demo01";
const deckId = params.get("deck") || "demo";
const socket = io();
let manifest = null;
let overlays = normalizeOverlayState();
const slide = document.getElementById("slide");
const current = document.getElementById("current");
const total = document.getElementById("total");
const audience = document.getElementById("audience");
const presenterStatus = document.getElementById("presenterStatus");
const streamStatus = document.getElementById("streamStatus");
const reactionsStatus = document.getElementById("reactionsStatus");
const qrStatus = document.getElementById("qrStatus");
const reactionsToggle = document.getElementById("reactionsToggle");
const qrToggle = document.getElementById("qrToggle");
const messageInput = document.getElementById("messageInput");
async function loadDeck() { const res = await fetch("/decks/" + deckId + "/manifest.json"); manifest = await res.json(); total.textContent = manifest.slides.length; }
function audienceUrl() { return window.location.origin + "/audience?session=" + encodeURIComponent(sessionId) + "&deck=" + encodeURIComponent(deckId); }
function normalizeOverlayState(next = {}) { const showReactions = next.showReactions ?? true; const showAudienceQr = next.showAudienceQr ?? next.qrVisible ?? false; return { ...next, showReactions, reactionsOnScreen: showReactions, showAudienceQr, qrVisible: showAudienceQr, messageVisible: Boolean(next.messageVisible), messageText: next.messageText || "" }; }
function setToggles() { overlays = normalizeOverlayState(overlays); reactionsToggle.checked = overlays.showReactions; qrToggle.checked = overlays.showAudienceQr; reactionsStatus.textContent = overlays.showReactions ? "On" : "Off"; qrStatus.textContent = overlays.showAudienceQr ? "Visible" : "Oculto"; }
function render(state) { overlays = normalizeOverlayState(state.overlays || overlays); setToggles(); const index = state.liveSlideIndex ?? state.slideIndex; const item = manifest.slides[index]; slide.src = "/decks/" + deckId + "/" + item.src; current.textContent = index + 1; audience.textContent = state.audienceCount || 0; presenterStatus.textContent = state.presenterConnected ? "Conectado" : "Desconectado"; streamStatus.textContent = state.transmissionPaused ? "Pausado" : "Activo"; }
function updateOverlay(patch) { overlays = normalizeOverlayState({ ...overlays, ...patch }); socket.emit("overlay_update", { overlays }); }
reactionsToggle.addEventListener("change", () => updateOverlay({ reactionsOnScreen: reactionsToggle.checked, showReactions: reactionsToggle.checked }));
qrToggle.addEventListener("change", () => updateOverlay({ qrVisible: qrToggle.checked, showAudienceQr: qrToggle.checked, audienceUrl: audienceUrl() }));
document.getElementById("messageForm").addEventListener("submit", (event) => { event.preventDefault(); const text = messageInput.value.trim(); if (text) updateOverlay({ messageVisible: true, messageText: text }); });
document.getElementById("clearMessage").addEventListener("click", () => { messageInput.value = ""; socket.emit("clear_message"); });
document.getElementById("clearScreen").addEventListener("click", () => { messageInput.value = ""; socket.emit("clear_screen"); });
socket.on("presentation_state", (state) => { if (manifest) render(state); });
socket.on("overlay_update", (next) => { overlays = normalizeOverlayState(next); setToggles(); });
socket.on("audience_count", (count) => { audience.textContent = count; });
loadDeck().then(() => socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "stage" }));
