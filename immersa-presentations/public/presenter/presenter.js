const params = new URLSearchParams(location.search);
const roleOpenContext = window.IMMERSA_ROLE_OPEN || {};
const sessionId = params.get("session") || roleOpenContext.session || roleOpenContext.session_id || "demo01";
const deckId = params.get("deck") || roleOpenContext.deck || roleOpenContext.deckId || "demo";
const interactionsFeatureEnabled = roleOpenContext.features?.interactions !== false;
const demoModeBadge = document.getElementById("demoModeBadge");
if (demoModeBadge) demoModeBadge.hidden = roleOpenContext.demo_mode !== true;
const socket = io();
const overlaySocket = io();
const raffleController = window.ImmersaRaffleControls?.createController ? window.ImmersaRaffleControls.createController(socket, { installLegacyIntegration: false, onStateChange: (_state, eventName) => { if (eventName === "raffle:closed") returnInteractionsHome(); else syncInteractionShellState(); } }) : null;
let manifest = null;
let interactions = [];
let videoSlideIds = new Set();
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
const prevSlide = document.getElementById("prev");
const nextSlide = document.getElementById("next");
const playPause = document.getElementById("playPause");
const localReactions = document.getElementById("localReactions");
const audienceQr = document.getElementById("audienceQr");
const drawToggle = document.getElementById("drawToggle");
const liveTextToggle = document.getElementById("liveTextToggle");
const interactionToggle = document.getElementById("interactionToggle");
const fullscreenToggle = document.getElementById("fullscreenToggle");
const thumbsToggle = document.getElementById("thumbsToggle");
const thumbs = document.getElementById("thumbs");
const deckNotice = document.getElementById("deckNotice");
let qnaAvailable = false;
const qnaControls = window.ImmersaQnaControls?.create({
  socket,
  role: "presenter",
  launcher: false,
  onAvailabilityChange: ({ available }) => {
    qnaAvailable = Boolean(available);
    interactionShell?.setCategoryVisible?.("qna", qnaAvailable);
  }
});
const liveTextControl = window.ImmersaLiveTextControl?.create({
  socket,
  button: liveTextToggle,
  modal: document.getElementById("presenterTextModal"),
  form: document.getElementById("presenterMessageForm"),
  input: document.getElementById("presenterMessageInput"),
  cancelButton: document.getElementById("presenterCancelMessage"),
  linkButton: document.getElementById("presenterDisplayLinkButton"),
  getPublicUrl: () => roleUrl("audience"),
  labelMode: "icon",
  inactiveLabel: "Texto en vivo",
  activeLabel: "Apagar texto"
});
const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" class="pause-icon"><path d="M9 6V18"></path><path d="M15 6V18"></path></svg>';
const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" class="play-icon"><path d="M9 6L18 12L9 18Z"></path></svg>';
const compactLandscapeQuery = window.matchMedia ? window.matchMedia("(orientation: landscape) and (max-height: 520px)") : null;
const interactionLaunchRocketMarkup = '<svg class="interaction-launch-rocket" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><g><path d="M 463.19 589.25 C410.78,641.72 392.94,659.00 391.19,659.00 C388.96,659.00 388.88,658.76 389.48,653.75 C389.82,650.86 390.27,646.92 390.47,645.00 C390.68,643.08 391.27,639.70 391.79,637.50 C392.31,635.30 393.30,630.12 393.97,626.00 C394.65,621.88 396.28,612.42 397.60,605.00 C400.28,589.87 401.54,582.67 402.98,574.25 C403.52,571.09 404.62,564.90 405.42,560.50 C406.22,556.10 407.39,549.12 408.01,545.00 C408.64,540.88 409.55,535.70 410.04,533.50 C410.53,531.30 411.60,525.67 412.41,521.00 L 412.70 519.37 C414.69,508.01 415.10,505.62 414.32,505.12 C414.11,504.99 413.82,504.99 413.45,505.00 C413.38,505.00 413.31,505.00 413.25,505.00 C412.23,505.00 410.97,505.41 410.45,505.90 C409.93,506.40 401.73,510.03 392.23,513.96 C376.14,520.63 374.73,521.03 371.67,519.93 C368.43,518.76 368.31,518.82 362.57,524.84 C359.37,528.20 356.02,531.18 355.12,531.47 C354.23,531.76 352.73,533.35 351.80,535.00 C349.81,538.50 348.02,538.78 345.50,536.00 C342.99,533.23 340.97,533.49 337.64,537.02 C335.97,538.79 334.96,540.23 333.63,540.65 C330.32,541.69 325.01,536.40 302.57,514.01 C300.50,511.95 298.29,509.74 295.92,507.37 C276.71,488.24 261.00,472.10 261.00,471.50 C261.00,470.90 262.80,468.65 265.00,466.50 C269.48,462.12 269.92,460.14 267.00,457.50 C265.90,456.50 265.00,455.34 265.00,454.90 C265.00,454.47 269.27,449.97 274.50,444.90 C283.36,436.29 285.44,433.01 283.00,431.50 C281.79,430.75 281.68,426.77 282.83,425.45 C283.29,424.93 285.60,419.55 287.97,413.50 C290.34,407.45 293.56,399.83 295.14,396.57 C299.49,387.56 299.32,387.26 291.00,389.06 C288.52,389.60 283.80,390.46 280.50,390.98 C273.36,392.10 266.66,393.26 254.50,395.47 C249.55,396.37 243.01,397.48 239.96,397.95 C234.58,398.76 215.64,402.09 205.50,404.00 C202.75,404.52 196.45,405.65 191.50,406.53 C186.55,407.40 180.25,408.53 177.50,409.03 C174.75,409.54 166.88,410.89 160.00,412.04 C153.12,413.19 146.26,414.36 144.75,414.64 C142.82,415.01 142.00,414.74 142.00,413.76 C142.00,412.99 173.94,380.47 212.98,341.48 C279.48,275.08 284.27,270.52 288.73,269.35 C291.35,268.65 294.73,268.07 296.24,268.04 C297.74,268.02 300.89,267.57 303.24,267.04 C310.50,265.41 323.13,263.13 331.50,261.95 C335.90,261.33 344.84,259.73 351.37,258.41 C357.90,257.08 364.55,256.00 366.14,256.00 C368.47,256.00 369.68,255.07 372.27,251.33 C379.39,241.03 394.85,219.79 400.63,212.37 C424.34,181.93 453.29,153.43 479.46,134.77 C483.88,131.62 487.95,128.69 488.50,128.26 C498.10,120.78 529.40,104.08 546.00,97.56 C551.22,95.51 556.85,93.25 558.50,92.54 C560.15,91.82 563.53,90.68 566.00,90.00 C568.47,89.32 571.62,88.38 573.00,87.91 C574.38,87.44 580.45,85.90 586.50,84.48 C592.55,83.07 598.40,81.70 599.50,81.43 C619.96,76.44 675.63,75.94 701.00,80.53 C705.67,81.37 711.64,82.33 714.26,82.66 L 719.02 83.26 L 720.60 88.70 C721.47,91.69 722.32,96.69 722.49,99.82 C722.90,107.36 724.78,126.67 725.51,130.75 C725.83,132.54 726.52,134.00 727.05,134.00 C728.67,134.00 728.24,157.70 726.56,160.29 C725.60,161.77 724.78,167.93 724.07,179.00 C722.78,199.14 719.08,217.70 712.23,238.50 C705.43,259.10 696.38,279.81 688.63,292.44 C686.91,295.25 684.97,298.44 684.32,299.52 C677.84,310.38 672.31,318.68 668.99,322.51 C666.80,325.05 665.00,327.54 665.00,328.05 C665.00,328.56 662.86,331.42 660.25,334.40 C657.64,337.37 653.92,341.96 652.00,344.59 C646.29,352.40 627.37,371.58 614.50,382.62 C607.90,388.28 600.46,394.71 597.96,396.90 C595.46,399.10 592.20,401.35 590.71,401.92 C589.22,402.49 588.00,403.37 588.00,403.89 C588.00,405.45 553.01,431.00 550.86,431.00 C549.47,431.00 546.05,439.01 546.02,442.31 C546.01,443.85 545.58,447.00 545.08,449.31 C544.57,451.61 543.41,458.00 542.51,463.50 C541.61,469.00 540.49,475.30 540.03,477.50 C539.56,479.70 538.71,484.42 538.14,488.00 C537.57,491.58 536.43,498.33 535.61,503.00 C534.80,507.67 533.85,513.30 533.50,515.50 C532.91,519.20 527.58,524.79 463.19,589.25 ZM 590.18 257.88 C598.54,259.27 602.94,259.11 611.00,257.13 C628.72,252.78 641.82,242.36 648.89,227.00 C658.96,205.12 654.15,179.71 636.84,163.41 C632.09,158.93 622.81,153.00 620.54,153.00 C619.76,153.00 618.87,152.60 618.57,152.11 C617.12,149.77 595.90,148.30 588.00,149.99 C572.13,153.39 557.29,165.21 550.20,180.10 C544.78,191.49 543.43,199.42 545.00,210.52 C545.70,215.40 547.25,221.12 548.61,223.80 C549.92,226.38 550.99,228.84 551.00,229.25 C551.01,231.10 558.48,240.12 563.95,244.88 C570.83,250.86 582.37,256.58 590.18,257.88 ZM 187.01 575.51 C144.66,617.86 109.45,652.61 108.76,652.74 C107.11,653.06 99.00,645.35 99.00,643.46 C99.00,642.66 99.41,642.00 99.91,642.00 C100.41,642.00 135.23,607.58 177.28,565.50 C219.33,523.42 254.38,489.00 255.17,489.00 C256.75,489.00 264.00,496.02 264.00,497.56 C264.00,498.09 229.35,533.17 187.01,575.51 ZM 170.50 641.52 C127.87,684.13 92.66,718.99 92.25,718.97 C91.21,718.94 83.00,711.10 83.00,710.14 C83.00,708.80 237.89,554.49 238.98,554.75 C240.11,555.03 248.00,562.70 248.00,563.52 C248.00,563.80 213.12,598.90 170.50,641.52 ZM 229.06 637.07 C186.75,679.38 151.52,714.00 150.77,714.00 C149.22,714.00 142.00,706.94 142.00,705.42 C142.00,704.27 295.32,550.73 297.04,550.15 C298.47,549.68 306.00,556.92 306.00,558.77 C306.00,559.53 271.38,594.76 229.06,637.07 Z" fill="currentColor"/><path d="M 704.83 81.20 C703.52,80.97 702.22,80.75 701.00,80.53 C678.71,76.50 632.99,76.39 608.36,79.81 C617.30,78.25 627.87,76.63 633.50,76.02 C644.95,74.79 672.00,74.77 672.00,76.00 C672.00,76.55 674.34,77.00 677.19,77.00 C681.32,77.00 693.99,78.95 704.83,81.20 ZM 727.96 138.87 C727.81,135.99 727.52,134.00 727.05,134.00 C726.52,134.00 725.83,132.54 725.51,130.75 C724.78,126.67 722.90,107.36 722.49,99.82 C722.34,97.02 721.64,92.71 720.87,89.70 C721.72,92.50 722.68,95.05 723.10,95.58 C723.58,96.18 724.22,101.35 724.54,107.08 C725.26,120.29 725.86,124.21 727.05,123.47 C727.53,123.18 727.85,128.87 727.96,138.87 ZM 720.25 208.45 C722.18,198.71 723.42,189.05 724.07,179.00 C724.78,167.93 725.60,161.77 726.56,160.29 C727.32,159.12 727.83,153.61 728.00,147.94 C727.99,167.34 727.75,170.88 726.50,171.36 C725.45,171.77 725.00,173.41 725.00,176.90 C725.00,183.38 723.08,195.52 720.25,208.45 ZM 598.66 81.63 C596.58,82.12 591.61,83.29 586.50,84.48 C580.45,85.90 574.38,87.44 573.00,87.91 C571.62,88.38 568.47,89.32 566.00,90.00 C568.47,89.32 571.62,88.38 573.00,87.90 C575.65,86.98 589.14,83.66 597.50,81.87 C597.87,81.79 598.26,81.71 598.66,81.63 Z" fill="currentColor"/><path d="M 704.83 81.20 C693.99,78.95 681.32,77.00 677.19,77.00 C674.34,77.00 672.00,76.55 672.00,76.00 C672.00,75.46 666.75,75.16 659.90,75.10 C673.62,75.00 687.00,75.30 687.00,76.00 C687.00,76.55 688.33,77.00 689.95,77.00 C695.27,77.00 715.00,81.04 715.00,82.14 C715.00,82.44 715.37,82.72 715.93,82.87 L 714.26 82.66 C712.32,82.42 708.55,81.83 704.83,81.20 ZM 720.25 208.45 C723.08,195.52 725.00,183.38 725.00,176.90 C725.00,173.41 725.45,171.77 726.50,171.36 C727.75,170.88 727.99,167.34 728.00,147.94 L 728.00 148.65 C728.00,176.63 727.74,183.40 726.62,184.52 C725.86,185.28 724.94,188.06 724.58,190.70 C723.18,200.77 720.63,213.00 719.92,213.00 C719.51,213.00 718.85,214.91 718.46,217.25 C718.14,219.16 716.73,224.09 714.88,230.03 C717.06,222.67 718.84,215.54 720.25,208.45 ZM 727.96 138.87 C727.85,128.87 727.53,123.18 727.05,123.47 C725.86,124.21 725.26,120.29 724.54,107.08 C724.37,103.94 724.09,100.97 723.81,98.83 C724.19,100.63 724.63,103.05 725.00,105.50 C725.66,109.90 726.60,113.65 727.10,113.83 C727.52,113.99 727.86,124.32 727.97,139.01 ZM 700.87 268.27 C704.01,261.07 707.09,253.27 709.88,245.35 C707.81,251.45 705.83,256.96 704.54,260.00 C703.51,262.45 702.24,265.30 700.87,268.27 ZM 721.58 91.90 C721.34,91.21 721.10,90.46 720.87,89.70 C720.79,89.36 720.70,89.04 720.61,88.74 C720.92,89.81 721.26,90.90 721.58,91.90 ZM 717.55 83.07 L 716.98 83.00 C717.18,83.00 717.37,83.02 717.55,83.07 Z" fill="currentColor"/></g></svg>';
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
let assessmentRenderer = null;
let contestRenderer = null;
let raffleHostRegistration = null;
let interactionPanelOpen = false;
let knowledgeActivitiesAvailable = false;
const knowledgeActivityController = window.ImmersaKnowledgeActivities?.createController({
  socket,
  deckId,
  role: "presenter",
  onAvailabilityChange: (available) => {
    knowledgeActivitiesAvailable = Boolean(available);
    interactionShell?.setCategoryVisible?.("assessments", knowledgeActivitiesAvailable);
    interactionShell?.setCategoryVisible?.("contests", knowledgeActivitiesAvailable);
  },
  onStateChange: () => syncInteractionShellState()
});
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
  socket.emit("overlay_update", { overlays: { showAudienceQr: visible, qrVisible: visible, audienceUrl } });
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
async function loadDeck() { const res = await fetch("/decks/" + deckId + "/manifest.json"); manifest = await res.json(); renderDeckNotice(); total.textContent = manifest.slides.length; await loadInteractions(); renderThumbs(); }
function normalizeInteractionList(data) { const list = Array.isArray(data) ? data : Array.isArray(data?.interactions) ? data.interactions : []; return list.filter((item) => item && item.id && item.type && Array.isArray(item.options) && item.options.length); }
function clearSelectedInteraction() { selectedInteractionId = ""; }
async function loadInteractions() { try { const res = await fetch("/decks/" + deckId + "/interactions.json", { cache: "no-store" }); if (!res.ok) throw new Error("No interactions"); const data = await res.json(); interactions = normalizeInteractionList(data); videoSlideIds = new Set((Array.isArray(data?.videos) ? data.videos : []).map((video) => String(video?.slide_id || "")).filter(Boolean)); if (!interactions.length) interactions = [fallbackDemoInteraction]; } catch (_error) { interactions = [fallbackDemoInteraction]; videoSlideIds = new Set(); } clearSelectedInteraction(); renderInteractionPanel(); }
function selectedInteraction() { return selectedInteractionId ? interactions.find((item) => String(item.id) === String(selectedInteractionId)) || null : null; }
function assetSrc(item, kind = "src") { return "/decks/" + deckId + "/" + (kind === "thumb" && item.thumb ? item.thumb : item.src); }
function slideSrc(index) { return assetSrc(manifest.slides[index]); }
function slideIdentity(item, index) { return String(item?.id || "slide-" + String(index + 1).padStart(3, "0")); }
function videoThumbMark(index) { const gradientId = "immersa-video-gradient-" + (index + 1); return '<span class="thumb-video-mark" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><defs><linearGradient id="' + gradientId + '" x1="4" y1="20" x2="20" y2="4" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#68d8cc"/><stop offset=".52" stop-color="#4368f6"/><stop offset="1" stop-color="#9b4cff"/></linearGradient></defs><path d="M6.5 4.75 19 12 6.5 19.25Z" fill="none" stroke="url(#' + gradientId + ')" stroke-width="3.1" stroke-linejoin="round"/></svg></span>'; }
function applySlideOrientation(container, item, src) { const portrait = item?.orientation === "portrait"; container.classList.toggle("portrait-slide", portrait); if (portrait) container.style.setProperty("--slide-bg", "url('" + src.replace(/'/g, "%27") + "')"); else container.style.removeProperty("--slide-bg"); }
function presenterNavigationLocked(state = currentState) { return Boolean(state?.transmissionPaused && state?.transmissionPausedBy !== "presenter"); }
function renderThumbs() { thumbs.innerHTML = ""; manifest.slides.forEach((item, index) => { const slideNumber = index + 1; const hasVideo = videoSlideIds.has(slideIdentity(item, index)); const button = document.createElement("button"); button.type = "button"; button.className = "thumb" + (hasVideo ? " has-video" : ""); button.setAttribute("aria-label", "Ir a lámina " + slideNumber + (item.title ? ": " + item.title : "") + (hasVideo ? " · contiene video" : "")); button.title = (item.title ? "Lámina " + slideNumber + " · " + item.title : "Lámina " + slideNumber) + (hasVideo ? " · Video" : ""); button.innerHTML = '<span class="thumb-number">' + slideNumber + '</span><img alt="" src="' + assetSrc(item, "thumb") + '">' + (hasVideo ? videoThumbMark(index) : ""); button.addEventListener("click", () => { if (presenterNavigationLocked()) return; socket.emit("slide_go", { slideIndex: index }); closeThumbsPanel(); }); thumbs.appendChild(button); }); }
function render(state) { currentState = state; const index = state.presenterSlideIndex ?? state.slideIndex; currentSlideIndex = index; const item = manifest.slides[index]; const src = slideSrc(index); slide.src = src; applySlideOrientation(streamArea, item, src); drawingOverlay?.refresh(); current.textContent = index + 1; audience.textContent = state.audienceCount || 0; playPause.innerHTML = state.transmissionPaused ? playIcon : pauseIcon; playPause.classList.toggle("is-paused", state.transmissionPaused); playPause.title = state.transmissionPaused ? "Reanudar transmisión" : "Pausar transmisión"; playPause.setAttribute("aria-label", playPause.title); const navigationLocked = presenterNavigationLocked(state); prevSlide.disabled = navigationLocked || index <= 0; nextSlide.disabled = navigationLocked || index >= manifest.slides.length - 1; updateAudienceQrButton(state); updateReactionToggle(state); liveTextControl?.sync(state.overlays || {}); document.querySelectorAll(".thumb").forEach((node, i) => { node.disabled = navigationLocked; node.classList.toggle("active", i === index); node.classList.toggle("live", i === state.liveSlideIndex); }); }
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
    categoryVisibility: {
      qna: qnaAvailable,
      assessments: knowledgeActivitiesAvailable,
      contests: knowledgeActivitiesAvailable
    },
    onSelectCategory: (view) => {
      if (view === "qna") {
        interactionShell.setView("home");
        syncRendererVisibility();
        setInteractionPanelOpen(false);
        qnaControls?.open();
        return;
      }
      if (view === "polls") renderInteractionPanel();
      if (view === "raffles") renderRafflePanel();
      if (view === "assessments" || view === "contests") syncRendererVisibility();
      if (view === "home") syncInteractionShellState();
    },
    onRequestClose: closeInteractionPanelRequest
  });
  pollsRenderer = document.createElement("div");
  pollsRenderer.className = "interaction-polls-renderer";
  raffleRenderer = document.createElement("div");
  raffleRenderer.className = "interaction-raffle-renderer";
  assessmentRenderer = document.createElement("div");
  assessmentRenderer.className = "interaction-knowledge-renderer";
  assessmentRenderer.dataset.interactionsView = "assessments";
  contestRenderer = document.createElement("div");
  contestRenderer.className = "interaction-knowledge-renderer";
  contestRenderer.dataset.interactionsView = "contests";
  interactionShell.getContentRoot().append(pollsRenderer, raffleRenderer, assessmentRenderer, contestRenderer);
  if (raffleController?.mountHost) {
    raffleHostRegistration = raffleController.mountHost({ role: "presenter", root: raffleRenderer, isActive: () => interactionShell.getView() === "raffles" });
  }
  knowledgeActivityController?.mountHost?.({ root: assessmentRenderer, category: "assessment" });
  knowledgeActivityController?.mountHost?.({ root: contestRenderer, category: "contest" });
  syncInteractionShellState();
  return interactionShell;
}
function knowledgeActivityView() {
  const category = knowledgeActivityController?.getState?.().category;
  return category === "contest" ? "contests" : category === "assessment" ? "assessments" : "";
}
function activeInteractionView() { return activeInteraction ? "polls" : (raffleController?.getState?.().active ? "raffles" : knowledgeActivityView() || "home"); }
function hasActiveInteractionShellLock() { return Boolean(activeInteraction || raffleController?.getState?.().active || knowledgeActivityView()); }
function resetInactiveRaffleDraft() { if (hasActiveInteractionShellLock()) return false; return raffleController?.resetLocalSetup?.() || false; }
function syncRendererVisibility() {
  if (!interactionShell) return;
  if (pollsRenderer) pollsRenderer.hidden = interactionShell.getView() !== "polls";
  if (raffleRenderer) raffleRenderer.hidden = interactionShell.getView() !== "raffles";
  if (assessmentRenderer) assessmentRenderer.hidden = interactionShell.getView() !== "assessments";
  if (contestRenderer) contestRenderer.hidden = interactionShell.getView() !== "contests";
}
function returnInteractionsHome() {
  const shell = ensureInteractionsShell();
  if (!shell) return;
  shell.setLocked(false);
  shell.setCloseVisible(true);
  shell.setTitleVisible?.(true);
  shell.setView("home");
  syncRendererVisibility();
}
function syncInteractionShellState() {
  const shell = ensureInteractionsShell();
  if (!shell) return;
  const activeRaffle = Boolean(raffleController?.getState?.().active);
  const activePoll = Boolean(activeInteraction);
  const activeKnowledge = knowledgeActivityView();
  const locked = activePoll || activeRaffle || Boolean(activeKnowledge);
  const view = activePoll ? "polls" : activeRaffle ? "raffles" : activeKnowledge || shell.getView();
  shell.setLocked(locked);
  shell.setCloseVisible(!locked);
  shell.setLiveView?.(activePoll ? "polls" : activeRaffle ? "raffles" : activeKnowledge);
  if (activePoll || activeRaffle || shell.getView() === "home") shell.setView(activeInteractionView());
  shell.setTitleVisible?.(true);
  syncRendererVisibility();
  if (locked && !interactionPanelOpen) setInteractionPanelOpen(true);
}
function renderRafflePanel() {
  const shell = ensureInteractionsShell();
  if (!shell) return;
  shell.setView("raffles");
  syncRendererVisibility();
  raffleController?.setTab?.("raffles");
}
function closeInteractionPanelRequest() {
  if (hasActiveInteractionShellLock()) return;
  clearSelectedInteraction();
  returnInteractionsHome();
  setInteractionPanelOpen(false);
}
function setInteractionPanelOpen(open) {
  if (!open && hasActiveInteractionShellLock()) open = true;
  if (!open) resetInactiveRaffleDraft();
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
function toggleInteractionPanel() { if (interactionPanelOpen && hasActiveInteractionShellLock()) return; setInteractionPanelOpen(!interactionPanelOpen); }
function ensureInteractionToggle() {
  if (!interactionToggle) return null;
  if (!interactionsFeatureEnabled) {
    interactionToggle.disabled = true;
    interactionToggle.classList.add("is-plan-locked");
    interactionToggle.setAttribute("aria-disabled", "true");
    interactionToggle.title = "Interacciones · Disponible en planes de pago";
    interactionToggle.setAttribute("aria-label", interactionToggle.title);
    return interactionToggle;
  }
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
  const hasInteractions = interactions.length > 0;
  const selected = selectedInteraction();
  const hasActive = Boolean(active);
  if (!hasActive) {
    if (shell.getView() !== "home" && !raffleController?.getState?.().active) shell.setView("polls");
    syncRendererVisibility();
    panel.innerHTML = '<div class="interaction-panel-heading"><h2>Encuestas disponibles</h2><p>Selecciona una encuesta para lanzarla.</p></div>' + (hasInteractions ? interactionListMarkup(false) : '<p>Este deck aún no tiene interacciones.</p>') + '<div class="interaction-panel-actions"><button class="primary" data-interaction-launch ' + (!selected ? 'disabled' : '') + '>' + interactionLaunchRocketMarkup + '<span>Lanzar encuesta</span></button></div>';
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
prevSlide.addEventListener("click", () => { if (!presenterNavigationLocked()) socket.emit("slide_prev"); });
nextSlide.addEventListener("click", () => { if (!presenterNavigationLocked()) socket.emit("slide_next"); });
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
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && interactionPanelOpen && !hasActiveInteractionShellLock()) closeInteractionPanelRequest(); });
socket.on("presentation_state", (state) => { if (manifest) render(state); });
socket.on("overlay_update", (overlays) => {
  updateReactionToggle({ overlays });
  liveTextControl?.sync(overlays);
});
socket.on("audience_count", (count) => { audience.textContent = count; });
socket.on("reaction", ({ emoji, target }) => { if (target === "presenter") popReaction(emoji); });
socket.on("interaction:state", (state) => { activeInteraction = state?.active || null; if (activeInteraction?.id) selectedInteractionId = String(activeInteraction.id); interactionResultsVisible = Boolean(state?.resultsVisible); if (!activeInteraction) interactionResults = null; renderInteractionPanel(); });
socket.on("interaction:active", (interaction) => { activeInteraction = interaction || null; if (activeInteraction?.id) selectedInteractionId = String(activeInteraction.id); interactionResults = null; interactionResultsVisible = false; renderInteractionPanel(); });
socket.on("interaction:results_updated", (results) => { interactionResults = results || null; renderInteractionPanel(); });
socket.on("interaction:closed", () => { activeInteraction = null; interactionResults = null; interactionResultsVisible = false; clearSelectedInteraction(); renderInteractionPanel(); returnInteractionsHome(); });
syncThumbsPanelMode();
ensureInteractionToggle();
loadDeck().then(() => { initDrawingOverlay(); updateDrawingMode(); socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "presenter" }); });
