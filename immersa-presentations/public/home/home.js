const PUBLIC_ORIGIN = "https://immersa.mx";
const roles = ["speaker", "audience", "screen", "stage"];
const labels = { speaker: "Speaker", audience: "Público", screen: "Screen", stage: "Stage" };
let decks = [];
let activeDeck = null;

const deckList = document.getElementById("deckList");
const deckCount = document.getElementById("deckCount");
const deckNotice = document.getElementById("deckNotice");
const uploadForm = document.getElementById("uploadForm");
const uploadButton = document.getElementById("uploadButton"); // Puede no existir: el flujo abre el modal al seleccionar archivo.
const uploadStatus = document.getElementById("uploadStatus");
const fileDrop = document.getElementById("fileDrop");
const fileInput = document.getElementById("pptxFile");
const selectedFileName = document.getElementById("selectedFileName");
const nameModal = document.getElementById("nameModal");
const nameForm = document.getElementById("nameForm");
const presentationName = document.getElementById("presentationName");
const cancelName = document.getElementById("cancelName");
const conversionOverlay = document.getElementById("conversionOverlay");
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

function deckConversionDate(deck) {
  const raw = deck?.convertedAt || deck?.conversionCompletedAt || deck?.conversionFinishedAt || deck?.completedAt || deck?.converted_at || deck?.updatedAt || deck?.updated_at || deck?.createdAt || deck?.created_at || "";
  if (!raw) return "Fecha de conversión no disponible";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "Fecha de conversión no disponible";
  return "Convertida: " + new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date).replace(",", " ·");
}

function deckConversionMeta(deck) {
  if (isPendingDeck(deck)) return "Convirtiendo presentación";
  if (isFailedDeck(deck)) return "Conversión fallida";
  return deckConversionDate(deck);
}

function setConversionOverlay(visible) {
  if (!conversionOverlay) return;
  conversionOverlay.hidden = !visible;
  conversionOverlay.setAttribute("aria-hidden", visible ? "false" : "true");
  document.body.classList.toggle("conversion-open", visible);
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
    await navigator.clipboard.writeText(value);
    return true;
  }
  window.prompt("Copia este link:", value);
  return false;
}

async function copyRoleLink(role, deck, button) {
  const label = labels[role] || role;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = role === "speaker" ? "Abriendo" : "Generando";

  try {
    const url = await createAccessLink(role, deck);
    if (role === "speaker") {
      window.open(url, "_blank", "noopener,noreferrer");
      button.textContent = "Speaker abierto";
    } else {
      const copied = await copyText(url);
      button.textContent = copied ? "Link copiado" : "Link listo";
      button.classList.add("copied");
    }
  } catch (error) {
    button.textContent = role === "speaker" ? "No se pudo abrir" : "No se pudo copiar";
    setUploadStatus("Error: " + (error.message || "No se pudo generar el link " + label + "."), "error");
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
    activeDeck = decks[0]?.deckId || null;
    renderAll();
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
    row.className = "deck-option deck-row" + (deck.deckId === activeDeck ? " active" : "") + (isPendingDeck(deck) ? " pending" : "") + (isFailedDeck(deck) ? " failed" : "") + (isConvertedDeck(deck) ? " converted" : "");

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
    slides.textContent = deckSlideLabel(deck) + " slides";

    metaLine.append(convertedAt, slides);

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
      button.textContent = role === "speaker" ? "Abrir Speaker" : "Copiar " + (labels[role] || role);
      button.title = role === "speaker" ? "Abrir Speaker" : "Copiar link de " + (labels[role] || role);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        activeDeck = deck.deckId;
        copyRoleLink(role, deck, event.currentTarget);
      });
      roleAction.appendChild(button);

      actions.appendChild(roleAction);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "deck-delete";
    deleteButton.setAttribute("aria-label", "Eliminar presentación");
    deleteButton.title = "Eliminar presentación";
    deleteButton.textContent = "🗑";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteDeck(deck);
    });

    row.append(thumb, info, actions, deleteButton);
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

async function loadDecks(selectedDeckId = activeDeck) {
  try {
    const res = await fetch("/api/decks");
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
    setConversionOverlay(true);
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
      setConversionOverlay(false);
      if (uploadButton) uploadButton.disabled = false;
    }
  });
}

loadDecks();
