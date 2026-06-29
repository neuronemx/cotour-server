const roles = ["presenter", "screen", "stage", "audience"];
const labels = { presenter: "Presenter", screen: "Screen", stage: "Stage", audience: "Audience" };
let decks = [];
let activeDeck = "demo";

const deckList = document.getElementById("deckList");
const deckCount = document.getElementById("deckCount");
const sessionInput = document.getElementById("sessionInput");
const normalizedHint = document.getElementById("normalizedHint");
const activeSession = document.getElementById("activeSession");
const linksList = document.getElementById("linksList");
const qrCode = document.getElementById("qrCode");
const copyAudience = document.getElementById("copyAudience");

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

function roleUrl(role) {
  return window.location.origin + "/" + role + "?session=" + encodeURIComponent(currentSession()) + "&deck=" + encodeURIComponent(activeDeck);
}

function renderDecks() {
  deckCount.textContent = decks.length + " deck" + (decks.length === 1 ? "" : "s");
  deckList.innerHTML = "";

  decks.forEach((deck) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "deck-option" + (deck.deckId === activeDeck ? " active" : "");

    const title = document.createElement("strong");
    title.textContent = deck.title;

    const meta = document.createElement("span");
    meta.textContent = "ID: " + deck.deckId + " · Slides: " + deck.slides + " · Ratio: " + deck.ratio;

    button.append(title, meta);
    button.addEventListener("click", () => {
      activeDeck = deck.deckId;
      renderAll();
    });
    deckList.appendChild(button);
  });
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

document.getElementById("generateSession").addEventListener("click", () => {
  sessionInput.value = generateSessionCode();
  renderAll();
});
sessionInput.addEventListener("input", renderLinks);
sessionInput.addEventListener("blur", renderAll);
copyAudience.addEventListener("click", (event) => copyText(roleUrl("audience"), event.currentTarget));

fetch("/api/decks")
  .then((res) => res.json())
  .then((data) => {
    decks = data.length ? data : [{ deckId: "demo", title: "Immersa Demo", slides: 3, ratio: "16:9" }];
    activeDeck = decks[0].deckId;
    sessionInput.value = "demo01";
    renderAll();
  })
  .catch(() => {
    decks = [{ deckId: "demo", title: "Immersa Demo", slides: 3, ratio: "16:9" }];
    sessionInput.value = "demo01";
    renderAll();
  });
