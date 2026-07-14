const params = new URLSearchParams(location.search);
const roleOpenContext = window.IMMERSA_ROLE_OPEN || {};
const sessionId = params.get("session") || roleOpenContext.session || roleOpenContext.session_id || "auto";
const deckId = params.get("deck") || roleOpenContext.deck || roleOpenContext.deckId || "demo";
const socket = io();
const raffleController = window.ImmersaRaffleControls?.createController ? window.ImmersaRaffleControls.createController(socket, { installLegacyIntegration: false, onStateChange: (_state, eventName) => { if (eventName === "raffle:closed") returnInteractionsHome(); else syncInteractionShellState(); } }) : null;

let manifest = null;
let overlays = normalizeOverlayState();
let currentSlideIndex = 0;
let lastStageCommandAt = 0;
let renderedStageQrUrl = "";
let drawingOverlay = null;
let interactions = [];
let selectedInteractionId = "";
let activeInteraction = null;
let interactionResults = null;
let interactionResultsVisible = false;
let stageActionsModal = null;
let stageActionsContent = null;
let interactionShellMount = null;
let interactionShell = null;
let pollsRenderer = null;
let raffleRenderer = null;
let raffleHostRegistration = null;
let stageActionsOpen = false;
const STAGE_COMMAND_DEBOUNCE_MS = 360;
const fallbackDemoInteraction = {
  id: "demo-poll-1",
  type: "poll",
  title: "Encuesta demo",
  prompt: "¿Qué experiencia te gustaría probar primero en Immersa?",
  options: [
    { id: "live-polls", label: "Encuestas en vivo" },
    { id: "quizzes", label: "Quizzes con puntaje" },
    { id: "decision-exercises", label: "Ejercicios de decisión" },
    { id: "attendee-results", label: "Resultados por asistente" }
  ],
  source: "fallback-demo"
};

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
const stageActionsButton = document.getElementById("stageActionsButton");
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
  await loadInteractions();
}

function publicUrl() {
  return roleOpenContext.public_url || "";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
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

function normalizeInteractionList(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.interactions) ? data.interactions : [];
  return list.filter((item) => item && item.id && item.type && Array.isArray(item.options) && item.options.length);
}

function clearSelectedInteraction() { selectedInteractionId = ""; }

async function loadInteractions() {
  try {
    const res = await fetch("/decks/" + deckId + "/interactions.json", { cache: "no-store" });
    if (!res.ok) throw new Error("No interactions");
    const data = await res.json();
    interactions = normalizeInteractionList(data);
    if (!interactions.length) interactions = [fallbackDemoInteraction];
  } catch (_error) {
    interactions = [fallbackDemoInteraction];
  }
  clearSelectedInteraction();
  renderStageActionsPanel();
  syncInteractionShellState();
}

function selectedInteraction() {
  return selectedInteractionId ? interactions.find((item) => String(item.id) === String(selectedInteractionId)) || null : null;
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

function ensureStageActionsModal() {
  if (stageActionsModal) return stageActionsModal;
  stageActionsModal = document.createElement("div");
  stageActionsModal.className = "stage-actions-modal";
  stageActionsModal.setAttribute("aria-hidden", "true");
  stageActionsModal.innerHTML = '<div class="stage-actions-backdrop" aria-hidden="true"></div><section class="stage-actions-card" role="dialog" aria-modal="true" aria-label="Interacciones"><div class="stage-actions-content"><div class="interactions-shell-mount"></div></div></section>';
  document.body.appendChild(stageActionsModal);
  stageActionsContent = stageActionsModal.querySelector(".stage-actions-content");
  interactionShellMount = stageActionsModal.querySelector(".interactions-shell-mount");
  ensureInteractionsShell();
  return stageActionsModal;
}

function openStageActions() {
  ensureStageActionsModal();
  stageActionsOpen = true;
  stageActionsModal.classList.add("is-open");
  stageActionsModal.setAttribute("aria-hidden", "false");
  stageActionsButton?.setAttribute("aria-expanded", "true");
  renderStageActionsPanel();
  syncInteractionShellState();
}

function closeStageActions() {
  if (!stageActionsModal) return;
  stageActionsOpen = false;
  stageActionsModal.classList.remove("is-open");
  stageActionsModal.setAttribute("aria-hidden", "true");
  stageActionsButton?.setAttribute("aria-expanded", "false");
}

function setStageActionsOpen(open) {
  ensureStageActionsModal();
  if (!open && hasActiveInteractionShellLock()) open = true;
  stageActionsOpen = Boolean(open);
  stageActionsModal.classList.toggle("is-open", stageActionsOpen);
  stageActionsModal.setAttribute("aria-hidden", stageActionsOpen ? "false" : "true");
  stageActionsButton?.setAttribute("aria-expanded", String(stageActionsOpen));
  if (stageActionsOpen) renderStageActionsPanel();
}

function activeInteractionView() { return activeInteraction ? "polls" : (raffleController?.getState?.().active ? "raffles" : "home"); }
function hasActiveInteractionShellLock() { return Boolean(activeInteraction || raffleController?.getState?.().active); }
function syncRendererVisibility() {
  if (!interactionShell) return;
  if (pollsRenderer) pollsRenderer.hidden = interactionShell.getView() !== "polls";
  if (raffleRenderer) raffleRenderer.hidden = interactionShell.getView() !== "raffles";
}
function returnInteractionsHome() {
  const shell = ensureInteractionsShell();
  if (!shell) return;
  shell.setLocked(false);
  shell.setCloseVisible(true);
  shell.setTitleVisible?.(true);
  shell.setView("home");
  clearSelectedInteraction();
  syncRendererVisibility();
  renderStageActionsPanel();
}
function syncInteractionShellState() {
  const shell = ensureInteractionsShell();
  if (!shell) return;
  const activeRaffle = Boolean(raffleController?.getState?.().active);
  const activePoll = Boolean(activeInteraction);
  stageActionsModal?.classList.toggle("is-locked", activePoll || activeRaffle);
  shell.setLocked(activePoll || activeRaffle);
  shell.setCloseVisible(!(activePoll || activeRaffle));
  if (activePoll || activeRaffle || shell.getView() === "home") shell.setView(activeInteractionView());
  shell.setTitleVisible?.(shell.getView() === "home" && !(activePoll || activeRaffle));
  syncRendererVisibility();
  if ((activePoll || activeRaffle) && !stageActionsOpen) setStageActionsOpen(true);
}
function closeStageActionsRequest() {
  if (hasActiveInteractionShellLock()) return;
  clearSelectedInteraction();
  returnInteractionsHome();
  closeStageActions();
}
function ensureInteractionsShell() {
  if (interactionShell || !window.ImmersaInteractionsShell || !interactionShellMount) return interactionShell;
  interactionShell = window.ImmersaInteractionsShell.create({
    root: interactionShellMount,
    onSelectCategory: (view) => {
      if (view === "polls") renderStageActionsPanel();
      if (view === "raffles") { syncRendererVisibility(); raffleController?.setTab?.("raffles"); }
      syncInteractionShellState();
    },
    onRequestClose: closeStageActionsRequest
  });
  pollsRenderer = document.createElement("div");
  pollsRenderer.className = "interaction-polls-renderer";
  raffleRenderer = document.createElement("div");
  raffleRenderer.className = "interaction-raffle-renderer";
  interactionShell.getContentRoot().append(pollsRenderer, raffleRenderer);
  if (raffleController?.mountHost) {
    raffleHostRegistration = raffleController.mountHost({ role: "stage", root: raffleRenderer, isActive: () => interactionShell.getView() === "raffles" });
  }
  syncRendererVisibility();
  return interactionShell;
}

function responseCountText(results) {
  const total = results?.totalResponses || 0;
  return total + " respuesta" + (total === 1 ? "" : "s");
}

function interactionListMarkup() {
  if (!interactions.length) return "";
  return '<div class="interaction-picker" role="listbox" aria-label="Interacciones disponibles">' + interactions.map((item) => {
    const selected = String(item.id) === String(selectedInteractionId);
    const demo = item.source === "fallback-demo" ? '<small>Demo temporal</small>' : '';
    return '<button type="button" class="interaction-choice ' + (selected ? 'is-selected' : '') + '" data-interaction-select="' + escapeHtml(item.id) + '" aria-selected="' + selected + '" role="option"><span class="interaction-choice-title">' + escapeHtml(item.title || item.prompt || 'Interacción') + '</span><span class="interaction-choice-prompt">' + escapeHtml(item.prompt || item.title || 'Elige una opción') + '</span>' + demo + '</button>';
  }).join("") + '</div>';
}

function activeResultRows(interaction, results) {
  const resultOptions = Array.isArray(results?.options) && results.options.length ? results.options : (interaction?.options || []).map((option) => ({ label: option.label, count: 0, percentage: 0 }));
  if (!resultOptions.length) return '<section class="interaction-active-results"><h3>Resultados</h3><p>Sin opciones disponibles.</p></section>';
  return '<section class="interaction-active-results"><h3>Resultados</h3><div class="interaction-results-list">' + resultOptions.map((option) => '<div class="interaction-result-row"><div class="interaction-result-label"><span>' + escapeHtml(option.label) + '</span><strong>' + (option.count || 0) + ' · ' + (option.percentage || 0) + '%</strong></div><div class="interaction-result-bar"><span style="width:' + (option.percentage || 0) + '%"></span></div></div>').join("") + '</div><p>' + responseCountText(results) + '</p></section>';
}

function attachInteractionCloseSlider(control, interactionId) {
  if (!control) return;
  let dragging = false;
  let startX = 0;
  let maxX = 1;
  let progress = 0;
  const reset = () => { progress = 0; control.style.setProperty("--close-progress", "0"); control.style.setProperty("--close-x", "0px"); control.classList.remove("is-complete"); };
  const update = (clientX) => {
    progress = Math.max(0, Math.min(1, (clientX - startX) / maxX));
    control.style.setProperty("--close-progress", String(progress));
    control.style.setProperty("--close-x", Math.round(progress * maxX) + "px");
    control.classList.toggle("is-complete", progress >= 0.82);
  };
  const finish = (event) => {
    if (!dragging) return;
    dragging = false;
    control.releasePointerCapture?.(event.pointerId);
    if (progress >= 0.82) socket.emit("interaction:close", { interactionId });
    else reset();
  };
  control.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = control.getBoundingClientRect();
    const knob = control.querySelector(".interaction-close-slider-knob");
    maxX = Math.max(1, rect.width - (knob?.offsetWidth || 38) - 8);
    startX = event.clientX;
    dragging = true;
    control.setPointerCapture?.(event.pointerId);
    update(event.clientX);
  });
  control.addEventListener("pointermove", (event) => { if (dragging) update(event.clientX); });
  control.addEventListener("pointerup", finish);
  control.addEventListener("pointercancel", (event) => { finish(event); reset(); });
}

function renderStageActionsPanel() {
  ensureInteractionsShell();
  if (!pollsRenderer || !interactionShell) return;
  const active = activeInteraction || null;
  const selected = selectedInteraction();
  if (!active) {
    if (interactionShell.getView() !== "home" && !raffleController?.getState?.().active) interactionShell.setView("polls");
    syncRendererVisibility();
    pollsRenderer.innerHTML = '<div class="stage-actions-head"><span>Stage</span><h2 id="stageActionsTitle">Acciones</h2><p>Encuestas disponibles</p></div>' + (interactions.length ? '<p>Selecciona una encuesta para lanzarla.</p>' + interactionListMarkup() : '<p>Este deck aún no tiene interacciones.</p>') + '<div class="interaction-panel-actions"><button class="primary" data-interaction-launch ' + (!selected ? 'disabled' : '') + '>Lanzar encuesta</button></div>';
    pollsRenderer.querySelectorAll("[data-interaction-select]").forEach((button) => button.addEventListener("click", () => {
      selectedInteractionId = button.dataset.interactionSelect || "";
      renderStageActionsPanel();
    }));
    pollsRenderer.querySelector("[data-interaction-launch]")?.addEventListener("click", () => socket.emit("interaction:launch", { interactionId: selected?.id }));
    return;
  }

  const revealLabel = interactionResultsVisible ? "Ocultar resultados" : "Mostrar resultados";
  const closeControl = '<div class="interaction-close-slider" data-interaction-close-slider role="button" aria-label="Desliza para cerrar encuesta" tabindex="0" style="--close-progress:0;--close-x:0px"><span class="interaction-close-slider-track"></span><span class="interaction-close-slider-label">Desliza para cerrar encuesta</span><span class="interaction-close-slider-knob" aria-hidden="true">›</span></div>';
  interactionShell.setView("polls");
  syncRendererVisibility();
  pollsRenderer.innerHTML = '<div class="stage-actions-head"><span>Encuesta activa</span><h2 id="stageActionsTitle">' + escapeHtml(active.title || 'Encuesta') + '</h2><p>' + escapeHtml(active.prompt || active.title || 'Interacción') + '</p></div>' + activeResultRows(active, interactionResults) + '<div class="interaction-panel-actions interaction-active-actions"><button data-interaction-reveal>' + revealLabel + '</button>' + closeControl + '</div>';
  pollsRenderer.querySelector("[data-interaction-reveal]")?.addEventListener("click", () => {
    const eventName = interactionResultsVisible ? "interaction:hide_results" : "interaction:reveal_results";
    socket.emit(eventName, { interactionId: activeInteraction?.id });
  });
  attachInteractionCloseSlider(pollsRenderer.querySelector("[data-interaction-close-slider]"), activeInteraction?.id);
}

function updateInteractionState(state) {
  activeInteraction = state?.active || null;
  if (activeInteraction?.id) selectedInteractionId = String(activeInteraction.id);
  else clearSelectedInteraction();
  interactionResultsVisible = Boolean(state?.resultsVisible);
  if (state?.results) interactionResults = state.results;
  if (!activeInteraction) interactionResults = null;
  renderStageActionsPanel();
}

function handleInteractionResults(results) {
  interactionResults = results || null;
  renderStageActionsPanel();
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

stageActionsButton?.addEventListener("click", () => { if (stageActionsOpen) closeStageActionsRequest(); else openStageActions(); });

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
  if (event.key === "Escape") {
    if (stageActionsOpen) closeStageActionsRequest();
    else closeTextModal();
    return;
  }
  if (event.target.matches("input, textarea, select, button")) return;
  if (event.key === "ArrowLeft") emitStageSlide(currentSlideIndex - 1);
  if (event.key === "ArrowRight") emitStageSlide(currentSlideIndex + 1);
});

socket.on("presentation_state", (state) => { if (manifest) render(state); });
socket.on("overlay_update", (next) => { overlays = normalizeOverlayState(next); setToggles(); });
socket.on("audience_count", (count) => { audience.textContent = count; });
socket.on("drawing_stroke", (stroke) => drawingOverlay?.addStroke(stroke));
socket.on("interaction:state", updateInteractionState);
socket.on("interaction:active", (interaction) => { activeInteraction = interaction || null; if (activeInteraction?.id) selectedInteractionId = String(activeInteraction.id); interactionResults = null; interactionResultsVisible = false; renderStageActionsPanel(); });
socket.on("interaction:results_updated", handleInteractionResults);
socket.on("interaction:show_results", () => { interactionResultsVisible = true; renderStageActionsPanel(); });
socket.on("interaction:hide_results", () => { interactionResultsVisible = false; renderStageActionsPanel(); });
socket.on("interaction:closed", () => { activeInteraction = null; interactionResults = null; interactionResultsVisible = false; clearSelectedInteraction(); renderStageActionsPanel(); returnInteractionsHome(); });

loadDeck().then(() => {
  initDrawingOverlay();
  socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "stage" });
});
