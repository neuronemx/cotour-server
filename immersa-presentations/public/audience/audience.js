const params = new URLSearchParams(location.search);
const sessionId = params.get("session") || "demo01";
const deckId = params.get("deck") || "demo";
const socket = io();
let manifest = null;
const slide = document.getElementById("slide");
const disconnect = document.getElementById("disconnect");
async function loadDeck() { const res = await fetch("/decks/" + deckId + "/manifest.json"); manifest = await res.json(); }
function render(state) { const index = state.liveSlideIndex ?? state.slideIndex; const item = manifest.slides[index]; slide.src = "/decks/" + deckId + "/" + item.src; disconnect.classList.toggle("hidden", state.presenterConnected); }
function popReaction(emoji) { const node = document.createElement("span"); node.className = "reaction"; node.textContent = emoji; node.style.left = Math.round(15 + Math.random() * 70) + "vw"; document.getElementById("reactions").appendChild(node); setTimeout(() => node.remove(), 2700); }
document.querySelectorAll("[data-emoji]").forEach((button) => button.addEventListener("click", () => socket.emit("reaction", { emoji: button.dataset.emoji })));
socket.on("presentation_state", (state) => { if (manifest) render(state); });
socket.on("presenter_disconnected", () => disconnect.classList.remove("hidden"));
socket.on("presenter_connected", () => disconnect.classList.add("hidden"));
socket.on("reaction", ({ emoji, target }) => { if (target === "audience") popReaction(emoji); });
loadDeck().then(() => socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "audience" }));
