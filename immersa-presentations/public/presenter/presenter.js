const params = new URLSearchParams(location.search);
const roleOpenContext = window.IMMERSA_ROLE_OPEN || {};
const sessionId = params.get("session") || roleOpenContext.session || roleOpenContext.session_id || "demo01";
const deckId = params.get("deck") || roleOpenContext.deck || roleOpenContext.deckId || "demo";
const socket = io();
const overlaySocket = io();
const raffleController = window.ImmersaRaffleControls?.createController ? window.ImmersaRaffleControls.createController(socket, { installLegacyIntegration: false, onStateChange: (_state, eventName) => { if (eventName === "raffle:closed") returnInteractionsHome(); else syncInteractionShellState(); } }) : null;
let overlaySocketJoined = false;
let manifest = null;
let interactions = [];
let selectedInteractionId = "";
let activeInteraction = null;
let interactionResults = null;
let interactionResultsVisible = false;
let currentState = null;
let currentSlideIndex = 0;
let drawingOverlay = null;
let drawingMode = false;
const slide = document.getElementById("slide");
const presenterShell = document.querySelector(".presenter-shell");
const streamArea = document.querySelector(".stream-area");
const current = document.getElementById("current");
const total = document.getElementById("total");
const audience = document.getElementById("audience");
const playPause = document.getElementById("playPause");
const localReactions = document.getElementById("localReactions");
const audienceQr = document.getElementById("audienceQr");
const drawToggle = document.getElementById("drawToggle");
const interactionToggle = document.getElementById("interactionToggle");
const fullscreenToggle = document.getElementById("fullscreenToggle");
const thumbsToggle = document.getElementById("thumbsToggle");
const thumbs = document.getElementById("thumbs");
const deckNotice = document.getElementById("deckNotice");
const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" class="pause-icon"><path d="M9 6V18"></path><path d="M15 6V18"></path></svg>';
const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" class="play-icon"><path d="M9 6L18 12L9 18Z"></path></svg>';
const compactLandscapeQuery = window.matchMedia ? window.matchMedia("(orientation: landscape) and (max-height: 520px)") : null;
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
let interactionPanel = null;
let interactionShellMount = null;
let interactionShell = null;
let pollsRenderer = null;
let raffleRenderer = null;
let raffleHostRegistration = null;
let interactionPanelOpen = false;
function renderDeckNotice() {
  const pending = manifest && (manifest.status === "uploaded" || manifest.conversion?.status === "pending");
  deckNotice.hidden = !pending;
}
function legacyRoleUrl(role) { return location.origin + "/" + role + "?session=" + encodeURIComponent(sessionId) + "&deck=" + encodeURIComponent(deckId); }
function roleUrl(role) {
  if (role === "audience") return roleOpenContext.public_url || "";
  if (role === "screen" && roleOpenContext.screen_url) return roleOpenContext.screen_url;
  if (role === "stage" && roleOpenContext.stage_url) return roleOpenContext.stage_url;
  return legacyRoleUrl(role);
}
function audienceQrVisible(state) { return Boolean(state?.overlays?.showAudienceQr ?? state?.overlays?.qrVisible); }
function updateAudienceQrButton(state) { const active = audienceQrVisible(state); audienceQr.classList.toggle("is-active", active); audienceQr.classList.toggle("active", active); audienceQr.setAttribute("aria-pressed", String(active)); audienceQr.title = active ? "Ocultar QR de público" : "Mostrar QR de público"; }
function publishAudienceQr(visible) {
  const audienceUrl = roleUrl("audience");
  if (visible && !audienceUrl) return;
  if (!overlaySocketJoined) { overlaySocket.emit("join_presentation", { session: sessionId, deck: deckId, role: "stage" }); overlaySocketJoined = true; }
  overlaySocket.emit("overlay_update", { overlays: { showAudienceQr: visible, qrVisible: visible, audienceUrl } });
}
function reactionsEnabled(state) { return Boolean(state?.overlays?.showReactions ?? state?.overlays?.reactionsOnScreen ?? true); }
function updateReactionToggle(state) { if (!localReactions) return; localReactions.checked = reactionsEnabled(state); }
function publishReactionsEnabled(enabled) { socket.emit("overlay_update", { overlays: { showReactions: enabled, reactionsOnScreen: enabled } }); }

function getFullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
function isFullscreen() { return Boolean(getFullscreenElement()); }
function updateFullscreenButton() {
  if (!fullscreenToggle) return;
  const active = isFullscreen();
  fullscreenToggle.classList.toggle("is-active", active);
  fullscreenToggle.setAttribute("aria-pressed", String(active));
  fullscreenToggle.title = active ? "Salir de pantalla completa" : "Pantalla completa";
  fullscreenToggle.setAttribute("aria-label", fullscreenToggle.title);
}
function isCompactLandscape() { return Boolean(compactLandscapeQuery?.matches); }
function setThumbsPanelOpen(open) {
  if (!presenterShell || !thumbsToggle) return;
  const active = Boolean(open && isCompactLandscape());
  presenterShell.classList.toggle("thumbs-panel-open", active);
  thumbsToggle.classList.toggle("is-active", active);
  thumbsToggle.setAttribute("aria-expanded", String(active));
  thumbsToggle.title = active ? "Ocultar miniaturas" : "Mostrar miniaturas";
  thumbsToggle.setAttribute("aria-label", thumbsToggle.title);
}
function closeThumbsPanel() { setThumbsPanelOpen(false); }
function toggleThumbsPanel() { setThumbsPanelOpen(!presenterShell?.classList.contains("thumbs-panel-open")); }
function syncThumbsPanelMode() { if (!isCompactLandscape()) closeThumbsPanel(); }
async function toggleFullscreen() {
  if (!fullscreenToggle) return;
  try {
    if (isFullscreen()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      return;
    }
    const target = presenterShell || document.documentElement;
    if (target.requestFullscreen) await target.requestFullscreen();
    else if (target.webkitRequestFullscreen) await target.webkitRequestFullscreen();
  } catch (_error) {
    // Fullscreen is a progressive enhancement; keep Presenter usable if denied.
  } finally {
    updateFullscreenButton();
  }
}
document.getElementById("screenUrl").value = roleUrl("screen");
document.getElementById("stageUrl").value = roleUrl("stage");
document.getElementById("audienceUrl").value = roleUrl("audience");
async function loadDeck() { const res = await fetch("/decks/" + deckId + "/manifest.json"); manifest = await res.json(); renderDeckNotice(); total.textContent = manifest.slides.length; renderThumbs(); await loadInteractions(); }
function normalizeInteractionList(data) { const list = Array.isArray(data) ? data : Array.isArray(data?.interactions) ? data.interactions : []; return list.filter((item) => item && item.id && item.type && Array.isArray(item.options) && item.options.length); }
function selectDefaultInteraction() { if (!interactions.length) { selectedInteractionId = ""; return; } if (!interactions.some((item) => String(item.id) === String(selectedInteractionId))) selectedInteractionId = String(interactions[0].id); }
async function loadInteractions() { try { const res = await fetch("/decks/" + deckId + "/interactions.json", { cache: "no-store" }); if (!res.ok) throw new Error("No interactions"); const data = await res.json(); interactions = normalizeInteractionList(data); if (!interactions.length) interactions = [fallbackDemoInteraction]; } catch (_error) { interactions = [fallbackDemoInteraction]; } selectDefaultInteraction(); renderInteractionPanel(); }
function selectedInteraction() { return interactions.find((item) => String(item.id) === String(selectedInteractionId)) || interactions[0] || null; }
function assetSrc(item, kind = "src") { return "/decks/" + deckId + "/" + (kind === "thumb" && item.thumb ? item.thumb : item.src); }
function slideSrc(index) { return assetSrc(manifest.slides[index]); }
function applySlideOrientation(container, item, src) { const portrait = item?.orientation === "portrait"; container.classList.toggle("portrait-slide", portrait); if (portrait) container.style.setProperty("--slide-bg", "url('" + src.replace(/'/g, "%27") + "')"); else container.style.removeProperty("--slide-bg"); }
function renderThumbs() { thumbs.innerHTML = ""; manifest.slides.forEach((item, index) => { const slideNumber = index + 1; const button = document.createElement("button"); button.type = "button"; button.className = "thumb"; button.setAttribute("aria-label", "Ir a lámina " + slideNumber + (item.title ? ": " + item.title : "")); button.title = item.title ? "Lámina " + slideNumber + " · " + item.title : "Lámina " + slideNumber; button.innerHTML = '<span class="thumb-number">' + slideNumber + '</span><img alt="" src="' + assetSrc(item, "thumb") + '">'; button.addEventListener("click", () => { socket.emit("slide_go", { slideIndex: index }); closeThumbsPanel(); }); thumbs.appendChild(button); }); }
function render(state) { currentState = state; const index = state.presenterSlideIndex ?? state.slideIndex; currentSlideIndex = index; const item = manifest.slides[index]; const src = slideSrc(index); slide.src = src; applySlideOrientation(streamArea, item, src); drawingOverlay?.refresh(); current.textContent = index + 1; audience.textContent = state.audienceCount || 0; playPause.innerHTML = state.transmissionPaused ? playIcon : pauseIcon; playPause.classList.toggle("is-paused", state.transmissionPaused); playPause.title = state.transmissionPaused ? "Reanudar transmisión" : "Pausar transmisión"; playPause.setAttribute("aria-label", playPause.title); updateAudienceQrButton(state); updateReactionToggle(state); document.querySelectorAll(".thumb").forEach((node, i) => { node.classList.toggle("active", i === index); node.classList.toggle("live", i === state.liveSlideIndex); }); }
function popReaction(emoji) { if (!localReactions.checked) return; const node = document.createElement("span"); node.className = "reaction"; node.textContent = emoji; node.style.left = Math.round(20 + Math.random() * 60) + "%"; node.style.setProperty("--x", Math.round(Math.random() * 240 - 120) + "px"); document.getElementById("reactions").appendChild(node); setTimeout(() => node.remove(), 2900); }
function updateDrawingMode() { if (!drawToggle) return; drawToggle.classList.toggle("is-active", drawingMode); drawToggle.classList.toggle("active", drawingMode); drawToggle.setAttribute("aria-pressed", String(drawingMode)); drawToggle.title = drawingMode ? "Desactivar dibujo" : "Dibujar sobre slide"; streamArea.classList.toggle("is-drawing", drawingMode); drawingOverlay?.setInteractive(drawingMode); }
function initDrawingOverlay() { if (drawingOverlay || !window.ImmersaDrawingOverlay) return; drawingOverlay = window.ImmersaDrawingOverlay.create({ root: streamArea, slide, getSlideIndex: () => currentSlideIndex, emitStroke: (stroke) => socket.emit("drawing_stroke", stroke), zIndex: 2 }); drawingOverlay.setInteractive(drawingMode); }
function ensureInteractionPanel() {
  if (interactionPanel) return interactionPanel;
  interactionPanel = document.createElement("section");
  interactionPanel.className = "interaction-panel";
  interactionPanel.setAttribute("aria-label", "Interacciones");
  interactionShellMount = document.createElement("div");
  interactionShellMount.className = "interactions-shell-mount";
  interactionPanel.appendChild(interactionShellMount);
  presenterShell.appendChild(interactionPanel);
  return interactionPanel;
}
function ensureInteractionsShell() {
  ensureInteractionPanel();
  if (interactionShell || !window.ImmersaInteractionsShell) return interactionShell;
  interactionShell = window.ImmersaInteractionsShell.create({
    root: interactionShellMount,
    onSelectCategory: (view) => {
      if (view === "polls") renderInteractionPanel();
      if (view === "raffles") renderRafflePanel();
      if (view === "home") syncInteractionShellState();
    },
    onRequestClose: () => setInteractionPanelOpen(false)
  });
  pollsRenderer = document.createElement("div");
  pollsRenderer.className = "interaction-polls-renderer";
  raffleRenderer = document.createElement("div");
  raffleRenderer.className = "interaction-raffle-renderer";
  interactionShell.getContentRoot().append(pollsRenderer, raffleRenderer);
  if (raffleController?.mountHost) {
    raffleHostRegistration = raffleController.mountHost({ role: "presenter", root: raffleRenderer, isActive: () => interactionShell.getView() === "raffles" });
  }
  syncInteractionShellState();
  return interactionShell;
}
function activeInteractionView() { return activeInteraction ? "polls" : (raffleController?.getState?.().active ? "raffles" : "home"); }
function syncRendererVisibility() {
  if (!interactionShell) return;
  if (pollsRenderer) pollsRenderer.hidden = interactionShell.getView() !== "polls";
  if (raffleRenderer) raffleRenderer.hidden = interactionShell.getView() !== "raffles";
}
function returnInteractionsHome() {
  const shell = ensureInteractionsShell();
  if (!shell) return;
  shell.setLocked(false);
  shell.setView("home");
  syncRendererVisibility();
}
function syncInteractionShellState() {
  const shell = ensureInteractionsShell();
  if (!shell) return;
  const activeRaffle = Boolean(raffleController?.getState?.().active);
  const activePoll = Boolean(activeInteraction);
  const view = activePoll ? "polls" : activeRaffle ? "raffles" : shell.getView();
  shell.setLocked(activePoll || activeRaffle);
  if (activePoll || activeRaffle || view === "home") shell.setView(activeInteractionView());
  syncRendererVisibility();
}
function renderRafflePanel() {
  const shell = ensureInteractionsShell();
  if (!shell) return;
  shell.setView("raffles");
  syncRendererVisibility();
  raffleController?.setTab?.("raffles");
}
function setInteractionPanelOpen(open) {
  interactionPanelOpen = Boolean(open);
  presenterShell?.classList.toggle("interaction-panel-open", interactionPanelOpen);
  if (interactionToggle) {
    interactionToggle.classList.toggle("is-active", interactionPanelOpen);
    interactionToggle.classList.toggle("is-special-active", interactionPanelOpen);
    interactionToggle.setAttribute("aria-expanded", String(interactionPanelOpen));
    interactionToggle.setAttribute("aria-pressed", String(interactionPanelOpen));
    interactionToggle.title = interactionPanelOpen ? "Cerrar interacciones" : "Interacciones";
    interactionToggle.setAttribute("aria-label", interactionToggle.title);
  }
  if (interactionPanelOpen) renderInteractionPanel();
}
function toggleInteractionPanel() { setInteractionPanelOpen(!interactionPanelOpen); }
function ensureInteractionToggle() {
  if (!interactionToggle) return null;
  interactionToggle.addEventListener("click", toggleInteractionPanel);
  interactionToggle.setAttribute("aria-expanded", "false");
  interactionToggle.setAttribute("aria-pressed", "false");
  interactionToggle.title = "Interacciones";
  interactionToggle.setAttribute("aria-label", "Interacciones");
  return interactionToggle;
}
function responseCountText(results) { const total = results?.totalResponses || 0; return total + " respuesta" + (total === 1 ? "" : "s"); }
function activeResultRows(interaction, results) {
  const resultOptions = Array.isArray(results?.options) && results.options.length ? results.options : (interaction?.options || []).map((option) => ({ label: option.label, count: 0, percentage: 0 }));
  if (!resultOptions.length) return '<section class="interaction-active-results"><h3>Resultados</h3><p>Sin opciones disponibles.</p></section>';
  return '<section class="interaction-active-results"><h3>Resultados</h3><div class="interaction-results-list">' + resultOptions.map((option) => '<div class="interaction-result-row"><div class="interaction-result-label"><span>' + option.label + '</span><strong>' + (option.count || 0) + ' · ' + (option.percentage || 0) + '%</strong></div><div class="interaction-result-bar"><span style="width:' + (option.percentage || 0) + '%"></span></div></div>').join("") + '</div></section>';
}
function resultRows(results) { if (!results) return '<p>Sin respuestas todavía.</p>'; return '<div class="interaction-results-list">' + results.options.map((option) => '<div class="interaction-result-row"><div class="interaction-result-label"><span>' + option.label + '</span><strong>' + option.count + ' · ' + option.percentage + '%</strong></div><div class="interaction-result-bar"><span style="width:' + option.percentage + '%"></span></div></div>').join("") + '</div><p>' + responseCountText(results) + '</p>'; }
function interactionListMarkup(hasActive) { if (!interactions.length) return ""; return '<div class="interaction-picker" role="listbox" aria-label="Interacciones disponibles">' + interactions.map((item) => { const selected = String(item.id) === String(selectedInteractionId); const disabled = hasActive ? ' disabled' : ''; const demo = item.source === "fallback-demo" ? '<small>Demo temporal</small>' : ''; return '<button type="button" class="interaction-choice ' + (selected ? 'is-selected' : '') + '" data-interaction-select="' + item.id + '" aria-selected="' + selected + '" role="option"' + disabled + '><span class="interaction-choice-title">' + (item.title || item.prompt || 'Interacción') + '</span><span class="interaction-choice-prompt">' + (item.prompt || item.title || 'Elige una opción') + '</span>' + demo + '</button>'; }).join("") + '</div>'; }
function attachInteractionCloseSlider(control, interactionId) {
  if (!control || control.classList.contains("is-disabled")) return;
  let dragging = false;
  let startX = 0;
  let maxX = 1;
  let progress = 0;
  const reset = () => { progress = 0; control.style.setProperty("--close-progress", "0"); control.style.setProperty("--close-x", "0px"); control.classList.remove("is-complete"); };
  const update = (clientX) => { progress = Math.max(0, Math.min(1, (clientX - startX) / maxX)); control.style.setProperty("--close-progress", String(progress)); control.style.setProperty("--close-x", Math.round(progress * maxX) + "px"); control.classList.toggle("is-complete", progress >= 0.82); };
  const finish = (event) => { if (!dragging) return; dragging = false; control.releasePointerCapture?.(event.pointerId); if (progress >= 0.82) socket.emit("interaction:close", { interactionId }); else reset(); };
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
function renderInteractionPanel() {
  ensureInteractionsShell();
  syncInteractionShellState();
  const shell = interactionShell;
  const panel = pollsRenderer;
  const active = activeInteraction || null;
  const selected = selectedInteraction();
  const hasActive = Boolean(active);
  if (!hasActive) {
    if (shell.getView() !== "home" && !raffleController?.getState?.().active) shell.setView("polls");
    syncRendererVisibility();
    panel.innerHTML = '<div class="interaction-panel-heading"><h2>Encuestas</h2></div>' + (selected ? '<p>Encuestas disponibles</p><p>Selecciona una encuesta para lanzarla.</p>' + interactionListMarkup(false) : '<p>Este deck aún no tiene interacciones.</p>') + '<div class="interaction-panel-actions"><button class="primary" data-interaction-launch ' + (!selected ? 'disabled' : '') + '>Lanzar encuesta</button></div>';
    panel.querySelectorAll("[data-interaction-select]").forEach((button) => button.addEventListener("click", () => { selectedInteractionId = button.dataset.interactionSelect || ""; renderInteractionPanel(); }));
    panel.querySelector("[data-interaction-launch]")?.addEventListener("click", () => socket.emit("interaction:launch", { interactionId: selected?.id }));
    return;
  }
  const revealLabel = interactionResultsVisible ? 'Ocultar resultados' : 'Mostrar resultados';
  const closeControl = '<div class="interaction-close-slider" data-interaction-close-slider role="button" aria-label="Desliza para cerrar encuesta" tabindex="0" style="--close-progress:0;--close-x:0px"><span class="interaction-close-slider-track"></span><span class="interaction-close-slider-label">Desliza para cerrar encuesta</span><span class="interaction-close-slider-knob" aria-hidden="true">›</span></div>';
  shell.setView("polls");
  syncRendererVisibility();
  panel.innerHTML = '<div class="interaction-panel-heading"><span>Encuesta activa</span><h2>' + (active.title || 'Encuesta') + '</h2></div><p>' + (active.prompt || active.title || 'Interacción') + '</p>' + activeResultRows(active, interactionResults) + '<div class="interaction-panel-actions interaction-active-actions"><button data-interaction-reveal>' + revealLabel + '</button>' + closeControl + '</div>';
  panel.querySelector("[data-interaction-reveal]")?.addEventListener("click", () => { const eventName = interactionResultsVisible ? "interaction:hide_results" : "interaction:reveal_results"; socket.emit(eventName, { interactionId: activeInteraction?.id }); });
  attachInteractionCloseSlider(panel.querySelector("[data-interaction-close-slider]"), activeInteraction?.id);
}
document.getElementById("prev").addEventListener("click", () => socket.emit("slide_prev"));
document.getElementById("next").addEventListener("click", () => socket.emit("slide_next"));
playPause.addEventListener("click", () => socket.emit(currentState?.transmissionPaused ? "transmission_play" : "transmission_pause"));
audienceQr.addEventListener("click", () => publishAudienceQr(!audienceQrVisible(currentState)));
if (localReactions) localReactions.addEventListener("change", () => publishReactionsEnabled(localReactions.checked));
if (drawToggle) drawToggle.addEventListener("click", () => { drawingMode = !drawingMode; updateDrawingMode(); });
if (fullscreenToggle) fullscreenToggle.addEventListener("click", toggleFullscreen);
if (thumbsToggle) thumbsToggle.addEventListener("click", toggleThumbsPanel);
if (compactLandscapeQuery?.addEventListener) compactLandscapeQuery.addEventListener("change", syncThumbsPanelMode);
else if (compactLandscapeQuery?.addListener) compactLandscapeQuery.addListener(syncThumbsPanelMode);
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && interactionPanelOpen) setInteractionPanelOpen(false); });
socket.on("presentation_state", (state) => { if (manifest) render(state); });
socket.on("overlay_update", (overlays) => updateReactionToggle({ overlays }));
socket.on("audience_count", (count) => { audience.textContent = count; });
socket.on("reaction", ({ emoji, target }) => { if (target === "presenter") popReaction(emoji); });
socket.on("interaction:state", (state) => { activeInteraction = state?.active || null; if (activeInteraction?.id) selectedInteractionId = String(activeInteraction.id); else selectDefaultInteraction(); interactionResultsVisible = Boolean(state?.resultsVisible); if (!activeInteraction) interactionResults = null; renderInteractionPanel(); });
socket.on("interaction:active", (interaction) => { activeInteraction = interaction || null; if (activeInteraction?.id) selectedInteractionId = String(activeInteraction.id); interactionResults = null; interactionResultsVisible = false; renderInteractionPanel(); });
socket.on("interaction:results_updated", (results) => { interactionResults = results || null; renderInteractionPanel(); });
socket.on("interaction:closed", () => { activeInteraction = null; interactionResults = null; interactionResultsVisible = false; selectDefaultInteraction(); renderInteractionPanel(); returnInteractionsHome(); });
syncThumbsPanelMode();
ensureInteractionToggle();
loadDeck().then(() => { initDrawingOverlay(); updateDrawingMode(); socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "presenter" }); });
