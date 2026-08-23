(() => {
  const context = window.IMMERSA_EVENT_PUBLIC;
  if (!context?.publicId) return;
  const base = `/api/event/public/${encodeURIComponent(context.publicId)}`;
  const key = `immersa-event-participant:${context.publicId}`;
  const title = document.querySelector("#event-title");
  const level = document.querySelector("#event-level");
  const registration = document.querySelector("#registration");
  const eventContent = document.querySelector("#event-content");
  const program = document.querySelector(".program");
  const exposition = document.querySelector("#exposition");
  const eventNav = document.querySelector("#event-nav");
  const eventTabs = [...document.querySelectorAll(".event-tab")];
  const tabs = document.querySelector("#day-tabs");
  const legend = document.querySelector("#legend");
  const panels = document.querySelector("#day-panels");
  const overlay = document.querySelector("#speaker-overlay");
  const sheet = document.querySelector("#sheet-content");
  const liveFilterNote = document.querySelector("#live-filter-note");
  const showFullProgram = document.querySelector("#show-full-program");
  const labels = { CONFERENCE: "Conferencia", MASTER_CLASS: "Master Class", ROUND_TABLE: "Mesa redonda", WORKSHOP: "Taller", PANEL: "Panel", OTHER: "Otra" };
  let activeSection = null;
  let activeDayId = null;
  let activitiesSnapshot = "";
  let refreshingActivities = false;
  let allActivities = [];
  let liveOnly = false;
  const participantId = () => localStorage.getItem(key);
  const request = async (url, options) => { const response = await fetch(url, options); const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudo completar la operación"); return body; };
  const rawDate = (value) => String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  const time = (value) => { const match = rawDate(value); if (!match) return "Por definir"; const hour = Number(match[4]); return `${hour % 12 || 12}:${match[5]} ${hour >= 12 ? "PM" : "AM"}`; };
  const endTime = (activity) => { const match = rawDate(activity.scheduledStartsAt); if (!match) return ""; const total = Number(match[4]) * 60 + Number(match[5]) + Number(activity.durationMinutes || 0); const hour = Math.floor((total % 1440) / 60); return `${hour % 12 || 12}:${String(total % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`; };
  const dateInfo = (activity) => { const match = rawDate(activity.scheduledStartsAt); if (!match) return { id: "unscheduled", name: "Por definir", date: "" }; const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))); return { id: `${match[1]}-${match[2]}-${match[3]}`, name: new Intl.DateTimeFormat("es-MX", { weekday: "short", timeZone: "UTC" }).format(date), date: new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }).format(date) }; };
  const initials = (name) => String(name || "?").split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const speakerAvatar = (speaker, small = false) => { const avatar = document.createElement("div"); avatar.className = small ? "avatar" : "speaker-photo"; if (speaker.photoUrl) avatar.style.backgroundImage = `url("${speaker.photoUrl}")`; else avatar.textContent = initials(speaker.name); return avatar; };
  const pin = () => { const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg"); icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true"); icon.innerHTML = '<path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>'; return icon; };
  function selectSection(section) {
    activeSection = section;
    exposition.classList.toggle("active", section === "exposition");
    program.classList.toggle("active", section === "program");
    eventTabs.forEach((tab) => {
      const selected = tab.dataset.section === section;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
  }
  function updateLiveIndicator() {
    const programTab = eventTabs.find((tab) => tab.dataset.section === "program");
    if (!programTab) return;
    const live = allActivities.some((activity) => activity.live);
    programTab.querySelector(".live-now")?.remove();
    if (live) { const marker = document.createElement("span"); marker.className = "live-now"; marker.dataset.liveFilter = "true"; marker.textContent = "En vivo"; programTab.append(marker); }
    liveFilterNote.classList.toggle("hidden", !liveOnly);
  }
  function renderCurrentActivities() {
    render(liveOnly ? allActivities.filter((activity) => activity.live) : allActivities);
    updateLiveIndicator();
  }
  function showSheet(activity) {
    sheet.replaceChildren();
    const detail = document.createElement("div");
    detail.className = `sheet-detail type-${activity.activityType || "OTHER"}`;
    const badgeRow = document.createElement("div");
    badgeRow.className = "sheet-badge-row";
    const badge = document.createElement("span");
    badge.className = "type";
    badge.textContent = labels[activity.activityType] || "Actividad";
    const when = document.createElement("span");
    when.className = "sheet-time";
    when.textContent = `${time(activity.scheduledStartsAt)}${endTime(activity) ? ` – ${endTime(activity)}` : ""}`;
    badgeRow.append(badge, when);
    const heading = document.createElement("h2");
    heading.className = "sheet-title";
    heading.textContent = activity.title;
    const location = document.createElement("div");
    location.className = "sheet-location";
    location.append(pin(), document.createTextNode(activity.stage.name));
    detail.append(badgeRow, heading, location);
    if (!activity.speakers?.length) {
      const empty = document.createElement("p");
      empty.className = "no-speakers";
      empty.textContent = "La semblanza de los ponentes estará disponible próximamente.";
      detail.append(empty);
    }
    for (const speaker of activity.speakers || []) {
      const block = document.createElement("article");
      block.className = "speaker";
      const copy = document.createElement("div");
      const name = document.createElement("h3");
      const role = document.createElement("p");
      const bio = document.createElement("p");
      name.textContent = speaker.name || "Ponente";
      role.className = "role"; role.textContent = speaker.roleTitle || "";
      bio.className = "bio"; bio.textContent = speaker.bio || "";
      copy.append(name);
      if (speaker.roleTitle) copy.append(role);
      if (speaker.bio) copy.append(bio);
      block.append(speakerAvatar(speaker), copy);
      detail.append(block);
    }
    sheet.append(detail);
    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");
  }
  function render(activities) {
    const grouped = new Map();
    for (const activity of activities) { const day = dateInfo(activity); const entry = grouped.get(day.id) || { ...day, activities: [] }; entry.activities.push(activity); grouped.set(day.id, entry); }
    const days = [...grouped.values()].sort((left, right) => left.id.localeCompare(right.id));
    tabs.replaceChildren(); panels.replaceChildren();
    const used = [...new Set(activities.map((activity) => activity.activityType || "OTHER"))];
    legend.replaceChildren(...used.map((type) => { const item = document.createElement("span"); item.className = "legend-item"; item.innerHTML = `<i class="dot dot-${type}"></i>`; item.append(document.createTextNode(labels[type] || "Actividad")); return item; }));
    const selectedDayId = days.some((day) => day.id === activeDayId) ? activeDayId : days[0]?.id || null;
    activeDayId = selectedDayId;
    days.forEach((day) => {
      const selected = day.id === selectedDayId;
      const tab = document.createElement("button"); tab.className = `daytab${selected ? " active" : ""}`; tab.innerHTML = `<span>${day.name}</span><small>${day.date}</small>`;
      const panel = document.createElement("section"); panel.className = `day-panel${selected ? " active" : ""}`;
      const timeline = document.createElement("div"); timeline.className = "timeline";
      day.activities.sort((left, right) => String(left.scheduledStartsAt || "").localeCompare(String(right.scheduledStartsAt || ""))).forEach((activity) => {
        const row = document.createElement("article"); row.className = "timeline-item";
        row.innerHTML = `<i class="line"></i><i class="timeline-dot dot-${activity.activityType || "OTHER"}"></i><div class="time">${time(activity.scheduledStartsAt)}<small>${endTime(activity)}</small></div>`;
        const card = document.createElement("div"); card.className = `program-card type-${activity.activityType || "OTHER"}`;
        const badge = document.createElement("span"); badge.className = "type"; badge.textContent = labels[activity.activityType] || "Actividad";
        const heading = document.createElement("h3"); heading.textContent = activity.title;
        const speakers = document.createElement("div"); speakers.className = "meta";
        const avatars = document.createElement("div"); avatars.className = "avatars"; (activity.speakers || []).forEach((speaker) => avatars.append(speakerAvatar(speaker, true)));
        speakers.append(avatars, document.createTextNode((activity.speakers || []).map((speaker) => speaker.name).join(", ") || "Ponentes por confirmar"));
        const schedule = document.createElement("div"); schedule.className = "meta"; schedule.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></svg>'; schedule.append(document.createTextNode(`${time(activity.scheduledStartsAt)}${endTime(activity) ? ` – ${endTime(activity)}` : ""}`));
        const place = document.createElement("div"); place.className = "meta"; place.append(pin(), document.createTextNode(activity.stage.name));
        card.append(badge, heading, speakers, schedule, place);
        const actions = document.createElement("div"); actions.className = "activity-actions";
        if (activity.live && activity.canEnter && participantId()) { const enter = document.createElement("button"); enter.className = "enter-button"; enter.textContent = "Entrar"; enter.onclick = async (event) => { event.stopPropagation(); const entry = await request(`/api/event/live-sessions/${encodeURIComponent(activity.liveSessionId)}/enter`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ participantId: participantId() }) }); if (entry.returnPath) sessionStorage.setItem("immersa:event-live-return", JSON.stringify({ liveSessionId: activity.liveSessionId, participantId: participantId(), returnPath: entry.returnPath })); window.location.assign(entry.audiencePath); }; actions.append(enter); }
        else if (activity.live && !activity.canEnter) { const locked = document.createElement("span"); locked.className = "access-badge"; locked.textContent = "En vivo para acceso preferente"; actions.append(locked); }
        if (actions.childNodes.length) card.append(actions);
        card.onclick = () => showSheet(activity); row.append(card); timeline.append(row);
      });
      panel.append(timeline);
      tab.addEventListener("pointerdown", () => tab.classList.add("is-activating"), { passive: true });
      tab.addEventListener("pointercancel", () => tab.classList.remove("is-activating"), { passive: true });
      tab.onclick = () => {
        activeDayId = day.id;
        tab.classList.add("active");
        tabs.querySelectorAll(".daytab").forEach((item) => { if (item !== tab) item.classList.remove("active"); item.classList.remove("is-activating"); });
        panel.classList.add("active");
        panels.querySelectorAll(".day-panel").forEach((item) => { if (item !== panel) item.classList.remove("active"); });
      };
      tabs.append(tab); panels.append(panel);
    });
  }
  const revealContent = () => requestAnimationFrame(() => requestAnimationFrame(() => { program?.classList.add("event-program-ready"); eventContent?.classList.add("event-content-ready"); eventNav?.classList.add("event-nav-ready"); }));
  const refreshActivities = async ({ force = false } = {}) => {
    if (refreshingActivities) return;
    refreshingActivities = true;
    try {
      const data = await request(`${base}/activities`);
      const activities = data.activities || [];
      const nextSnapshot = JSON.stringify(activities);
      if (force || nextSnapshot !== activitiesSnapshot) {
        activitiesSnapshot = nextSnapshot;
        allActivities = activities;
        if (liveOnly && !allActivities.some((activity) => activity.live)) liveOnly = false;
        renderCurrentActivities();
      }
    } finally { refreshingActivities = false; }
  };
  const load = async () => { const event = await request(base); title.textContent = event.title; level.textContent = event.audienceLevel === "PAID" ? "Acceso preferente" : "Acceso libre"; registration.classList.toggle("hidden", Boolean(participantId())); await refreshActivities({ force: true }); if (!activeSection) selectSection(event.audienceLevel === "PAID" ? "program" : "exposition"); revealContent(); };
  document.querySelector("#registration-form").onsubmit = async (event) => { event.preventDefault(); const result = await request(`${base}/registration`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registrationKey: document.querySelector("#registration-key").value.trim() }) }); localStorage.setItem(key, result.participantId); await load(); };
  const close = () => { overlay.classList.remove("active"); overlay.setAttribute("aria-hidden", "true"); };
  document.querySelector("#sheet-close").onclick = close;
  overlay.onclick = (event) => { if (event.target === overlay) close(); };
  eventTabs.forEach((tab) => {
    tab.addEventListener("pointerdown", () => tab.classList.add("is-activating"), { passive: true });
    tab.addEventListener("pointercancel", () => tab.classList.remove("is-activating"), { passive: true });
    tab.addEventListener("click", (event) => {
      const liveFilter = Boolean(event.target.closest("[data-live-filter]"));
      selectSection(tab.dataset.section);
      if (tab.dataset.section === "program") {
        liveOnly = liveFilter;
        renderCurrentActivities();
      }
      eventTabs.forEach((item) => { if (item !== tab) item.classList.remove("is-activating"); });
    });
  });
  showFullProgram?.addEventListener("click", () => { liveOnly = false; renderCurrentActivities(); });
  registration.classList.toggle("hidden", Boolean(participantId()));
  load().catch((error) => { title.textContent = error.message; });
  window.setInterval(() => { refreshActivities().catch(() => {}); }, 5000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshActivities().catch(() => {}); });
})();
