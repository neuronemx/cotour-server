const params = new URLSearchParams(location.search);
const sessionId = params.get("session") || "demo01";
const deckId = params.get("deck") || "demo";
const socket = io();
let manifest = null;
let currentState = null;
const slide = document.getElementById("slide");
const current = document.getElementById("current");
const total = document.getElementById("total");
const audience = document.getElementById("audience");
const playPause = document.getElementById("playPause");
const streamStatus = document.getElementById("streamStatus");
const localReactions = document.getElementById("localReactions");
function roleUrl(role) { return location.origin + "/" + role + "?session=" + encodeURIComponent(sessionId) + "&deck=" + encodeURIComponent(deckId); }
document.getElementById("screenUrl").value = roleUrl("screen");
document.getElementById("stageUrl").value = roleUrl("stage");
document.getElementById("audienceUrl").value = roleUrl("audience");
async function loadDeck() { const res = await fetch("/decks/" + deckId + "/manifest.json"); manifest = await res.json(); total.textContent = manifest.slides.length; renderThumbs(); }
function slideSrc(index) { return "/decks/" + deckId + "/" + manifest.slides[index].src; }
function renderThumbs() { const thumbs = document.getElementById("thumbs"); thumbs.innerHTML = ""; manifest.slides.forEach((item, index) => { const button = document.createElement("button"); button.type = "button"; button.className = "thumb"; button.innerHTML = '<img alt="" src="' + slideSrc(index) + '"><strong>' + (index + 1) + '. ' + item.title + '</strong>'; button.addEventListener("click", () => socket.emit("slide_go", { slideIndex: index })); thumbs.appendChild(button); }); }
function render(state) { currentState = state; const index = state.presenterSlideIndex ?? state.slideIndex; slide.src = slideSrc(index); current.textContent = index + 1; audience.textContent = state.audienceCount || 0; playPause.textContent = state.transmissionPaused ? "▶" : "⏸"; playPause.classList.toggle("is-paused", state.transmissionPaused); playPause.title = state.transmissionPaused ? "Reanudar transmisión" : "Pausar transmisión"; playPause.setAttribute("aria-label", playPause.title); if (streamStatus) { streamStatus.textContent = state.transmissionPaused ? "Pausado" : "Transmitiendo"; streamStatus.classList.toggle("is-paused", state.transmissionPaused); } document.querySelectorAll(".thumb").forEach((node, i) => { node.classList.toggle("active", i === index); node.classList.toggle("live", i === state.liveSlideIndex); }); }
function popReaction(emoji) { if (!localReactions.checked) return; const node = document.createElement("span"); node.className = "reaction"; node.textContent = emoji; node.style.left = Math.round(20 + Math.random() * 60) + "%"; node.style.setProperty("--x", Math.round(Math.random() * 240 - 120) + "px"); document.getElementById("reactions").appendChild(node); setTimeout(() => node.remove(), 2900); }
document.getElementById("prev").addEventListener("click", () => socket.emit("slide_prev"));
document.getElementById("next").addEventListener("click", () => socket.emit("slide_next"));
playPause.addEventListener("click", () => socket.emit(currentState?.transmissionPaused ? "transmission_play" : "transmission_pause"));
socket.on("presentation_state", (state) => { if (manifest) render(state); });
socket.on("audience_count", (count) => { audience.textContent = count; });
socket.on("reaction", ({ emoji, target }) => { if (target === "presenter") popReaction(emoji); });
loadDeck().then(() => socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "presenter" }));
