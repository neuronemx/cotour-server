const params = new URLSearchParams(location.search);
const sessionId = params.get("session") || "demo01";
const deckId = params.get("deck") || "demo";
const socket = io();

let manifest = null;
let overlays = normalizeOverlayState();
let currentSlideIndex = 0;
let latestState = null;
let lastStageCommandAt = 0;
const STAGE_COMMAND_DEBOUNCE_MS = 420;

const slide = document.getElementById("slide");
const preview = document.querySelector(".preview");
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
const stageDeckLabel = document.getElementById("stageDeckLabel");
const stageSessionLabel = document.getElementById("stageSessionLabel");
const previewStatus = document.getElementById("previewStatus");
const prevSlide = document.getElementById("prevSlide");
const nextSlide = document.getElementById("nextSlide");
const jumpForm = document.getElementById("jumpForm");
const jumpInput = document.getElementById("jumpInput");
const currentControl = document.getElementById("currentControl");
const totalControl = document.getElementById("totalControl");
const controlStatus = document.getElementById("controlStatus");

async function loadDeck() {
  const res = await fetch("/decks/" + deckId + "/manifest.json");
  manifest = await res.json();
  const slideCount = manifest.slides.length;
  total.textContent = slideCount;
  totalControl.textContent = slideCount;
  jumpInput.max = slideCount;
  stageDeckLabel.textContent = manifest.title || deckId;
  stageSessionLabel.textContent = sessionId + " · " + deckId;
  updateSlideControls();
}

function audienceUrl() {
  return "https://immersa.mx/" + encodeURIComponent(sessionId);
}

function normalizeOverlayState(next = {}) {
  const showReactions = next.showReactions ?? true;
  const showAudienceQr = next.showAudienceQr ?? next.qrVisible ?? false;
  return {
    ...next,
    showReactions,
    reactionsOnScreen: showReactions,
    showAudienceQr,
    qrVisible: showAudienceQr,
    messageVisible: Boolean(next.messageVisible),
    messageText: next.messageText || ""
  };
}

function setToggles() {
  overlays = normalizeOverlayState(overlays);
  reactionsToggle.checked = overlays.showReactions;
  qrToggle.checked = overlays.showAudienceQr;
  reactionsStatus.textContent = overlays.showReactions ? "On" : "Off";
  qrStatus.textContent = overlays.showAudienceQr ? "Visible" : "Oculto";
}

function clampSlideIndex(index) {
  if (!manifest?.slides?.length) return 0;
  return Math.max(0, Math.min(index, manifest.slides.length - 1));
}

function applySlideOrientation(item, src) {
  const portrait = item?.orientation === "portrait";
  preview.classList.toggle("portrait-slide", portrait);
  if (portrait) preview.style.setProperty("--slide-bg", "url('" + src.replace(/'/g, "%27") + "')");
  else preview.style.removeProperty("--slide-bg");
}

function updateSlideControls() {
  const slideCount = manifest?.slides?.length || 0;
  const displayIndex = slideCount ? currentSlideIndex + 1 : 0;
  current.textContent = displayIndex;
  currentControl.textContent = displayIndex;
  total.textContent = slideCount || 0;
  totalControl.textContent = slideCount || 0;
  jumpInput.value = displayIndex || 1;
  prevSlide.disabled = !slideCount || currentSlideIndex <= 0;
  nextSlide.disabled = !slideCount || currentSlideIndex >= slideCount - 1;
}

function render(state) {
  if (!manifest?.slides?.length) return;
  latestState = state;
  overlays = normalizeOverlayState(state.overlays || overlays);
  setToggles();

  const index = clampSlideIndex(state.liveSlideIndex ?? state.slideIndex ?? currentSlideIndex);
  currentSlideIndex = index;
  const item = manifest.slides[index];
  const src = "/decks/" + deckId + "/" + item.src;
  slide.src = src;
  applySlideOrientation(item, src);

  audience.textContent = state.audienceCount || 0;
  presenterStatus.textContent = state.presenterConnected ? "Conectado" : "Desconectado";
  streamStatus.textContent = state.transmissionPaused ? "Pausado" : "Activo";
  previewStatus.textContent = state.transmissionPaused ? "Pausado" : "Live";
  controlStatus.textContent = "Stage listo";
  updateSlideControls();
}

function updateOverlay(patch) {
  overlays = normalizeOverlayState({ ...overlays, ...patch });
  socket.emit("overlay_update", { overlays });
}

function emitStageSlide(targetIndex) {
  if (!manifest?.slides?.length) return;
  const now = Date.now();
  if (now - lastStageCommandAt < STAGE_COMMAND_DEBOUNCE_MS) return;
  lastStageCommandAt = now;

  const slideIndex = clampSlideIndex(targetIndex);
  currentSlideIndex = slideIndex;
  updateSlideControls();
  controlStatus.textContent = "Enviado por Stage";

  const payload = {
    session: sessionId,
    deck: deckId,
    role: "stage",
    source: "stage",
    slideIndex,
    liveSlideIndex: slideIndex,
    timestamp: now
  };

  // Absolute slide target: if more than one handler exists, the same target is idempotent.
  socket.emit("slide_change", payload);
  socket.emit("stage_slide_control", payload);
}

prevSlide.addEventListener("click", () => emitStageSlide(currentSlideIndex - 1));
nextSlide.addEventListener("click", () => emitStageSlide(currentSlideIndex + 1));
jumpForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const requested = Number.parseInt(jumpInput.value, 10);
  if (Number.isFinite(requested)) emitStageSlide(requested - 1);
});

reactionsToggle.addEventListener("change", () => updateOverlay({ reactionsOnScreen: reactionsToggle.checked, showReactions: reactionsToggle.checked }));
qrToggle.addEventListener("change", () => updateOverlay({ qrVisible: qrToggle.checked, showAudienceQr: qrToggle.checked, audienceUrl: audienceUrl() }));
document.getElementById("messageForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (text) updateOverlay({ messageVisible: true, messageText: text });
});
document.getElementById("clearMessage").addEventListener("click", () => {
  messageInput.value = "";
  socket.emit("clear_message");
});
document.getElementById("clearScreen").addEventListener("click", () => {
  messageInput.value = "";
  socket.emit("clear_screen");
});

socket.on("presentation_state", (state) => { if (manifest) render(state); });
socket.on("overlay_update", (next) => { overlays = normalizeOverlayState(next); setToggles(); });
socket.on("audience_count", (count) => { audience.textContent = count; });

loadDeck().then(() => socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "stage" }));
