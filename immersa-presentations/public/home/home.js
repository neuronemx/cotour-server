const PUBLIC_ORIGIN = "https://immersa.mx";

const roles = ["speaker", "publico", "screen", "stage"];
const labels = {
  speaker: "Speaker",
  publico: "Público",
  screen: "Screen",
  stage: "Stage"
};

let decks = [];
let activeDeck = "demo";
let pendingFile = null;

const deckList = document.getElementById("deckList");
const deckCount = document.getElementById("deckCount");
const deckNotice = document.getElementById("deckNotice");
const uploadForm = document.getElementById("uploadForm");
const uploadStatus = document.getElementById("uploadStatus");
const fileDrop = document.getElementById("fileDrop");
const fileInput = document.getElementById("pptxFile");
const selectedFileName = document.getElementById("selectedFileName");
const nameModal = document.getElementById("nameModal");
const nameForm = document.getElementById("nameForm");
const presentationName = document.getElementById("presentationName");
const cancelName = document.getElementById("cancelName");
const rotatingWord = document.getElementById("rotatingWord");

function normalizeSession(value) {
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

function generateSessionId() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let id = "";
  if (crypto?.getRandomValues) {
    const values = new Uint8Array(6);
    crypto.getRandomValues(values);
    values.forEach((value) => id += alphabet[value % alphabet.length]);
    return id;
  }
  for (let i = 0; i < 6; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

function titleToDeckId(title) {
  return normalizeSession(title).slice(0, 32) || "deck";
}

function sessionForDeck(deck) {
  return deck.sessionId || deck.session_id || deck.session || deck.code || deck.deckId || "demo01";
}

function publicUrl(deck) {
  return PUBLIC_ORIGIN + "/" + encodeURIComponent(sessionForDeck(deck));
}

function roleUrl(role, deck) {
  const session = encodeURIComponent(sessionForDeck(deck));
  if (role === "publico") return publicUrl(deck);
  const route = role === "speaker" ? "speaker" : role;
  return window.location.origin + "/" + route + "?session=" + session;
}

function isPendingDeck(deck) {
  return deck && (deck.status === "uploaded" || deck.conversionStatus === "pending" || deck.status === "pending");
}

function isFailedDeck(deck) {
  return deck && (deck.status === "conversion_failed" || deck.conversionStatus === "failed" || deck.status === "failed");
}

function isConvertedDeck(deck) {
  return deck && (deck.status === "converted" || deck.conversionStatus === "completed" || deck.status === "ready" || deck.conversionStatus === "ready");
}

function deckStatusLabel(deck) {
  if (isConvertedDeck(deck)) return "Lista";
  if (isFailedDeck(deck)) return "Falló";
  if (isPendingDeck(deck)) return deck.conversionStatus === "pending" ? "Convirtiendo" : "Pendiente";
  return "Borrador";
}

function deckSlideLabel(deck) {
  if (isPendingDeck(deck) || isFailedDeck(deck)) return "pendiente";
  return deck.slideCount ?? deck.slides ?? 0;
}

function thumbnailForDeck(deck) {
  return deck.thumbnail || deck.thumbnailUrl || deck.cover || deck.coverUrl || deck.slide1 || deck.slide1Url || "";
}

function setUploadStatus(message, type = "") {
  uploadStatus.textContent = message;
  uploadStatus.className = "upload-status" + (type ? " " + type : "");
}

async function copyText(text, button, label = "Link copiado") {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_error) {
    const temp = document.createElement("textarea");
    temp.value = text;
    temp.setAttribute("readonly", "");
    temp.style.position = "fixed";
    temp.style.opacity = "0";
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
  }

  const original = button.textContent;
  button.textContent = label;
  button.classList.add("copied");
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove("copied");
  }, 1250);
}

function createThumb(deck) {
  const thumb = document.createElement("div");
  thumb.className = "deck-thumb";
  const src = thumbnailForDeck(deck);

  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "Slide 1 de " + (deck.title || "presentación");
    img.onerror = () => {
      thumb.textContent = "Slide 1 no disponible";
      img.remove();
    };
    thumb.appendChild(img);
  } else {
    thumb.textContent = "Slide 1 no disponible";
  }

  return thumb;
}

function renderDecks() {
  const countLabel = decks.length + " presentación" + (decks.length === 1 ? "" : "es");
  deckCount.textContent = countLabel;
  deckList.innerHTML = "";

  decks.forEach((deck) => {
    const row = document.createElement("article");
    row.className = "deck-option" + (deck.deckId === activeDeck ? " active" : "") + (isPendingDeck(deck) ? " pending" : "") + (isFailedDeck(deck) ? " failed" : "") + (isConvertedDeck(deck) ? " converted" : "");

    const info = document.createElement("div");
    info.className = "deck-info";

    const head = document.createElement("div");
    head.className = "deck-head";

    const title = document.createElement("strong");
    title.className = "deck-title";
    title.textContent = deck.title || "Presentación sin título";

    const badge = document.createElement("em");
    badge.className = "deck-badge";
    badge.textContent = deckStatusLabel(deck);

    head.append(title, badge);

    const body = document.createElement("div");
    body.className = "deck-body";

    const updated = document.createElement("span");
    updated.textContent = deck.updatedLabel || "Actualizada recientemente";

    const sessionCode = document.createElement("span");
    sessionCode.className = "deck-code";
    sessionCode.textContent = "ID sesión: " + sessionForDeck(deck);

    const meta = document.createElement("span");
    meta.textContent = "Slides: " + deckSlideLabel(deck) + " · Ratio: " + (deck.ratio || "16:9");

    body.append(updated, sessionCode, meta);

    if (isFailedDeck(deck) && deck.conversionMessage) {
      const error = document.createElement("span");
      error.className = "deck-error";
      error.textContent = deck.conversionMessage;
      body.appendChild(error);
    }

    info.append(head, body);

    const actions = document.createElement("div");
    actions.className = "deck-actions";

    roles.forEach((role) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "role-button role-" + role;
      button.textContent = labels[role];
      button.setAttribute("aria-label", role === "speaker" ? "Abrir Speaker" : "Copiar link " + labels[role]);
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        activeDeck = deck.deckId;
        const url = roleUrl(role, deck);
        if (role === "speaker") {
          window.open(url, "_blank", "noopener");
          return;
        }
        const feedback = role === "publico" ? "Link público copiado" : "Link " + labels[role] + " copiado";
        await copyText(url, event.currentTarget, feedback);
      });
      actions.appendChild(button);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-deck";
    deleteButton.innerHTML = "×";
    deleteButton.setAttribute("aria-label", "Eliminar presentación");
    deleteButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await deleteDeck(deck);
    });

    row.append(createThumb(deck), info, actions, deleteButton);
    row.addEventListener("click", () => {
      activeDeck = deck.deckId;
      renderDecks();
    });
    deckList.appendChild(row);
  });

  const deck = decks.find((item) => item.deckId === activeDeck);
  deckNotice.hidden = !(isPendingDeck(deck) || isFailedDeck(deck));
  if (deckNotice.hidden) return;
  deckNotice.textContent = isFailedDeck(deck)
    ? (deck.conversionMessage || "La conversión falló. Verás una pantalla provisional.")
    : "Esta presentación aún no ha sido convertida. Verás una pantalla provisional.";
}

async function loadDecks(selectedDeckId = activeDeck) {
  try {
    const res = await fetch("/api/decks");
    if (!res.ok) throw new Error("No se pudo cargar la lista de presentaciones");
    const data = await res.json();
    decks = Array.isArray(data) && data.length ? data : defaultDecks();
  } catch (_error) {
    decks = defaultDecks();
  }

  decks = decks.map((deck) => ({
    sessionId: deck.sessionId || deck.session_id || deck.session || deck.code || deck.deckId,
    ...deck,
    deckId: deck.deckId || deck.id || deck.slug || deck.sessionId || deck.session_id || generateSessionId()
  }));

  activeDeck = decks.some((deck) => deck.deckId === selectedDeckId) ? selectedDeckId : decks[0]?.deckId;
  renderDecks();
}

function defaultDecks() {
  return [
    {
      deckId: "demo",
      sessionId: "demo01",
      title: "Demo Immersa",
      slides: 3,
      ratio: "16:9",
      status: "ready",
      conversionStatus: "ready",
      updatedLabel: "Lista para presentar"
    }
  ];
}

async function deleteDeck(deck) {
  const title = deck.title || "esta presentación";
  const confirmed = window.confirm("¿Eliminar \"" + title + "\"?\n\nEsta acción no se puede deshacer.");
  if (!confirmed) return;

  try {
    await fetch("/api/decks/" + encodeURIComponent(deck.deckId), { method: "DELETE" });
  } catch (_error) {
    // En modo demo/local se elimina visualmente aunque el endpoint no exista.
  }

  decks = decks.filter((item) => item.deckId !== deck.deckId);
  if (!decks.length) decks = defaultDecks();
  activeDeck = decks[0].deckId;
  renderDecks();
}

function updateSelectedFileName() {
  const file = fileInput.files && fileInput.files[0];
  selectedFileName.textContent = file ? file.name : "Ningún archivo seleccionado";
}

function validPresentationFile(file) {
  if (!file) return false;
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith(".pdf") || lowerName.endsWith(".pptx");
}

function sourceLabel(file) {
  return file?.name?.toLowerCase().endsWith(".pdf") ? "PDF" : "PPTX";
}

function assignDroppedFiles(files) {
  if (!files || !files.length) return;
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(files[0]);
  fileInput.files = dataTransfer.files;
  handleFileSelected();
}

function handleFileSelected() {
  const file = fileInput.files && fileInput.files[0];
  updateSelectedFileName();
  if (!file) return;
  if (!validPresentationFile(file)) {
    setUploadStatus("Error: solo se aceptan archivos PPTX o PDF.", "error");
    fileInput.value = "";
    updateSelectedFileName();
    return;
  }
  pendingFile = file;
  const cleanName = file.name.replace(/\.(pptx|pdf)$/i, "").replace(/[-_]+/g, " ").trim();
  presentationName.value = cleanName || "Nueva presentación";
  openNameModal();
}

function openNameModal() {
  nameModal.hidden = false;
  nameModal.setAttribute("aria-hidden", "false");
  setTimeout(() => presentationName.focus(), 0);
}

function closeNameModal(resetFile = false) {
  nameModal.hidden = true;
  nameModal.setAttribute("aria-hidden", "true");
  if (resetFile) {
    pendingFile = null;
    fileInput.value = "";
    updateSelectedFileName();
  }
}

async function createPresentation(title, file) {
  const sessionId = generateSessionId();
  const deckId = titleToDeckId(title) + "-" + sessionId;
  const label = sourceLabel(file);
  const formData = new FormData();
  formData.append("pptx", file);
  formData.append("title", title);
  formData.append("sessionId", sessionId);
  formData.append("deckId", deckId);

  setUploadStatus("Subiendo y preparando presentación...", "loading");

  try {
    const res = await fetch("/api/upload-pptx", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No se pudo subir el archivo");

    const newDeck = {
      deckId: data.deckId || deckId,
      sessionId: data.sessionId || sessionId,
      title: data.title || title,
      slides: data.slides || data.slideCount || 0,
      ratio: data.ratio || "16:9",
      status: data.status || "uploaded",
      conversionStatus: data.conversionStatus || "pending",
      conversionMessage: data.conversionMessage || "",
      thumbnail: data.thumbnail || data.thumbnailUrl || "",
      updatedLabel: "Creada ahora"
    };

    decks = [newDeck, ...decks.filter((deck) => deck.deckId !== newDeck.deckId)];
    activeDeck = newDeck.deckId;
    renderDecks();

    if (newDeck.conversionStatus === "completed" || newDeck.conversionStatus === "ready") {
      setUploadStatus(label + " convertido correctamente.", "success");
    } else if (newDeck.conversionStatus === "failed") {
      setUploadStatus(label + " cargado, pero la conversión falló: " + (newDeck.conversionMessage || "verás una pantalla provisional"), "error");
    } else {
      setUploadStatus(label + " cargado. Convirtiendo...", "loading");
    }
  } catch (error) {
    const localDeck = {
      deckId,
      sessionId,
      title,
      slides: 0,
      ratio: "16:9",
      status: "uploaded",
      conversionStatus: "pending",
      updatedLabel: "Creada ahora"
    };
    decks = [localDeck, ...decks];
    activeDeck = deckId;
    renderDecks();
    setUploadStatus("Presentación creada localmente. Falta conectar backend: " + error.message, "loading");
  } finally {
    uploadForm.reset();
    pendingFile = null;
    updateSelectedFileName();
  }
}

fileInput.addEventListener("change", handleFileSelected);

fileDrop.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

["dragenter", "dragover"].forEach((eventName) => {
  fileDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    fileDrop.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  fileDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    fileDrop.classList.remove("is-dragging");
  });
});

fileDrop.addEventListener("drop", (event) => assignDroppedFiles(event.dataTransfer.files));

uploadForm.addEventListener("submit", (event) => event.preventDefault());

cancelName.addEventListener("click", () => closeNameModal(true));
nameModal.addEventListener("click", (event) => {
  if (event.target === nameModal) closeNameModal(true);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !nameModal.hidden) closeNameModal(true);
});

nameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingFile) return closeNameModal(true);
  const title = presentationName.value.trim() || "Nueva presentación";
  const confirmButton = document.getElementById("confirmName");
  confirmButton.disabled = true;
  try {
    closeNameModal(false);
    await createPresentation(title, pendingFile);
  } finally {
    confirmButton.disabled = false;
  }
});

(function rotateHeroWords() {
  if (!rotatingWord) return;
  const words = ["presentaciones", "lanzamientos", "visiones", "ideas", "historias"];
  let index = 0;
  setInterval(() => {
    index = (index + 1) % words.length;
    rotatingWord.animate(
      [
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(-8px)" }
      ],
      { duration: 170, easing: "ease-out" }
    ).onfinish = () => {
      rotatingWord.textContent = words[index];
      rotatingWord.animate(
        [
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "translateY(0)" }
        ],
        { duration: 220, easing: "ease-out" }
      );
    };
  }, 2300);
})();

loadDecks("demo");
