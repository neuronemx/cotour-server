const roles = ["presenter", "screen", "stage", "audience"];
const labels = { presenter: "Presenter", screen: "Screen", stage: "Stage", audience: "Audience" };
let decks = [];
let activeDeck = "demo";

const deckList = document.getElementById("deckList");
const deckCount = document.getElementById("deckCount");
const deckNotice = document.getElementById("deckNotice");
const sessionInput = document.getElementById("sessionInput");
const normalizedHint = document.getElementById("normalizedHint");
const activeSession = document.getElementById("activeSession");
const linksList = document.getElementById("linksList");
const qrCode = document.getElementById("qrCode");
const copyAudience = document.getElementById("copyAudience");
const uploadForm = document.getElementById("uploadForm");
const uploadButton = document.getElementById("uploadButton");
const uploadStatus = document.getElementById("uploadStatus");

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
  if (isConvertedDeck(deck)) return "Convertido";
  if (isFailedDeck(deck)) return "Conversión fallida";
  if (isPendingDeck(deck)) return deck.conversionStatus === "pending" ? "Convirtiendo..." : "Conversión pendiente";
  return "";
}

function roleUrl(role) {
  return window.location.origin + "/" + role + "?session=" + encodeURIComponent(currentSession()) + "&deck=" + encodeURIComponent(activeDeck);
}

function renderDecks() {
  deckCount.textContent = decks.length + " deck" + (decks.length === 1 ? "" : "s");
  deckList.innerHTML = "";

  decks.forEach((deck) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "deck-option" + (deck.deckId === activeDeck ? " active" : "") + (isPendingDeck(deck) ? " pending" : "") + (isFailedDeck(deck) ? " failed" : "") + (isConvertedDeck(deck) ? " converted" : "");

    const title = document.createElement("strong");
    title.textContent = deck.title;

    const meta = document.createElement("span");
    const slideLabel = isPendingDeck(deck) || isFailedDeck(deck) ? "pendiente" : (deck.slideCount ?? deck.slides ?? 0);
    meta.textContent = "ID: " + deck.deckId + " · Slides: " + slideLabel + " · Ratio: " + deck.ratio;

    button.append(title, meta);
    const statusLabel = deckStatusLabel(deck);
    if (statusLabel) {
      const badge = document.createElement("em");
      badge.textContent = statusLabel;
      button.appendChild(badge);
    }
    if (isFailedDeck(deck) && deck.conversionMessage) {
      const error = document.createElement("small");
      error.textContent = deck.conversionMessage;
      button.appendChild(error);
    }
    button.addEventListener("click", () => {
      activeDeck = deck.deckId;
      renderAll();
    });
    deckList.appendChild(button);
  });

  const deck = activeDeckMeta();
  deckNotice.hidden = !(isPendingDeck(deck) || isFailedDeck(deck));
  if (isFailedDeck(deck)) deckNotice.textContent = deck.conversionMessage || "La conversión falló. Verás una pantalla provisional.";
  else deckNotice.textContent = "Este deck aún no ha sido convertido. Verás una pantalla provisional.";
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
        row % 22 === 0 ||
        row % 22 === 6 ||
        col % 22 === 0 ||
        col % 22 === 6
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
      width: 220,
      height: 220,
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
  activeSession.textContent = session;
  normalizedHint.textContent = session;
  linksList.innerHTML = "";

  roles.forEach((role) => {
    const url = roleUrl(role);
    const row = document.createElement("article");
    const title = document.createElement("strong");
    const input = document.createElement("input");
    const open = document.createElement("a");
    const copy = document.createElement("button");

    row.className = "role-link";
    title.textContent = labels[role];
    input.readOnly = true;
    input.value = url;
    open.href = url;
    open.target = "_blank";
    open.rel = "noopener";
    open.textContent = "Abrir " + labels[role];
    copy.type = "button";
    copy.textContent = "Copiar";
    copy.addEventListener("click", (event) => copyText(url, event.currentTarget));

    row.append(title, input, open, copy);
    linksList.appendChild(row);
  });

  drawQr(roleUrl("audience"));
}

function renderAll() {
  sessionInput.value = normalizeSession(sessionInput.value);
  renderDecks();
  renderLinks();
}

async function loadDecks(selectedDeckId = activeDeck) {
  try {
    const res = await fetch("/api/decks");
    if (!res.ok) throw new Error("No se pudo cargar la lista de decks");
    const data = await res.json();
    decks = data.length ? data : [{ deckId: "demo", title: "Immersa Demo", slides: 3, ratio: "16:9", status: "ready", conversionStatus: "ready" }];
    activeDeck = decks.some((deck) => deck.deckId === selectedDeckId) ? selectedDeckId : decks[0].deckId;
  } catch (_error) {
    decks = [{ deckId: "demo", title: "Immersa Demo", slides: 3, ratio: "16:9", status: "ready", conversionStatus: "ready" }];
    activeDeck = "demo";
  }
  renderAll();
}

function setUploadStatus(message, type = "") {
  uploadStatus.textContent = message;
  uploadStatus.className = "upload-status" + (type ? " " + type : "");
}

document.getElementById("generateSession").addEventListener("click", () => {
  sessionInput.value = generateSessionCode();
  renderAll();
});
sessionInput.addEventListener("input", renderLinks);
sessionInput.addEventListener("blur", renderAll);
copyAudience.addEventListener("click", (event) => copyText(roleUrl("audience"), event.currentTarget));

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fileInput = document.getElementById("pptxFile");
  const file = fileInput.files[0];
  if (!file) return setUploadStatus("Selecciona un archivo .pptx", "error");
  if (!file.name.toLowerCase().endsWith(".pptx")) return setUploadStatus("Error: solo se aceptan archivos .pptx", "error");

  const formData = new FormData(uploadForm);
  uploadButton.disabled = true;
  setUploadStatus("Subiendo y convirtiendo...", "loading");

  try {
    const res = await fetch("/api/upload-pptx", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "No se pudo subir el PPTX");

    uploadForm.reset();
    if (data.conversionStatus === "completed") setUploadStatus("PPTX convertido correctamente.", "success");
    else if (data.conversionStatus === "failed") setUploadStatus("PPTX cargado, pero la conversión falló: " + (data.conversionMessage || "verás una pantalla provisional"), "error");
    else setUploadStatus("PPTX cargado. Convirtiendo...", "loading");
    await loadDecks(data.deckId);
  } catch (error) {
    setUploadStatus("Error: " + error.message, "error");
  } finally {
    uploadButton.disabled = false;
  }
});

sessionInput.value = "demo01";
loadDecks("demo");
