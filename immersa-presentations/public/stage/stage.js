const params = new URLSearchParams(location.search);
const roleOpenContext = window.IMMERSA_ROLE_OPEN || {};
const sessionId = params.get("session") || roleOpenContext.session || roleOpenContext.session_id || "auto";
const deckId = params.get("deck") || roleOpenContext.deck || roleOpenContext.deckId || "demo";
const socket = io();

let manifest = null;
let overlays = normalizeOverlayState();
let currentSlideIndex = 0;
let lastStageCommandAt = 0;
let renderedStageQrUrl = "";
let drawingOverlay = null;
let stageInteractionPanel = null;
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
const stageLiveText = document.getElementById("stageLiveText");
const stageQr = document.getElementById("stageQr");
const stageQrPattern = document.getElementById("stageQrPattern");
const stageQrUrl = document.getElementById("stageQrUrl");

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
  return roleOpenContext.public_url || "";
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
  qrToggle.checked = Boolean(overlays.showAudienceQr && publicUrl());
  liveTextButton.classList.toggle("is-live", overlays.messageVisible);
  liveTextButton.textContent = overlays.messageVisible ? "Apagar texto" : "Texto en vivo";
  renderLiveTextOverlay();
  renderStageQr();
}

function renderLiveTextOverlay() {
  if (!stageLiveText) return;
  const visible = Boolean(overlays.messageVisible && overlays.messageText);
  stageLiveText.hidden = !visible;
  stageLiveText.textContent = visible ? overlays.messageText : "";
}

function renderStageQr() {
  if (!stageQr || !stageQrPattern || !stageQrUrl) return;
  const url = overlays.showAudienceQr ? (overlays.audienceUrl || publicUrl()) : "";
  stageQr.hidden = !url;
  stageQrUrl.textContent = url;
  if (!url || renderedStageQrUrl === url) return;

  renderedStageQrUrl = url;
  stageQrPattern.innerHTML = "";
  stageQrPattern.classList.remove("qr-fallback");
  if (window.QRCode) {
    new window.QRCode(stageQrPattern, { text: url, width: 188, height: 188, colorDark: "#111111", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
    return;
  }
  stageQrPattern.textContent = url;
  stageQrPattern.classList.add("qr-fallback");
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
  drawingOverlay?.refresh();

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
  socket.emit("slide_go", { slideIndex });
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

function initDrawingOverlay() {
  if (drawingOverlay || !window.ImmersaDrawingOverlay) return;
  drawingOverlay = window.ImmersaDrawingOverlay.create({ root: screenFrame, slide, getSlideIndex: () => currentSlideIndex, zIndex: 2 });
}

function ensureStageInteractionPanel() {
  if (stageInteractionPanel) return stageInteractionPanel;
  stageInteractionPanel = document.createElement("section");
  stageInteractionPanel.className = "stage-interaction-panel interaction-hidden";
  stageInteractionPanel.setAttribute("aria-label", "Resultados de interacción");
  screenFrame.appendChild(stageInteractionPanel);
  return stageInteractionPanel;
}

function renderStageInteractionResults(results) {
  const panel = ensureStageInteractionPanel();
  if (!results) {
    panel.classList.add("interaction-hidden");
    panel.innerHTML = "";
    return;
  }
  panel.classList.remove("interaction-hidden");
  panel.innerHTML = '<h2>' + (results.title || 'Interacción') + '</h2><p>' + results.totalResponses + ' respuesta' + (results.totalResponses === 1 ? '' : 's') + '</p><div class="interaction-results-list">' + results.options.map((option) => '<div class="interaction-result-row"><div class="interaction-result-label"><span>' + option.label + '</span><strong>' + option.count + ' · ' + option.percentage + '%</strong></div><div class="interaction-result-bar"><span style="width:' + option.percentage + '%"></span></div></div>').join("") + '</div>';
}

prevSlide.addEventListener("click", () => emitStageSlide(currentSlideIndex - 1));
nextSlide.addEventListener("click", () => emitStageSlide(currentSlideIndex + 1));
reactionsToggle.addEventListener("change", () => updateOverlay({ reactionsOnScreen: reactionsToggle.checked, showReactions: reactionsToggle.checked }));
qrToggle.addEventListener("change", () => {
  const audienceUrl = publicUrl();
  if (qrToggle.checked && !audienceUrl) {
    qrToggle.checked = false;
    return;
  }
  updateOverlay({ qrVisible: qrToggle.checked, showAudienceQr: qrToggle.checked, audienceUrl });
});

displayLinkButton.addEventListener("click", () => {
  const url = publicUrl();
  if (!url) return;
  messageInput.value = url;
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
socket.on("drawing_stroke", (stroke) => drawingOverlay?.addStroke(stroke));
socket.on("interaction:results_updated", renderStageInteractionResults);
socket.on("interaction:closed", () => renderStageInteractionResults(null));

loadDeck().then(() => {
  initDrawingOverlay();
  socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "stage" });
  const audienceUrl = publicUrl();
  updateOverlay({ showReactions: true, reactionsOnScreen: true, audienceUrl });
});
