const PUBLIC_ORIGIN = "https://immersa.mx";
const roles = ["presenter", "audience", "screen", "stage"];
const labels = { presenter: "Speaker", audience: "Público", screen: "Screen", stage: "Stage" };
const rotatingTerms = ["presentaciones", "lanzamientos", "visiones", "ideas", "historias"];
let rotatingIndex = 0;
let decks = [];
let activeDeck = "demo";

const deckList = document.getElementById("deckList");
const deckCount = document.getElementById("deckCount");
const deckNotice = document.getElementById("deckNotice");
const uploadForm = document.getElementById("uploadForm");
const uploadButton = document.getElementById("uploadButton"); // Puede no existir: el flujo abre el modal al seleccionar archivo.
const uploadStatus = document.getElementById("uploadStatus");
const fileDrop = document.getElementById("fileDrop");
const fileInput = document.getElementById("pptxFile");
const selectedFileName = document.getElementById("selectedFileName");
const rotatingWord = document.getElementById("rotatingWord");
const nameModal = document.getElementById("nameModal");
const nameForm = document.getElementById("nameForm");
const presentationName = document.getElementById("presentationName");
const cancelName = document.getElementById("cancelName");
let pendingFile = null;

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

function openNameModal(file) {
  if (!nameModal || !presentationName) return;
  pendingFile = file || fileInput.files[0] || null;
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
  document.body.classList.remove("modal-open");
  if (clearFile) {
    pendingFile = null;
    uploadForm.reset();
    updateSelectedFileName(false);
  }
}

function deckSession(deck) {
  const value = deck?.sessionCode || deck?.session || deck?.linkName || deck?.publicCode || deck?.deckId || "demo01";
  return normalizeSlug(value) || "demo01";
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
  if (label.includes("fall")) return " failed";
  return "";
}

function deckSlideLabel(deck) {
  if (isPendingDeck(deck) || isFailedDeck(deck)) return "pendiente";
  return deck.slideCount ?? deck.slidesCount ?? (Array.isArray(deck.slides) ? deck.slides.length : deck.slides) ?? 0;
}

function roleUrl(role, deck) {
  // Público no debe ver ni intuir roles: recibe un link limpio con solo el ID de sesión.
  const session = encodeURIComponent(deckSession(deck));
  if (role === "audience") return PUBLIC_ORIGIN + "/" + session;

  // Los roles operativos viven en show.immersa.mx y siguen usando session + rol.
  const route = role === "presenter" ? "speaker" : role;
  return window.location.origin + "/" + route + "?session=" + session;
}

async function copyRoleLink(role, deck, button) {
  const label = labels[role] || role;
  const url = roleUrl(role, deck);
  const feedback = role === "audience" ? "Link público copiado" : "Link " + label + " copiado";
  try {
    await navigator.clipboard.writeText(url);
    const original = button.textContent;
    button.textContent = feedback;
    button.classList.add("copied");
    window.setTimeout(() => {
      button.textContent = original;
      button.classList.remove("copied");
    }, 1400);
  } catch (_error) {
    window.prompt("Copia el link " + label + ":", url);
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
    activeDeck = decks[0]?.deckId || "demo";
    if (!decks.length) await loadDecks("demo");
    else renderAll();
    setUploadStatus("Presentación eliminada.", "success");
  } catch (error) {
    setUploadStatus("Error: " + error.message, "error");
  }
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

  thumb.append(fallback);
  return thumb;
}

function renderDecks() {
  const countLabel = decks.length + " presentación" + (decks.length === 1 ? "" : "es");
  deckCount.textContent = countLabel;
  deckList.innerHTML = "";

  decks.forEach((deck) => {
    const row = document.createElement("article");
    row.className = "deck-option deck-row" + (deck.deckId === activeDeck ? " active" : "") + (isPendingDeck(deck) ? " pending" : "") + (isFailedDeck(deck) ? " failed" : "") + (isConvertedDeck(deck) ? " converted" : "");

    const thumb = renderThumb(deck);

    const info = document.createElement("div");
    info.className = "deck-info";

    const titleLine = document.createElement("div");
    titleLine.className = "deck-title-line";

    const title = document.createElement("strong");
    title.textContent = niceTitle(deck.title || deck.deckId || "Presentación");

    const badge = document.createElement("em");
    badge.className = "deck-badge" + deckBadgeClass(deck);
    badge.textContent = deckStatusLabel(deck);

    titleLine.append(title, badge);

    const metaLine = document.createElement("div");
    metaLine.className = "deck-meta-line";

    const updated = document.createElement("span");
    updated.textContent = deck.updatedLabel || deck.updatedAtLabel || "Actualizada recientemente";

    const slides = document.createElement("span");
    slides.textContent = "Slides: " + deckSlideLabel(deck);

    const ratio = document.createElement("span");
    ratio.textContent = "Ratio: " + (deck.ratio || "16:9");

    metaLine.append(updated, slides, ratio);

    info.append(titleLine, metaLine);

    if (isFailedDeck(deck) && deck.conversionMessage) {
      const error = document.createElement("span");
      error.className = "deck-error";
      error.textContent = deck.conversionMessage;
      info.appendChild(error);
    }

    const linkName = document.createElement("div");
    linkName.className = "deck-link-name";
    linkName.innerHTML = `<span>ID sesión</span><strong>${deckSession(deck)}</strong>`;

    const actions = document.createElement("div");
    actions.className = "deck-actions";

    roles.forEach((role) => {
      const roleAction = document.createElement("div");
      roleAction.className = "role-action role-" + role;

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = labels[role];
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        activeDeck = deck.deckId;
        if (role === "presenter") {
          window.open(roleUrl(role, deck), "_blank", "noopener");
          return;
        }
        copyRoleLink(role, deck, event.currentTarget);
      });
      roleAction.appendChild(button);

      actions.appendChild(roleAction);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "deck-delete";
    deleteButton.textContent = "Eliminar";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteDeck(deck);
    });

    row.append(thumb, info, linkName, actions, deleteButton);
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      activeDeck = deck.deckId;
      renderDecks();
    });
    deckList.appendChild(row);
  });

  const deck = activeDeckMeta();
  deckNotice.hidden = !(isPendingDeck(deck) || isFailedDeck(deck));
  if (isFailedDeck(deck)) deckNotice.textContent = deck.conversionMessage || "La conversión falló. Verás una pantalla provisional.";
  else deckNotice.textContent = "Esta presentación aún no ha sido convertida. Verás una pantalla provisional.";
}

function renderAll() {
  renderDecks();
}

function fallbackDecks() {
  return [
    { deckId: "bodilla", linkName: "ventas", title: "Bodilla", slides: 15, ratio: "16:9", status: "ready", conversionStatus: "ready", updatedLabel: "Actualizada hace 2 horas" },
    { deckId: "gig", linkName: "gig2026", title: "GIG", slides: 14, ratio: "16:9", status: "ready", conversionStatus: "ready", updatedLabel: "Actualizada hace 1 día" },
    { deckId: "demo", linkName: "demo01", title: "Immersa Demo", slides: 3, ratio: "16:9", status: "ready", conversionStatus: "ready", updatedLabel: "Actualizada hace 2 días" }
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

function updateSelectedFileName(askName = false) {
  const file = fileInput.files[0];
  selectedFileName.textContent = file ? file.name : "Ningún archivo seleccionado";
  if (askName && file) openNameModal(file);
}

function initRotator() {
  if (!rotatingWord) return;

  const measure = document.createElement("span");
  measure.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:nowrap;font:inherit;letter-spacing:inherit;";
  rotatingWord.parentElement.appendChild(measure);

  function updateWidth() {
    measure.textContent = rotatingTerms.reduce((longest, term) => term.length > longest.length ? term : longest, "");
    const width = Math.ceil(measure.getBoundingClientRect().width) + 56;
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && nameModal && !nameModal.hidden) closeNameModal(false);
});

if (nameForm) {
  nameForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = pendingFile || fileInput.files[0];
    if (!file) {
      closeNameModal(true);
      return setUploadStatus("Arrastra o selecciona un archivo para crear la presentación.", "error");
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
    setUploadStatus("Subiendo y convirtiendo presentación...", "loading");

    try {
      const res = await fetch("/api/upload-pptx", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo subir el archivo");

      uploadForm.reset();
      pendingFile = null;
      updateSelectedFileName(false);
      if (data.conversionStatus === "completed") setUploadStatus(sourceLabel + " convertido correctamente.", "success");
      else if (data.conversionStatus === "failed") setUploadStatus(sourceLabel + " cargado, pero la conversión falló: " + (data.conversionMessage || "verás una pantalla provisional"), "error");
      else setUploadStatus(sourceLabel + " cargado. Convirtiendo presentación...", "loading");
      await loadDecks(data.deckId || newSessionId);
    } catch (error) {
      setUploadStatus("Error: " + error.message, "error");
    } finally {
      if (uploadButton) uploadButton.disabled = false;
    }
  });
}

initRotator();
loadDecks("demo");
