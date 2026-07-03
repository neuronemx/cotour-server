const params = new URLSearchParams(location.search);
const publicOpenContext = window.IMMERSA_PUBLIC_OPEN || {};
const sessionId = params.get("session") || publicOpenContext.session || "demo01";
const deckId = params.get("deck") || publicOpenContext.deck || "demo";
const socket = io();
let manifest = null;
let currentSlideIndex = 0;
let zoom = 1;
let panX = 0;
let panY = 0;
let lastTapAt = 0;
let startZoom = 1;
let startPanX = 0;
let startPanY = 0;
let startDistance = 0;
let startCenter = null;
let drawingOverlay = null;
const pointers = new Map();
const viewer = document.getElementById("viewer");
const viewport = document.getElementById("slideViewport");
const slide = document.getElementById("slide");
const snapshot = document.getElementById("snapshot");
const fullscreen = document.getElementById("fullscreen");
const connectionNotice = document.getElementById("connectionNotice");
const liveMessage = document.getElementById("liveMessage");
async function loadDeck() { const res = await fetch("/decks/" + deckId + "/manifest.json"); manifest = await res.json(); }
function slideUrl(index) { const item = manifest.slides[index]; return "/decks/" + deckId + "/" + item.src; }
function applySlideOrientation(item, src) { const portrait = item?.orientation === "portrait"; viewport.classList.toggle("portrait-slide", portrait); if (portrait) viewport.style.setProperty("--slide-bg", "url('" + src.replace(/'/g, "%27") + "')"); else viewport.style.removeProperty("--slide-bg"); }
function clamp(value, min, max) { return Math.max(min, Math.min(value, max)); }
function applyTransform() { slide.style.setProperty("--zoom", zoom); slide.style.setProperty("--pan-x", panX + "px"); slide.style.setProperty("--pan-y", panY + "px"); drawingOverlay?.refresh(); }
function resetZoom() { zoom = 1; panX = 0; panY = 0; applyTransform(); }
function applyLiveMessage(overlays = {}) { if (!liveMessage) return; const text = overlays.messageText || ""; const visible = Boolean(overlays.messageVisible && text); liveMessage.textContent = visible ? text : ""; liveMessage.classList.toggle("hidden", !visible); }
function render(state) { const index = state.liveSlideIndex ?? state.slideIndex; const nextIndex = Math.max(0, Math.min(index, manifest.slides.length - 1)); if (nextIndex !== currentSlideIndex) resetZoom(); currentSlideIndex = nextIndex; const item = manifest.slides[currentSlideIndex]; const src = slideUrl(currentSlideIndex); slide.src = src; applySlideOrientation(item, src); applyLiveMessage(state.overlays || {}); drawingOverlay?.refresh(); }
function popReaction(emoji) { const node = document.createElement("span"); node.className = "reaction"; node.textContent = emoji; node.style.left = Math.round(15 + Math.random() * 70) + "vw"; document.getElementById("reactions").appendChild(node); setTimeout(() => node.remove(), 2700); }
function takeSnapshot() { if (!manifest) return; const url = slideUrl(currentSlideIndex); const filename = "immersa-slide-" + (currentSlideIndex + 1) + ".jpg"; if ("download" in HTMLAnchorElement.prototype) { const link = document.createElement("a"); link.href = url; link.download = filename; link.rel = "noopener"; document.body.appendChild(link); link.click(); link.remove(); return; } window.open(url, "_blank", "noopener"); }
function distance(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
function center(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }
function pointerList() { return Array.from(pointers.values()); }
function beginGesture() { const active = pointerList(); startZoom = zoom; startPanX = panX; startPanY = panY; if (active.length >= 2) { startDistance = distance(active[0], active[1]); startCenter = center(active[0], active[1]); } else { startDistance = 0; startCenter = active[0] ? { x: active[0].clientX, y: active[0].clientY } : null; } }
function handlePointerDown(event) { viewport.setPointerCapture(event.pointerId); pointers.set(event.pointerId, event); beginGesture(); }
function handlePointerMove(event) { if (!pointers.has(event.pointerId)) return; pointers.set(event.pointerId, event); const active = pointerList(); if (active.length >= 2 && startDistance > 0) { const nextCenter = center(active[0], active[1]); zoom = clamp(startZoom * (distance(active[0], active[1]) / startDistance), 1, 3); panX = startPanX + (nextCenter.x - startCenter.x); panY = startPanY + (nextCenter.y - startCenter.y); if (zoom === 1) { panX = 0; panY = 0; } applyTransform(); return; } if (active.length === 1 && zoom > 1 && startCenter) { panX = startPanX + (active[0].clientX - startCenter.x); panY = startPanY + (active[0].clientY - startCenter.y); applyTransform(); } }
function handlePointerUp(event) { pointers.delete(event.pointerId); if (pointers.size) beginGesture(); const now = Date.now(); if (now - lastTapAt < 280) { resetZoom(); lastTapAt = 0; } else { lastTapAt = now; } }
async function toggleFullscreen() { try { if (document.fullscreenElement) { await document.exitFullscreen(); return; } if (viewer.requestFullscreen) { await viewer.requestFullscreen(); if (screen.orientation?.lock) screen.orientation.lock("landscape").catch(() => {}); } } catch (_error) {} }
function updateFullscreenButton() {
  const active = Boolean(document.fullscreenElement);
  fullscreen.textContent = active ? "×" : "⛶";
  fullscreen.classList.toggle("is-active", active);
  fullscreen.setAttribute("aria-label", active ? "Salir de pantalla completa" : "Pantalla completa");
  fullscreen.title = active ? "Salir de pantalla completa" : "Pantalla completa";
}
function setConnectionNotice(visible) {
  if (!connectionNotice) return;
  connectionNotice.classList.toggle("hidden", !visible);
}
function joinAudience() {
  if (!manifest) return;
  socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "audience" });
}
function initDrawingOverlay() { if (drawingOverlay || !window.ImmersaDrawingOverlay) return; drawingOverlay = window.ImmersaDrawingOverlay.create({ root: viewport, slide, getSlideIndex: () => currentSlideIndex, zIndex: 2 }); }
document.querySelectorAll("[data-emoji]").forEach((button) => button.addEventListener("click", () => socket.emit("reaction", { emoji: button.dataset.emoji })));
snapshot.addEventListener("click", takeSnapshot);
fullscreen.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFullscreenButton);
viewport.addEventListener("pointerdown", handlePointerDown);
viewport.addEventListener("pointermove", handlePointerMove);
viewport.addEventListener("pointerup", handlePointerUp);
viewport.addEventListener("pointercancel", handlePointerUp);
socket.on("connect", () => { setConnectionNotice(false); joinAudience(); });
socket.on("disconnect", () => setConnectionNotice(true));
socket.io?.on?.("reconnect", () => { setConnectionNotice(false); joinAudience(); });
socket.io?.on?.("reconnect_error", () => setConnectionNotice(true));
socket.io?.on?.("reconnect_failed", () => setConnectionNotice(true));
socket.on("presentation_state", (state) => { if (manifest) render(state); });
socket.on("overlay_update", applyLiveMessage);
socket.on("clear_overlays", () => applyLiveMessage({ messageVisible: false, messageText: "" }));
socket.on("reaction", ({ emoji, target }) => { if (target === "audience") popReaction(emoji); });
socket.on("drawing_stroke", (stroke) => drawingOverlay?.addStroke(stroke));
applyTransform();
loadDeck().then(() => { initDrawingOverlay(); joinAudience(); });
