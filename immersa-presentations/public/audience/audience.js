const params = new URLSearchParams(location.search);
const publicOpenContext = window.IMMERSA_PUBLIC_OPEN || {};
const eventLiveReturnKey = "immersa:event-live-return";
const sessionId = params.get("session") || publicOpenContext.session || "demo01";
const deckId = params.get("deck") || publicOpenContext.deck || "demo";
const socket = io();
window.ImmersaPresentationCompletion?.create({ socket, role: "audience", context: publicOpenContext });
let knowledgeActivityAudience = null;
let manifest = null;
let baseManifest = null;
let englishManifest = null;
let currentLocale = 'es';
let latestPresentationState = null;
const localePreferenceKey = 'immersa:locale:' + sessionId;
const tr = (key) => window.ImmersaI18n?.t(key) || key;
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
let activeInteraction = null;
let interactionResponse = null;
let selectedInteractionOption = "";
let interactionCard = null;
let qnaState = { questionsOpen: false, hasSubmitted: false, roundNumber: null };
let qnaSubmitting = false;
let qnaConfirmationTimer = null;
let qnaCooldownTimer = null;
let qnaCooldownUntil = 0;
let audienceAccessMessage = "";
const pointers = new Map();
const viewer = document.getElementById("viewer");
const viewport = document.getElementById("slideViewport");
const slide = document.getElementById("slide");
const snapshot = document.getElementById("snapshot");
const fullscreen = document.getElementById("fullscreen");
const audienceLocale = document.getElementById("audienceLocale");
const audienceQrToggle = document.getElementById("audienceQrToggle");
const audienceQrPanel = document.getElementById("audienceQrPanel");
const audienceQrPattern = document.getElementById("audienceQrPattern");
const connectionNotice = document.getElementById("connectionNotice");
const liveMessage = document.getElementById("liveMessage");
const qnaOpen = document.getElementById("qnaOpen");
const qnaComposer = document.getElementById("qnaComposer");
const qnaForm = document.getElementById("qnaForm");
const qnaClose = document.getElementById("qnaClose");
const qnaQuestion = document.getElementById("qnaQuestion");
const qnaName = document.getElementById("qnaName");
const qnaAllowName = document.getElementById("qnaAllowName");
const qnaFormStatus = document.getElementById("qnaFormStatus");
const qnaSubmit = document.getElementById("qnaSubmit");
const qnaConfirmation = document.getElementById("qnaConfirmation");
const audienceId = getAudienceId();
let audienceQrReady = false;
let eventLiveReturnChecking = false;
function eventLiveReturn() {
  try {
    const value = JSON.parse(sessionStorage.getItem(eventLiveReturnKey) || "null");
    if (!value || !/^[a-z0-9-]+$/i.test(String(value.liveSessionId || "")) || !/^[a-z0-9-]+$/i.test(String(value.participantId || "")) || !/^\/p_[a-z0-9_]+$/.test(String(value.returnPath || ""))) return null;
    return value;
  } catch (_error) { return null; }
}
async function returnToEventProgramIfClosed() {
  if (eventLiveReturnChecking) return;
  const state = eventLiveReturn();
  if (!state) return;
  eventLiveReturnChecking = true;
  try {
    const response = await fetch(`/api/event/live-sessions/${encodeURIComponent(state.liveSessionId)}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ participantId: state.participantId }) });
    const result = await response.json();
    if (!response.ok || result.live) return;
    sessionStorage.removeItem(eventLiveReturnKey);
    socket.disconnect?.();
    window.location.replace(state.returnPath);
  } catch (_error) {}
  finally { eventLiveReturnChecking = false; }
}
function audiencePublicUrl() {
  return publicOpenContext.public_url || window.location.href;
}
function ensureAudienceQr() {
  if (audienceQrReady || !audienceQrPattern) return;
  const url = audiencePublicUrl();
  if (!url) return;
  audienceQrPattern.innerHTML = "";
  if (window.QRCode) {
    new window.QRCode(audienceQrPattern, {
      text: url,
      width: 220,
      height: 220,
      colorDark: "#111111",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.M
    });
  } else {
    audienceQrPattern.textContent = url;
    audienceQrPattern.classList.add("is-fallback");
  }
  audienceQrReady = true;
}
function setAudienceQrVisible(visible) {
  if (visible) ensureAudienceQr();
  audienceQrPanel?.classList.toggle("hidden", !visible);
  audienceQrToggle?.classList.toggle("is-active", visible);
  audienceQrToggle?.setAttribute("aria-pressed", String(visible));
  if (audienceQrToggle) {
    audienceQrToggle.title = tr(visible ? 'audience.qr.hide' : 'audience.qr.show');
    audienceQrToggle.setAttribute("aria-label", audienceQrToggle.title);
  }
}
function setKnowledgeSnapshotAllowed(allowed) {
  if (!snapshot) return;
  snapshot.disabled = !allowed;
  snapshot.hidden = !allowed;
  snapshot.setAttribute("aria-hidden", allowed ? "false" : "true");
}
knowledgeActivityAudience = window.ImmersaKnowledgeActivities?.createAudience({
  socket,
  root: document.getElementById("knowledgeActivityAudience"),
  getLocale: () => currentLocale,
  onSnapshotAvailabilityChange: setKnowledgeSnapshotAllowed
});
function getAudienceId() { const key = "immersa:audience_id"; try { const existing = localStorage.getItem(key); if (existing) return existing; const value = "aud_" + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(key, value); return value; } catch (_error) { return "aud_" + Math.random().toString(36).slice(2) + Date.now().toString(36); } }
async function loadDeck() {
  const res = await fetch("/decks/" + deckId + "/manifest.json");
  baseManifest = await res.json();
  manifest = baseManifest;
  if (baseManifest.locales?.en?.active) {
    const en = await fetch("/decks/" + deckId + "/locales/en/manifest.json", { cache: 'no-store' }).catch(() => null);
    if (en?.ok) {
      const candidate = await en.json();
      if (candidate.slides?.length === baseManifest.slides?.length) {
        englishManifest = candidate;
        audienceLocale.hidden = false;
        try { if (localStorage.getItem(localePreferenceKey) === 'en') currentLocale = 'en'; } catch (_error) {}
        audienceLocale.value = currentLocale;
        manifest = currentLocale === 'en' ? { ...baseManifest, slides: englishManifest.slides } : baseManifest;
      }
    }
  }
  window.ImmersaI18n?.setLocale(currentLocale);
}
function slideUrl(index) { const item = manifest.slides[index]; return "/decks/" + deckId + "/" + (currentLocale === 'en' ? 'locales/en/' : '') + item.src; }
audienceLocale?.addEventListener('change', () => {
  currentLocale = audienceLocale.value === 'en' && englishManifest ? 'en' : 'es';
  manifest = currentLocale === 'en' ? { ...baseManifest, slides: englishManifest.slides } : baseManifest;
  try { localStorage.setItem(localePreferenceKey, currentLocale); } catch (_error) {}
  window.ImmersaI18n?.setLocale(currentLocale);
  updateFullscreenButton();
  setAudienceQrVisible(!audienceQrPanel?.classList.contains('hidden'));
  setConnectionNotice(!connectionNotice?.classList.contains('hidden'));
  renderQnaState(qnaState);
  if (latestPresentationState) render(latestPresentationState);
  else slide.src = slideUrl(currentSlideIndex);
  renderInteractionCard();
  knowledgeActivityAudience?.render?.();
  if (socket.connected) socket.emit('presentation:set_audience_locale', { locale: currentLocale });
});
function applySlideOrientation(item, src) { const portrait = item?.orientation === "portrait"; viewport.classList.toggle("portrait-slide", portrait); if (portrait) viewport.style.setProperty("--slide-bg", "url('" + src.replace(/'/g, "%27") + "')"); else viewport.style.removeProperty("--slide-bg"); }
function clamp(value, min, max) { return Math.max(min, Math.min(value, max)); }
function applyTransform() { slide.style.setProperty("--zoom", zoom); slide.style.setProperty("--pan-x", panX + "px"); slide.style.setProperty("--pan-y", panY + "px"); drawingOverlay?.refresh(); }
function resetZoom() { zoom = 1; panX = 0; panY = 0; applyTransform(); }
function applyLiveMessage(overlays = {}) { if (!liveMessage) return; const text = overlays.messageText || ""; const visible = Boolean(overlays.messageVisible && text); liveMessage.textContent = visible ? text : ""; liveMessage.classList.toggle("hidden", !visible); }
function render(state) { const index = state.liveSlideIndex ?? state.slideIndex; const nextIndex = Math.max(0, Math.min(index, manifest.slides.length - 1)); const previousIndex = currentSlideIndex; const changed = nextIndex !== previousIndex; if (changed) resetZoom(); currentSlideIndex = nextIndex; const item = manifest.slides[currentSlideIndex]; const src = slideUrl(currentSlideIndex); if (changed && window.ImmersaSlideTransitions?.swap) window.ImmersaSlideTransitions.swap(slide, src, manifest.slideTransition, nextIndex - previousIndex); else slide.src = src; window.ImmersaSlideTransitions?.preload([currentSlideIndex - 1, currentSlideIndex + 1].filter((slideIndex) => manifest.slides[slideIndex]).map(slideUrl)); applySlideOrientation(item, src); window.ImmersaDemoPlanBadge?.update(viewport, item, manifest); applyLiveMessage(state.overlays || {}); drawingOverlay?.refresh(); }
function popReaction(emoji) { const node = document.createElement("span"); node.className = "reaction"; node.textContent = emoji; node.style.left = Math.round(15 + Math.random() * 70) + "vw"; document.getElementById("reactions").appendChild(node); setTimeout(() => node.remove(), 2700); }
function takeSnapshot() { if (!manifest || snapshot?.disabled) return; const url = slideUrl(currentSlideIndex); const filename = "immersa-slide-" + (currentSlideIndex + 1) + ".jpg"; if ("download" in HTMLAnchorElement.prototype) { const link = document.createElement("a"); link.href = url; link.download = filename; link.rel = "noopener"; document.body.appendChild(link); link.click(); link.remove(); return; } window.open(url, "_blank", "noopener"); }
function distance(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
function center(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }
function pointerList() { return Array.from(pointers.values()); }
function beginGesture() { const active = pointerList(); startZoom = zoom; startPanX = panX; startPanY = panY; if (active.length >= 2) { startDistance = distance(active[0], active[1]); startCenter = center(active[0], active[1]); } else { startDistance = 0; startCenter = active[0] ? { x: active[0].clientX, y: active[0].clientY } : null; } }
function handlePointerDown(event) { viewport.setPointerCapture(event.pointerId); pointers.set(event.pointerId, event); beginGesture(); }
function handlePointerMove(event) { if (!pointers.has(event.pointerId)) return; pointers.set(event.pointerId, event); const active = pointerList(); if (active.length >= 2 && startDistance > 0) { const nextCenter = center(active[0], active[1]); zoom = clamp(startZoom * (distance(active[0], active[1]) / startDistance), 1, 3); panX = startPanX + (nextCenter.x - startCenter.x); panY = startPanY + (nextCenter.y - startCenter.y); if (zoom === 1) { panX = 0; panY = 0; } applyTransform(); return; } if (active.length === 1 && zoom > 1 && startCenter) { panX = startPanX + (active[0].clientX - startCenter.x); panY = startPanY + (active[0].clientY - startCenter.y); applyTransform(); } }
function handlePointerUp(event) { pointers.delete(event.pointerId); if (pointers.size) beginGesture(); const now = Date.now(); if (now - lastTapAt < 280) { resetZoom(); lastTapAt = 0; } else { lastTapAt = now; } }
function fullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
async function toggleFullscreen() {
  try {
    const active = fullscreenElement();
    if (active) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) await Promise.resolve(exit.call(document));
      return;
    }
    const target = document.documentElement;
    const request = target?.requestFullscreen || target?.webkitRequestFullscreen;
    if (request) await Promise.resolve(request.call(target));
  } catch (_error) {}
}
function updateFullscreenButton() {
  const active = Boolean(fullscreenElement());
  fullscreen.classList.toggle("is-active", active);
  fullscreen.setAttribute("aria-pressed", String(active));
  fullscreen.setAttribute("aria-label", tr(active ? 'audience.fullscreen.exit' : 'audience.fullscreen'));
  fullscreen.title = tr(active ? 'audience.fullscreen.exit' : 'audience.fullscreen');
}
function setConnectionNotice(visible) {
  if (!connectionNotice) return;
  connectionNotice.textContent = audienceAccessMessage || tr('audience.connection.paused');
  connectionNotice.classList.toggle("hidden", !visible);
}
function closeQnaComposer() { qnaComposer?.classList.add("hidden"); qnaComposer?.setAttribute("aria-hidden", "true"); qnaFormStatus.textContent = ""; }
function openQnaComposer() { if (!qnaState.questionsOpen || qnaState.hasSubmitted) return; qnaComposer?.classList.remove("hidden"); qnaComposer?.setAttribute("aria-hidden", "false"); qnaFormStatus.textContent = ""; window.setTimeout(() => qnaQuestion?.focus(), 20); }
function scheduleQnaCooldown(remainingMs) {
  window.clearTimeout(qnaCooldownTimer);
  const delay = Math.max(0, Number(remainingMs) || 0);
  qnaCooldownUntil = delay ? Date.now() + delay : 0;
  if (!delay) return;
  qnaCooldownTimer = window.setTimeout(() => {
    qnaCooldownTimer = null;
    qnaCooldownUntil = 0;
    renderQnaState({ ...qnaState, hasSubmitted: false, cooldownRemainingMs: 0 });
  }, delay + 25);
}
function renderQnaState(state = {}) {
  const cooldownRemainingMs = Math.max(0, Number(state.cooldownRemainingMs) || 0);
  if (cooldownRemainingMs > 0) scheduleQnaCooldown(cooldownRemainingMs);
  else if (state.hasSubmitted && qnaCooldownUntil <= Date.now()) scheduleQnaCooldown(10_000);
  qnaState = {
    questionsOpen: Boolean(state.questionsOpen),
    hasSubmitted: Boolean(state.hasSubmitted) && qnaCooldownUntil > Date.now(),
    roundNumber: Number.isFinite(Number(state.roundNumber)) ? Number(state.roundNumber) : null,
    cooldownRemainingMs: Math.max(0, qnaCooldownUntil - Date.now())
  };
  const visible = qnaState.questionsOpen && !qnaState.hasSubmitted;
  qnaOpen?.classList.toggle("hidden", !visible);
  if (qnaOpen) {
    qnaOpen.disabled = qnaState.hasSubmitted;
    qnaOpen.classList.toggle("is-submitted", qnaState.hasSubmitted);
    qnaOpen.setAttribute("aria-label", tr(qnaState.hasSubmitted ? 'audience.qna.sent' : 'audience.qna.open'));
    qnaOpen.title = tr(qnaState.hasSubmitted ? 'audience.qna.sent' : 'audience.qna.open');
  }
  if (!visible || qnaState.hasSubmitted) closeQnaComposer();
}
function showQnaConfirmation(message) {
  if (!qnaConfirmation) return;
  window.clearTimeout(qnaConfirmationTimer);
  qnaConfirmation.textContent = message;
  qnaConfirmation.classList.remove("hidden");
  qnaConfirmationTimer = window.setTimeout(() => qnaConfirmation.classList.add("hidden"), 4200);
}
function qnaRejectedMessage(reason) {
  if (reason === "QNA_CLOSED") return tr('audience.qna.closed');
  if (reason === "QNA_COOLDOWN") return tr('audience.qna.cooldown');
  if (reason === "QNA_INVALID_INPUT") return tr('audience.qna.empty');
  return tr('audience.qna.unavailable');
}
function submitQna(event) {
  event.preventDefault();
  if (qnaSubmitting || qnaState.hasSubmitted || !qnaState.questionsOpen) return;
  const question = String(qnaQuestion?.value || "").trim();
  if (!question) { qnaFormStatus.textContent = tr('audience.qna.empty'); qnaQuestion?.focus(); return; }
  const name = String(qnaName?.value || "").trim();
  qnaSubmitting = true;
  qnaSubmit.disabled = true;
  qnaFormStatus.textContent = tr('audience.qna.sending');
  socket.emit("qna:submit", {
    question,
    name,
    allowNameOnScreen: Boolean(name && qnaAllowName?.checked)
  });
}
function joinAudience() {
  if (!manifest) return;
  socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "audience", audienceId, locale: currentLocale });
}
function initDrawingOverlay() { if (drawingOverlay || !window.ImmersaDrawingOverlay) return; drawingOverlay = window.ImmersaDrawingOverlay.create({ root: viewport, slide, getSlideIndex: () => currentSlideIndex, zIndex: 2 }); }
function ensureInteractionCard() { if (interactionCard) return interactionCard; interactionCard = document.createElement("section"); interactionCard.className = "interaction-card interaction-hidden"; interactionCard.setAttribute("aria-label", "Interacción activa"); viewer.appendChild(interactionCard); return interactionCard; }
function pollForAudience(interaction) {
  if (currentLocale !== 'en' || !englishManifest || !interaction?.en?.prompt?.trim()) return interaction;
  const englishOptions = interaction.en.options || {};
  if (!interaction.options?.every((option) => String(englishOptions[option.id] || '').trim())) return interaction;
  return { ...interaction, prompt: interaction.en.prompt, options: interaction.options.map((option) => ({ ...option, label: englishOptions[option.id] })) };
}
function renderInteractionCard() { const card = ensureInteractionCard(); if (!activeInteraction) { card.classList.add("interaction-hidden"); card.innerHTML = ""; return; } const answered = Boolean(interactionResponse); const displayInteraction = pollForAudience(activeInteraction); const options = displayInteraction.options || []; card.classList.remove("interaction-hidden"); card.innerHTML = '<h2>' + (currentLocale === 'en' && displayInteraction !== activeInteraction ? tr('audience.poll.title') : (activeInteraction.title || tr('audience.poll.title'))) + '</h2><p>' + (displayInteraction.prompt || tr('audience.poll.default')) + '</p><div class="interaction-options">' + options.map((option) => '<button class="interaction-option ' + (selectedInteractionOption === option.id || interactionResponse?.optionId === option.id ? 'is-selected' : '') + '" type="button" data-option-id="' + option.id + '" ' + (answered ? 'disabled' : '') + '>' + option.label + '</button>').join("") + '</div><div class="interaction-card-actions"><button class="primary" type="button" data-submit ' + (!selectedInteractionOption || answered ? 'disabled' : '') + '>' + tr(answered ? 'audience.poll.sent' : 'audience.poll.submit') + '</button></div>' + (answered ? '<div class="interaction-accepted">' + tr('audience.poll.registered') + '</div>' : ''); card.querySelectorAll("[data-option-id]").forEach((button) => button.addEventListener("click", () => { selectedInteractionOption = button.dataset.optionId; renderInteractionCard(); })); card.querySelector("[data-submit]")?.addEventListener("click", () => { if (!activeInteraction || !selectedInteractionOption || answered) return; socket.emit("interaction:submit_response", { interactionId: activeInteraction.id, audienceId, optionId: selectedInteractionOption }); }); }
document.querySelectorAll("[data-emoji]").forEach((button) => button.addEventListener("click", () => socket.emit("reaction", { emoji: button.dataset.emoji })));
snapshot.addEventListener("click", takeSnapshot);
fullscreen.addEventListener("click", toggleFullscreen);
audienceQrToggle?.addEventListener("click", () => setAudienceQrVisible(audienceQrPanel?.classList.contains("hidden")));
qnaOpen?.addEventListener("click", openQnaComposer);
qnaClose?.addEventListener("click", closeQnaComposer);
qnaComposer?.addEventListener("click", (event) => { if (event.target === qnaComposer) closeQnaComposer(); });
qnaForm?.addEventListener("submit", submitQna);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!audienceQrPanel?.classList.contains("hidden")) setAudienceQrVisible(false);
  else if (!qnaComposer?.classList.contains("hidden")) closeQnaComposer();
});
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
viewport.addEventListener("pointerdown", handlePointerDown);
viewport.addEventListener("pointermove", handlePointerMove);
viewport.addEventListener("pointerup", handlePointerUp);
viewport.addEventListener("pointercancel", handlePointerUp);
socket.on("connect", () => { audienceAccessMessage = ""; setConnectionNotice(false); joinAudience(); });
socket.on("plan:audience_limit", (payload = {}) => {
  audienceAccessMessage = tr('audience.connection.limit');
  setConnectionNotice(true);
});
socket.on("disconnect", () => setConnectionNotice(true));
socket.io?.on?.("reconnect", () => { setConnectionNotice(false); joinAudience(); });
socket.io?.on?.("reconnect_error", () => setConnectionNotice(true));
socket.io?.on?.("reconnect_failed", () => setConnectionNotice(true));
returnToEventProgramIfClosed();
window.setInterval(returnToEventProgramIfClosed, 3000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) returnToEventProgramIfClosed(); });
socket.on("presentation_state", (state) => { latestPresentationState = state; returnToEventProgramIfClosed(); if (manifest) render(state); });
socket.on("overlay_update", applyLiveMessage);
socket.on("clear_overlays", () => applyLiveMessage({ messageVisible: false, messageText: "" }));
socket.on("reaction", ({ emoji, target }) => { if (target === "audience") popReaction(emoji); });
socket.on("drawing_stroke", (stroke) => drawingOverlay?.addStroke(stroke));
socket.on("interaction:state", (state) => { activeInteraction = state?.active || null; interactionResponse = state?.response || null; if (!activeInteraction) selectedInteractionOption = ""; else if (interactionResponse) selectedInteractionOption = interactionResponse.optionId; renderInteractionCard(); });
socket.on("interaction:active", (interaction) => { activeInteraction = interaction || null; interactionResponse = null; selectedInteractionOption = ""; renderInteractionCard(); });
socket.on("interaction:response_accepted", ({ optionId, submittedAt }) => { interactionResponse = { optionId, submittedAt }; selectedInteractionOption = optionId; renderInteractionCard(); });
socket.on("interaction:response_rejected", ({ reason }) => { if (reason === "duplicate_response") interactionResponse = { optionId: selectedInteractionOption, submittedAt: "" }; renderInteractionCard(); });
socket.on("interaction:closed", () => { activeInteraction = null; interactionResponse = null; selectedInteractionOption = ""; renderInteractionCard(); });
socket.on("qna:state", renderQnaState);
socket.on("qna:submitted", ({ message }) => {
  qnaSubmitting = false;
  qnaSubmit.disabled = false;
  qnaState.hasSubmitted = true;
  renderQnaState(qnaState);
  qnaForm?.reset();
  showQnaConfirmation(currentLocale === 'en' ? tr('audience.qna.confirmed') : (message || tr('audience.qna.confirmed')));
});
socket.on("qna:rejected", ({ event, reason }) => {
  if (event !== "qna:submit" && event !== "qna:state") return;
  qnaSubmitting = false;
  qnaSubmit.disabled = false;
  const message = qnaRejectedMessage(reason);
  qnaFormStatus.textContent = message;
  if (reason === "QNA_COOLDOWN") {
    qnaState.hasSubmitted = true;
    scheduleQnaCooldown(qnaCooldownUntil > Date.now() ? qnaCooldownUntil - Date.now() : 10_000);
    renderQnaState(qnaState);
  }
  if (reason === "QNA_CLOSED") renderQnaState({ ...qnaState, questionsOpen: false });
});
applyTransform();
loadDeck().then(() => { initDrawingOverlay(); joinAudience(); });
