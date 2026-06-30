const params = new URLSearchParams(location.search);
const sessionId = params.get("session") || "demo01";
const deckId = params.get("deck") || "demo";
const socket = io();
let manifest = null;
let currentSlideIndex = 0;
const slide = document.getElementById("slide");
const disconnect = document.getElementById("disconnect");
const snapshot = document.getElementById("snapshot");
async function loadDeck() { const res = await fetch("/decks/" + deckId + "/manifest.json"); manifest = await res.json(); }
function slideUrl(index) { const item = manifest.slides[index]; return "/decks/" + deckId + "/" + item.src; }
function render(state) { const index = state.liveSlideIndex ?? state.slideIndex; currentSlideIndex = Math.max(0, Math.min(index, manifest.slides.length - 1)); slide.src = slideUrl(currentSlideIndex); disconnect.classList.toggle("hidden", state.presenterConnected); }
function popReaction(emoji) { const node = document.createElement("span"); node.className = "reaction"; node.textContent = emoji; node.style.left = Math.round(15 + Math.random() * 70) + "vw"; document.getElementById("reactions").appendChild(node); setTimeout(() => node.remove(), 2700); }
function takeSnapshot() { if (!manifest) return; const url = slideUrl(currentSlideIndex); const filename = "immersa-slide-" + (currentSlideIndex + 1) + ".jpg"; if ("download" in HTMLAnchorElement.prototype) { const link = document.createElement("a"); link.href = url; link.download = filename; link.rel = "noopener"; document.body.appendChild(link); link.click(); link.remove(); return; } window.open(url, "_blank", "noopener"); }
document.querySelectorAll("[data-emoji]").forEach((button) => button.addEventListener("click", () => socket.emit("reaction", { emoji: button.dataset.emoji })));
snapshot.addEventListener("click", takeSnapshot);
socket.on("presentation_state", (state) => { if (manifest) render(state); });
socket.on("presenter_disconnected", () => disconnect.classList.remove("hidden"));
socket.on("presenter_connected", () => disconnect.classList.add("hidden"));
socket.on("reaction", ({ emoji, target }) => { if (target === "audience") popReaction(emoji); });
loadDeck().then(() => socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "audience" }));
