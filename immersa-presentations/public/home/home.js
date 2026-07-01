const roles = ["presenter", "screen", "audience", "stage"];
const labels = { presenter: "Presentar", screen: "Pantalla", audience: "Audiencia", stage: "Stage" };
const rotatingTerms = ["presentaciones", "lanzamientos", "visiones", "ideas", "historias"];
let rotatingIndex = 0;
let decks = [];
let activeDeck = "demo";

const deckList = document.getElementById("deckList");
const deckCount = document.getElementById("deckCount");
const deckNotice = document.getElementById("deckNotice");
const sessionInput = document.getElementById("sessionInput");
const normalizedHint = document.getElementById("normalizedHint");
const linksList = document.getElementById("linksList");
const qrCode = document.getElementById("qrCode");
const copyAudience = document.getElementById("copyAudience");
const uploadForm = document.getElementById("uploadForm");
const uploadButton = document.getElementById("uploadButton");
const uploadStatus = document.getElementById("uploadStatus");
const fileDrop = document.getElementById("fileDrop");
const fileInput = document.getElementById("pptxFile");
const selectedFileName = document.getElementById("selectedFileName");
const activityDeckName = document.getElementById("activityDeckName");
const rotatingWord = document.getElementById("rotatingWord");

function normalizeSession(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function generateSessionCode() {
  const prefixes = ["demo", "evento", "immersa", "show"];
  return prefixes[Math.floor(Math.random() * prefixes.length)] + "-" + Math.floor(1000 + Math.random() * 9000);
}

function currentSession() {
  const normalized = normalizeSession(sessionInput.value);
  return normalized || "demo01";
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
  return deck && (deck.status === "converted" || deck.conversionStatus === "completed");
}

function deckStatusLabel(deck) {
  if (deck?.isLive || deck?.status === "live") return "En vivo";
  if (isConvertedDeck(deck) || deck?.status === "ready" || deck?.conversionStatus === "ready") return "Lista";
  if (isFailedDeck(deck)) return "Falló";
  if (isPendingDeck(deck)) return deck.conversionStatus === "pending" ? "Convirtiendo" : "Pendiente";
  return "Borrador";
}

function deckBadgeClass(deck) {
  const label = deckStatusLabel(deck).toLowerCase();
  if (label.includes("vivo")) return " live";
  if (label.includes("borrador") || label.includes("pendiente")) return " draft";
  return "";
}

function deckSlideLabel(deck) {
  if (isPendingDeck(deck) || isFailedDeck(deck)) return "pendiente";
  return deck.slideCount ?? deck.slidesCount ?? (Array.isArray(deck.slides) ? deck.slides.length : deck.slides) ?? 0;
}

function roleUrl(role, deckId = activeDeck) {
  return window.location.origin + "/" + role + "?session=" + encodeURIComponent(currentSession()) + "&deck=" + encodeURIComponent(deckId);
}

function absoluteOrRoot(path) {
  if (!path || typeof path !== "string") return "";
  if (/^(https?:)?\/\//.test(path) || path.startsWith("data:")) return path;
  return path.startsWith("/") ? path : "/" + path;
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

  return unique([...direct.map(absoluteOrRoot), ...derived]);
}

function niceTitle(title = "Presentación") {
  return String(title).replace(/[-_]+/g, " ").trim() || "Presentación";
}

function attachImageWithFallback(img, thumb, candidates, index = 0) {
  if (!candidates[index]) return;
  img.src = candidates[index];
  img.addEventListener("load", () => thumb.classList.add("has-image"), { once: true });
  img.addEventListener("error", () => {
    const nextIndex = index + 1;
    if (candidates[nextIndex]) attachImageWithFallback(img, thumb, candidates, nextIndex);
    else img.remove();
  }, { once: true });
}

function renderThumb(deck) {
  const thumb = document.createElement("div");
  thumb.className = "deck-thumb";

  const candidates = firstSlideThumbnailCandidates(deck);
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

  const subtitle = document.createElement("span");
  subtitle.className = "thumb-subtitle";
  subtitle.textContent = "Thumbnail real";

  thumb.append(fallback, subtitle);
  return thumb;
}

function renderDecks() {
  const countLabel = decks.length + " presentación" + (decks.length === 1 ? "" : "es");
  deckCount.textContent = countLabel;
  deckList.innerHTML = "";

  decks.slice(0, 3).forEach((deck) => {
    const card = document.createElement("article");
    card.className = "deck-option" + (deck.deckId === activeDeck ? " active" : "") + (isPendingDeck(deck) ? " pending" : "") + (isFailedDeck(deck) ? " failed" : "") + (isConvertedDeck(deck) ? " converted" : "");

    const thumb = renderThumb(deck);

    const main = document.createElement("div");
    main.className = "deck-main";

    const head = document.createElement("div");
    head.className = "deck-head";

    const title = document.createElement("strong");
    title.textContent = niceTitle(deck.title || deck.deckId || "Presentación");

    const badge = document.createElement("em");
    badge.className = "deck-badge" + deckBadgeClass(deck);
    badge.textContent = deckStatusLabel(deck);

    const menu = document.createElement("span");
    menu.className = "deck-menu";
    menu.textContent = "⋮";
    menu.setAttribute("aria-hidden", "true");

    head.append(title, badge, menu);

    const body = document.createElement("div");
    body.className = "deck-body";

    const updated = document.createElement("span");
    updated.textContent = deck.updatedLabel || "Actualizada recientemente";

    const meta = document.createElement("span");
    meta.textContent = "Slides: " + deckSlideLabel(deck) + " · Ratio: " + (deck.ratio || "16:9");

    const codeLabel = document.createElement("span");
    codeLabel.textContent = "Código de sesión";

    const sessionCode = document.createElement("span");
    sessionCode.className = "deck-code";
    sessionCode.textContent = currentSession().toUpperCase();

    body.append(updated, meta, codeLabel, sessionCode);

    if (isFailedDeck(deck) && deck.conversionMessage) {
      const error = document.createElement("span");
      error.className = "deck-error";
      error.textContent = deck.conversionMessage;
      body.appendChild(error);
    }

    main.append(head, body);

    const actions = document.createElement("div");
    actions.className = "deck-actions";

    roles.forEach((role) => {
      const link = document.createElement("a");
      link.href = roleUrl(role, deck.deckId);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = labels[role];
      link.addEventListener("click", () => { activeDeck = deck.deckId; });
      actions.appendChild(link);
    });

    card.append(thumb, main, actions);
    card.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      activeDeck = deck.deckId;
      renderAll();
    });
    deckList.appendChild(card);
  });

  const deck = activeDeckMeta();
  if (activityDeckName && deck) activityDeckName.textContent = niceTitle(deck.title || deck.deckId || "Immersa Demo");
  deckNotice.hidden = !(isPendingDeck(deck) || isFailedDeck(deck));
  if (isFailedDeck(deck)) deckNotice.textContent = deck.conversionMessage || "La conversión falló. Verás una pantalla provisional.";
  else deckNotice.textContent = "Esta presentación aún no ha sido convertida. Verás una pantalla provisional.";
}

function drawFallbackQr(text) {
  qrCode.classList.add("fallback");
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed * 33 + text.charCodeAt(i)) >>> 0;

  for (let row = 0; row < 29; row++) {
    for (let col = 0; col < 29; col++) {
      const cell = document.createElement("span");
      const finder = (row < 7 && col < 7) || (row < 7 && col > 21) || (row > 21 && col < 7);
      const finderInner = finder && (
        (row % 22 > 1 && row % 22 < 5 && col % 22 > 1 && col % 22 < 5) ||
        row % 22 === 0 || row % 22 === 6 || col % 22 === 0 || col % 22 === 6
      );
      const bit = ((seed >> ((row + col) % 24)) ^ row * 7 ^ col * 13 ^ (row * col)) & 1;
      if (finderInner || (!finder && bit)) cell.className = "dark";
      qrCode.appendChild(cell);
    }
  }
}

function drawQr(text) {
  qrCode.innerHTML = "";
  qrCode.classList.remove("fallback");

  if (window.QRCode) {
    new window.QRCode(qrCode, {
      text,
      width: 52,
      height: 52,
      colorDark: "#050505",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.M
    });
    return;
  }

  drawFallbackQr(text);
}

async function copyText(text, button) {
  await navigator.clipboard.writeText(text);
  const original = button.textContent;
  button.textContent = "Copiado";
  button.classList.add("copied");
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove("copied");
  }, 1200);
}

function renderLinks() {
  const session = currentSession();
  normalizedHint.textContent = session;
  linksList.innerHTML = "";

  roles.forEach((role) => {
    const url = roleUrl(role);
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = labels[role];
    linksList.appendChild(link);
  });

  drawQr(roleUrl("audience"));
}

function renderAll() {
  sessionInput.value = normalizeSession(sessionInput.value);
  renderDecks();
  renderLinks();
}

function fallbackDecks() {
  return [
    { deckId: "bodilla", title: "Bodilla", slides: 15, ratio: "16:9", status: "ready", conversionStatus: "ready", updatedLabel: "Actualizada hace 2 horas" },
    { deckId: "gig", title: "GIG", slides: 14, ratio: "16:9", status: "ready", conversionStatus: "ready", updatedLabel: "Actualizada hace 1 día" },
    { deckId: "demo", title: "Immersa Demo", slides: 3, ratio: "16:9", status: "ready", conversionStatus: "ready", updatedLabel: "Actualizada hace 2 días" }
  ];
}

async function loadDecks(selectedDeckId = activeDeck) {
  try {
    const res = await fetch("/api/decks");
    if (!res.ok) throw new Error("No se pudo cargar la lista de presentaciones");
    const data = await res.json();
    decks = Array.isArray(data) && data.length ? data : fallbackDecks();
    activeDeck = decks.some((deck) => deck.deckId === selectedDeckId) ? selectedDeckId : decks[0].deckId;
  } catch (_error) {
    decks = fallbackDecks();
    activeDeck = decks.some((deck) => deck.deckId === selectedDeckId) ? selectedDeckId : "demo";
  }
  renderAll();
}

function setUploadStatus(message, type = "") {
  uploadStatus.textContent = message;
  uploadStatus.className = "upload-status" + (type ? " " + type : "");
}

function updateSelectedFileName() {
  const file = fileInput.files[0];
  selectedFileName.textContent = file ? file.name : "Ningún archivo seleccionado";
}

function initRotator() {
  if (!rotatingWord) return;

  const measure = document.createElement("span");
  measure.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:nowrap;font:inherit;letter-spacing:inherit;";
  rotatingWord.parentElement.appendChild(measure);

  function updateWidth() {
    measure.textContent = rotatingTerms.reduce((longest, term) => term.length > longest.length ? term : longest, "");
    const width = Math.ceil(measure.getBoundingClientRect().width);
    rotatingWord.parentElement.style.setProperty("--rotator-width", width + "px");
  }

  updateWidth();
  window.addEventListener("resize", updateWidth);

  setInterval(() => {
    rotatingWord.classList.add("is-changing");
    window.setTimeout(() => {
      rotatingIndex = (rotatingIndex + 1) % rotatingTerms.length;
      rotatingWord.textContent = rotatingTerms[rotatingIndex];
      rotatingWord.classList.remove("is-changing");
    }, 220);
  }, 2200);
}

document.getElementById("generateSession").addEventListener("click", () => {
  sessionInput.value = generateSessionCode();
  renderAll();
});
sessionInput.addEventListener("input", renderLinks);
sessionInput.addEventListener("blur", renderAll);
copyAudience.addEventListener("click", (event) => copyText(roleUrl("audience"), event.currentTarget));
fileInput.addEventListener("change", updateSelectedFileName);

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
  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  updateSelectedFileName();
});

fileDrop.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!file) return setUploadStatus("Arrastra o selecciona un archivo para crear la presentación.", "error");

  const lowerName = file.name.toLowerCase();
  const isPdf = lowerName.endsWith(".pdf");
  const isPptx = lowerName.endsWith(".pptx");
  if (!isPdf && !isPptx) return setUploadStatus("Error: solo se aceptan archivos PPTX o PDF.", "error");

  const sourceLabel = isPdf ? "PDF" : "PPTX";
  const formData = new FormData(uploadForm);
  uploadButton.disabled = true;
  setUploadStatus("Subiendo y convirtiendo presentación...", "loading");

  try {
    const res = await fetch("/api/upload-pptx", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "No se pudo subir el archivo");

    uploadForm.reset();
    updateSelectedFileName();
    if (data.conversionStatus === "completed") setUploadStatus(sourceLabel + " convertido correctamente.", "success");
    else if (data.conversionStatus === "failed") setUploadStatus(sourceLabel + " cargado, pero la conversión falló: " + (data.conversionMessage || "verás una pantalla provisional"), "error");
    else setUploadStatus(sourceLabel + " cargado. Convirtiendo presentación...", "loading");
    await loadDecks(data.deckId);
  } catch (error) {
    setUploadStatus("Error: " + error.message, "error");
  } finally {
    uploadButton.disabled = false;
  }
});

sessionInput.value = "demo01";
initRotator();
loadDecks("demo");
