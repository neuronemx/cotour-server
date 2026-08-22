const form = document.getElementById("createHub");
const feedback = document.getElementById("feedback");
const hubSection = document.getElementById("hub");
const hubTitle = document.getElementById("hubTitle");
const hubSlug = document.getElementById("hubSlug");
const stageList = document.getElementById("stageList");
const qrList = document.getElementById("qrList");
const activityForm = document.getElementById("activityForm");
const activityStage = document.getElementById("activityStage");
const activityFeedback = document.getElementById("activityFeedback");
const activityAdminList = document.getElementById("activityAdminList");
const existingHubs = document.getElementById("existingHubs");
const existingHubsFeedback = document.getElementById("existingHubsFeedback");
const savedHubKey = "immersa-event-hub-admin-workspace";
let currentHub = null;

function eventUrl(publicId) { return new URL("/" + publicId, window.location.origin).toString(); }
function activityDate(value) {
  if (!value) return "Horario por definir";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Horario por definir" : date.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}
function renderActivities(activities) {
  activityAdminList.replaceChildren();
  if (!activities.length) return void (activityAdminList.textContent = "Aún no hay actividades programadas.");
  for (const activity of activities) {
    const item = document.createElement("article");
    item.className = "activity-card";
    item.innerHTML = "<div><strong></strong><span></span></div><div class='access'></div>";
    item.querySelector("strong").textContent = activity.title;
    item.querySelector("span").textContent = `${activity.stage_name} · ${activityDate(activity.scheduled_starts_at)} · ${activity.duration_minutes} min · ${activity.deck_id ? "Deck asignado" : "Deck por asignar"}`;
    item.querySelector(".access").textContent = activity.access_level === "PAID" ? "Público Paid" : "Público Free";
    activityAdminList.appendChild(item);
  }
}
async function loadActivities() {
  if (!currentHub) return;
  const response = await fetch(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/activities`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo cargar el programa");
  renderActivities(body.activities || []);
}
async function selectHub(workspaceId) {
  const response = await fetch(`/api/admin/event-hubs/${encodeURIComponent(workspaceId)}`);
  const hub = await response.json();
  if (!response.ok) throw new Error(hub.error || "No se pudo abrir el Event Hub");
  renderHub(hub);
  await loadActivities();
}
function renderExistingHubs(hubs) {
  existingHubs.replaceChildren();
  existingHubsFeedback.textContent = hubs.length ? "Selecciona un Event Hub para administrarlo." : "Aún no hay Event Hubs en este ambiente.";
  for (const item of hubs) {
    const card = document.createElement("article");
    card.className = "existing-hub";
    card.innerHTML = "<div><strong></strong><span></span></div><button type='button'>Abrir</button>";
    card.querySelector("strong").textContent = item.title;
    card.querySelector("span").textContent = item.slug;
    card.querySelector("button").addEventListener("click", async () => {
      try { await selectHub(item.workspace_id); }
      catch (error) { existingHubsFeedback.className = "error"; existingHubsFeedback.textContent = error.message; }
    });
    existingHubs.appendChild(card);
  }
}
async function loadExistingHubs() {
  const response = await fetch("/api/admin/event-hubs");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo cargar los Event Hubs");
  renderExistingHubs(body.hubs || []);
}

function renderHub(hub) {
  currentHub = hub;
  localStorage.setItem(savedHubKey, hub.workspace_id);
  hubSection.hidden = false;
  hubTitle.textContent = hub.title;
  hubSlug.textContent = hub.slug;
  stageList.replaceChildren();
  activityStage.replaceChildren();
  for (const stage of hub.stages || []) {
    const item = document.createElement("li");
    item.innerHTML = "<strong></strong><span>Capacidad por definir</span>";
    item.querySelector("strong").textContent = stage.name;
    if (stage.audience_capacity) item.querySelector("span").textContent = stage.audience_capacity + " participantes";
    stageList.appendChild(item);
    const option = document.createElement("option");
    option.value = stage.id;
    option.textContent = stage.name;
    activityStage.appendChild(option);
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
    await loadActivities();
    await loadExistingHubs();
    feedback.className = "success";
    feedback.textContent = "Event Hub creado. Los QR ya están listos para probarse.";
    form.reset();
  } catch (error) {
    feedback.className = "error";
    feedback.textContent = error.message;
  } finally { button.disabled = false; }
});

activityForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentHub) return;
  const button = activityForm.querySelector("button");
  button.disabled = true;
  activityFeedback.className = "";
  activityFeedback.textContent = "Agregando actividad…";
  try {
    const response = await fetch(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/activities`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: activityForm.elements.title.value.trim(),
        eventStageId: activityForm.elements.eventStageId.value,
        accessLevel: activityForm.elements.accessLevel.value,
        scheduledStartsAt: activityForm.elements.scheduledStartsAt.value || null,
        durationMinutes: Number(activityForm.elements.durationMinutes.value)
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "No se pudo agregar la actividad");
    activityForm.reset();
    activityFeedback.className = "success";
    activityFeedback.textContent = "Actividad agregada. Deck por asignar.";
    await loadActivities();
  } catch (error) {
    activityFeedback.className = "error";
    activityFeedback.textContent = error.message;
  } finally { button.disabled = false; }
});

(async () => {
  try {
    await loadExistingHubs();
    const workspaceId = localStorage.getItem(savedHubKey);
    if (workspaceId) await selectHub(workspaceId);
  } catch {
    localStorage.removeItem(savedHubKey);
    existingHubsFeedback.className = "error";
    existingHubsFeedback.textContent = "No se pudo cargar los Event Hubs.";
  }
})();
