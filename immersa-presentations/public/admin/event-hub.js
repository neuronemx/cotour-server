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
const activityNew = document.getElementById("activityNew");
const eventBrands = document.getElementById("eventBrands");
const eventLocalPackage = document.getElementById("eventLocalPackage");
const eventOverview = document.getElementById("eventOverview");
const eventOverviewPanel = document.getElementById("eventOverviewPanel");
const overviewRegistered = document.getElementById("overviewRegistered");
const overviewAttendance = document.getElementById("overviewAttendance");
const overviewLiveStages = document.getElementById("overviewLiveStages");
const overviewEngagement = document.getElementById("overviewEngagement");
const overviewStages = document.getElementById("overviewStages");
const eventPolls = document.getElementById("eventPolls");
const eventPollsPanel = document.getElementById("eventPollsPanel");
const eventPollForm = document.getElementById("eventPollForm");
const eventPollAddOption = document.getElementById("eventPollAddOption");
const eventPollOptionList = document.getElementById("eventPollOptionList");
const eventPollFeedback = document.getElementById("eventPollFeedback");
const eventPollList = document.getElementById("eventPollList");
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
activityEditor.id = "activityEditor";
activityForm.parentNode.insertBefore(activityEditor, activityForm);
activityEditor.append(activityForm, activityFeedback, activitySpeakers, activityDeckCheck);
let currentHub = null;
let editingActivity = null;
let accountSpeakers = null;
let activeActivityTool = "";
let eventPollRefreshTimer = null;
let eventOverviewRefreshTimer = null;
const activityTypeLabels = { CONFERENCE: "Conferencia", ROUND_TABLE: "Mesa redonda", WORKSHOP: "Taller", MASTER_CLASS: "Master Class", PANEL: "Panel", PROJECTION: "Proyección", OTHER: "Otra" };

function eventUrl(publicId) { return new URL("/" + publicId, window.location.origin).toString(); }
async function loadEventOverview() {
  if (!currentHub) return;
  const response = await fetch(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/overview`, { cache: "no-store" });
  const overview = await response.json();
  if (!response.ok) throw new Error(overview.error || "No se pudo cargar la operación del evento");
  overviewRegistered.textContent = overview.registered || 0;
  overviewAttendance.textContent = overview.attendance || 0;
  overviewLiveStages.textContent = overview.liveStages || 0;
  overviewEngagement.textContent = overview.eventInteraction?.responsesTotal || 0;
  overviewStages.replaceChildren();
  for (const stage of overview.stages || []) {
    const item = document.createElement("article");
    item.className = stage.live ? "stage-live" : "stage-idle";
    item.innerHTML = "<strong></strong><span></span>";
    item.querySelector("strong").textContent = stage.name;
    item.querySelector("span").textContent = stage.live
      ? `${stage.activityTitle || "Actividad en vivo"} · ${stage.attendance} asistentes · pico ${stage.peakConnections}`
      : "Disponible";
    overviewStages.appendChild(item);
  }
}
function addEventPollOption(value = "") {
  const field = document.createElement("label");
  field.className = "event-poll-option";
  field.innerHTML = "<input maxlength='300' required placeholder='Opción'><button type='button' aria-label='Quitar opción'>×</button>";
  field.querySelector("input").value = value;
  field.querySelector("button").addEventListener("click", () => {
    if (eventPollOptionList.children.length <= 2) return;
    field.remove();
  });
  eventPollOptionList.appendChild(field);
}
function resetEventPollForm() {
  eventPollForm.reset();
  eventPollOptionList.replaceChildren();
  addEventPollOption();
  addEventPollOption();
}
function renderEventPolls(polls, interaction = {}) {
  eventPollList.replaceChildren();
  if (!polls.length) { eventPollList.textContent = "Aún no hay encuestas propias del evento."; return; }
  for (const poll of polls) {
    const item = document.createElement("article");
    item.className = "event-poll-card";
    const active = String(interaction.active?.id || "") === String(poll.id);
    item.innerHTML = "<div><strong></strong><p></p><ol></ol><p class='event-poll-results' hidden></p></div><aside><button type='button' data-toggle></button><button type='button' data-delete>Eliminar</button></aside>";
    item.querySelector("strong").textContent = poll.title;
    item.querySelector("p").textContent = poll.prompt;
    for (const option of poll.options || []) { const row = document.createElement("li"); row.textContent = option.label; item.querySelector("ol").appendChild(row); }
    const toggle = item.querySelector("[data-toggle]");
    toggle.textContent = active ? "Cerrar interacción" : "Lanzar";
    if (active) {
      const results = item.querySelector(".event-poll-results");
      const rows = interaction.results || [];
      results.hidden = false;
      results.textContent = `${interaction.responsesTotal || 0} respuesta${Number(interaction.responsesTotal) === 1 ? "" : "s"} · ${rows.map((row) => `${row.label}: ${row.responses}`).join(" · ")}`;
    }
    toggle.addEventListener("click", async () => {
      try {
        const url = active
          ? `/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/polls/close`
          : `/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/polls/${encodeURIComponent(poll.id)}/launch`;
        const response = await fetch(url, { method: "POST" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo actualizar la interacción");
        eventPollFeedback.className = "success"; eventPollFeedback.textContent = active ? "Interacción cerrada." : "Encuesta activa en el Programa del evento.";
        await loadEventPolls();
      } catch (error) { eventPollFeedback.className = "error"; eventPollFeedback.textContent = error.message; }
    });
    item.querySelector("[data-delete]").addEventListener("click", async () => {
      if (!window.confirm(`¿Eliminar la encuesta “${poll.title}”?`)) return;
      try {
        const response = await fetch(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/polls/${encodeURIComponent(poll.id)}`, { method: "DELETE" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo eliminar la encuesta");
        await loadEventPolls();
      } catch (error) { eventPollFeedback.className = "error"; eventPollFeedback.textContent = error.message; }
    });
    eventPollList.appendChild(item);
  }
}
async function loadEventPolls() {
  if (!currentHub) return;
  const [response, interactionResponse] = await Promise.all([
    fetch(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/polls`, { cache: "no-store" }),
    fetch(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/polls/interaction`, { cache: "no-store" })
  ]);
  const [body, interaction] = await Promise.all([response.json(), interactionResponse.json()]);
  if (!response.ok) throw new Error(body.error || "No se pudieron cargar las encuestas del evento");
  if (!interactionResponse.ok) throw new Error(interaction.error || "No se pudo cargar la interacción activa");
  renderEventPolls(body.polls || [], interaction);
}
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
  activeActivityTool = "edit";
  activityForm.reset();
  activitySubmit.textContent = "Agregar al programa";
  activityCancel.hidden = true;
  activityForm.hidden = false;
  activityFeedback.hidden = false;
  activitySpeakers.hidden = true;
  activityDeckCheck.hidden = true;
  activityEditor.hidden = false;
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
  activityDeckCheck.hidden = activeActivityTool !== "deck";
  if (activityDeckCheck.hidden) return;
  if (status === "DECK_CHECK") {
    activityDeckCheckStatus.textContent = "Deck Check aprobado. Esta es la versión comprobada para la actividad.";
    const openStage = document.createElement("button");
    openStage.type = "button";
    openStage.textContent = "Abrir Event Stage";
    openStage.addEventListener("click", async () => {
      const stageWindow = window.open("about:blank", "_blank");
      if (stageWindow) stageWindow.opener = null;
      openStage.disabled = true;
      try {
        const response = await fetch(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/activities/${encodeURIComponent(activity.id)}/stage-access`, { method: "POST" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo abrir Event Stage");
        if (!stageWindow) throw new Error("El navegador bloqueó la nueva pestaña.");
        stageWindow.location.replace(body.url);
      } catch (error) {
        if (stageWindow && !stageWindow.closed) stageWindow.close();
        activityDeckCheckStatus.textContent = error.message;
      } finally { openStage.disabled = false; }
    });
    activityDeckCheckActions.appendChild(openStage);
    const removeDeck = document.createElement("button");
    removeDeck.type = "button";
    removeDeck.textContent = "Quitar Deck";
    removeDeck.addEventListener("click", async () => {
      if (!window.confirm("¿Quitar el Deck de esta actividad? El Deck no se borrará de la cuenta del ponente.")) return;
      removeDeck.disabled = true;
      try {
        const response = await fetch(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/activities/${encodeURIComponent(activity.id)}/deck-check`, { method: "DELETE" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo quitar el Deck");
        editingActivity = { ...editingActivity, ...body };
        renderDeckCheck(editingActivity);
        await loadActivities();
      } catch (error) { activityDeckCheckStatus.textContent = error.message; }
      finally { removeDeck.disabled = false; }
    });
    activityDeckCheckActions.appendChild(removeDeck);
    return;
  }
  if (status === "READY_FOR_TEST") {
    activityDeckCheckStatus.textContent = "El Deck está preparado para prueba. Aprueba después de comprobarlo, o abre Event Stage sin Deck Check si es una incorporación de último momento.";
    const openStage = document.createElement("button");
    openStage.type = "button";
    openStage.textContent = "Abrir Event Stage sin Deck Check";
    openStage.addEventListener("click", async () => {
      const stageWindow = window.open("about:blank", "_blank");
      if (stageWindow) stageWindow.opener = null;
      openStage.disabled = true;
      try {
        const response = await fetch(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/activities/${encodeURIComponent(activity.id)}/stage-access`, { method: "POST" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo abrir Event Stage");
        if (!stageWindow) throw new Error("El navegador bloqueó la nueva pestaña.");
        stageWindow.location.replace(body.url);
      } catch (error) {
        if (stageWindow && !stageWindow.closed) stageWindow.close();
        activityDeckCheckStatus.textContent = error.message;
      } finally { openStage.disabled = false; }
    });
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
    activityDeckCheckActions.append(openStage, approve);
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
function openActivityTool(activity, tool, item, { scroll = true } = {}) {
  editingActivity = activity;
  activeActivityTool = tool;
  if (tool === "edit") {
    activityForm.elements.title.value = activity.title;
    activityForm.elements.activityType.value = activity.activity_type || "CONFERENCE";
    activityForm.elements.eventStageId.value = activity.event_stage_id;
    activityForm.elements.accessLevel.value = activity.access_level;
    activityForm.elements.scheduledStartsAt.value = dateForInput(activity.scheduled_starts_at);
    activityForm.elements.durationMinutes.value = activity.duration_minutes || 60;
    activitySubmit.textContent = "Guardar cambios";
    activityCancel.hidden = false;
  }
  activityForm.hidden = tool !== "edit";
  activityFeedback.hidden = tool !== "edit";
  activitySpeakers.hidden = tool !== "speaker";
  if (tool === "speaker") {
    renderActivitySpeakers(activity.speakers || []);
    loadAccountSpeakers().catch((error) => { activitySpeakerFeedback.className = "error"; activitySpeakerFeedback.textContent = error.message; });
  }
  renderDeckCheck(activity);
  item.after(activityEditor);
  if (scroll) requestAnimationFrame(() => item.scrollIntoView({ behavior: "smooth", block: "start" }));
}
function speakerAction(activity) {
  const invitations = (activity.speakers || []).map((speaker) => speaker.invitation?.status).filter(Boolean);
  if (invitations.includes("LINKED")) return { label: "Invitación aceptada", state: "accepted" };
  if (invitations.includes("INVITED")) return { label: "Invitación enviada", state: "sent" };
  return { label: "Enviar invitación", state: "pending" };
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
    item.className = `activity-card type-${activity.activity_type || "OTHER"}`;
    const speaker = speakerAction(activity);
    const linked = (activity.speakers || []).some((candidate) => candidate.invitation?.status === "LINKED");
    const deckApproved = activity.deck_check_status === "DECK_CHECK";
    item.innerHTML = "<div class='activity-card-main'><div class='activity-card-kicker'><span class='activity-type'></span><span class='paid-symbol' hidden>$</span></div><strong></strong><span class='activity-detail'></span></div><div class='activity-card-actions'><button type='button' class='action-edit' data-tool='edit'>Editar</button><button type='button' class='action-speaker'></button></div>";
    item.querySelector(".activity-type").textContent = activityTypeLabels[activity.activity_type] || "Actividad";
    item.querySelector("strong").textContent = activity.title;
    item.querySelector(".activity-detail").textContent = `${activity.stage_name} · ${activityDate(activity.scheduled_starts_at)} · ${activity.duration_minutes} min`;
    item.querySelector(".paid-symbol").hidden = activity.access_level !== "PAID";
    const speakerButton = item.querySelector(".action-speaker");
    speakerButton.textContent = speaker.label;
    speakerButton.classList.add(`action-speaker-${speaker.state}`);
    speakerButton.addEventListener("click", () => openActivityTool(activity, "speaker", item));
    if (linked) {
      const deckButton = document.createElement("button");
      deckButton.type = "button";
      deckButton.className = `action-deck ${deckApproved ? "action-deck-approved" : "action-deck-pending"}`;
      deckButton.textContent = "Deck Check";
      deckButton.addEventListener("click", () => openActivityTool(activity, "deck", item));
      item.querySelector(".activity-card-actions").append(deckButton);
    }
    item.querySelector(".action-edit").addEventListener("click", () => openActivityTool(activity, "edit", item));
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
  stageList?.replaceChildren();
  activityStage.replaceChildren();
  for (const stage of hub.stages || []) {
    const item = document.createElement("li");
    item.innerHTML = "<strong></strong><span></span>";
    item.querySelector("strong").textContent = stage.name;
    item.querySelector("span").textContent = `${stage.audience_capacity || 300} participantes`;
    stageList?.appendChild(item);
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
eventBrands?.addEventListener("click", () => {
  if (!currentHub) return;
  window.ImmersaBrandMentionEditor?.open({
    deckId: currentHub.workspace_id,
    title: currentHub.title,
    ownerLabel: "Event Hub",
    apiBase: `/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/brand-mentions`
  });
});
eventLocalPackage?.addEventListener("click", () => {
  if (!currentHub) return;
  window.location.assign(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/local-package`);
});
eventOverview?.addEventListener("click", async () => {
  if (!currentHub) return;
  eventOverviewPanel.hidden = !eventOverviewPanel.hidden;
  window.clearInterval(eventOverviewRefreshTimer);
  if (!eventOverviewPanel.hidden) {
    try { await loadEventOverview(); }
    catch (error) { overviewStages.textContent = error.message; }
    eventOverviewRefreshTimer = window.setInterval(() => { loadEventOverview().catch(() => {}); }, 5000);
  } else eventOverviewRefreshTimer = null;
});
eventPolls?.addEventListener("click", async () => {
  if (!currentHub) return;
  eventPollsPanel.hidden = !eventPollsPanel.hidden;
  if (!eventPollsPanel.hidden) {
    try { await loadEventPolls(); }
    catch (error) { eventPollFeedback.className = "error"; eventPollFeedback.textContent = error.message; }
    window.clearInterval(eventPollRefreshTimer);
    eventPollRefreshTimer = window.setInterval(() => { loadEventPolls().catch(() => {}); }, 2000);
  } else {
    window.clearInterval(eventPollRefreshTimer);
    eventPollRefreshTimer = null;
  }
});
eventPollAddOption?.addEventListener("click", () => addEventPollOption());
eventPollForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentHub) return;
  const submit = eventPollForm.querySelector("button[type='submit']");
  submit.disabled = true;
  eventPollFeedback.className = "";
  eventPollFeedback.textContent = "Guardando encuesta…";
  try {
    const response = await fetch(`/api/admin/event-hubs/${encodeURIComponent(currentHub.workspace_id)}/polls`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: eventPollForm.elements.title.value.trim(),
        prompt: eventPollForm.elements.prompt.value.trim(),
        options: [...eventPollOptionList.querySelectorAll("input")].map((input) => input.value.trim())
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "No se pudo guardar la encuesta");
    resetEventPollForm();
    eventPollFeedback.className = "success";
    eventPollFeedback.textContent = "Encuesta lista para lanzar en el Programa.";
    await loadEventPolls();
  } catch (error) { eventPollFeedback.className = "error"; eventPollFeedback.textContent = error.message; }
  finally { submit.disabled = false; }
});

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
activityNew.addEventListener("click", () => {
  clearActivityEditor();
  activityEditor.scrollIntoView({ behavior: "smooth", block: "start" });
  activityForm.elements.title.focus();
});
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
resetEventPollForm();

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
