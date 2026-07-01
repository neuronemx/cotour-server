const params = new URLSearchParams(location.search);
const sessionId = params.get("session") || "auto";
const deckId = params.get("deck") || "demo";
const socket = io();

let manifest = null;
let overlays = normalizeOverlayState();
let currentSlideIndex = 0;
let lastStageCommandAt = 0;
const STAGE_COMMAND_DEBOUNCE_MS = 360;

const slide = document.getElementById("slide");
const screenFrame = document.querySelector(".screen-frame");
const current = document.getElementById("current");
const total = document.getElementById("total");
const audience = document.getElementById("audience");
const presenterStatus = document.getElementById("presenterStatus");
const reactionsToggle = document.getElementById("reactionsToggle");
const qrToggle = document.getElementById("qrToggle");
const messageInput = document.getElementById("messageInput");
const stageDeckLabel = document.getElementById("stageDeckLabel");
const prevSlide = document.getElementById("prevSlide");
const nextSlide = document.getElementById("nextSlide");
const liveTextButton = document.getElementById("liveTextButton");
const textModal = document.getElementById("textModal");
const messageForm = document.getElementById("messageForm");
const cancelMessage = document.getElementById("cancelMessage");
const displayLinkButton = document.getElementById("displayLinkButton");

async function loadDeck() {
  const res = await fetch("/decks/" + deckId + "/manifest.json");
  manifest = await res.json();
  const slideCount = manifest.slides.length;
  total.textContent = slideCount;
  stageDeckLabel.textContent = manifest.title || "Presentación";
  updateSlideControls();
  setToggles();
}

function publicUrl() {
  return "https://show.immersa.mx/" + encodeURIComponent(sessionId);
}

function normalizeOverlayState(next = {}) {
  const showReactions = next.showReactions ?? next.reactionsOnScreen ?? true;
  const showAudienceQr = next.showAudienceQr ?? next.qrVisible ?? false;
  return {
    ...next,
    showReactions,
    reactionsOnScreen: showReactions,
    showAudienceQr,
    qrVisible: showAudienceQr,
    audienceUrl: next.audienceUrl || publicUrl(),
    messageVisible: Boolean(next.messageVisible),
    messageText: next.messageText || ""
  };
}

function setToggles() {
  overlays = normalizeOverlayState(overlays);
  reactionsToggle.checked = Boolean(overlays.showReactions);
  qrToggle.checked = Boolean(overlays.showAudienceQr);
  liveTextButton.classList.toggle("is-live", overlays.messageVisible);
  liveTextButton.textContent = overlays.messageVisible ? "Apagar texto" : "Texto en vivo";
}

function clampSlideIndex(index) {
  if (!manifest?.slides?.length) return 0;
  return Math.max(0, Math.min(index, manifest.slides.length - 1));
}

function applySlideOrientation(item, src) {
  const portrait = item?.orientation === "portrait";
  screenFrame.classList.toggle("portrait-slide", portrait);
  if (portrait) screenFrame.style.setProperty("--slide-bg", "url('" + src.replace(/'/g, "%27") + "')");
  else screenFrame.style.removeProperty("--slide-bg");
}

function updateSlideControls() {
  const slideCount = manifest?.slides?.length || 0;
  const displayIndex = slideCount ? currentSlideIndex + 1 : 0;
  current.textContent = displayIndex;
  total.textContent = slideCount || 0;
  prevSlide.disabled = !slideCount || currentSlideIndex <= 0;
  nextSlide.disabled = !slideCount || currentSlideIndex >= slideCount - 1;
}

function render(state) {
  if (!manifest?.slides?.length) return;
  overlays = normalizeOverlayState(state.overlays || overlays);
  setToggles();

  const index = clampSlideIndex(state.liveSlideIndex ?? state.slideIndex ?? currentSlideIndex);
  currentSlideIndex = index;
  const item = manifest.slides[index];
  const src = "/decks/" + deckId + "/" + item.src;
  slide.src = src;
  applySlideOrientation(item, src);

  audience.textContent = state.audienceCount || 0;
  presenterStatus.textContent = state.presenterConnected ? "On" : "Off";
  updateSlideControls();
}

function updateOverlay(patch) {
  overlays = normalizeOverlayState({ ...overlays, ...patch });
  setToggles();
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

  const payload = {
    session: sessionId,
    deck: deckId,
    role: "stage",
    source: "stage",
    slideIndex,
    liveSlideIndex: slideIndex,
    timestamp: now
  };

  socket.emit("slide_change", payload);
  socket.emit("stage_slide_control", payload);
}

function openTextModal() {
  textModal.classList.add("is-open");
  textModal.setAttribute("aria-hidden", "false");
  messageInput.focus();
}

function closeTextModal() {
  textModal.classList.remove("is-open");
  textModal.setAttribute("aria-hidden", "true");
}

function clearLiveText() {
  messageInput.value = "";
  updateOverlay({ messageVisible: false, messageText: "" });
  socket.emit("clear_message");
}

prevSlide.addEventListener("click", () => emitStageSlide(currentSlideIndex - 1));
nextSlide.addEventListener("click", () => emitStageSlide(currentSlideIndex + 1));
reactionsToggle.addEventListener("change", () => updateOverlay({ reactionsOnScreen: reactionsToggle.checked, showReactions: reactionsToggle.checked }));
qrToggle.addEventListener("change", () => updateOverlay({ qrVisible: qrToggle.checked, showAudienceQr: qrToggle.checked, audienceUrl: publicUrl() }));

displayLinkButton.addEventListener("click", () => {
  messageInput.value = publicUrl();
  messageInput.focus();
});

liveTextButton.addEventListener("click", () => {
  if (overlays.messageVisible) clearLiveText();
  else openTextModal();
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  updateOverlay({ messageVisible: true, messageText: text });
  closeTextModal();
});

cancelMessage.addEventListener("click", closeTextModal);
textModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-modal]")) closeTextModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeTextModal();
  if (event.target.matches("input, textarea, select, button")) return;
  if (event.key === "ArrowLeft") emitStageSlide(currentSlideIndex - 1);
  if (event.key === "ArrowRight") emitStageSlide(currentSlideIndex + 1);
});

socket.on("presentation_state", (state) => { if (manifest) render(state); });
socket.on("overlay_update", (next) => { overlays = normalizeOverlayState(next); setToggles(); });
socket.on("audience_count", (count) => { audience.textContent = count; });

loadDeck().then(() => {
  socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "stage" });
  updateOverlay({ showReactions: true, reactionsOnScreen: true, audienceUrl: publicUrl() });
});
