const params = new URLSearchParams(location.search);
const sessionId = params.get("session") || "demo01";
const deckId = params.get("deck") || "demo";
const socket = io();
let manifest = null;
let overlays = { reactionsOnScreen: false, qrVisible: false };
const slide = document.getElementById("slide");
const disconnect = document.getElementById("disconnect");
const qr = document.getElementById("qr");
const audienceUrl = location.origin + "/audience?session=" + encodeURIComponent(sessionId) + "&deck=" + encodeURIComponent(deckId);
document.getElementById("audienceUrl").textContent = audienceUrl;
function makeQrPattern(text) { const grid = document.getElementById("qrPattern"); grid.innerHTML = ""; let seed = 0; for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0; for (let i = 0; i < 289; i++) { const bit = ((seed >> (i % 24)) ^ i ^ Math.floor(i / 17)) & 1; const cell = document.createElement("span"); if (bit || i < 54 && (i % 17 < 6 || i % 17 > 10)) { const ink = document.createElement("i"); cell.appendChild(ink); } grid.appendChild(cell); } }
async function loadDeck() { const res = await fetch("/decks/" + deckId + "/manifest.json"); manifest = await res.json(); }
function applyOverlays(next) { overlays = { ...overlays, ...next }; qr.classList.toggle("hidden", !overlays.qrVisible); }
function render(state) { const item = manifest.slides[state.slideIndex]; slide.src = "/decks/" + deckId + "/" + item.src; disconnect.classList.toggle("hidden", state.presenterConnected); applyOverlays(state.overlays || {}); }
function popReaction(emoji) { if (!overlays.reactionsOnScreen) return; const node = document.createElement("span"); node.className = "reaction"; node.textContent = emoji; node.style.left = Math.round(18 + Math.random() * 64) + "vw"; node.style.setProperty("--x", Math.round(Math.random() * 220 - 110) + "px"); document.getElementById("reactions").appendChild(node); setTimeout(() => node.remove(), 3100); }
socket.on("presentation_state", (state) => { if (manifest) render(state); });
socket.on("presenter_disconnected", () => disconnect.classList.remove("hidden"));
socket.on("presenter_connected", () => disconnect.classList.add("hidden"));
socket.on("overlay_update", applyOverlays);
socket.on("clear_overlays", () => applyOverlays({ reactionsOnScreen: false, qrVisible: false }));
socket.on("reaction", ({ emoji, target }) => { if (target === "screen") popReaction(emoji); });
makeQrPattern(audienceUrl);
loadDeck().then(() => socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "screen" }));
