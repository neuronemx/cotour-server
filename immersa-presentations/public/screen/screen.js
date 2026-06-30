const params = new URLSearchParams(location.search);
const sessionId = params.get("session") || "demo01";
const deckId = params.get("deck") || "demo";
const socket = io();
let manifest = null;
let overlays = normalizeOverlayState();
const screenRoot = document.getElementById("screen");
const slide = document.getElementById("slide");
const qr = document.getElementById("qr");
const message = document.getElementById("message");
const audienceUrl = location.origin + "/audience?session=" + encodeURIComponent(sessionId) + "&deck=" + encodeURIComponent(deckId);
let activeAudienceUrl = audienceUrl;
document.getElementById("audienceUrl").textContent = activeAudienceUrl;
function normalizeOverlayState(next = {}) { const showReactions = next.showReactions ?? true; const showAudienceQr = next.showAudienceQr ?? next.qrVisible ?? false; return { ...next, showReactions, reactionsOnScreen: showReactions, showAudienceQr, qrVisible: showAudienceQr, messageVisible: Boolean(next.messageVisible), messageText: next.messageText || "" }; }
function makeQrPattern(text) { const grid = document.getElementById("qrPattern"); grid.innerHTML = ""; grid.classList.remove("qr-fallback"); document.getElementById("audienceUrl").textContent = text; if (window.QRCode) { new window.QRCode(grid, { text, width: 188, height: 188, colorDark: "#111111", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M }); return; } grid.textContent = text; grid.classList.add("qr-fallback"); }
async function loadDeck() { const res = await fetch("/decks/" + deckId + "/manifest.json"); manifest = await res.json(); }
function applySlideOrientation(item, src) { const portrait = item?.orientation === "portrait"; screenRoot.classList.toggle("portrait-slide", portrait); if (portrait) screenRoot.style.setProperty("--slide-bg", "url('" + src.replace(/'/g, "%27") + "')"); else screenRoot.style.removeProperty("--slide-bg"); }
function applyOverlays(next) { overlays = normalizeOverlayState({ ...overlays, ...next }); if (overlays.audienceUrl && overlays.audienceUrl !== activeAudienceUrl) { activeAudienceUrl = overlays.audienceUrl; makeQrPattern(activeAudienceUrl); } qr.classList.toggle("hidden", !overlays.showAudienceQr); message.textContent = overlays.messageText || ""; message.classList.toggle("hidden", !overlays.messageVisible || !overlays.messageText); }
function render(state) { const index = state.liveSlideIndex ?? state.slideIndex; const item = manifest.slides[index]; const src = "/decks/" + deckId + "/" + item.src; slide.src = src; applySlideOrientation(item, src); applyOverlays(state.overlays || {}); }
function popReaction(emoji) { if (!overlays.showReactions) return; const node = document.createElement("span"); node.className = "reaction"; node.textContent = emoji; node.style.left = Math.round(18 + Math.random() * 64) + "vw"; node.style.setProperty("--x", Math.round(Math.random() * 220 - 110) + "px"); document.getElementById("reactions").appendChild(node); setTimeout(() => node.remove(), 3100); }
socket.on("presentation_state", (state) => { if (manifest) render(state); });
socket.on("overlay_update", applyOverlays);
socket.on("clear_overlays", () => applyOverlays({ qrVisible: false, showAudienceQr: false, messageVisible: false, messageText: "" }));
socket.on("reaction", ({ emoji, target }) => { if (target === "audience") popReaction(emoji); });
makeQrPattern(activeAudienceUrl);
loadDeck().then(() => socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "screen" }));
