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
const activitySubmit = document.getElementById("activitySubmit");
const activityCancel = document.getElementById("activityCancel");
const activitySpeakers = document.getElementById("activitySpeakers");
const activityDeckCheck = document.getElementById("activityDeckCheck");
const activityDeckCheckStatus = document.getElementById("activityDeckCheckStatus");
const activityDeckCheckActions = document.getElementById("activityDeckCheckActions");
const activitySpeakerList = document.getElementById("activitySpeakerList");
const activitySpeakerForm = document.getElementById("activitySpeakerForm");
const activitySpeakerFeedback = document.getElementById("activitySpeakerFeedback");
const speakerAccount = document.getElementById("speakerAccount");
const speakerAccountSearch = document.getElementById("speakerAccountSearch");
const speakerSubmit = document.getElementById("speakerSubmit");
const existingHubs = document.getElementById("existingHubs");
const existingHubsFeedback = document.getElementById("existingHubsFeedback");
const savedHubKey = "immersa-event-hub-admin-workspace";
const activityEditor = document.createElement("div");
activityEditor.className = "activity-editor";
activityForm.parentNode.insertBefore(activityEditor, activityForm);
activityEditor.append(activityForm, activityFeedback, activitySpeakers);
let currentHub = null;
let editingActivity = null;
let accountSpeakers = null;
const activityTypeLabels = { CONFERENCE: "Conferencia", ROUND_TABLE: "Mesa redonda", WORKSHOP: "Taller", MASTER_CLASS: "Master Class", PANEL: "Panel", OTHER: "Otra" };

function eventUrl(publicId) { return new URL("/" + publicId, window.location.origin).toString(); }
function activityDate(value) {
  if (!value) return "Horario por definir";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return "Horario por definir";
  const [, year, month, day, hours, minutes] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const dateLabel = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  const hour = Number(hours);
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${dateLabel}, ${hour12}:${minutes} ${period}`;
}
function dateForInput(value) { return value ? String(value).slice(0, 16).replace(" ", "T") : ""; }
function activityDay(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "Sin horario programado";
  const [, year, month, day] = match;
  return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}
function clearActivityEditor() {
  editingActivity = null;
  activityForm.reset();
  activitySubmit.textContent = "Agregar al programa";
  activityCancel.hidden = true;
  activitySpeakers.hidden = true;
  activityDeckCheck.hidden = true;
  activityAdminList.before(activityEditor);
}
async function loadAccountSpeakers() {
  if (accountSpeakers) return accountSpeakers;
  const response = await fetch("/api/admin/accounts", { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudieron cargar las cuentas IMMERSA");
  accountSpeakers = body.accounts || [];
  renderAccountSpeakerOptions();
  return accountSpeakers;
}
function renderAccountSpeakerOptions() {
  const query = speakerAccountSearch.value.trim().toLowerCase();
  speakerAccount.replaceChildren();
  for (const account of (accountSpeakers || []).filter((item) => !query || `${item.name} ${item.email}`.toLowerCase().includes(query))) {
    const option = document.createElement("option");
    option.value = account.userId;
    option.textContent = `${account.name || "Sin nombre"} · ${account.email}`;
    speakerAccount.appendChild(option);
  }
}
function showSpeakerSource() {
  const manual = activitySpeakerForm.elements.source.value === "MANUAL";
  document.querySelectorAll(".speaker-manual-field").forEach((field) => {
    field.hidden = !manual;
    field.style.display = manual ? "grid" : "none";
  });
  document.querySelectorAll(".speaker-account-field").forEach((field) => {
    field.hidden = manual;
    field.style.display = manual ? "none" : "grid";
  });
  speakerSubmit.textContent = manual ? "Agregar ponente" : "Invitar ponente";
}
function renderActivitySpeakers(speakers) {
  activitySpeakerList.replaceChildren();
  if (!speakers.length) activitySpeakerList.textContent = "Aún no hay ponentes vinculados.";
  for (const speaker of speakers) {
    const item = document.createElement("div");
    item.className = "speaker-admin";
    item.innerHTML = "<div><strong></strong><span></span></div><button type='button'>Quitar</button>";
    item.querySelector("strong").textContent = speaker.name || "Perfil sin nombre";
    const linkStatus = speaker.sourceKind !== "ACCOUNT" ? "" : (speaker.invitation?.status === "LINKED" ? " · Cuenta vinculada" : (speaker.invitation ? " · Invitación enviada" : ""));
    item.querySelector("span").textContent = `${speaker.sourceKind === "ACCOUNT" ? "Cuenta IMMERSA" : "Manual"}${speaker.roleTitle ? ` · ${speaker.roleTitle}` : ""}${linkStatus}`;
    item.querySelector("button").addEventListener("click", async () => {
      try {
        const response = await fetch(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/activities/${encodeURIComponent(editingActivity.id)}/speakers/${encodeURIComponent(speaker.id)}`, { method: "DELETE" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo quitar el ponente");
        editingActivity.speakers = editingActivity.speakers.filter((candidate) => candidate.id !== speaker.id);
        renderActivitySpeakers(editingActivity.speakers);
        await loadActivities();
      } catch (error) { activitySpeakerFeedback.className = "error"; activitySpeakerFeedback.textContent = error.message; }
    });
    activitySpeakerList.appendChild(item);
  }
}
function renderDeckCheck(activity) {
  const linked = (activity.speakers || []).filter((speaker) => speaker.invitation?.status === "LINKED");
  const status = activity.deck_check_status || "PENDING";
  activityDeckCheckActions.replaceChildren();
  activityDeckCheck.hidden = !linked.length && status !== "READY_FOR_TEST" && status !== "DECK_CHECK";
  if (activityDeckCheck.hidden) return;
  if (status === "DECK_CHECK") {
    activityDeckCheckStatus.textContent = "Deck Check aprobado. Esta es la versión comprobada para la actividad.";
    return;
  }
  if (status === "READY_FOR_TEST") {
    activityDeckCheckStatus.textContent = "El Deck está preparado para prueba. Aprueba sólo después de comprobarlo.";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.textContent = "Aprobar Deck Check";
    approve.addEventListener("click", async () => {
      approve.disabled = true;
      try {
        const response = await fetch(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/activities/${encodeURIComponent(activity.id)}/deck-check/approve`, { method: "POST" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo aprobar el Deck Check");
        editingActivity = { ...editingActivity, ...body };
        renderDeckCheck(editingActivity);
        await loadActivities();
      } catch (error) { activityDeckCheckStatus.textContent = error.message; }
      finally { approve.disabled = false; }
    });
    activityDeckCheckActions.appendChild(approve);
    return;
  }
  activityDeckCheckStatus.textContent = linked.length ? "Selecciona un Deck actual de un ponente vinculado para prepararlo para prueba." : "Aún no hay una cuenta de ponente vinculada.";
  for (const speaker of linked) {
    const choose = document.createElement("button");
    choose.type = "button";
    choose.textContent = `Elegir Deck de ${speaker.name || "ponente"}`;
    choose.addEventListener("click", async () => {
      choose.disabled = true;
      try {
        const response = await fetch(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/activities/${encodeURIComponent(activity.id)}/speakers/${encodeURIComponent(speaker.id)}/decks`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudieron cargar los Decks del ponente");
        const select = document.createElement("select");
        select.innerHTML = "<option value=''>Selecciona un Deck</option>";
        for (const deck of body.decks || []) {
          const option = document.createElement("option");
          option.value = deck.deckId;
          option.textContent = deck.title || deck.deckId;
          select.appendChild(option);
        }
        const confirm = document.createElement("button");
        confirm.type = "button";
        confirm.textContent = "Preparar para prueba";
        confirm.addEventListener("click", async () => {
          if (!select.value) { activityDeckCheckStatus.textContent = "Selecciona un Deck."; return; }
          confirm.disabled = true;
          try {
            const request = await fetch(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/activities/${encodeURIComponent(activity.id)}/deck-check`, {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ speakerId: speaker.id, deckId: select.value })
            });
            const result = await request.json();
            if (!request.ok) throw new Error(result.error || "No se pudo preparar el Deck Check");
            editingActivity = { ...editingActivity, ...result };
            renderDeckCheck(editingActivity);
            await loadActivities();
          } catch (error) { activityDeckCheckStatus.textContent = error.message; }
          finally { confirm.disabled = false; }
        });
        activityDeckCheckActions.replaceChildren(select, confirm);
      } catch (error) { activityDeckCheckStatus.textContent = error.message; }
      finally { choose.disabled = false; }
    });
    activityDeckCheckActions.appendChild(choose);
  }
}
function editActivity(activity) {
  editingActivity = activity;
  activityForm.elements.title.value = activity.title;
  activityForm.elements.activityType.value = activity.activity_type || "CONFERENCE";
  activityForm.elements.eventStageId.value = activity.event_stage_id;
  activityForm.elements.accessLevel.value = activity.access_level;
  activityForm.elements.scheduledStartsAt.value = dateForInput(activity.scheduled_starts_at);
  activityForm.elements.durationMinutes.value = activity.duration_minutes || 60;
  activitySubmit.textContent = "Guardar cambios";
  activityCancel.hidden = false;
  activitySpeakers.hidden = false;
  renderActivitySpeakers(activity.speakers || []);
  renderDeckCheck(activity);
  loadAccountSpeakers().catch((error) => { activitySpeakerFeedback.className = "error"; activitySpeakerFeedback.textContent = error.message; });
  activityForm.scrollIntoView({ behavior: "smooth", block: "center" });
}
function renderActivities(activities) {
  activityAdminList.replaceChildren();
  if (!activities.length) return void (activityAdminList.textContent = "Aún no hay actividades programadas.");
  const scheduled = [...activities].sort((left, right) => {
    const leftStart = left.scheduled_starts_at || "9999-12-31";
    const rightStart = right.scheduled_starts_at || "9999-12-31";
    return leftStart.localeCompare(rightStart) || left.stage_name.localeCompare(right.stage_name) || left.title.localeCompare(right.title);
  });
  let currentDay = null;
  for (const activity of scheduled) {
    const day = activityDay(activity.scheduled_starts_at);
    if (day !== currentDay) {
      const heading = document.createElement("h4");
      heading.className = "agenda-day";
      heading.textContent = day;
      activityAdminList.appendChild(heading);
      currentDay = day;
    }
    const item = document.createElement("article");
    item.className = "activity-card";
    item.innerHTML = "<div><strong></strong><span></span></div><div class='access'></div><button type='button'>Editar</button>";
    item.querySelector("strong").textContent = activity.title;
    item.querySelector("span").textContent = `${activityTypeLabels[activity.activity_type] || "Actividad"} · ${activity.stage_name} · ${activityDate(activity.scheduled_starts_at)} · ${activity.duration_minutes} min · ${activity.deck_id ? "Deck asignado" : "Deck por asignar"}`;
    item.querySelector(".access").textContent = activity.access_level === "PAID" ? "Público Paid" : "Público Free";
    item.querySelector("button").addEventListener("click", () => { editActivity(activity); item.after(activityEditor); });
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
    item.className = "stage-config";
    item.innerHTML = "<div><strong></strong><span></span></div><form><label><span>Capacidad</span><input type='number' min='1' max='100000' inputmode='numeric' required></label><button type='submit'>Guardar</button></form><p role='status'></p>";
    item.querySelector("strong").textContent = stage.name;
    const capacityLabel = item.querySelector("div span");
    const capacityInput = item.querySelector("input");
    const capacityForm = item.querySelector("form");
    const capacityFeedback = item.querySelector("p");
    capacityLabel.textContent = stage.audience_capacity ? `${stage.audience_capacity} participantes` : "Capacidad por definir";
    capacityInput.value = stage.audience_capacity || "";
    capacityForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const capacity = Number(capacityInput.value);
      const button = capacityForm.querySelector("button");
      button.disabled = true;
      capacityFeedback.className = "";
      capacityFeedback.textContent = "Guardando…";
      try {
        const response = await fetch(`/api/admin/event-stages/${encodeURIComponent(stage.id)}/capacity`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audienceCapacity: capacity })
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo guardar la capacidad");
        stage.audience_capacity = body.audienceCapacity;
        capacityLabel.textContent = `${body.audienceCapacity} participantes`;
        capacityFeedback.className = "success";
        capacityFeedback.textContent = "Capacidad guardada.";
      } catch (error) {
        capacityFeedback.className = "error";
        capacityFeedback.textContent = error.message;
      } finally { button.disabled = false; }
    });
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
  activityFeedback.textContent = editingActivity ? "Guardando cambios…" : "Agregando actividad…";
  try {
    const endpoint = editingActivity
      ? `/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/activities/${encodeURIComponent(editingActivity.id)}`
      : `/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/activities`;
    const response = await fetch(endpoint, {
      method: editingActivity ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: activityForm.elements.title.value.trim(),
        activityType: activityForm.elements.activityType.value,
        eventStageId: activityForm.elements.eventStageId.value,
        accessLevel: activityForm.elements.accessLevel.value,
        scheduledStartsAt: activityForm.elements.scheduledStartsAt.value || null,
        durationMinutes: Number(activityForm.elements.durationMinutes.value)
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "No se pudo agregar la actividad");
    const wasEditing = Boolean(editingActivity);
    clearActivityEditor();
    activityFeedback.className = "success";
    activityFeedback.textContent = wasEditing ? "Actividad actualizada." : "Actividad agregada. Deck por asignar.";
    await loadActivities();
  } catch (error) {
    activityFeedback.className = "error";
    activityFeedback.textContent = error.message;
  } finally { button.disabled = false; }
});
activityCancel.addEventListener("click", clearActivityEditor);
activitySpeakerForm.elements.source.addEventListener("change", showSpeakerSource);
speakerAccountSearch.addEventListener("input", renderAccountSpeakerOptions);
activitySpeakerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editingActivity || !currentHub) return;
  const button = activitySpeakerForm.querySelector("button");
  button.disabled = true;
  activitySpeakerFeedback.className = "";
  activitySpeakerFeedback.textContent = activitySpeakerForm.elements.source.value === "MANUAL" ? "Agregando ponente…" : "Enviando invitación…";
  try {
    const manual = activitySpeakerForm.elements.source.value === "MANUAL";
    const response = await fetch(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/activities/${encodeURIComponent(editingActivity.id)}/speakers`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manual ? {
        name: activitySpeakerForm.elements.name.value.trim(), roleTitle: activitySpeakerForm.elements.roleTitle.value.trim(),
        bio: activitySpeakerForm.elements.bio.value.trim(), photoUrl: activitySpeakerForm.elements.photoUrl.value.trim()
      } : { accountUserId: activitySpeakerForm.elements.accountUserId.value })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "No se pudo agregar el ponente");
    let invitation = null;
    if (!manual) {
      const speaker = (body.speakers || []).find((item) => item.accountUserId === activitySpeakerForm.elements.accountUserId.value);
      if (!speaker) throw new Error("No se pudo identificar la cuenta del ponente");
      const inviteResponse = await fetch(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/activities/${encodeURIComponent(editingActivity.id)}/speakers/${encodeURIComponent(speaker.id)}/invite-link`, { method: "POST" });
      invitation = await inviteResponse.json();
      if (!inviteResponse.ok) throw new Error(invitation.error || "No se pudo enviar la invitación");
    }
    editingActivity.speakers = body.speakers || [];
    renderActivitySpeakers(editingActivity.speakers);
    activitySpeakerForm.reset();
    showSpeakerSource();
    activitySpeakerFeedback.className = "success";
    activitySpeakerFeedback.textContent = manual
      ? "Ponente agregado."
      : (invitation?.email?.status === "sent" ? "Ponente invitado. También recibió un correo para vincular su cuenta." : "Ponente invitado. Verá la invitación para vincular su cuenta al entrar a IMMERSA.");
    await loadActivities();
  } catch (error) { activitySpeakerFeedback.className = "error"; activitySpeakerFeedback.textContent = error.message; }
  finally { button.disabled = false; }
});
showSpeakerSource();

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
