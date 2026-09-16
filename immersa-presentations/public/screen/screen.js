const params = new URLSearchParams(location.search);
const roleOpenContext = window.IMMERSA_ROLE_OPEN || {};
const sessionId = params.get("session") || roleOpenContext.session || roleOpenContext.session_id || "demo01";
const deckId = params.get("deck") || roleOpenContext.deck || roleOpenContext.deckId || "demo";
const socket = io();
window.ImmersaPresentationCompletion?.create({ socket, role: "screen", context: roleOpenContext });
let knowledgeActivityScreen = null;
try {
  knowledgeActivityScreen = window.ImmersaKnowledgeActivities?.createScreen({
    socket,
    root: document.getElementById("knowledgeActivityScreen")
  }) || null;
} catch (error) {
  console.error("Unable to initialize Screen knowledge activities", error);
}
let manifest = null;
let pendingPresentationState = null;
let manifestRetryTimer = null;
const screenRoot = document.getElementById("screen");
const fullscreenToggle = document.getElementById("fullscreenToggle");
const localLibraryPicker = document.getElementById("localLibraryPicker");
const localLibraryStatus = document.getElementById("localLibraryStatus");
let screenUiTimer = null;
const slide = document.getElementById("slide");
const qr = document.getElementById("qr");
const message = document.getElementById("message");
const qnaOverlay = document.getElementById("qnaOverlay");
const qnaQuestion = document.getElementById("qnaQuestion");
const qnaName = document.getElementById("qnaName");
const audienceUrl = roleOpenContext.public_url || "";
let activeAudienceUrl = audienceUrl;
let overlays = normalizeOverlayState();
let currentSlideIndex = 0;
let drawingOverlay = null;
let interactionOverlay = null;
let audiovisualState = { audio: { resource: null, status: "stopped" }, video: { resource: null, status: "stopped" } };
let audiovisualLayer = null;
let audiovisualMedia = null;
const localLibrary = { directoryHandle: null, resources: [], files: new Map(), objectUrls: new Map(), scanning: false };
const localVideoExtensions = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
const localAudioExtensions = new Set(["mp3", "wav", "m4a", "aac", "ogg", "flac"]);
function localResourceId(relativePath, file, type) {
  const key = [type, relativePath, file.size, file.lastModified].join("|");
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) { hash ^= key.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return "local:" + type + ":" + (hash >>> 0).toString(36);
}
function setLocalLibraryStatus(text) {
  if (localLibraryStatus) localLibraryStatus.textContent = text || "";
  if (localLibraryPicker) localLibraryPicker.classList.toggle("is-linked", Boolean(localLibrary.directoryHandle));
}
async function makeLocalVideoThumbnail(file) {
  const source = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.preload = "metadata";
  try {
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error("No se pudo leer el video")); video.src = source; });
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.min(Math.max(video.duration * 0.1, 0.12), 2);
      await new Promise((resolve) => { video.onseeked = resolve; video.onerror = resolve; });
    }
    const width = 320, height = 180;
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    const scale = Math.max(width / Math.max(video.videoWidth || width, 1), height / Math.max(video.videoHeight || height, 1));
    const drawWidth = (video.videoWidth || width) * scale, drawHeight = (video.videoHeight || height) * scale;
    context.fillStyle = "#111827"; context.fillRect(0, 0, width, height);
    context.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    return canvas.toDataURL("image/webp", 0.72);
  } catch (error) {
    console.warn("Unable to generate local video thumbnail", file.name, error);
    return "";
  } finally {
    video.removeAttribute("src"); video.load(); URL.revokeObjectURL(source);
  }
}
async function collectLocalFiles(handle, prefix = "") {
  const entries = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === "directory") entries.push(...await collectLocalFiles(entry, prefix + name + "/"));
    else if (entry.kind === "file") {
      const extension = String(name).split(".").pop().toLowerCase();
      const type = localVideoExtensions.has(extension) ? "video" : localAudioExtensions.has(extension) ? "audio" : "";
      if (type) entries.push({ file: await entry.getFile(), type, relativePath: prefix + name });
    }
  }
  return entries;
}
function clearLocalObjectUrls() {
  localLibrary.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  localLibrary.objectUrls.clear();
}
function resolveLocalMediaUrl(resource) {
  const file = localLibrary.files.get(String(resource?.id || ""));
  if (!file) return "";
  const existing = localLibrary.objectUrls.get(String(resource.id));
  if (existing) return existing;
  const url = URL.createObjectURL(file);
  localLibrary.objectUrls.set(String(resource.id), url);
  return url;
}
function resolveAudiovisualMediaUrl(resource) {
  return resource?.source === "local" ? resolveLocalMediaUrl(resource) : resource?.media_url || "";
}
async function scanAndPublishLocalLibrary() {
  if (!localLibrary.directoryHandle || localLibrary.scanning) return;
  localLibrary.scanning = true; setLocalLibraryStatus("Actualizando Librería local…");
  try {
    const files = (await collectLocalFiles(localLibrary.directoryHandle)).sort((a, b) => (a.type === b.type ? a.relativePath.localeCompare(b.relativePath, "es") : a.type === "video" ? -1 : 1)).slice(0, 100);
    clearLocalObjectUrls(); localLibrary.files.clear();
    const resources = [];
    for (const entry of files) {
      const id = localResourceId(entry.relativePath, entry.file, entry.type);
      localLibrary.files.set(id, entry.file);
      resources.push({ id, type: entry.type, source: "local", name: entry.file.name.replace(/\.[^.]+$/, ""), thumbnail_url: entry.type === "video" ? await makeLocalVideoThumbnail(entry.file) : "" });
    }
    localLibrary.resources = resources;
    socket.emit("local-library:publish", { resources });
    setLocalLibraryStatus(resources.length ? "Librería local · " + resources.length + " recursos" : "Librería local vacía");
  } catch (error) {
    console.error("Unable to scan local library", error);
    setLocalLibraryStatus("No se pudo actualizar la carpeta");
  } finally { localLibrary.scanning = false; }
}
async function chooseLocalLibraryFolder() {
  if (!window.showDirectoryPicker) { setLocalLibraryStatus("Usa Chrome o Edge para vincular una carpeta"); return; }
  try {
    localLibrary.directoryHandle = await window.showDirectoryPicker({ mode: "read" });
    await scanAndPublishLocalLibrary();
  } catch (error) {
    if (error?.name !== "AbortError") { console.error("Unable to choose local media folder", error); setLocalLibraryStatus("No se pudo vincular la carpeta"); }
  }
}
let audioFadeToken = 0;
function emptyAudiovisualChannel() { return { resource: null, status: "stopped", loop: false, volume: 1, position: 0 }; }
function normalizeAudiovisualChannels(next = {}) {
  if (next.audio || next.video) return {
    audio: { ...audiovisualState.audio, ...(next.audio || {}) },
    video: { ...audiovisualState.video, ...(next.video || {}) }
  };
  const type = next.resource?.type;
  if (type === "audio" || type === "video") return { ...audiovisualState, [type]: { ...audiovisualState[type], ...next } };
  return audiovisualState;
}
function ensureAudiovisualLayer() {
  if (audiovisualLayer) return;
  audiovisualLayer = document.createElement("div");
  audiovisualLayer.className = "audiovisual-screen-layer";
  audiovisualLayer.innerHTML = '<video playsinline preload="auto"></video><audio preload="auto"></audio>';
  audiovisualMedia = { video: audiovisualLayer.querySelector("video"), audio: audiovisualLayer.querySelector("audio") };
  Object.entries(audiovisualMedia).forEach(([type, item]) => {
    item.addEventListener("loadedmetadata", () => {
      if (item.dataset.resourceId && Number.isFinite(item.duration)) socket.emit("audiovisual:metadata", { resourceId: item.dataset.resourceId, type, duration: item.duration });
    });
    item.addEventListener("ended", () => socket.emit("audiovisual:ended", { resourceId: item.dataset.resourceId, type }));
  });
  screenRoot.appendChild(audiovisualLayer);
}
function applyChannelState(type, state) {
  const media = audiovisualMedia[type];
  const resource = state?.resource;
  if (!resource || state.status === "stopped") {
    if (media) { media.pause(); media.currentTime = 0; }
    return;
  }
  if (media.dataset.resourceId !== String(resource.id)) {
    const mediaUrl = resolveAudiovisualMediaUrl(resource);
    if (!mediaUrl) { console.warn("Local media is not available on this Screen", resource.id); return; }
    media.dataset.resourceId = String(resource.id); media.src = mediaUrl; media.currentTime = 0;
  }
  media.loop = Boolean(state.loop);
  if (type === "audio" && state.status === "fading") {
    const token = ++audioFadeToken;
    const startVolume = media.volume || Math.max(0, Math.min(1, Number(state.volume ?? 1)));
    const started = performance.now();
    const fade = () => {
      if (token !== audioFadeToken || audiovisualState.audio.status !== "fading") return;
      const ratio = Math.max(0, 1 - ((performance.now() - started) / 1000));
      media.volume = startVolume * ratio;
      if (ratio > 0) requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
    return;
  }
  if (type === "audio") audioFadeToken += 1;
  media.volume = Math.max(0, Math.min(1, Number(state.volume ?? 1)));
  const shouldSynchronizePosition = state.lastAction === "seek" || state.lastAction === "play" || state.lastAction === "pause";
  if (shouldSynchronizePosition && Number.isFinite(Number(state.position)) && Math.abs(media.currentTime - Number(state.position)) > 1.2) media.currentTime = Number(state.position);
  if (state.status === "playing") media.play().catch(() => {}); else media.pause();
}
function applyAudiovisualState(next = {}) {
  audiovisualState = normalizeAudiovisualChannels(next);
  ensureAudiovisualLayer();
  applyChannelState("audio", audiovisualState.audio || emptyAudiovisualChannel());
  applyChannelState("video", audiovisualState.video || emptyAudiovisualChannel());
  const videoState = audiovisualState.video || emptyAudiovisualChannel();
  const hasVideo = Boolean(videoState.resource && videoState.status !== "stopped");
  audiovisualLayer.classList.toggle("is-video", hasVideo);
  screenRoot.classList.toggle("has-audiovisual-video", Boolean(videoState.resource && videoState.status === "playing"));
}
document.getElementById("audienceUrl").textContent = activeAudienceUrl;
function normalizeOverlayState(next = {}) { const showReactions = next.showReactions ?? next.reactionsOnScreen ?? true; const showAudienceQr = next.showAudienceQr ?? next.qrVisible ?? false; return { ...next, showReactions, reactionsOnScreen: showReactions, showAudienceQr, qrVisible: showAudienceQr, audienceUrl: next.audienceUrl || activeAudienceUrl || audienceUrl, messageVisible: Boolean(next.messageVisible), messageText: next.messageText || "" }; }

function getFullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
function updateFullscreenButton() {
  const active = Boolean(getFullscreenElement());
  if (!fullscreenToggle) return;
  fullscreenToggle.classList.toggle("is-active", active);
  fullscreenToggle.setAttribute("aria-pressed", String(active));
  fullscreenToggle.title = active ? "Salir de pantalla completa" : "Pantalla completa";
  fullscreenToggle.setAttribute("aria-label", fullscreenToggle.title);
}
function showScreenUi() {
  screenRoot.classList.add("ui-visible");
  clearTimeout(screenUiTimer);
  screenUiTimer = setTimeout(() => {
    screenRoot.classList.remove("ui-visible");
    if (fullscreenToggle) fullscreenToggle.blur();
  }, 2200);
}
async function toggleFullscreen() {
  try {
    if (getFullscreenElement()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
    } else if (screenRoot.requestFullscreen) {
      await screenRoot.requestFullscreen();
    } else if (screenRoot.webkitRequestFullscreen) {
      await screenRoot.webkitRequestFullscreen();
    }
  } catch (error) {
    console.warn("Fullscreen request failed", error);
  } finally {
    updateFullscreenButton();
    if (fullscreenToggle) fullscreenToggle.blur();
    showScreenUi();
  }
}

function makeQrPattern(text) { const grid = document.getElementById("qrPattern"); grid.innerHTML = ""; grid.classList.remove("qr-fallback"); document.getElementById("audienceUrl").textContent = text; if (!text) return; if (window.QRCode) { new window.QRCode(grid, { text, width: 376, height: 376, colorDark: "#111111", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M }); return; } grid.textContent = text; grid.classList.add("qr-fallback"); }
async function loadDeck() {
  const res = await fetch("/decks/" + encodeURIComponent(deckId) + "/manifest.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Screen manifest unavailable (" + res.status + ")");
  const nextManifest = await res.json();
  if (!Array.isArray(nextManifest?.slides) || !nextManifest.slides.length) {
    throw new Error("Screen manifest has no slides");
  }
  manifest = nextManifest;
  if (pendingPresentationState) render(pendingPresentationState);
  return manifest;
}
function loadDeckWithRetry(attempt = 0) {
  loadDeck().catch((error) => {
    if (attempt >= 3) {
      console.error("Unable to load Screen deck", error);
      return;
    }
    clearTimeout(manifestRetryTimer);
    manifestRetryTimer = setTimeout(() => loadDeckWithRetry(attempt + 1), 350 * (attempt + 1));
  });
}
function applySlideOrientation(item, src) { const portrait = item?.orientation === "portrait"; screenRoot.classList.toggle("portrait-slide", portrait); if (portrait) screenRoot.style.setProperty("--slide-bg", "url('" + src.replace(/'/g, "%27") + "')"); else screenRoot.style.removeProperty("--slide-bg"); }
function syncScreenFocus() {
  const messageVisible = Boolean(overlays.messageVisible && overlays.messageText);
  const resultsVisible = Boolean(interactionOverlay && !interactionOverlay.classList.contains("interaction-hidden"));
  screenRoot.classList.toggle("has-focus-overlay", messageVisible || resultsVisible);
}
function applyOverlays(next) { overlays = normalizeOverlayState({ ...overlays, ...next }); if (overlays.audienceUrl !== activeAudienceUrl) { activeAudienceUrl = overlays.audienceUrl || ""; makeQrPattern(activeAudienceUrl); } qr.classList.toggle("hidden", !overlays.showAudienceQr || !activeAudienceUrl); message.textContent = overlays.messageText || ""; message.classList.toggle("hidden", !overlays.messageVisible || !overlays.messageText); syncScreenFocus(); }
function render(state) {
  pendingPresentationState = state;
  applyOverlays(state?.overlays || {});
  if (!manifest?.slides?.length) return;
  const index = state?.liveSlideIndex ?? state?.slideIndex ?? 0;
  const item = manifest.slides[index];
  if (!item?.src) return;
  const previousIndex = currentSlideIndex;
  const changed = index !== previousIndex;
  currentSlideIndex = index;
  const src = "/decks/" + encodeURIComponent(deckId) + "/" + String(item.src).replace(/^\/+/, "");
  if (changed && window.ImmersaSlideTransitions?.swap) window.ImmersaSlideTransitions.swap(slide, src, manifest.slideTransition, index - previousIndex);
  else slide.src = src;
  window.ImmersaSlideTransitions?.preload([index - 1, index + 1].filter((slideIndex) => manifest.slides[slideIndex]).map((slideIndex) => "/decks/" + encodeURIComponent(deckId) + "/" + String(manifest.slides[slideIndex].src).replace(/^\/+/, "")));
  applySlideOrientation(item, src);
  window.ImmersaDemoPlanBadge?.update(screenRoot, item, manifest);
  drawingOverlay?.refresh();
}
function popReaction(emoji) { if (!overlays.showReactions) return; const node = document.createElement("span"); node.className = "reaction"; node.textContent = emoji; node.style.left = Math.round(18 + Math.random() * 64) + "vw"; node.style.setProperty("--x", Math.round(Math.random() * 220 - 110) + "px"); document.getElementById("reactions").appendChild(node); setTimeout(() => node.remove(), 3100); }
function initDrawingOverlay() { if (drawingOverlay || !window.ImmersaDrawingOverlay) return; drawingOverlay = window.ImmersaDrawingOverlay.create({ root: screenRoot, slide, getSlideIndex: () => currentSlideIndex, zIndex: 2 }); }
function ensureInteractionOverlay() { if (interactionOverlay) return interactionOverlay; interactionOverlay = document.createElement("section"); interactionOverlay.className = "interaction-results-overlay interaction-hidden"; interactionOverlay.setAttribute("aria-label", "Resultados de interacción"); screenRoot.appendChild(interactionOverlay); return interactionOverlay; }
function renderResultRows(results) { return '<div class="interaction-results-list">' + results.options.map((option) => '<div class="interaction-result-row"><div class="interaction-result-label"><span>' + option.label + '</span><strong>' + option.percentage + '%</strong></div><div class="interaction-result-bar"><span style="width:' + option.percentage + '%"></span></div></div>').join("") + '</div>'; }
function showInteractionResults(results) { if (!results) return; const overlay = ensureInteractionOverlay(); overlay.classList.remove("interaction-hidden"); overlay.innerHTML = '<h2>' + (results.title || 'Resultados') + '</h2><p>' + (results.prompt || '') + '</p>' + renderResultRows(results); syncScreenFocus(); }
function hideInteractionResults() { ensureInteractionOverlay().classList.add("interaction-hidden"); syncScreenFocus(); }
function renderQnaScreen(payload = {}) {
  const question = payload.visible ? payload.question : null;
  const text = String(question?.text || "").trim();
  if (!question || !text) {
    qnaOverlay.hidden = true;
    qnaQuestion.textContent = "";
    qnaName.textContent = "";
    qnaName.hidden = true;
    return;
  }
  const name = String(question.name || "").trim();
  qnaQuestion.textContent = text;
  qnaName.textContent = name;
  qnaName.hidden = !name;
  qnaOverlay.hidden = false;
}

if (fullscreenToggle) fullscreenToggle.addEventListener("click", toggleFullscreen);
if (localLibraryPicker) localLibraryPicker.addEventListener("click", chooseLocalLibraryFolder);
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const tagName = String(event.target?.tagName || "").toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select" || event.target?.isContentEditable) return;
  if (event.key === "ArrowRight") {
    event.preventDefault();
    if (socket.connected !== false) (socket.volatile || socket).emit("slide_next");
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (socket.connected !== false) (socket.volatile || socket).emit("slide_prev");
  }
});
["mousemove", "mousedown", "touchstart", "pointermove"].forEach((eventName) => {
  screenRoot.addEventListener(eventName, showScreenUi, { passive: true });
});
showScreenUi();

socket.on("presentation_state", render);
socket.on("audiovisual:state", applyAudiovisualState);
socket.on("overlay_update", applyOverlays);
socket.on("clear_overlays", () => applyOverlays({ qrVisible: false, showAudienceQr: false, messageVisible: false, messageText: "" }));
socket.on("reaction", ({ emoji, target }) => { if (target === "screen") popReaction(emoji); });
socket.on("drawing_stroke", (stroke) => drawingOverlay?.addStroke(stroke));
socket.on("interaction:show_results", showInteractionResults);
socket.on("interaction:hide_results", hideInteractionResults);
socket.on("interaction:closed", hideInteractionResults);
socket.on("qna:screen", renderQnaScreen);
makeQrPattern(activeAudienceUrl);
socket.on("connect", () => {
  socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "screen" });
  if (localLibrary.resources.length) socket.emit("local-library:publish", { resources: localLibrary.resources });
});
if (socket.connected) {
  socket.emit("join_presentation", { session: sessionId, deck: deckId, role: "screen" });
}
loadDeckWithRetry();
initDrawingOverlay();
