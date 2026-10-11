Warning: truncated output (original token count: 49635)
Total output lines: 935

const params = new URLSearchParams(location.search);
const roleOpenContext = window.IMMERSA_ROLE_OPEN || {};
const sessionId = params.get("session") || roleOpenContext.session || roleOpenContext.session_id || "demo01";
const deckId = params.get("deck") || roleOpenContext.deck || roleOpenContext.deckId || "demo";
let requestedLocale = params.get("locale") === "en" ? "en" : "es";
const isPublishedDemo = roleOpenContext.demo_role === "published" || deckId === "immersa-demo";
const deckHomeLink = document.getElementById("deckHomeLink");
if (deckHomeLink) deckHomeLink.href = "/home?deck=" + encodeURIComponent(deckId);
const interactionsFeatureEnabled = roleOpenContext.features?.interactions !== false;
const planCapabilities = roleOpenContext.capabilities || roleOpenContext.features || {};
const planAllows = (capability) => planCapabilities[capability] === true;
const socket = io();
window.ImmersaPresentationCompletion?.create({ socket, role: "presenter", context: roleOpenContext });
const overlaySocket = io();
const raffleController = window.ImmersaRaffleControls?.createController ? window.ImmersaRaffleControls.createController(socket, { installLegacyIntegration: false, onStateChange: (_state, eventName) => { if (eventName === "raffle:closed") returnInteractionsHome(); else syncInteractionShellState(); } }) : null;
let manifest = null;
let baseManifest = null;
let englishManifest = null;
let operationalLocale = requestedLocale;
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
let audiovisualResources = [];
let localAudiovisualResources = [];
let audiovisualState = { audio: { resource: null, status: "stopped", loop: false, volume: 1, position: 0 }, video: { resource: null, status: "stopped", loop: false, volume: 1, position: 0 } };
let audioReactState = { enabled: false, reaction: 0 };
let audiovisualTab = "audio";
let audiovisualPanel = null;
let audiovisualLayer = null;
let audiovisualMedia = null;
let prompterScripts = {}, prompterOverlay = null, prompterPointerId = null, prompterLastY = 0;
const slide = document.getElementById("slide");
const presenterShell = document.querySelector(".presenter-shell");
const streamArea = document.querySelector(".stream-area");
const current = document.getElementById("current");
const total = document.getElementById("total");
const audience = document.getElementById("audience");
const prevSlide = document.getElementById("prev");
const nextSlide = document.getElementById("next");
const playPause = document.getElementById("playPause");
const audienceQr = document.getElementById("audienceQr");
const presenterQr = document.getElementById("presenterQr");
const presenterQrPattern = document.getElementById("presenterQrPattern");
const presenterQrUrl = document.getElementById("presenterQrUrl");
let renderedPresenterQrUrl = "";
const drawToggle = document.getElementById("drawToggle");
const liveTextToggle = document.getElementById("liveTextToggle");
const interactionToggle = document.getElementById("interactionToggle");
const audiovisualToggle = document.getElementById("audiovisualToggle");
const timeToggle = document.getElementById("timeToggle");
const speakerTimer = document.getElementById("speakerTimer");
const speakerTimerValue = document.getElementById("speakerTimerValue");
const speakerTimerActions = document.getElementById("speakerTimerActions");
const speakerTimerResume = document.getElementById("speakerTimerResume");
const speakerTimerReset = document.getElementById("speakerTimerReset");
let immersaTimeState = null;
let immersaTimePanel = null;
let immersaTimeTick = null;
const speakerTimerState = { running: false, elapsedMs: 0, startedAt: 0 };
const fullscreenToggle = document.getElementById("fullscreenToggle");
const thumbsToggle = document.getElementById("thumbsToggle");
const thumbs = document.getElementById("thumbs");
let trackedActiveThumb = null;
let thumbScrollFrame = null;
function followActiveThumb(state) {
  const index = Number(state?.presenterSlideIndex ?? state?.slideIndex);
  const activeThumb = Number.isInteger(index) ? thumbs?.children?.[index] : null;
  if (!activeThumb || activeThumb === trackedActiveThumb) return;
  trackedActiveThumb = activeThumb;
  if (thumbScrollFrame) cancelAnimationFrame(thumbScrollFrame);
  thumbScrollFrame = requestAnimationFrame(() => {
    thumbScrollFrame = null;
    const centeredLeft = activeThumb.offsetLeft - ((thumbs.clientWidth - activeThumb.offsetWidth) / 2);
    thumbs.scrollTo({ left: Math.max(0, centeredLeft), behavior: "smooth" });
  });
}
const deckNotice = document.getElementById("deckNotice");
let qnaAvailable = planAllows("qna.run");
let qnaQuestionsOpen = false;
const qnaControls = window.ImmersaQnaControls?.create({
  socket,
  role: "presenter",
  modalMount: presenterShell,
  launcher: false,
  onAvailabilityChange: ({ available, state }) => {
    qnaAvailable = Boolean(available);
    qnaQuestionsOpen = Boolean(state?.questionsOpen);
    interactionShell?.setCategoryVisible?.("qna", qnaAvailable);
    syncInteractionShellState();
    syncInteractionToggleVisualState();
  }
});
const liveTextControl = window.ImmersaLiveTextControl?.create({
  socket,
  button: liveTextToggle,
  modal: document.getElementById("presenterTextModal"),
  form: document.getElementById("presenterMessageForm"),
  input: document.getElementById("presenterMessageInput"),
  cancelButton: document.getElementById("presenterCancelMessage"),
  labelMode: "icon",
  inactiveLabel: "Texto en vivo",
  activeLabel: "Apagar texto"
});
const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" class="pause-icon"><path d="M9 6V18"></path><path d="M15 6V18"></path></svg>';
const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" class="play-icon"><path d="M9 6L18 12L9 18Z"></path></svg>';
const compactLandscapeQuery = window.matchMedia ? window.matchMedia("(orientation: landscape) and (max-height: 520px)") : null;
const interactionLaunchRocketMarkup = '<svg class="interaction-launch-rocket" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><g><path d="M 463.19 589.25 C410.78,641.72 392.94,659.00 391.19,659.00 C388.96,659.00 388.88,658.76 389.48,653.75 C389.82,650.86 390.27,646.92 390.47,645.00 C390.68,643.08 391.27,639.70 391.79,637.50 C392.31,635.30 393.30,630.12 393.97,626.00 C394.65,621.88 396.28,612.42 397.60,605.00 C400.28,589.87 401.54,582.67 402.98,574.25 C403.52,571.09 404.62,564.90 405.42,560.50 C406.22,556.10 407.39,549.12 408.01,545.00 C408.64,540.88 409.55,535.70 410.04,533.50 C410.53,531.30 411.60,525.67 412.41,521.00 L 412.70 519.37 C414.69,508.01 415.10,505.62 414.32,505.12 C414.11,504.99 413.82,504.99 413.45,505.00 C413.38,505.00 413.31,505.00 413.25,505.00 C412.23,505.00 410.97,505.41 410.45,505.90 C409.93,506.40 401.73,510.03 392.23,513.96 C376.14,520.63 374.73,521.03 371.67,519.93 C368.43,518.76 368.31,518.82 362.57,524.84 C359.37,528.20 356.02,531.18 355.12,531.47 C354.23,531.76 352.73,533.35 351.80,535.00 C349.81,538.50 348.02,538.78 345.50,536.00 C342.99,533.23 340.97,533.49 337.64,537.02 C335.97,538.79 334.96,540.23 333.63,540.65 C330.32,541.69 325.01,536.40 302.57,514.01 C300.50,511.95 298.29,509.74 295.92,507.37 C276.71,488.24 261.00,472.10 261.00,471.50 C261.00,470.90 262.80,468.65 265.00,466.50 C269.48,462.12 269.92,460.14 267.00,457.50 C265.90,456.50 265.00,455.34 265.00,454.90 C265.00,454.47 269.27,449.97 274.50,444.90 C283.36,436.29 285.44,433.01 283.00,431.50 C281.79,430.75 281.68,426.77 282.83,425.45 C283.29,424.93 285.60,419.55 287.97,413.50 C290.34,407.45 293.56,399.83 295.14,396.57 C299.49,387.56 299.32,387.26 291.00,389.06 C288.52,389.60 283.80,390.46 280.50,390.98 C273.36,392.10 266.66,393.26 254.50,395.47 C249.55,396.37 243.01,397.48 239.96,397.95 C234.58,398.76 215.64,402.09 205.50,404.00 C202.75,404.52 196.45,405.65 191.50,406.53 C186.55,407.40 180.25,408.53 177.50,409.03 C174.75,409.54 166.88,410.89 160.00,412.04 C153.12,413.19 146.26,414.36 144.75,414.64 C142.82,415.01 142.00,414.74 142.00,413.76 C142.00,412.99 173.94,380.47 212.98,341.48 C279.48,275.08 284.27,270.52 288.73,269.35 C291.35,268.65 294.73,268.07 296.24,268.04 C297.74,268.02 300.89,267.57 303.24,267.04 C310.50,265.41 323.13,263.13 331.50,261.95 C335.90,261.33 344.84,259.73 351.37,258.41 C357.90,257.08 364.55,256.00 366.14,256.00 C368.47,256.00 369.68,255.07 372.27,251.33 C379.39,241.03 394.85,219.79 400.63,212.37 C424.34,181.93 453.29,153.43 479.46,134.77 C483.88,131.62 487.95,128.69 488.50,128.26 C498.10,120.78 529.40,104.08 546.00,97.56 C551.22,95.51 556.85,93.25 558.50,92.54 C560.15,91.82 563.53,90.68 566.00,90.00 C568.47,89.32 571.62,88.38 573.00,87.91 C574.38,87.44 580.45,85.90 586.50,84.48 C592.55,83.07 598.40,81.70 599.50,81.43 C619.96,76.44 675.63,75.94 701.00,80.53 C705.67,81.37 711.64,82.33 714.26,82.66 L 719.02 83.26 L 720.60 88.70 C721.47,91.69 722.32,96.69 722.49,99.82 C722.90,107.36 724.78,126.67 725.51,130.75 C725.83,132.54 726.52,134.00 727.05,134.00 C728.67,134.00 728.24,157.70 726.56,160.29 C725.60,161.77 724.78,167.93 724.07,179.00 C722.78,199.14 719.08,217.70 712.23,238.50 C705.43,259.10 696.38,279.81 688.63,292.44 C686.91,295.25 684.97,298.44 684.32,299.52 C677.84,310.38 672.31,318.68 668.99,322.51 C666.80,325.05 665.00,327.54 665.00,328.05 C665.00,328.56 662.86,331.42 660.25,334.40 C657.64,337.37 653.92,341.96 652.00,344.59 C646.29,352.40 627.37,371.58 614.50,382.62 C607.90,388.28 600.46,394.71 597.96,396.90 C595.46,399.10 592.20,401.35 590.71,401.92 C589.22,402.49 588.00,403.37 588.00,403.89 C588.00,405.45 553.01,431.00 550.86,431.00 C549.47,431.00 546.05,439.01 546.02,442.31 C546.01,443.85 545.58,447.00 545.08,449.31 C544.57,451.61 543.41,458.00 542.51,463.50 C541.61,469.00 540.49,475.30 540.03,477.50 C539.56,479.70 538.71,484.42 538.14,488.00 C537.57,491.58 536.43,498.33 535.61,503.00 C534.80,507.67 533.85,513.30 533.50,515.50 C532.91,519.20 527.58,524.79 463.19,589.25 ZM 590.18 257.88 C598.54,259.27 602.94,259.11 611.00,257.13 C628.72,252.78 641.82,242.36 648.89,227.00 C658.96,205.12 654.15,179.71 636.84,163.41 C632.09,158.93 622.81,153.00 620.54,153.00 C619.76,153.00 618.87,152.60 618.57,152.11 C617.12,149.77 595.90,148.30 588.00,149.99 C572.13,153.39 557.29,165.21 550.20,180.10 C544.78,191.49 543.43,199.42 545.00,210.52 C545.70,215.40 547.25,221.12 548.61,223.80 C549.92,226.38 550.99,228.84 551.00,229.25 C551.01,231.10 558.48,240.12 563.95,244.88 C570.83,250.86 582.37,256.58 590.18,257.88 ZM 187.01 575.51 C144.66,617.86 109.45,652.61 108.76,652.74 C107.11,653.06 99.00,645.35 99.00,643.46 C99.00,642.66 99.41,642.00 99.91,642.00 C100.41,642.00 135.23,607.58 177.28,565.50 C219.33,523.42 254.38,489.00 255.17,489.00 C256.75,489.00 264.00,496.02 264.00,497.56 C264.00,498.09 229.35,533.17 187.01,575.51 ZM 170.50 641.52 C127.87,684.13 92.66,718.99 92.25,718.97 C91.21,718.94 83.00,711.10 83.00,710.14 C83.00,708.80 237.89,554.49 238.98,554.75 C240.11,555.03 248.00,562.70 248.00,563.52 C248.00,563.80 213.12,598.90 170.50,641.52 ZM 229.06 637.07 C186.75,679.38 151.52,714.00 150.77,714.00 C149.22,714.00 142.00,706.94 142.00,705.42 C142.00,704.27 295.32,550.73 297.04,550.15 C298.47,549.68 306.00,556.92 306.00,558.77 C306.00,559.53 271.38,594.76 229.06,637.07 Z" fill="currentColor"/><path d="M 704.83 81.20 C703.52,80.97 702.22,80.75 701.00,80.53 C678.71,76.50 632.99,76.39 608.36,79.81 C617.30,78.25 627.87,76.63 633.50,76.02 C644.95,74.79 672.00,74.77 672.00,76.00 C672.00,76.55 674.34,77.00 677.19,77.00 C681.32,77.00 693.99,78.95 704.83,81.20 ZM 727.96 138.87 C727.81,135.99 727.52,134.00 727.05,134.00 C726.52,134.00 725.83,132.54 725.51,130.75 C724.78,126.67 722.90,107.36 722.49,99.82 C722.34,97.02 721.64,92.71 720.87,89.70 C721.72,92.50 722.68,95.05 723.10,95.58 C723.58,96.18 724.22,101.35 724.54,107.08 C725.26,120.29 725.86,124.21 727.05,123.47 C727.53,123.18 727.85,128.87 727.96,138.87 ZM 720.25 208.45 C722.18,198.71 723.42,189.05 724.07,179.00 C724.78,167.93 725.60,161.77 726.56,160.29 C727.32,159.12 727.83,153.61 728.00,147.94 C727.99,167.34 727.75,170.88 726.50,171.36 C725.45,171.77 725.00,173.41 725.00,176.90 C725.00,183.38 723.08,195.52 720.25,208.45 ZM 598.66 81.63 C596.58,82.12 591.61,83.29 586.50,84.48 C580.45,85.90 574.38,87.44 573.00,87.91 C571.62,88.38 568.47,89.32 566.00,90.00 C568.47,89.32 571.62,88.38 573.00,87.90 C575.65,86.98 589.14,83.66 597.50,81.87 C597.87,81.79 598.26,81.71 598.66,81.63 Z" fill="currentColor"/><path d="M 704.83 81.20 C693.99,78.95 681.32,77.00 677.19,77.00 C674.34,77.00 672.00,76.55 672.00,76.00 C672.00,75.46 666.75,75.16 659.90,75.10 C673.62,75.00 687.00,75.30 687.00,76.00 C687.00,76.55 688.33,77.00 689.95,77.00 C695.27,77.00 715.00,81.04 715.00,82.14 C715.00,82.44 715.37,82.72 715.93,82.87 L 714.26 82.66 C712.32,82.42 708.55,81.83 704.83,81.20 ZM 720.25 208.45 C723.08,195.52 725.00,183.38 725.00,176.90 C725.00,173.41 725.45,171.77 726.50,171.36 C727.75,170.88 727.99,167.34 728.00,147.94 L 728.00 148.65 C728.00,176.63 727.74,183.40 726.62,184.52 C725.86,185.28 724.94,188.06 724.58,190.70 C723.18,200.77 720.63,213.00 719.92,213.00 C719.51,213.00 718.85,214.91 718.46,217.25 C718.14,219.16 716.73,224.09 714.88,230.03 C717.06,222.67 718.84,215.54 720.25,208.45 ZM 727.96 138.87 C727.85,128.87 727.53,123.18 727.05,123.47 C725.86,124.21 725.26,120.29 724.54,107.08 C724.37,103.94 724.09,100.97 723.81,98.83 C724.19,100.63 724.63,103.05 725.00,105.50 C725.66,109.90 726.60,113.65 727.10,113.83 C727.52,113.99 727.86,124.32 727.97,139.01 ZM 700.87 268.27 C704.01,261.07 707.09,253.27 709.88,245.35 C707.81,251.45 705.83,256.96 704.54,260.00 C703.51,262.45 702.24,265.30 700.87,268.27 ZM 721.58 91.90 C721.34,91.21 721.10,90.46 720.87,89.70 C720.79,89.36 720.70,89.04 720.61,88.74 C720.92,89.81 721.26,90.90 721.58,91.90 ZM 717.55 83.07 L 716.98 83.00 C717.18,83.00 717.37,83.02 717.55,83.07 Z" fill="currentColor"/></g></svg>';
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
function renderPresenterQr(state = currentState) { if (!presenterQr || !presenterQrPattern || !presenterQrUrl) return; const url = audienceQrVisible(state) ? (state?.overlays?.audienceUrl || roleUrl("audience")) : ""; presenterQr.hidden = !url; presenterQrUrl.textContent = url; if (!url || renderedPresenterQrUrl === url) return; renderedPresenterQrUrl = url; presenterQrPattern.innerHTML = ""; presenterQrPattern.classList.remove("qr-fallback"); if (window.QRCode) { new window.QRCode(presenterQrPattern, { text: url, width: 188, height: 188, colorDark: "#111111", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M }); return; } presenterQrPattern.textContent = url; presenterQrPattern.classList.add("qr-fallback"); }
function publishAudienceQr(visible) {
  const audienceUrl = roleUrl("audience");
  if (visible && !audienceUrl) return;
  currentState = { ...(currentState || {}), overlays: { ...(currentState?.overlays || {}), showAudienceQr: visible, qrVisible: visible, audienceUrl } };
  updateAudienceQrButton(currentState);
  renderPresenterQr(currentState);
  socket.emit("overlay_update", { overlays: { showAudienceQr: visible, qrVisible: visible, audienceUrl } });
}
function updateReactionToggle() {}
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
async function loadDeck() {
  const res = await fetch('/decks/' + deckId + '/manifest.json');
  baseManifest = await res.json();
  manifest = baseManifest;
  if (baseManifest.locales?.en?.active && planAllows('multilanguage.manage')) {
    const response = await fetch('/decks/' + deckId + '/locales/en/manifest.json', { cache: 'no-store' }).catch(() => null);
    if (response?.ok) {
      const candidate = await response.json();
      if (candidate.slides?.length === baseManifest.slides?.length) englishManifest = candidate;
    }
  }
  if (requestedLocale === 'en' && !englishManifest) requestedLocale = 'es';
  operationalLocale = requestedLocale;
  manifest = operationalLocale === 'en' ? { ...baseManifest, slides: englishManifest.slides } : baseManifest;
  window.ImmersaI18n?.setLocale(operationalLocale);
  renderDeckNotice(); total.textContent = manifest.slides.length;
  await loadInteractions(); renderThumbs();
}
function normalizeInteractionList(data) { const list = Array.isArray(data) ? data : Array.isArray(data?.interactions) ? data.interactions : []; return list.filter((item) => item && item.id && item.type && Array.isArray(item.options) && item.options.length); }
function clearSelectedInteraction() { selectedInteractionId = ""; }
async function loadInteractions() { try { const res = await fetch("/decks/" + deckId + "/interactions.json", { cache: "no-store" }); if (!res.ok) throw new Error("No interactions"); const data = await res.json(); interactions = normalizeInteractionList(data); videoSlideIds = new Set((Array.isArray(data?.videos) ? data.videos : []).map((video) => String(video?.slide_id || "")).filter(Boolean)); prompterScripts=data?.prompter||{}; } catch (_error) { interactions = []; videoSlideIds = new Set(); prompterScripts={}; } clearSelectedInteraction(); renderInteractionPanel(); void loadAudiovisualResources(); }
async function loadAudiovisualResources() { try { const response = await fetch("/api/decks/" + encodeURIComponent(deckId) + "/audiovisual-library", { cache: "no-store" }); if (!response.ok) throw new Error("Unable to load deck library"); const catalog = await response.json(); audiovisualResources = Array.isArray(catalog.resources) ? catalog.resources : []; } catch (_error) { audiovisualResources = []; } renderAudiovisualPanel(); }
function avEscape(value) { const node = document.createElement("span"); node.textContent = String(value || ""); return node.innerHTML; }
function ensureAudiovisualUi() { if (audiovisualPanel) return; audiovisualPanel = document.createElement("section"); audiovisualPanel.className = "audiovisual-panel"; audiovisualPanel.setAttribute("aria-label", "Librería Immersa"); presenterShell.appendChild(audiovisualPanel); }
const avStopIcon = '<img class="av-control-icon" src="/presenter/player-stop.svg" alt="">';
const avLoopIcon = '<img class="av-control-icon" src="/presenter/player-loop.svg" alt="">';
const avVolumeIcon = '<img class="av-control-icon" src="/presenter/player-volume.svg" alt="">';
const localPlaylistCover = { video: "data:image/jpeg;base64,/9j/4QAYRXhpZgAASUkqAAgAAAAAAAAAAAAAAP/sABFEdWNreQABAAQAAAA8AAD/7gAOQWRvYmUAZMAAAAAB/9sAhAAGBAQEBQQGBQUGCQYFBgkLCAYGCAsMCgoLCgoMEAwMDAwMDBAMDg8QDw4MExMUFBMTHBsbGxwfHx8fHx8fHx8fAQcHBw0MDRgQEBgaFREVGh8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx//wAARCAMABUADAREAAhEBAxEB/8QA2QABAQACAwEBAAAAAAAAAAAAAAEGBwIEBQMIAQEBAAIDAQEAAAAAAAAAAAAAAQUGAwQHAggQAQACAQIBBAkMDggFAwMFAAABAgMRBAUhMRIGQVFhcZHRIhMHgbEyQlKSkxRUFRYIocFicrIjU3OzNHQ1VRfhosLSM0MkNvCCw2RWJUUmY0R1g+OkZUYRAQACAAMEAwkNBwIFAwQDAAABAhEDBCExEgVBUQZhcZHBIjJSE1OBodFCcpKi0jMUFRYH8LFigsIjF+FD8bIkNFTiczVjo7Pj00Rk/9oADAMBAAIRAxEAPwD9TqoAAABygAACgIAAAAAACiAKAAAAAAAAAAACoICgACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIKAKACACiIKKAAAAAAAAAIAAKAgKCAAoAAAgKCAAAAAAAKCAACggAAAKAAiggAoAECKAAAAAAAAAAAAAgogAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACCgKCAoiCgCgAAAAAAAAAACACgAAiCrAgKACAAAAAAKCAoIAAAAAAKCAoCKCACgCAKAAAAAAAAAAAAgoAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACCigAAAAAAAAAACAaAACooIKIAACggAAAAKAoiAAAAAAgqgCAqAoAKIAAAAAAAAAAAAAAqIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgooAAAAAAAAAAAAAAAgAoIAgoCwIAAAAAAAoIAAKCAAIKoAiCgALAigAAAAAAAAAAICgACogACCqIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAiqAAAAAAAAAAAAAAAAAgqAAoAAgAAAAAACggAAAAAAoIAgq6AaCKAAAAAAAAAAAAAACogAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACCigAAgKAAAAAAAAAAAAAICCiioAgAAAAAAAAAAAKCAAqAogBAKAAAAAAAAAAAAAgKACCiAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIqgAACCiIKKAAAAAAAAAAAAIAKCAAAAAoAIAoIAAKgKCAAoAigAAAAAAAAAAAAqCKACCiAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAoACAoIoAAAAAAAAAAAAAAmgAAAAAAAAAAAAAAIKAAAoigAAAAAAAAAAAAqIiqAqAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgooAAAAAAAAAAAAAAAAAgAAAAAAAAAAoAICoosIKIAAAAAAAAAAqCKAAKiAAoIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgooICgCoIoAAAAAAAAAAAAAgAoIAAAAAAAAAACqIAAAAAAAAAAIK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…19635 tokens truncated…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AAQFAAAAAAAAAAAAEFAAQBQAQAUAQAAFAAQAAF1ENQNQUAAAAAAAAAABBRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEFFAAAAAAAAAAAAAAAAEAFQAAAAFABREAAFBEFUEAABQAIEUAAAAAAAAABABREFAAUQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABFUAAAAAAAAAAAAABAAAQUUAAAEBRUQFURAAQVQBAUBAAAFFhEUAAAAAAAAAAABAUEAAFEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQVREFAFAAAAAAAAAAAAAAEABBQABQQFABBQBAVREAAFABEFAAAAFFhBRAAAAAAAAAAAAABABRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEFFAAAAAAAAAAAAAAAAAAAEAFOQQFRRUEBQAAQFEAAAAAAQVREFAAFFQQF1ENQUAAAAAAAAAAFREFFBBREFUQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABFUAAAQFAAAAAAAAAAAAAAAEAFRQQUAAEUVBAUAQBBQFEBQRBVBFBAUEAAAAF1AEUAAAAAAAAABAAUEAFEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQUUAAAAAAAAAAAAAAAASQBQQBBQABQQAUAAQFBAAUEAABQQFQFABAAAUEABQAIEUAAAAAAAAABAUAAVERVVAEABUBRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEVQBAUAAAAAAAAAAAAAASRUBQBAVAAAUEABREFAUAQAAAAAAFABAUBAAUAAEBRCAUAAAAAAAAAAAABBQQBQQURBQFEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQUAAAUAAAAAAAAAAAAAAQAUAABAUAAAQFBAVAAUQFf//Z" };
let audiovisualRevealResourceId = null;
let audiovisualRevealUntil = 0;
let audiovisualRevealTimer = null;
let audiovisualPendingTimer = null;
const audiovisualDurationCache = new Map();
let audiovisualDurationTick = null;
function formatAudiovisualDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  return Math.floor(value / 60) + ":" + String(value % 60).padStart(2, "0");
}
function durationForAudiovisualResource(resource) {
  const declared = Number(resource?.duration || 0);
  return declared > 0 ? declared : Number(audiovisualDurationCache.get(String(resource?.id || "")) || 0);
}
function currentAudiovisualPosition(state) {
  if (!state) return 0;
  const position = Math.max(0, Number(state.position || 0));
  return state.status === "playing" && state.startedAt
    ? position + Math.max(0, (Date.now() - Number(state.startedAt)) / 1000)
    : position;
}
function resourcesForAudiovisualPlaylist(playlistId, type) {
  return localAudiovisualResources
    .filter((item) => String(item?.playlist?.id || "") === String(playlistId || "") && item.type === type)
    .sort((a, b) => Number(a?.playlist?.order || 0) - Number(b?.playlist?.order || 0));
}
function audiovisualDurationValue(resourceId, playlistId, type) {
  const state = audiovisualChannel(type);
  const isPlaylist = Boolean(playlistId);
  const active = isPlaylist
    ? String(state.resource?.playlist?.id || "") === String(playlistId) && state.status === "playing"
    : String(state.resource?.id || "") === String(resourceId) && state.status === "playing";
  if (isPlaylist) {
    const items = resourcesForAudiovisualPlaylist(playlistId, type);
    if (!items.length || items.some((item) => !durationForAudiovisualResource(item))) return null;
    const total = items.reduce((sum, item) => sum + durationForAudiovisualResource(item), 0);
    if (!active) return total;
    const currentIndex = items.findIndex((item) => String(item.id) === String(state.resource?.id || ""));
    if (currentIndex < 0) return total;
    const tail = items.slice(currentIndex + 1).reduce((sum, item) => sum + durationForAudiovisualResource(item), 0);
    return Math.max(0, durationForAudiovisualResource(items[currentIndex]) - currentAudiovisualPosition(state) + tail);
  }
  const resource = [...audiovisualResources, ...localAudiovisualResources].find((item) => String(item.id) === String(resourceId));
  const total = durationForAudiovisualResource(resource);
  if (!total) return null;
  return active ? Math.max(0, total - currentAudiovisualPosition(state)) : total;
}
function updateAudiovisualDurationLabels() {
  audiovisualPanel?.querySelectorAll("[data-av-duration]").forEach((node) => {
    const value = audiovisualDurationValue(node.dataset.avResourceId, node.dataset.avPlaylist || "", node.dataset.avType || "");
    node.textContent = value == null ? "" : formatAudiovisualDuration(value);
  });
}
function syncAudiovisualDurationTick() {
  const needsTick = activeAudiovisualChannels().length > 0;
  if (!needsTick && audiovisualDurationTick) { clearInterval(audiovisualDurationTick); audiovisualDurationTick = null; }
  if (needsTick && !audiovisualDurationTick) audiovisualDurationTick = setInterval(updateAudiovisualDurationLabels, 500);
  updateAudiovisualDurationLabels();
}
function warmAudiovisualDurations(resources) {
  resources.forEach((resource) => {
    const id = String(resource?.id || "");
    if (!id || durationForAudiovisualResource(resource) || !resource.media_url) return;
    const media = document.createElement(resource.type === "video" ? "video" : "audio");
    media.preload = "metadata";
    media.src = resource.media_url;
    const cleanup = () => { media.removeAttribute("src"); media.load?.(); };
    media.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(media.duration) && media.duration > 0) {
        audiovisualDurationCache.set(id, media.duration);
        updateAudiovisualDurationLabels();
      }
      cleanup();
    }, { once:true });
    media.addEventListener("error", cleanup, { once:true });
  });
}
function audiovisualChannel(type) {
  return audiovisualState[type] || { resource: null, status: "stopped", loop: false, volume: 1, position: 0 };
}
function activeAudiovisualChannels() {
  return ["audio", "video"].filter((type) => audiovisualChannel(type).resource && audiovisualChannel(type).status === "playing");
}
function hasRunningAudiovisual() {
  return ["audio", "video"].some((type) => audiovisualChannel(type).resource && ["playing", "fading"].includes(audiovisualChannel(type).status));
}
function syncAudiovisualToggle() {
  const open = Boolean(audiovisualPanel?.classList.contains("is-open"));
  audiovisualToggle?.classList.toggle("is-active", open || hasRunningAudiovisual());
  audiovisualToggle?.setAttribute("aria-expanded", String(open));
}
function audiovisualCardKey(resource) {
  return String(resource?.id || "");
}
function syncAudiovisualActiveCard() {
  let matched = false;
  ["audio", "video"].forEach((type) => {
    const state = audiovisualChannel(type);
    const resourceId = String(state.resource?.id || "");
    const playlistId = String(state.resource?.playlist?.id || "");
    const card = playlistId
      ? audiovisualPanel?.querySelector('.audiovisual-resource.is-active[data-av-playlist="' + playlistId + '"]')
      : audiovisualPanel?.querySelector('.audiovisual-resource.is-active[data-av-resource="' + resourceId + '"]');
    if (!card) return;
    matched = true;
    card.querySelector("[data-av-loop]")?.classList.toggle("is-active", Boolean(state.loop));
    const activeBars = Math.max(1, Math.round(Number(state.volume ?? 1) * 5));
    card.querySelectorAll("[data-av-volume-level]").forEach((bar) => bar.classList.toggle("is-on", Number(bar.dataset.avVolumeLevel) <= activeBars));
  });
  return matched;
}
function buildLocalPlaylistCards(resources) {
  const playlists = new Map();
  resources.filter((item) => item.playlist?.id).forEach((item) => {
    const id = String(item.playlist.id);
    if (!playlists.has(id)) playlists.set(id, { id, type: item.type, name: item.playlist.name, items: [] });
    playlists.get(id).items.push(item);
  });
  return [...playlists.values()]
    .sort((a, b) => (a.type === b.type ? String(a.name || "").localeCompare(String(b.name || ""), "es", { numeric: true }) : a.type === "video" ? -1 : 1))
    .map((playlist) => {
      const first = [...playlist.items].sort((a, b) => Number(a.playlist?.order || 0) - Number(b.playlist?.order || 0))[0];
      return { ...first, id: first.id, name: playlist.name + " · " + playlist.items.length + " pistas", thumbnail_url: localPlaylistCover[playlist.type] || first.thumbnail_url, playlistCard: true, playlistId: playlist.id };
    });
}
function audiovisualCards(resources, emptyMessage, options = {}) {
  if (!resources.length) return emptyMessage ? '<p class="audiovisual-empty">' + emptyMessage + '</p>' : "";
  const orderedResources = [...resources].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es", { numeric: true }));
  return orderedResources.map((item) => {
    const state = audiovisualChannel(item.type);
    const isPlaylist = Boolean(item.playlistCard);
    const active = !options.suppressActive && (isPlaylist
      ? String(state.resource?.playlist?.id || "") === String(item.playlistId || "") && state.status === "playing"
      : String(state.resource?.id || "") === String(item.id) && state.status === "playing");
    const mediaIcon = item.thumbnail_url ? '<img src="' + item.thumbnail_url + '" alt="">' : '<span class="av-icon">' + (item.type === "video" ? "▶" : "♫") + '</span>';
    const volumeBars = [1,2,3,4,5].map(function(level) { return '<i data-av-volume-level="' + level + '" class="' + (level <= Math.max(1, Math.round(state.volume * 5)) ? 'is-on' : '') + '"></i>'; }).join("");
    const controls = '<span class="audiovisual-inline-controls" data-av-type="' + item.type + '"><button data-av-stop title="Detener">' + avStopIcon + '</button><button data-av-loop class="' + (state.loop ? 'is-active' : '') + '" title="Loop">' + avLoopIcon + '</button><button class="av-volume-control" data-av-volume title="Volumen">' + volumeBars + '</button></span>';
    const revealing = active && audiovisualRevealResourceId === String(item.id) && Date.now() < audiovisualRevealUntil;
    const playlistAttribute = isPlaylist ? ' data-av-playlist="' + avEscape(item.playlistId) + '"' : "";
    return '<div class="audiovisual-resource is-' + avEscape(item.type || "audio") + ' ' + (active ? 'is-active' + (revealing ? ' is-revealing' : '') : '') + '" data-av-resource="' + item.id + '"' + playlistAttribute + ' data-av-type="' + item.type + '" role="button" tabindex="0">' + mediaIcon + '<span class="audiovisual-resource-label"><strong>' + avEscape(item.name) + '</strong><small data-av-duration data-av-resource-id="' + avEscape(item.id) + '"' + playlistAttribute + ' data-av-type="' + avEscape(item.type || "") + '"></small></span>' + controls + '</div>';
  }).join('');
}
function audiovisualTabIcon(type) {
  if (type === "react") return '<img src="/presenter/audio-react.svg" alt="">';
  if (type === "video") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5v15L19 12z"/></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11.1a4.2 4.2 0 1 1-2-3.55V5.2l10-2.1v9.5a4.2 4.2 0 1 1-2-3.55V5.4z"/></svg>';
}
const audioReactNames = ["Líneas", "Barras", "Onda circular", "Nube", "Malla", "Arena", "Partículas", "Caleidoscopio", "Blobs", "Logo", "Caja 3D", "Esfera 3D"];
const audioReactThumbnails = audioReactNames.map((_, index) => "/presenter/audio-react/react" + String(index + 1).padStart(2, "0") + (index >= 10 ? ".svg?rev=2" : ".jpg"));
function renderAudiovisualPanel(force = false) {
  if (!force && audiovisualRevealResourceId) return;
  ensureAudiovisualUi();
  const type = audiovisualTab === "video" ? "video" : "audio";
  const state = audiovisualChannel(type);
  const running = state.resource && ["playing", "fading"].includes(state.status) ? [state.resource] : [];
  const playlists = buildLocalPlaylistCards(localAudiovisualResources.filter((item) => item.type === type));
  const localSingles = localAudiovisualResources.filter((item) => item.type === type && !item.playlist?.id);
  const remote = audiovisualResources.filter((item) => item.type === type);
  const tabs = ["audio", "video", "react"].map((tab) => { const isReact = tab === "react"; const label = tab === "audio" ? "Audio" : tab === "video" ? "Video" : "React"; const live = !isReact && ["playing", "fading"].includes(audiovisualChannel(tab).status); const selected = audiovisualTab === tab && (!isReact || audioReactState.enabled); return '<button class="audiovisual-tab ' + (selected ? 'is-selected' : '') + (live ? ' is-playing' : '') + (isReact && audioReactState.enabled ? ' is-reacting' : '') + '" data-av-tab="' + tab + '" title="' + label + '">' + audiovisualTabIcon(tab) + '<span>' + label + '</span>' + (isReact ? '<b class="audio-react-tab-status">' + (audioReactState.enabled ? "On" : "Off") + '</b>' : "") + '</button>'; }).join("");
  let body = "";
  if (audiovisualTab === "react") {
    const selected = Math.max(0, Math.min(11, Number(audioReactState.reaction) || 0));
    body = '<section class="audio-react-control"><div class="audio-react-picker"><p>Elige una reacción</p><div class="audio-react-grid" role="listbox" aria-label="Reacciones">' + audioReactNames.map((name, index) => '<button class="audio-react-choice ' + (index === selected ? "is-selected" : "") + '" data-react-choice="' + index + '" role="option" aria-selected="' + String(index === selected) + '"><img src="' + audioReactThumbnails[index] + '" alt=""><span><b>' + (index + 1) + '</b>' + name + '</span></button>').join("") + '</div></div></section>';
  } else {
    const runningBlock = running.length ? '<section class="audiovisual-group audiovisual-running"><h3>Medio corriendo</h3><div class="audiovisual-resource-list">' + audiovisualCards(running, "", { suppressActive: false }) + '</div></section>' : "";
    const playlistsBlock = playlists.length ? '<section class="audiovisual-group"><h3>Playlists</h3><div class="audiovisual-resource-list">' + audiovisualCards(playlists, "", { suppressActive: true }) + '</div></section>' : "";
    const localBlock = localSingles.length ? '<section class="audiovisual-group"><h3>Medios Local</h3><div class="audiovisual-resource-list">' + audiovisualCards(localSingles, "", { suppressActive: true }) + '</div></section>' : "";
    const remoteBlock = remote.length ? '<section class="audiovisual-group"><h3>Medios Immersa</h3><div class="audiovisual-resource-list">' + audiovisualCards(remote, "", { suppressActive: true }) + '</div></section>' : '<p class="audiovisual-empty">No hay medios ' + (type === "audio" ? "de audio" : "de video") + ' seleccionados en Librería.</p>';
    body = runningBlock + playlistsBlock + localBlock + remoteBlock;
  }
  audiovisualPanel.innerHTML = '<div class="audiovisual-panel-sticky"><div class="audiovisual-panel-head"><h2>Audiovisual</h2><button data-av-close aria-label="Cerrar Audiovisual"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8"/></svg></button></div><nav class="audiovisual-tabs" aria-label="Audiovisual">' + tabs + '</nav></div><div class="audiovisual-panel-content">' + body + '</div>';
  warmAudiovisualDurations([...audiovisualResources, ...localAudiovisualResources]);
  syncAudiovisualDurationTick();
  audiovisualPanel.querySelectorAll("[data-av-tab]").forEach((button) => button.addEventListener("click", () => {
    const tab = button.dataset.avTab;
    if (tab === "react") {
      const nextEnabled = audiovisualTab !== "react" ? true : !audioReactState.enabled;
      audiovisualTab = "react";
      socket.emit("audio-react:control", { enabled: nextEnabled, reaction: audioReactState.reaction });
    } else { audiovisualTab = tab; renderAudiovisualPanel(true); }
  }));
  audiovisualPanel.querySelectorAll("[data-react-choice]").forEach((button) => button.addEventListener("click", () => socket.emit("audio-react:control", { enabled: true, reaction: Number(button.dataset.reactChoice) })));
  audiovisualPanel.querySelectorAll("[data-av-resource]").forEach((button) => button.addEventListener("click", (event) => {
    const selectedId = String(button.dataset.avResource);
    const playlistId = String(button.dataset.avPlaylist || "");
    const resourceType = button.dataset.avType;
    const current = audiovisualChannel(resourceType);
    if (event.target.closest(".audiovisual-inline-controls")) return;
    const isCurrentPlayback = button.classList.contains("is-active") && current.status === "playing" && String(current.resource?.id || "") === selectedId;
    if (isCurrentPlayback) return;
    audiovisualPanel.scrollTop = 0;
    audiovisualPanel.scrollTo?.({ top: 0, behavior: "smooth" });
    button.classList.remove("is-active", "is-revealing", "is-closing");
    clearTimeout(audiovisualRevealTimer);
    audiovisualPanel.querySelectorAll('.audiovisual-resource.is-active[data-av-type="' + resourceType + '"]').forEach((card) => { card.classList.remove("is-active", "is-revealing"); card.classList.add("is-closing"); });
    clearTimeout(audiovisualPendingTimer);
    audiovisualRevealResourceId = selectedId; audiovisualRevealUntil = Date.now() + 500;
    button.classList.add("is-active", "is-revealing");
    audiovisualRevealTimer = setTimeout(() => { if (audiovisualRevealResourceId === selectedId) button.classList.remove("is-revealing"); }, 500);
    audiovisualPendingTimer = setTimeout(() => { if (audiovisualRevealResourceId !== selectedId) return; audiovisualRevealResourceId = null; audiovisualRevealUntil = 0; renderAudiovisualPanel(true); }, 2500);
    socket.emit("audiovisual:control", playlistId ? { action: "select-playlist", resourceId: selectedId, playlistId, type: resourceType, loop: false } : { action: "select", resourceId: selectedId, type: resourceType, loop: false });
  }));
  audiovisualPanel.querySelectorAll("[data-av-stop]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation(); const card = event.currentTarget.closest(".audiovisual-resource"); const resourceType = card?.dataset.avType || "audio";
    if (card) { card.classList.add("is-closing"); card.classList.remove("is-active"); }
    socket.emit("audiovisual:control", { action: resourceType === "audio" ? "fade-stop" : "stop", resourceId: card?.dataset.avResource, type: resourceType });
  }));
  audiovisualPanel.querySelectorAll("[data-av-loop]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation(); const card = event.currentTarget.closest(".audiovisual-resource"); const resourceType = card?.dataset.avType || "audio";
    socket.emit("audiovisual:control", { action: "loop", resourceId: card?.dataset.avResource, type: resourceType, loop: !audiovisualChannel(resourceType).loop });
  }));
  audiovisualPanel.querySelectorAll("[data-av-volume]").forEach((control) => control.addEventListener("click", (event) => {
    event.stopPropagation(); const bar = event.target.closest("[data-av-volume-level]"); if (!bar) return;
    const card = event.currentTarget.closest(".audiovisual-resource");
    socket.emit("audiovisual:control", { action: "volume", resourceId: card?.dataset.avResource, type: card?.dataset.avType, volume: Number(bar.dataset.avVolumeLevel) / 5 });
  }));
  audiovisualPanel.querySelector("[data-av-close]")?.addEventListener("click", () => { audiovisualPanel.classList.remove("is-open"); syncAudiovisualToggle(); });
}
let audiovisualFadeCloseTimer = null;
function applyAudiovisualState(next = {}) {
  if (next.audio || next.video) {
    audiovisualState = { audio: { ...audiovisualChannel("audio"), ...(next.audio || {}) }, video: { ...audiovisualChannel("video"), ...(next.video || {}) } };
  } else if (next.resource?.type === "audio" || next.resource?.type === "video") {
    audiovisualState = { ...audiovisualState, [next.resource.type]: { ...audiovisualChannel(next.resource.type), ...next } };
  }
  syncAudiovisualToggle();
  syncAudiovisualDurationTick();
  if (audiovisualRevealResourceId) {
    const selectedArrived = ["audio", "video"].some((type) => audiovisualRevealResourceId === String(audiovisualChannel(type).resource?.id || "") && audiovisualChannel(type).status === "playing");
    if (selectedArrived) {
      clearTimeout(audiovisualPendingTimer);
      audiovisualRevealResourceId = null;
      audiovisualRevealUntil = 0;
      // Rebuild after the server confirms playback so "Medio corriendo" is always first.
      renderAudiovisualPanel(true);
      audiovisualPanel.scrollTop = 0;
    }
    return;
  }
  const fadingAudio = audiovisualChannel("audio");
  if (fadingAudio.status === "fading") {
    clearTimeout(audiovisualFadeCloseTimer);
    const fadingPlaylistId = String(fadingAudio.resource?.playlist?.id || "");
    const card = fadingPlaylistId
      ? audiovisualPanel?.querySelector('.audiovisual-resource.is-active[data-av-playlist="' + fadingPlaylistId + '"]')
      : audiovisualPanel?.querySelector('.audiovisual-resource.is-active[data-av-resource="' + String(fadingAudio.resource?.id || "") + '"]');
    if (card) {
      card.classList.add("is-closing");
      card.classList.remove("is-active");
      audiovisualFadeCloseTimer = setTimeout(() => renderAudiovisualPanel(true), 1000);
    }
    return;
  }
  clearTimeout(audiovisualFadeCloseTimer);
  const expected = activeAudiovisualChannels();
  const expectedIds = expected.map((type) => audiovisualCardKey(audiovisualChannel(type).resource));
  const visibleIds = Array.from(audiovisualPanel?.querySelectorAll(".audiovisual-resource.is-active[data-av-resource]") || []).map((card) => card.dataset.avPlaylist ? "playlist:" + String(card.dataset.avPlaylist) : String(card.dataset.avResource));
  const cardsMatchChannels = expectedIds.length === visibleIds.length && expectedIds.every((id) => visibleIds.includes(id));
  if (cardsMatchChannels) { syncAudiovisualActiveCard(); return; }
  renderAudiovisualPanel(true);
}
function toggleAudiovisualPanel() {
  ensureAudiovisualUi();
  const open = !audiovisualPanel?.classList.contains("is-open");
  audiovisualPanel?.classList.toggle("is-open", open);
  syncAudiovisualToggle();
  if (open) {
    closeImmersaTimePanel();
    if (interactionPanelOpen) setInteractionPanelOpen(false);
  }
}

function defaultImmersaTimeState() {
  return window.ImmersaTime?.normalize({
    serverNow: Date.now(),
    speaker: { running: false, elapsedMs: 0 },
    screen: { mode: null, visible: false, running: false, elapsedMs: 0, remainingMs: 0, durationMs: 0 }
  }) || null;
}
function currentImmersaTimeState() {
  return immersaTimeState || defaultImmersaTimeState();
}
function speakerTimeValue() {
  return window.ImmersaTime ? window.ImmersaTime.duration(speakerElapsedMs()) : "00:00:00";
}
function speakerElapsedMs() {
  const active = speakerTimerState.running ? Math.max(0, Date.now() - speakerTimerState.startedAt) : 0;
  return Math.max(0, speakerTimerState.elapsedMs + active);
}
function screenTimeValue() {
  const state = currentImmersaTimeState();
  const timer = state?.screen || {};
  if (!state || !window.ImmersaTime || !timer.visible) return "";
  if (timer.mode === "stopwatch") return window.ImmersaTime.duration(window.ImmersaTime.elapsed(timer, state));
  if (timer.mode === "countdown") return window.ImmersaTime.duration(window.ImmersaTime.remaining(timer, state));
  if (timer.mode === "clock") return window.ImmersaTime.clock(state);
  return "";
}
function screenTimeIsRunning() {
  const state = currentImmersaTimeState();
  const timer = state?.screen || {};
  if (timer.mode === "clock" && timer.visible) return true;
  if (timer.mode === "countdown") return Boolean(timer.running && window.ImmersaTime?.remaining(timer, state) > 0);
  return Boolean(timer.running);
}
function clearImmersaTimeTick() {
  if (immersaTimeTick) clearTimeout(immersaTimeTick);
  immersaTimeTick = null;
}
function speakerTimerCanReset() {
  return Boolean(!speakerTimerState.running && speakerElapsedMs() > 0);
}
function updateImmersaTimeReadouts() {
  const value = speakerTimeValue();
  if (speakerTimerValue) speakerTimerValue.textContent = value;
  const resettable = speakerTimerCanReset();
  if (speakerTimerActions) speakerTimerActions.hidden = !resettable;
  if (speakerTimer) {
    speakerTimer.classList.toggle("is-running", speakerTimerState.running);
    speakerTimer.setAttribute("aria-label", speakerTimerState.running ? "Detener Timer Speaker" : (resettable ? "Reanudar Timer Speaker" : "Iniciar Timer Speaker"));
    speakerTimer.title = speakerTimerState.running ? "Detener Timer Speaker" : (resettable ? "Reanudar Timer Speaker" : "Iniciar Timer Speaker");
  }
  document.querySelectorAll("[data-time-screen-value]").forEach((node) => { node.textContent = screenTimeValue(); });
}
function syncImmersaTimeUi() {
  const state = currentImmersaTimeState();
  const panelOpen = Boolean(immersaTimePanel?.classList.contains("is-open"));
  const screen = state?.screen || {};
  timeToggle?.classList.toggle("is-active", panelOpen || Boolean(screen.visible));
  timeToggle?.setAttribute("aria-expanded", String(panelOpen));
  updateImmersaTimeReadouts();
  clearImmersaTimeTick();
  if (speakerTimerState.running || screenTimeIsRunning()) immersaTimeTick = setTimeout(syncImmersaTimeUi, 200);
}
function ensureImmersaTimePanel() {
  if (immersaTimePanel) return immersaTimePanel;
  immersaTimePanel = document.createElement("section");
  immersaTimePanel.className = "time-panel";
  immersaTimePanel.setAttribute("aria-label", "IMMERSA TIME");
  document.body.appendChild(immersaTimePanel);
  return immersaTimePanel;
}
function screenTimeControls(timer) {
  if (!timer?.visible) return "";
  const close = '<button class="time-close" data-time-screen-action="hide" type="button" aria-label="Cerrar tiempo en Pantalla">×</button>';
  if (timer.mode === "clock") return '<div class="time-screen-actions time-screen-actions-clock">' + close + '</div>';
  if (screenTimeIsRunning()) {
    return '<div class="time-screen-actions"><button class="time-primary" data-time-screen-action="stop" type="button">Detener</button>' + close + '</div>';
  }
  return '<div class="time-screen-actions"><button class="time-primary" data-time-screen-action="resume" type="button">Reanudar</button><button class="time-secondary" data-time-screen-action="reset" type="button">Restablecer</button>' + close + '</div>';
}
function renderImmersaTimePanel() {
  const panel = ensureImmersaTimePanel();
  const state = currentImmersaTimeState();
  const screen = state?.screen || {};
  const mode = screen.visible ? String(screen.mode || "") : "";
  const screenTitle = mode === "stopwatch" ? "Cronómetro" : mode === "countdown" ? "Temporizador" : "Hora actual";
  const modeSummary = screen.visible
    ? '<div class="time-screen-live"><div class="time-screen-preview"><span>' + screenTitle + '</span><strong data-time-screen-value>' + screenTimeValue() + '</strong></div>' + screenTimeControls(screen) + '</div>'
    : "";
  panel.innerHTML =
    '<header class="time-panel-head"><h2>Tiempo</h2><button data-time-close type="button" aria-label="Cerrar Tiempo">×</button></header>' +
    '<div class="time-launch-grid">' +
      '<button class="time-launch-card ' + (mode === "stopwatch" ? "is-active" : "") + '" data-time-start="stopwatch" type="button"><b>Cronómetro</b><span>00:00:00</span></button>' +
      '<button class="time-launch-card ' + (mode === "clock" ? "is-active" : "") + '" data-time-start="clock" type="button"><b>Hora actual</b><span>12 horas</span></button>' +
    '</div>' +
    '<div class="time-countdown-form ' + (mode === "countdown" ? "is-active" : "") + '"><div class="time-countdown-copy"><b>Temporizador</b><span>Cuenta regresiva</span></div><div class="time-countdown-inputs"><label><input data-time-hours type="number" min="0" max="99" value="0" aria-label="Horas"><em>H</em></label><label><input data-time-minutes type="number" min="0" max="59" value="15" aria-label="Minutos"><em>M</em></label><label><input data-time-seconds type="number" min="0" max="59" value="0" aria-label="Segundos"><em>S</em></label></div><div class="time-countdown-actions"><div class="time-shortcuts" aria-label="Temporizadores rápidos"><button data-time-shortcut="5" type="button">5 min</button><button data-time-shortcut="10" type="button">10 min</button><button data-time-shortcut="30" type="button">30 min</button></div><button data-time-start-countdown type="button">Iniciar</button></div></div>' +
    modeSummary;
  panel.querySelector("[data-time-close]")?.addEventListener("click", closeImmersaTimePanel);
  panel.querySelectorAll("[data-time-start]").forEach((button) => button.addEventListener("click", () => socket.emit("time:control", { target: "screen", action: "start", mode: button.dataset.timeStart })));
  panel.querySelector("[data-time-start-countdown]")?.addEventListener("click", () => {
    const hours = panel.querySelector("[data-time-hours]")?.value;
    const minutes = panel.querySelector("[data-time-minutes]")?.value;
    const seconds = panel.querySelector("[data-time-seconds]")?.value;
    socket.emit("time:control", { target: "screen", action: "start", mode: "countdown", hours, minutes, seconds });
  });
  panel.querySelectorAll("[data-time-shortcut]").forEach((button) => button.addEventListener("click", () => {
    const minutes = Number(button.dataset.timeShortcut) || 0;
    const hoursInput = panel.querySelector("[data-time-hours]");
    const minutesInput = panel.querySelector("[data-time-minutes]");
    const secondsInput = panel.querySelector("[data-time-seconds]");
    if (hoursInput) hoursInput.value = "0";
    if (minutesInput) minutesInput.value = String(minutes);
    if (secondsInput) secondsInput.value = "0";
    socket.emit("time:control", { target: "screen", action: "start", mode: "countdown", hours: 0, minutes, seconds: 0 });
  }));
  panel.querySelectorAll("[data-time-screen-action]").forEach((button) => button.addEventListener("click", () => socket.emit("time:control", { target: "screen", action: button.dataset.timeScreenAction })));
}
function toggleSpeakerTimer() {
  if (speakerTimerState.running) {
    speakerTimerState.elapsedMs = speakerElapsedMs();
    speakerTimerState.running = false;
    speakerTimerState.startedAt = 0;
  } else {
    speakerTimerState.running = true;
    speakerTimerState.startedAt = Date.now();
  }
  syncImmersaTimeUi();
}
function resumeSpeakerTimer() {
  if (!speakerTimerState.running) {
    speakerTimerState.running = true;
    speakerTimerState.startedAt = Date.now();
  }
  syncImmersaTimeUi();
}
function resetSpeakerTimer() {
  speakerTimerState.running = false;
  speakerTimerState.elapsedMs = 0;
  speakerTimerState.startedAt = 0;
  syncImmersaTimeUi();
}
function openImmersaTimePanel() {
  ensureImmersaTimePanel();
  renderImmersaTimePanel();
  immersaTimePanel.classList.add("is-open");
  audiovisualPanel?.classList.remove("is-open");
  if (interactionPanelOpen) setInteractionPanelOpen(false);
  syncAudiovisualToggle();
  syncImmersaTimeUi();
}
function closeImmersaTimePanel() {
  immersaTimePanel?.classList.remove("is-open");
  syncImmersaTimeUi();
}
function toggleImmersaTimePanel() {
  if (immersaTimePanel?.classList.contains("is-open")) closeImmersaTimePanel();
  else openImmersaTimePanel();
}
function applyImmersaTime(next = {}) {
  if (!window.ImmersaTime) return;
  immersaTimeState = window.ImmersaTime.normalize(next);
  if (immersaTimePanel?.classList.contains("is-open")) renderImmersaTimePanel();
  syncImmersaTimeUi();
}

function selectedInteraction() { return selectedInteractionId ? interactions.find((item) => String(item.id) === String(selectedInteractionId)) || null : null; }
function assetSrc(item, kind = "src") { return "/decks/" + deckId + "/" + (operationalLocale === 'en' ? 'locales/en/' : '') + (kind === "thumb" && item.thumb ? item.thumb : item.src); }
function slideSrc(index) { return assetSrc(manifest.slides[index]); }
function slideIdentity(item, index) { return String(item?.id || "slide-" + String(index + 1).padStart(3, "0")); }
function prompterText(index=currentSlideIndex){const value=prompterScripts[slideIdentity(manifest?.slides?.[index],index)];if(!value)return '';if(operationalLocale==='en')return typeof value==='object'&&value.en?String(value.en):'Apuntador no disponible en English';return typeof value==='object'&&value?String(value.es||''):String(value||'')}function showPrompter(){const currentText=prompterText(),nextText=prompterText(currentSlideIndex+1);if(drawingMode||!currentText)return false;if(!prompterOverlay){prompterOverlay=document.createElement('section');prompterOverlay.innerHTML='<div class="prompter-overlay-current"><div></div></div><div class="prompter-overlay-next"></div>';presenterShell.appendChild(prompterOverlay)}const main=prompterOverlay.firstElementChild,next=prompterOverlay.lastElementChild;main.firstElementChild.textContent=currentText;main.scrollTop=0;next.textContent=nextText;prompterOverlay.className='prompter-overlay is-visible'+(nextText?' has-preview':'');return true}function hidePrompter(){prompterOverlay?.classList.remove('is-visible','has-preview')}function bindPrompterGesture(){slide.draggable=false;slide.addEventListener('dragstart',e=>e.preventDefault());slide.addEventListener('pointerdown',e=>{if(showPrompter()){prompterPointerId=e.pointerId;prompterLastY=e.clientY;slide.setPointerCapture?.(e.pointerId);e.preventDefault()}});slide.addEventListener('pointermove',e=>{if(e.pointerId===prompterPointerId){const main=prompterOverlay?.firstElementChild;if(main)main.scrollTop+=prompterLastY-e.clientY;prompterLastY=e.clientY;e.preventDefault()}});slide.addEventListener('contextmenu',e=>e.preventDefault());slide.addEventListener('pointerup',e=>{if(prompterPointerId===null||e.pointerId===prompterPointerId){prompterPointerId=null;hidePrompter()}})}
function videoThumbMark(index) { const gradientId = "immersa-video-gradient-" + (index + 1); return '<span class="thumb-video-mark" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><defs><linearGradient id="' + gradientId + '" x1="4" y1="20" x2="20" y2="4" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#68d8cc"/><stop offset=".52" stop-color="#4368f6"/><stop offset="1" stop-color="#9b4cff"/></linearGradient></defs><path d="M6.5 4.75 19 12 6.5 19.25Z" fill="none" stroke="url(#' + gradientId + ')" stroke-width="3.1" stroke-linejoin="round"/></svg></span>'; }
function applySlideOrientation(container, item, src) { const portrait = item?.orientation === "portrait"; container.classList.toggle("portrait-slide", portrait); if (portrait) container.style.setProperty("--slide-bg", "url('" + src.replace(/'/g, "%27") + "')"); else container.style.removeProperty("--slide-bg"); }
function presenterNavigationLocked(state = currentState) { return Boolean(state?.transmissionPaused && state?.transmissionPausedBy !== "presenter"); }
function renderThumbs() { thumbs.innerHTML = ""; manifest.slides.forEach((item, index) => { const slideNumber = index + 1; const hasVideo = videoSlideIds.has(slideIdentity(item, index)); const button = document.createElement("button"); button.type = "button"; button.className = "thumb" + (hasVideo ? " has-video" : ""); button.setAttribute("aria-label", "Ir a lámina " + slideNumber + (item.title ? ": " + item.title : "") + (hasVideo ? " · contiene video" : "")); button.title = (item.title ? "Lámina " + slideNumber + " · " + item.title : "Lámina " + slideNumber) + (hasVideo ? " · Video" : ""); button.innerHTML = '<span class="thumb-number">' + slideNumber + '</span><img alt="" src="' + assetSrc(item, "thumb") + '">' + (hasVideo ? videoThumbMark(index) : ""); button.addEventListener("click", () => { if (presenterNavigationLocked()) return; socket.emit("slide_go", { slideIndex: index }); closeThumbsPanel(); }); thumbs.appendChild(button); }); }
function render(state) { currentState = state; const nextLocale = state.operationalLocale === 'en' && englishManifest ? 'en' : 'es'; if (nextLocale !== operationalLocale) { operationalLocale = nextLocale; window.ImmersaI18n?.setLocale(operationalLocale); manifest = operationalLocale === 'en' ? { ...baseManifest, slides: englishManifest.slides } : baseManifest; renderThumbs(); hidePrompter(); } const index = state.presenterSlideIndex ?? state.slideIndex; const previousIndex = currentSlideIndex; const changed = index !== previousIndex; currentSlideIndex = index; const item = manifest.slides[index]; const src = slideSrc(index); if (changed && window.ImmersaSlideTransitions?.swap) window.ImmersaSlideTransitions.swap(slide, src, manifest.slideTransition, index - previousIndex); else slide.src = src; window.ImmersaSlideTransitions?.preload([index - 1, index + 1].filter((slideIndex) => manifest.slides[slideIndex]).map(slideSrc)); applySlideOrientation(streamArea, item, src); window.ImmersaDemoPlanBadge?.update(streamArea, item, manifest); drawingOverlay?.refresh(); current.textContent = index + 1; audience.textContent = state.audienceCount || 0; playPause.innerHTML = state.transmissionPaused ? playIcon : pauseIcon; playPause.classList.toggle("is-paused", state.transmissionPaused); playPause.title = window.ImmersaI18n?.t(state.transmissionPaused ? 'live.resume' : 'live.pause') || (state.transmissionPaused ? 'Reanudar transmisión' : 'Pausar transmisión'); playPause.setAttribute("aria-label", playPause.title); const navigationLocked = presenterNavigationLocked(state); prevSlide.disabled = navigationLocked || index <= 0; nextSlide.disabled = navigationLocked || index >= manifest.slides.length - 1; updateAudienceQrButton(state); renderPresenterQr(state); updateReactionToggle(state); liveTextControl?.sync(state.overlays || {}); document.querySelectorAll(".thumb").forEach((node, i) => { node.disabled = navigationLocked; node.classList.toggle("active", i === index); node.classList.toggle("live", i === state.liveSlideIndex); }); }
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
    categoryEnabled: {
      polls: planAllows("polls.run"),
      qna: planAllows("qna.run"),
      assessments: planAllows("assessments.run"),
      raffles: planAllows("raffles.run"),
      contests: planAllows("trivia.run"),
      games: !isPublishedDemo && planAllows("games.run")
    },
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
  shell.setLiveView?.(activePoll ? "polls" : activeRaffle ? "raffles" : activeKnowledge || (qnaQuestionsOpen ? "qna" : ""));
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
  if (interactionPanelOpen) {
    audiovisualPanel?.classList.remove("is-open");
    closeImmersaTimePanel();
    syncAudiovisualToggle();
  }
  syncInteractionToggleVisualState();
  if (interactionPanelOpen) renderInteractionPanel();
}
function syncInteractionToggleVisualState() {
  if (interactionToggle) {
    const visuallyActive = interactionPanelOpen || qnaQuestionsOpen;
    interactionToggle.classList.toggle("is-active", visuallyActive);
    interactionToggle.classList.toggle("is-special-active", visuallyActive);
    interactionToggle.setAttribute("aria-expanded", String(interactionPanelOpen));
    interactionToggle.setAttribute("aria-pressed", String(visuallyActive));
    interactionToggle.title = interactionPanelOpen ? "Cerrar interacciones" : qnaQuestionsOpen ? "Interacciones · Preguntas abiertas" : "Interacciones";
    interactionToggle.setAttribute("aria-label", interactionToggle.title);
  }
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
function interactionListMarkup(hasActive) { if (!interactions.length) return ""; return '<div class="interaction-picker" role="listbox" aria-label="Interacciones disponibles">' + interactions.map((item) => { const selected = String(item.id) === String(selectedInteractionId); const disabled = hasActive ? ' disabled' : ''; return '<button type="button" class="interaction-choice ' + (selected ? 'is-selected' : '') + '" data-interaction-select="' + item.id + '" aria-selected="' + selected + '" role="option"' + disabled + '><span class="interaction-choice-title">' + (item.title || item.prompt || 'Interacción') + '</span><span class="interaction-choice-prompt">' + (item.prompt || item.title || 'Elige una opción') + '</span></button>'; }).join("") + '</div>'; }
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
if (drawToggle) drawToggle.addEventListener("click", () => { drawingMode = !drawingMode; if(drawingMode)hidePrompter(); updateDrawingMode(); });
if (audiovisualToggle) audiovisualToggle.addEventListener("click", toggleAudiovisualPanel);
if (timeToggle) timeToggle.addEventListener("click", toggleImmersaTimePanel);
if (speakerTimer) speakerTimer.addEventListener("click", toggleSpeakerTimer);
if (speakerTimerResume) speakerTimerResume.addEventListener("click", resumeSpeakerTimer);
if (speakerTimerReset) speakerTimerReset.addEventListener("click", resetSpeakerTimer);
if (fullscreenToggle) fullscreenToggle.addEventListener("click", toggleFullscreen);
if (thumbsToggle) thumbsToggle.addEventListener("click", toggleThumbsPanel);
if (compactLandscapeQuery?.addEventListener) compactLandscapeQuery.addEventListener("change", syncThumbsPanelMode);
else if (compactLandscapeQuery?.addListener) compactLandscapeQuery.addListener(syncThumbsPanelMode);
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && interactionPanelOpen && !hasActiveInteractionShellLock()) closeInteractionPanelRequest(); });
socket.on("presentation_state", (state) => {
  if (!manifest) return;
  render(state);
  followActiveThumb(state);
});
socket.on("overlay_update", (overlays) => {
  currentState = { ...(currentState || {}), overlays: { ...(currentState?.overlays || {}), ...overlays } };
  updateAudienceQrButton({ overlays });
  renderPresenterQr(currentState);
  liveTextControl?.sync(overlays);
});
socket.on("audience_count", (count) => { audience.textContent = count; });
socket.on("audiovisual:state", applyAudiovisualState);
socket.on("audio-react:state", (next = {}) => { audioReactState = { enabled: next.enabled === true, reaction: Math.max(0, Math.min(11, Number(next.reaction) || 0)) }; renderAudiovisualPanel(true); });
socket.on("time:state", applyImmersaTime);
socket.on("local-library:updated", (payload = {}) => { localAudiovisualResources = Array.isArray(payload.resources) ? payload.resources : []; warmAudiovisualDurations(localAudiovisualResources); renderAudiovisualPanel(); });
socket.on("interaction:state", (state) => { activeInteraction = state?.active || null; if (activeInteraction?.id) selectedInteractionId = String(activeInteraction.id); interactionResultsVisible = Boolean(state?.resultsVisible); if (!activeInteraction) interactionResults = null; renderInteractionPanel(); });
socket.on("interaction:active", (interaction) => { activeInteraction = interaction || null; if (activeInteraction?.id) selectedInteractionId = String(activeInteraction.id); interactionResults = null; interactionResultsVisible = false; renderInteractionPanel(); });
socket.on("interaction:results_updated", (results) => { interactionResults = results || null; renderInteractionPanel(); });
socket.on("interaction:closed", () => { activeInteraction = null; interactionResults = null; interactionResultsVisible = false; clearSelectedInteraction(); renderInteractionPanel(); returnInteractionsHome(); });
syncThumbsPanelMode();
ensureInteractionToggle();
loadDeck().then(() => {
  initDrawingOverlay();
  bindPrompterGesture();
  updateDrawingMode();
  socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "presenter", locale: requestedLocale });
});
