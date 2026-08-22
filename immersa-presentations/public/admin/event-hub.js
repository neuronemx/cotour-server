const form = document.getElementById("createHub");
const feedback = document.getElementById("feedback");
const hubSection = document.getElementById("hub");
const hubTitle = document.getElementById("hubTitle");
const hubSlug = document.getElementById("hubSlug");
const stageList = document.getElementById("stageList");
const qrList = document.getElementById("qrList");

function eventUrl(publicId) { return new URL("/" + publicId, window.location.origin).toString(); }

function renderHub(hub) {
  hubSection.hidden = false;
  hubTitle.textContent = hub.title;
  hubSlug.textContent = hub.slug;
  stageList.replaceChildren();
  for (const stage of hub.stages || []) {
    const item = document.createElement("li");
    item.innerHTML = "<strong></strong><span>Capacidad por definir</span>";
    item.querySelector("strong").textContent = stage.name;
    if (stage.audience_capacity) item.querySelector("span").textContent = stage.audience_capacity + " participantes";
    stageList.appendChild(item);
  }
  qrList.replaceChildren();
  for (const qr of hub.publicQrs || []) {
    const card = document.createElement("article");
    card.className = "qr-card";
    card.innerHTML = "<div class='qr-pattern' aria-label='QR de acceso'></div><div><strong></strong><a target='_blank' rel='noopener'></a></div>";
    const url = eventUrl(qr.public_id);
    card.querySelector("strong").textContent = qr.audience_level === "PAID" ? "Público Paid" : "Público Free";
    const link = card.querySelector("a");
    link.href = url;
    link.textContent = url;
    const pattern = card.querySelector(".qr-pattern");
    if (window.QRCode) new window.QRCode(pattern, { text: url, width: 148, height: 148, colorDark: "#11142d", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
    qrList.appendChild(card);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  feedback.className = "";
  feedback.textContent = "Creando Event Hub…";
  try {
    const response = await fetch("/api/admin/event-hubs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: form.elements.title.value.trim(), slug: form.elements.slug.value.trim() })
    });
    const hub = await response.json();
    if (!response.ok) throw new Error(hub.error || "No se pudo crear el Event Hub");
    renderHub(hub);
    feedback.className = "success";
    feedback.textContent = "Event Hub creado. Los QR ya están listos para probarse.";
    form.reset();
  } catch (error) {
    feedback.className = "error";
    feedback.textContent = error.message;
  } finally { button.disabled = false; }
});
