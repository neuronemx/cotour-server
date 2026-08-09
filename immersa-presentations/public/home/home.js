const PUBLIC_ORIGIN = "https://immersa.mx";
const roles = ["speaker", "audience", "screen", "stage"];
const labels = { speaker: "Speaker", audience: "Público", screen: "Screen", stage: "Stage" };
let decks = [];
let activeDeck = null;
let detailDeck = null;
let planUsage = null;

const deckList = document.getElementById("deckList");
const deckCount = document.getElementById("deckCount");
const deckNotice = document.getElementById("deckNotice");
const uploadForm = document.getElementById("uploadForm");
const uploadButton = document.getElementById("uploadButton"); // Puede no existir: el flujo abre el modal al seleccionar archivo.
const uploadStatus = document.getElementById("uploadStatus");
const fileDrop = document.getElementById("fileDrop");
const fileInput = document.getElementById("pptxFile");
const selectedFileName = document.getElementById("selectedFileName");
const accountPlanBadge = document.getElementById("accountPlanBadge");
const planUsagePanel = document.getElementById("planUsage");
const planName = document.getElementById("planName");
const planDeckUsage = document.getElementById("planDeckUsage");
const planStorageUsage = document.getElementById("planStorageUsage");
const planDeckBar = document.getElementById("planDeckBar");
const planStorageBar = document.getElementById("planStorageBar");
const planLimitMessage = document.getElementById("planLimitMessage");
const nameModal = document.getElementById("nameModal");
const nameForm = document.getElementById("nameForm");
const presentationName = document.getElementById("presentationName");
const cancelName = document.getElementById("cancelName");
const deckDetailModal = document.getElementById("deckDetailModal");
const closeDeckDetail = document.getElementById("closeDeckDetail");
const detailThumb = document.getElementById("detailThumb");
const detailSlideStrip = document.getElementById("detailSlideStrip");
const detailTitle = document.getElementById("detailTitle");
const detailDate = document.getElementById("detailDate");
const detailSlides = document.getElementById("detailSlides");
const detailStatus = document.getElementById("detailStatus");
const detailActions = document.getElementById("detailActions");
const detailRename = document.getElementById("detailRename");
const detailReplace = document.getElementById("detailReplace");
const replacementFile = document.getElementById("replacementFile");
const replacementReview = document.getElementById("replacementReview");
const replacementReviewed = document.getElementById("replacementReviewed");
const conversionOverlay = document.getElementById("conversionOverlay");
const conversionCard = conversionOverlay?.querySelector(".conversion-card");
const conversionTitle = document.getElementById("conversionTitle");
const conversionMessage = document.getElementById("conversionMessage");
const conversionPercent = document.getElementById("conversionPercent");
const conversionBarFill = document.getElementById("conversionBarFill");
let conversionProgressTimer = null;
let conversionProgressValue = 0;
let pendingFile = null;
let renameDeckTarget = null;
let detailSlidesRequestId = 0;

function normalizeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function sessionId() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let value = "";
  const cryptoObj = window.crypto || window.msCrypto;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(8);
    cryptoObj.getRandomValues(bytes);
    bytes.forEach((byte) => value += alphabet[byte % alphabet.length]);
  } else {
    for (let i = 0; i < 8; i += 1) value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

function titleFromFile(file) {
  return String(file?.name || "")
    .replace(/\.(pptx|pdf)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

function percentage(used, limit) {
  if (!Number.isFinite(Number(limit)) || Number(limit) <= 0) return 0;
  return Math.max(0, Math.min(100, (Number(used) / Number(limit)) * 100));
}

function storageLabel(bytes) {
  const megabytes = Math.max(0, Number(bytes) || 0) / (1024 * 1024);
  if (megabytes === 0) return "0 MB";
  if (megabytes < 0.1) return "< 0.1 MB";
  return (megabytes >= 10 ? Math.round(megabytes) : Math.round(megabytes * 10) / 10) + " MB";
}

function currentPlanBlockMessage() {
  if (!planUsage) return "";
  if (planUsage.remaining?.decks < 1) {
    return "Alcanzaste las " + planUsage.limits.decks + " presentaciones de tu plan " + planUsage.plan + ". Elimina una para subir otra.";
  }
  if (planUsage.remaining?.storageBytes < 1) {
    return "Alcanzaste los " + storageLabel(planUsage.limits.storageBytes) + " de tu plan " + planUsage.plan + ". Elimina una presentación para liberar espacio.";
  }
  return "";
}

function uploadIssue(file) {
  const blocked = currentPlanBlockMessage();
  if (blocked) return blocked;
  if (file && planUsage && Number(file.size || 0) > Number(planUsage.remaining?.storageBytes || 0)) {
    return "Este archivo pesa " + storageLabel(file.size) + " y tienes " + storageLabel(planUsage.remaining.storageBytes) + " disponibles en tu plan " + planUsage.plan + ".";
  }
  return "";
}

function replacementIssue(file, deck) {
  if (!file || !deck || !planUsage) return "";
  const currentBytes = Math.max(0, Number(deck.sourceSizeBytes) || 0);
  const availableBytes = Math.max(0, Number(planUsage.remaining?.storageBytes) || 0) + currentBytes;
  if (Number(file.size || 0) > availableBytes) {
    return "Este archivo pesa " + storageLabel(file.size) + " y tienes " + storageLabel(availableBytes) + " disponibles al sustituirla en tu plan " + planUsage.plan + ".";
  }
  return "";
}

function renderPlanUsage() {
  if (!planUsage) return;
  const plan = String(planUsage.plan || "FREE");
  if (accountPlanBadge) accountPlanBadge.textContent = plan;
  if (planName) planName.textContent = plan;
  if (planUsagePanel) planUsagePanel.setAttribute("aria-label", "Uso del plan " + plan);
  if (planDeckUsage) planDeckUsage.textContent = planUsage.usage.decks + " de " + planUsage.limits.decks;
  if (planStorageUsage) planStorageUsage.textContent = storageLabel(planUsage.usage.storageBytes) + " de " + storageLabel(planUsage.limits.storageBytes);
  if (planDeckBar) planDeckBar.style.width = percentage(planUsage.usage.decks, planUsage.limits.decks) + "%";
  if (planStorageBar) planStorageBar.style.width = percentage(planUsage.usage.storageBytes, planUsage.limits.storageBytes) + "%";

  const blockedMessage = currentPlanBlockMessage();
  if (planLimitMessage) {
    planLimitMessage.textContent = blockedMessage;
    planLimitMessage.hidden = !blockedMessage;
  }
  fileDrop.classList.toggle("is-disabled", Boolean(blockedMessage));
  fileDrop.setAttribute("aria-disabled", blockedMessage ? "true" : "false");
  fileDrop.tabIndex = blockedMessage ? -1 : 0;
  fileInput.disabled = Boolean(blockedMessage);
}

async function loadPlanUsage() {
  try {
    const response = await fetch("/api/account/plan", { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo cargar el plan");
    planUsage = await response.json();
    renderPlanUsage();
  } catch (_error) {
    planUsage = null;
  }
}

function openNameModal(file) {
  const issue = uploadIssue(file);
  if (issue) return setUploadStatus(issue, "error");
  if (!nameModal || !presentationName) return;
  pendingFile = file || fileInput.files[0] || null;
  renameDeckTarget = null;
  document.getElementById("nameModalTitle").textContent = "Nombra tu presentación";
  nameModal.querySelector("p").textContent = "¿Cómo quieres identificar esta presentación en Immersa?";
  document.getElementById("confirmName").textContent = "Crear presentación";
  presentationName.value = titleFromFile(pendingFile);
  nameModal.hidden = false;
  nameModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  window.setTimeout(() => presentationName.focus(), 20);
}

function closeNameModal(clearFile = false) {
  if (!nameModal) return;
  nameModal.hidden = true;
  nameModal.setAttribute("aria-hidden", "true");
  renameDeckTarget = null;
  if (deckDetailModal && !deckDetailModal.hidden) {
    deckDetailModal.setAttribute("aria-hidden", "false");
  }
  if (!deckDetailModal || deckDetailModal.hidden) document.body.classList.remove("modal-open");
  if (clearFile) {
    pendingFile = null;
    uploadForm.reset();
    updateSelectedFileName(false);
  }
}

function openRenameModal(deck) {
  if (!nameModal || !presentationName || !deck) return;
  renameDeckTarget = deck;
  pendingFile = null;
  document.getElementById("nameModalTitle").textContent = "Renombra tu presentación";
  nameModal.querySelector("p").textContent = "El nuevo nombre se mostrará en todo Immersa.";
  document.getElementById("confirmName").textContent = "Guardar nombre";
  presentationName.value = niceTitle(deck.title || deck.deckId || "Presentación");
  nameModal.hidden = false;
  nameModal.setAttribute("aria-hidden", "false");
  if (deckDetailModal && !deckDetailModal.hidden) {
    deckDetailModal.setAttribute("aria-hidden", "true");
  }
  document.body.classList.add("modal-open");
  window.setTimeout(() => {
    presentationName.focus();
    presentationName.select();
  }, 20);
}

function deckSession(deck) {
  const value = deck?.sessionCode || deck?.session || deck?.linkName || deck?.publicCode || deck?.deckId || "";
  return normalizeSlug(value) || "";
}

function activeDeckMeta() {
  return decks.find((deck) => deck.deckId === activeDeck);
}

function isPendingDeck(deck) {
  return deck && (deck.status === "uploaded" || deck.conversionStatus === "pending");
}

function isFailedDeck(deck) {
  return deck && (deck.status === "conversion_failed" || deck.conversionStatus === "failed");
}

function isConvertedDeck(deck) {
  return deck && (deck.status === "converted" || deck.conversionStatus === "completed" || deck.status === "ready" || deck.conversionStatus === "ready");
}

function deckStatusLabel(deck) {
  if (deck?.isLive || deck?.status === "live") return "En vivo";
  if (isConvertedDeck(deck)) return "Lista";
  if (isFailedDeck(deck)) return "Falló";
  if (isPendingDeck(deck)) return deck.conversionStatus === "pending" ? "Convirtiendo" : "Pendiente";
  return "Borrador";
}

function deckBadgeClass(deck) {
  const label = deckStatusLabel(deck).toLowerCase();
  if (label.includes("vivo")) return " live";
  if (label.includes("borrador") || label.includes("pendiente") || label.includes("convirtiendo")) return " draft";
  if (label.includes("fall")) return " failed";
  return "";
}

function deckSlideCount(deck) {
  const value = deck?.slideCount ?? deck?.slidesCount ?? (Array.isArray(deck?.slides) ? deck.slides.length : deck?.slides);
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function deckSlideLabel(deck) {
  const count = deckSlideCount(deck);
  if (!count) return "Slides pendientes";
  return count + " slide" + (count === 1 ? "" : "s");
}

function parseDeckDate(deck) {
  const raw = deck?.convertedAt || deck?.conversionCompletedAt || deck?.conversionFinishedAt || deck?.completedAt || deck?.converted_at || deck?.updatedAt || deck?.updated_at || deck?.createdAt || deck?.created_at || "";
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDeckDate(date) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date).replace(",", " ·");
}

function deckConversionDate(deck) {
  const date = parseDeckDate(deck);
  return date ? formatDeckDate(date) : "Fecha no disponible";
}

function deckConversionMeta(deck) {
  if (isPendingDeck(deck)) return "Convirtiendo…";
  if (isFailedDeck(deck)) return "Conversión fallida";
  return deckConversionDate(deck);
}

function setConversionProgress(value) {
  conversionProgressValue = Math.max(0, Math.min(100, Math.round(value || 0)));
  if (conversionPercent) conversionPercent.textContent = conversionProgressValue + "%";
  if (conversionBarFill) conversionBarFill.style.width = conversionProgressValue + "%";
}

function setConversionOverlay(visible, options = {}) {
  if (!conversionOverlay) return;

  if (!visible) {
    window.clearInterval(conversionProgressTimer);
    conversionProgressTimer = null;
    conversionOverlay.hidden = true;
    conversionOverlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("conversion-open");
    conversionCard?.classList.remove("success", "error");
    return;
  }

  const state = options.state || "loading";
  conversionOverlay.hidden = false;
  conversionOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("conversion-open");
  conversionCard?.classList.toggle("success", state === "success");
  conversionCard?.classList.toggle("error", state === "error");

  if (conversionTitle) conversionTitle.textContent = options.title || "Convirtiendo tu presentación";
  if (conversionMessage) conversionMessage.textContent = options.message || "Preparando slides y archivos para Immersa.";
  setConversionProgress(options.percent ?? conversionProgressValue);
}

function startConversionProgress() {
  window.clearInterval(conversionProgressTimer);
  conversionProgressTimer = null;
  setConversionProgress(0);

  conversionProgressTimer = window.setInterval(() => {
    const next = conversionProgressValue < 72
      ? conversionProgressValue + 4
      : conversionProgressValue < 90
        ? conversionProgressValue + 2
        : conversionProgressValue < 96
          ? conversionProgressValue + 1
          : conversionProgressValue;
    setConversionProgress(Math.min(next, 96));
  }, 260);
}

function finishConversionOverlay(state, title, message, hold = 1600) {
  window.clearInterval(conversionProgressTimer);
  conversionProgressTimer = null;
  setConversionOverlay(true, { state, title, message, percent: 100 });
  window.setTimeout(() => setConversionOverlay(false), hold);
}

function accessRoute(role) {
  return role === "speaker" ? "speaker" : role;
}

function accessUrl(role, data) {
  if (role === "audience") {
    if (!data?.public_id) throw new Error("El backend no devolvió public_id.");
    return window.location.origin + "/" + data.public_id;
  }
  if (!data?.access_token) throw new Error("El backend no devolvió access_token.");
  return window.location.origin + "/" + accessRoute(role) + "/" + data.access_token;
}

async function createAccessLink(role, deck) {
  const sessionIdValue = String(deck?.session_id || "").trim();
  if (!sessionIdValue) throw new Error("Esta presentación aún no tiene session_id.");

  const res = await fetch("/api/access-links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionIdValue, role })
  });

  let data = null;
  try {
    data = await res.json();
  } catch (_error) {}

  if (!res.ok) throw new Error(data?.error || "No se pudo generar el link.");
  return accessUrl(role, data);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_error) {
      // iOS and in-app browsers can expose Clipboard API but reject writeText.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (_error) {}
  textarea.remove();
  if (copied) return true;

  window.prompt("Copia este link:", value);
  return false;
}

async function copyRoleLink(role, deck, button) {
  const label = labels[role] || role;
  const original = button.textContent;
  let speakerWindow = null;

  if (role === "speaker") {
    // Open synchronously from the tap. Safari/iOS blocks window.open after an await.
    speakerWindow = window.open("about:blank", "_blank");
    if (speakerWindow) speakerWindow.opener = null;
  }

  button.disabled = true;
  button.textContent = role === "speaker" ? "Abriendo" : "Generando";

  try {
    if (role === "speaker" && !speakerWindow) throw new Error("El navegador bloqueó la nueva pestaña.");
    const url = await createAccessLink(role, deck);
    if (role === "speaker") {
      speakerWindow.location.replace(url);
      button.textContent = "Speaker abierto";
    } else {
      const copied = await copyText(url);
      button.textContent = copied ? "Link copiado" : "Link listo";
      button.classList.add("copied");
    }
  } catch (error) {
    if (speakerWindow && !speakerWindow.closed) speakerWindow.close();
    button.textContent = role === "speaker" ? "No se pudo abrir" : "No se pudo copiar";
    console.error("No se pudo preparar el acceso " + label + ":", error);
  } finally {
    window.setTimeout(() => {
      button.textContent = original;
      button.classList.remove("copied");
      button.disabled = false;
    }, 1600);
  }
}

async function deleteDeck(deck) {
  const title = niceTitle(deck.title || deck.deckId || "esta presentación");
  const confirmed = window.confirm('¿Eliminar "' + title + '"?\n\nEsta acción no se puede deshacer.');
  if (!confirmed) return;

  try {
    const res = await fetch("/api/decks/" + encodeURIComponent(deck.deckId), { method: "DELETE" });
    if (!res.ok) {
      let message = "No se pudo eliminar la presentación.";
      try {
        const data = await res.json();
        message = data.error || data.message || message;
      } catch (_error) {}
      throw new Error(message);
    }

    decks = decks.filter((item) => item.deckId !== deck.deckId);
    if (detailDeck?.deckId === deck.deckId) closeDeckModal();
    activeDeck = decks[0]?.deckId || null;
    renderAll();
    await loadPlanUsage();
    setUploadStatus("Presentación eliminada.", "success");
  } catch (error) {
    setUploadStatus("Error: " + error.message, "error");
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function firstSlideThumbnailCandidates(deck) {
  const direct = [
    deck.thumbnail,
    deck.thumbnailUrl,
    deck.cover,
    deck.coverUrl,
    deck.firstSlide,
    deck.firstSlideUrl,
    deck.slide1,
    deck.slide1Url,
    deck.thumbnailPath,
    deck.coverPath
  ];

  if (Array.isArray(deck.slideImages) && deck.slideImages[0]) direct.push(deck.slideImages[0]);
  if (Array.isArray(deck.slides) && deck.slides[0]) {
    if (typeof deck.slides[0] === "string") direct.push(deck.slides[0]);
    else direct.push(
      deck.slides[0].thumbnail,
      deck.slides[0].thumbnailUrl,
      deck.slides[0].image,
      deck.slides[0].imageUrl,
      deck.slides[0].url,
      deck.slides[0].path
    );
  }

  const id = deck.deckId ? encodeURIComponent(deck.deckId) : "";
  const derived = id ? [
    `/decks/${id}/slide-1.png`,
    `/decks/${id}/slide-1.jpg`,
    `/decks/${id}/slide1.png`,
    `/decks/${id}/slide1.jpg`,
    `/decks/${id}/slides/slide-1.png`,
    `/decks/${id}/slides/slide-1.jpg`,
    `/decks/${id}/slides/slide-001.png`,
    `/decks/${id}/slides/slide-001.jpg`,
    `/decks/${id}/slides/1.png`,
    `/decks/${id}/slides/1.jpg`,
    `/uploads/decks/${id}/slide-1.png`,
    `/uploads/decks/${id}/slides/slide-1.png`,
    `/api/decks/${id}/thumbnail`,
    `/api/decks/${id}/slide/1/thumbnail`
  ] : [];

  return unique([
    ...direct.map((value) => deckAssetUrl(deck.deckId, value)),
    ...derived
  ]);
}

function deckAssetUrl(deckId, value) {
  if (!value || typeof value !== "string") return "";
  if (/^(https?:)?\/\//.test(value) || value.startsWith("data:") || value.startsWith("blob:")) return value;
  if (value.startsWith("/")) return value;
  const [rawPath, ...queryParts] = value.split("?");
  const safePath = rawPath
    .replace(/^\.\//, "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
  const query = queryParts.length ? "?" + queryParts.join("?") : "";
  return safePath ? "/decks/" + encodeURIComponent(deckId) + "/" + safePath + query : "";
}

function slideImageCandidates(deck, slide, preferThumbnail = false) {
  const thumbnail = [slide?.thumb, slide?.thumbnail, slide?.thumbnailUrl];
  const full = [slide?.poster, slide?.image, slide?.imageUrl, slide?.src, slide?.url, slide?.path];
  return unique((preferThumbnail ? [...thumbnail, ...full] : [...full, ...thumbnail]).map((value) => deckAssetUrl(deck.deckId, value)));
}

function niceTitle(title = "Presentación") {
  return String(title).replace(/[-_]+/g, " ").trim() || "Presentación";
}

function attachImageWithFallback(img, thumb, candidates, index = 0) {
  const candidate = candidates[index];
  if (!candidate) {
    img.remove();
    thumb.classList.remove("is-loading");
    thumb.classList.add("has-fallback");
    return;
  }

  img.onload = () => {
    thumb.classList.remove("is-loading", "has-fallback");
    thumb.classList.add("has-image");
  };
  img.onerror = () => {
    attachImageWithFallback(img, thumb, candidates, index + 1);
  };
  img.src = candidate;
}

function renderThumb(deck, className = "deck-thumb") {
  const thumb = document.createElement("div");
  const candidates = firstSlideThumbnailCandidates(deck);
  thumb.className = className + (candidates.length ? " is-loading" : " has-fallback");

  if (candidates.length) {
    const img = document.createElement("img");
    img.alt = "Slide 1 de " + niceTitle(deck.title || deck.deckId);
    img.loading = "lazy";
    thumb.appendChild(img);
    attachImageWithFallback(img, thumb, candidates);
  }

  const fallback = document.createElement("span");
  fallback.className = "thumb-fallback";
  fallback.textContent = "Slide 1 no disponible";

  thumb.append(fallback);
  return thumb;
}

function renderDetailSlide(deck, slide, index) {
  const thumb = document.createElement("div");
  const candidates = slideImageCandidates(deck, slide);
  thumb.className = "deck-detail-thumb" + (candidates.length ? " is-loading" : " has-fallback");

  if (candidates.length) {
    const img = document.createElement("img");
    img.alt = "Slide " + (index + 1) + " de " + niceTitle(deck.title || deck.deckId);
    thumb.appendChild(img);
    attachImageWithFallback(img, thumb, candidates);
  }

  const fallback = document.createElement("span");
  fallback.className = "thumb-fallback";
  fallback.textContent = "Slide " + (index + 1) + " no disponible";
  thumb.appendChild(fallback);
  return thumb;
}

async function loadDetailSlideNavigation(deck) {
  if (!detailSlideStrip || !detailThumb) return;
  const requestId = ++detailSlidesRequestId;
  detailSlideStrip.hidden = true;
  detailSlideStrip.replaceChildren();

  try {
    const response = await fetch("/decks/" + encodeURIComponent(deck.deckId) + "/manifest.json", { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudieron cargar las miniaturas");
    const manifest = await response.json();
    const slides = Array.isArray(manifest?.slides) ? manifest.slides : [];
    if (requestId !== detailSlidesRequestId || detailDeck?.deckId !== deck.deckId || !slides.length) return;

    const buttons = slides.map((slide, index) => {
      const button = document.createElement("button");
      const candidates = slideImageCandidates(deck, slide, true);
      button.type = "button";
      button.className = "deck-detail-slide-thumb" + (candidates.length ? " is-loading" : " has-fallback");
      button.setAttribute("aria-label", "Ver slide " + (index + 1));
      button.setAttribute("aria-pressed", "false");

      if (candidates.length) {
        const image = document.createElement("img");
        image.alt = "";
        image.loading = "lazy";
        image.draggable = false;
        button.appendChild(image);
        attachImageWithFallback(image, button, candidates);
      }

      const fallback = document.createElement("span");
      fallback.className = "deck-detail-slide-fallback";
      fallback.textContent = String(index + 1);
      button.appendChild(fallback);

      const number = document.createElement("span");
      number.className = "deck-detail-slide-number";
      number.textContent = String(index + 1);
      button.appendChild(number);

      button.addEventListener("click", () => {
        if (detailDeck?.deckId !== deck.deckId) return;
        detailThumb.replaceChildren(renderDetailSlide(deck, slide, index));
        buttons.forEach((item, itemIndex) => {
          const selected = itemIndex === index;
          item.classList.toggle("is-active", selected);
          item.setAttribute("aria-pressed", String(selected));
        });
      });
      return button;
    });

    detailSlideStrip.append(...buttons);
    detailSlideStrip.hidden = false;
    buttons[0].click();
  } catch (_error) {
    if (requestId === detailSlidesRequestId) detailSlideStrip.hidden = true;
  }
}

function renderEmptyDecks() {
  const empty = document.createElement("article");
  empty.className = "deck-empty-state";

  const icon = document.createElement("div");
  icon.className = "empty-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "↥";

  const title = document.createElement("strong");
  title.textContent = "Aún no hay presentaciones";

  const hint = document.createElement("p");
  hint.textContent = "Sube un PPTX o PDF para crear tu primera experiencia Immersa.";

  empty.append(icon, title, hint);
  deckList.appendChild(empty);
}

function renderDecks() {
  const countLabel = decks.length + " presentación" + (decks.length === 1 ? "" : "es");
  deckCount.textContent = countLabel;
  deckList.innerHTML = "";

  if (!decks.length) {
    activeDeck = null;
    deckNotice.hidden = true;
    renderEmptyDecks();
    return;
  }

  decks.forEach((deck) => {
    const row = document.createElement("article");
    row.className = "deck-option deck-row" + (isPendingDeck(deck) ? " pending" : "") + (isFailedDeck(deck) ? " failed" : "") + (isConvertedDeck(deck) ? " converted" : "");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", "Ver detalles de " + niceTitle(deck.title || deck.deckId || "Presentación"));

    const thumb = renderThumb(deck);

    const info = document.createElement("div");
    info.className = "deck-info";

    const titleLine = document.createElement("div");
    titleLine.className = "deck-title-line";

    const title = document.createElement("strong");
    title.textContent = niceTitle(deck.title || deck.deckId || "Presentación");

    titleLine.append(title);

    if (!isConvertedDeck(deck) || deck?.isLive || deck?.status === "live") {
      const badge = document.createElement("em");
      badge.className = "deck-badge" + deckBadgeClass(deck);
      badge.textContent = deckStatusLabel(deck);
      titleLine.appendChild(badge);
    }

    const metaLine = document.createElement("div");
    metaLine.className = "deck-meta-line";

    const convertedAt = document.createElement("span");
    convertedAt.textContent = deckConversionMeta(deck);

    const slides = document.createElement("span");
    slides.textContent = deckSlideLabel(deck);

    metaLine.append(convertedAt, slides);

    info.append(titleLine, metaLine);

    if (isFailedDeck(deck) && deck.conversionMessage) {
      const error = document.createElement("span");
      error.className = "deck-error";
      error.textContent = deck.conversionMessage;
      info.appendChild(error);
    }

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "deck-delete";
    deleteButton.setAttribute("aria-label", "Eliminar presentación");
    deleteButton.title = "Eliminar presentación";
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteDeck(deck);
    });

    row.append(thumb, info, deleteButton);
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      openDeckModal(deck);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openDeckModal(deck);
    });
    deckList.appendChild(row);
  });

  const deck = activeDeckMeta();
  deckNotice.hidden = !(isPendingDeck(deck) || isFailedDeck(deck));
  if (isFailedDeck(deck)) deckNotice.textContent = deck.conversionMessage || "La conversión falló. Verás una pantalla provisional.";
  else deckNotice.textContent = "Esta presentación aún no ha sido convertida. Verás una pantalla provisional.";
}

function renderDetailActions(deck) {
  if (!detailActions) return;
  detailActions.innerHTML = "";

  roles.forEach((role) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "detail-role-action role-" + role;
    button.textContent = labels[role] || role;
    button.title = role === "speaker" ? "Abrir Speaker en nueva pestaña" : "Copiar link de " + (labels[role] || role);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      copyRoleLink(role, deck, event.currentTarget);
    });
    detailActions.appendChild(button);
  });
}

function openDeckModal(deck) {
  if (!deckDetailModal || !deck) return;
  detailDeck = deck;
  if (replacementReview) replacementReview.hidden = !deck.associationsReviewRequired;
  activeDeck = deck.deckId;

  if (detailThumb) {
    detailThumb.innerHTML = "";
    detailThumb.appendChild(renderThumb(deck, "deck-detail-thumb"));
  }
  if (detailTitle) detailTitle.textContent = niceTitle(deck.title || deck.deckId || "Presentación");
  if (detailDate) detailDate.textContent = deckConversionMeta(deck);
  if (detailSlides) detailSlides.textContent = deckSlideLabel(deck);
  if (detailStatus) {
    detailStatus.textContent = deckStatusLabel(deck);
    detailStatus.className = "deck-detail-status" + deckBadgeClass(deck);
  }
  renderDetailActions(deck);
  loadDetailSlideNavigation(deck);

  deckDetailModal.hidden = false;
  deckDetailModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  document.dispatchEvent(new CustomEvent("immersa:deck-detail-open", { detail: { deck } }));
  window.setTimeout(() => closeDeckDetail?.focus(), 20);
}

function closeDeckModal() {
  if (!deckDetailModal) return;
  detailSlidesRequestId += 1;
  if (detailSlideStrip) {
    detailSlideStrip.hidden = true;
    detailSlideStrip.replaceChildren();
  }
  deckDetailModal.hidden = true;
  deckDetailModal.setAttribute("aria-hidden", "true");
  document.dispatchEvent(new CustomEvent("immersa:deck-detail-close"));
  detailDeck = null;
  if (!nameModal || nameModal.hidden) document.body.classList.remove("modal-open");
}

async function replaceDeckFile(file) {
  const deck = detailDeck;
  if (!deck || !file) return;
  const lowerName = String(file.name || "").toLowerCase();
  if (!lowerName.endsWith(".pptx") && !lowerName.endsWith(".pdf")) {
    return setUploadStatus("Error: solo se aceptan archivos PPTX o PDF.", "error");
  }
  const issue = replacementIssue(file, deck);
  if (issue) return setUploadStatus(issue, "error");
  const accepted = window.confirm(
    "Sustituiremos las slides de “" + (deck.title || "esta presentación") + "”.\n\n" +
    "Se conservarán Interacciones, Videos, enlaces y configuración. Si cambia el número de slides, Immersa te pedirá revisar sus asociaciones."
  );
  if (!accepted) {
    replacementFile.value = "";
    return;
  }

  const formData = new FormData();
  formData.append("pptx", file);
  closeDeckModal();
  startConversionProgress();
  setConversionOverlay(true, {
    state: "loading",
    title: "Sustituyendo tu presentación",
    message: "La versión actual seguirá intacta hasta terminar la conversión.",
    percent: 0
  });
  setUploadStatus("", "");
  try {
    const response = await fetch("/api/decks/" + encodeURIComponent(deck.deckId) + "/replace", { method: "POST", body: formData });
    const data = await response.json();
    if (data.plan) {
      planUsage = data.plan;
      renderPlanUsage();
    }
    if (!response.ok) throw new Error(data.error || "No se pudo sustituir la presentación");
    const deckIndex = decks.findIndex((item) => item.deckId === deck.deckId);
    if (deckIndex >= 0) decks[deckIndex] = { ...decks[deckIndex], ...data };
    renderDecks();
    await Promise.all([loadDecks(deck.deckId), loadPlanUsage()]);
    finishConversionOverlay(
      "success",
      "Presentación actualizada",
      data.associationsReviewRequired
        ? "Tus configuraciones se conservaron. Revisa sus asociaciones porque cambió la estructura."
        : "Tus configuraciones y asociaciones se conservaron."
    );
  } catch (error) {
    finishConversionOverlay("error", "No se pudo sustituir", (error.message || "Inténtalo nuevamente.") + " Tu versión anterior permanece intacta.", 3200);
  } finally {
    replacementFile.value = "";
  }
}

function renderAll() {
  renderDecks();
  renderPlanUsage();
}

async function loadDecks(selectedDeckId = activeDeck) {
  try {
    const res = await fetch("/api/decks", { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo cargar la lista de presentaciones");
    const data = await res.json();
    decks = Array.isArray(data) ? data : [];
    activeDeck = decks.length && decks.some((deck) => deck.deckId === selectedDeckId) ? selectedDeckId : decks[0]?.deckId || null;
  } catch (_error) {
    decks = [];
    activeDeck = null;
  }
  renderAll();
}

function setUploadStatus(message, type = "") {
  uploadStatus.textContent = message;
  uploadStatus.className = "upload-status" + (type ? " " + type : "");
}

function updateSelectedFileName(askName = false) {
  const file = fileInput.files[0];
  const issue = uploadIssue(file);
  if (file && issue) {
    fileInput.value = "";
    selectedFileName.textContent = "Ningún archivo seleccionado";
    setUploadStatus(issue, "error");
    return;
  }
  selectedFileName.textContent = file ? file.name : "Ningún archivo seleccionado";
  if (askName && file) openNameModal(file);
}

fileInput.addEventListener("change", () => updateSelectedFileName(true));

["dragenter", "dragover"].forEach((eventName) => {
  fileDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    fileDrop.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  fileDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    fileDrop.classList.remove("dragging");
  });
});

fileDrop.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (!file) return;
  const issue = uploadIssue(file);
  if (issue) return setUploadStatus(issue, "error");
  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  updateSelectedFileName(true);
});

fileDrop.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

uploadForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!file) return setUploadStatus("Arrastra o selecciona un archivo para crear la presentación.", "error");
  openNameModal(file);
});

if (cancelName) {
  cancelName.addEventListener("click", () => closeNameModal(true));
}

if (nameModal) {
  nameModal.addEventListener("click", (event) => {
    if (event.target === nameModal) closeNameModal(false);
  });
}

if (closeDeckDetail) {
  closeDeckDetail.addEventListener("click", closeDeckModal);
}

if (deckDetailModal) {
  deckDetailModal.addEventListener("click", (event) => {
    if (event.target === deckDetailModal) closeDeckModal();
  });
}

if (detailReplace && replacementFile) {
  detailReplace.addEventListener("click", (event) => {
    event.stopPropagation();
    replacementFile.click();
  });
  replacementFile.addEventListener("change", () => replaceDeckFile(replacementFile.files[0]));
}

if (detailRename) {
  detailRename.addEventListener("click", (event) => {
    event.stopPropagation();
    openRenameModal(detailDeck);
  });
}

if (replacementReviewed) {
  replacementReviewed.addEventListener("click", async () => {
    if (!detailDeck) return;
    replacementReviewed.disabled = true;
    try {
      const response = await fetch("/api/decks/" + encodeURIComponent(detailDeck.deckId) + "/replacement-review", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar la revisión");
      detailDeck = { ...detailDeck, ...data };
      const index = decks.findIndex((deck) => deck.deckId === detailDeck.deckId);
      if (index >= 0) decks[index] = { ...decks[index], ...data };
      replacementReview.hidden = true;
      renderDecks();
    } catch (error) {
      setUploadStatus(error.message, "error");
    } finally {
      replacementReviewed.disabled = false;
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (nameModal && !nameModal.hidden) return closeNameModal(false);
  if (deckDetailModal && !deckDetailModal.hidden) closeDeckModal();
});

if (nameForm) {
  nameForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (renameDeckTarget) {
      const deck = renameDeckTarget;
      const title = presentationName.value.trim();
      if (!title || title.length > 120) return setUploadStatus("Escribe un nombre de hasta 120 caracteres.", "error");
      try {
        const response = await fetch("/api/decks/" + encodeURIComponent(deck.deckId) + "/title", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo renombrar la presentación");
        const index = decks.findIndex((item) => item.deckId === deck.deckId);
        if (index >= 0) decks[index] = { ...decks[index], ...data };
        detailDeck = index >= 0 ? decks[index] : { ...deck, ...data };
        closeNameModal(false);
        renderDecks();
        openDeckModal(detailDeck);
        setUploadStatus("Presentación renombrada.", "success");
      } catch (error) {
        setUploadStatus(error.message, "error");
      }
      return;
    }
    const file = pendingFile || fileInput.files[0];
    if (!file) {
      closeNameModal(true);
      return setUploadStatus("Arrastra o selecciona un archivo para crear la presentación.", "error");
    }

    const issue = uploadIssue(file);
    if (issue) {
      closeNameModal(true);
      return setUploadStatus(issue, "error");
    }

    const lowerName = file.name.toLowerCase();
    const isPdf = lowerName.endsWith(".pdf");
    const isPptx = lowerName.endsWith(".pptx");
    if (!isPdf && !isPptx) return setUploadStatus("Error: solo se aceptan archivos PPTX o PDF.", "error");

    const title = presentationName.value.trim() || titleFromFile(file) || "Nueva presentación";
    const newSessionId = sessionId();
    const sourceLabel = isPdf ? "PDF" : "PPTX";
    const formData = new FormData();
    formData.append("pptx", file);
    formData.append("title", title);
    formData.append("sessionId", newSessionId);
    formData.append("deckId", newSessionId); // Compatibilidad temporal con el backend actual.

    if (uploadButton) uploadButton.disabled = true;
    closeNameModal(false);
    startConversionProgress();
    setConversionOverlay(true, {
      state: "loading",
      title: "Convirtiendo tu presentación",
      message: "Subiendo archivo y preparando slides para Immersa.",
      percent: 0
    });
    setUploadStatus("", "");

    try {
      const res = await fetch("/api/upload-pptx", { method: "POST", body: formData });
      const data = await res.json();
      if (data.plan) {
        planUsage = data.plan;
        renderPlanUsage();
      }
      if (!res.ok) throw new Error(data.error || "No se pudo subir el archivo");

      uploadForm.reset();
      pendingFile = null;
      updateSelectedFileName(false);
      await Promise.all([loadDecks(data.deckId || newSessionId), loadPlanUsage()]);

      if (data.conversionStatus === "completed") {
        finishConversionOverlay("success", "Presentación lista", sourceLabel + " convertido correctamente.");
      } else if (data.conversionStatus === "failed") {
        finishConversionOverlay("error", "La conversión falló", data.conversionMessage || "Verás una pantalla provisional.", 2400);
      } else {
        finishConversionOverlay("success", "Archivo recibido", sourceLabel + " cargado. La conversión continúa en segundo plano.", 2200);
      }
    } catch (error) {
      finishConversionOverlay("error", "No se pudo convertir", error.message || "Intenta subir el archivo nuevamente.", 2600);
    } finally {
      if (uploadButton) uploadButton.disabled = false;
    }
  });
}

Promise.all([loadDecks(), loadPlanUsage()]);
