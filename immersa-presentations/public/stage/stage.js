const params = new URLSearchParams(location.search);
const sessionId = params.get("session") || "demo01";
const deckId = params.get("deck") || "demo";
const socket = io();
let manifest = null;
let overlays = { reactionsOnScreen: false, qrVisible: false };
const slide = document.getElementById("slide");
const current = document.getElementById("current");
const total = document.getElementById("total");
const audience = document.getElementById("audience");
const status = document.getElementById("status");
const reactionsToggle = document.getElementById("reactionsToggle");
const qrToggle = document.getElementById("qrToggle");
async function loadDeck() { const res = await fetch("/decks/" + deckId + "/manifest.json"); manifest = await res.json(); total.textContent = manifest.slides.length; }
function setToggles() { reactionsToggle.checked = !!overlays.reactionsOnScreen; qrToggle.checked = !!overlays.qrVisible; }
function render(state) { overlays = state.overlays || overlays; setToggles(); const item = manifest.slides[state.slideIndex]; slide.src = "/decks/" + deckId + "/" + item.src; current.textContent = state.slideIndex + 1; audience.textContent = state.audienceCount || 0; status.textContent = state.presenterConnected ? "Presenter en vivo" : "Presenter desconectado"; }
function updateOverlay(patch) { socket.emit("overlay_update", { overlays: { ...overlays, ...patch } }); }
reactionsToggle.addEventListener("change", () => updateOverlay({ reactionsOnScreen: reactionsToggle.checked }));
qrToggle.addEventListener("change", () => updateOverlay({ qrVisible: qrToggle.checked }));
document.getElementById("clear").addEventListener("click", () => socket.emit("clear_overlays"));
socket.on("presentation_state", (state) => { if (manifest) render(state); });
socket.on("overlay_update", (next) => { overlays = next; setToggles(); });
socket.on("audience_count", (count) => { audience.textContent = count; });
loadDeck().then(() => socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "stage" }));
