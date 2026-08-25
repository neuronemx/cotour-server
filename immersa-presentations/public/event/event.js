(() => {
  const context = window.IMMERSA_EVENT_PUBLIC;
  if (!context?.publicId) return;
  const base = `/api/event/public/${encodeURIComponent(context.publicId)}`;
  const key = `immersa-event-participant:${context.publicId}`;
  const participantNameKey = `immersa-event-participant-name:${context.publicId}`;
  const answeredInteractionsKey = `immersa-event-admin-answered:${context.publicId}`;
  const eventSocket = window.io?.();
  const title = document.querySelector("#event-title");
  const level = document.querySelector("#event-level");
  const registration = document.querySelector("#registration");
  const registrationEventTitle = document.querySelector("#registration-event-title");
  const eventContent = document.querySelector("#event-content");
  const program = document.querySelector(".program");
  const exposition = document.querySelector("#exposition");
  const eventNav = document.querySelector("#event-nav");
  const eventTabs = [...document.querySelectorAll(".event-tab")];
  const eventBrands = document.querySelector("#event-brands");
  const eventBrandRail = document.querySelector("#event-brand-rail");
  const tabs = document.querySelector("#day-tabs");
  const legend = document.querySelector("#legend");
  const panels = document.querySelector("#day-panels");
  const overlay = document.querySelector("#speaker-overlay");
  const sheet = document.querySelector("#sheet-content");
  const liveFilterNote = document.querySelector("#live-filter-note");
  const showFullProgram = document.querySelector("#show-full-program");
  const labels = { CONFERENCE: "Conferencia", MASTER_CLASS: "Master Class", ROUND_TABLE: "Mesa redonda", WORKSHOP: "Taller", PANEL: "Panel", PROJECTION: "Proyección", OTHER: "Otra" };
  let activeSection = null;
  let activeDayId = null;
  let activitiesSnapshot = "";
  let refreshingActivities = false;
  let allActivities = [];
  let liveOnly = false;
  let adminInteraction = null;
  let adminResponse = null;
  let adminThankYou = false;
  let adminThankYouTimer = null;
  let brandRotationTimer = null;
  const participantId = () => localStorage.getItem(key);
  const answeredInteractions = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(answeredInteractionsKey) || "[]");
      return new Set(Array.isArray(stored) ? stored : []);
    } catch (_error) {
      return new Set();
    }
  };
  const rememberAnsweredInteraction = (interactionId) => {
    if (!interactionId) return;
    const answered = answeredInteractions();
    answered.add(interactionId);
    localStorage.setItem(answeredInteractionsKey, JSON.stringify([...answered].slice(-100)));
  };
  function closeAdminInteractionAfterThanks() {
    window.clearTimeout(adminThankYouTimer);
    adminThankYouTimer = window.setTimeout(() => {
      adminThankYou = false;
      adminInteraction = null;
      renderAdminInteraction();
    }, 3000);
  }
  function renderAdminInteraction() {
    let card = document.querySelector("#event-admin-interaction");
    if (!card) { card = document.createElement("section"); card.id = "event-admin-interaction"; card.className = "event-admin-interaction hidden"; document.body.append(card); }
    if (adminThankYou) {
      card.classList.remove("hidden");
      card.innerHTML = '<div class="event-admin-dialog event-admin-thanks" role="status"><strong></strong><p>Tu respuesta fue registrada.</p></div>';
      const participantName = String(localStorage.getItem(participantNameKey) || "").trim();
      card.querySelector("strong").textContent = participantName ? `Gracias ${participantName}` : "Gracias";
      return;
    }
    if (!adminInteraction || adminResponse) { card.classList.add("hidden"); card.replaceChildren(); return; }
    card.classList.remove("hidden");
    card.innerHTML = '<div class="event-admin-dialog" role="dialog" aria-modal="true"><p class="event-admin-intro"></p><p class="event-admin-question"></p><div></div></div>';
    const eventName = String(title?.textContent || "este evento").trim() || "este evento";
    card.querySelector(".event-admin-intro").textContent = `Ayúdanos a mejorar para la siguiente edición de ${eventName}`;
    card.querySelector(".event-admin-question").textContent = adminInteraction.prompt;
    for (const option of adminInteraction.options || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option.label;
      button.dataset.option = option.id;
      button.onclick = () => {
        adminResponse = { optionId: option.id };\n        rememberAnsweredInteraction(adminInteraction.id);
        adminThankYou = true;
        eventSocket?.emit("event-admin:interaction:submit", { interactionId: adminInteraction.id, optionId: option.id });
        renderAdminInteraction();
        closeAdminInteractionAfterThanks();
      };
      card.querySelector("div").append(button);
    }
  }
  function joinEventAdminChannel() { if (participantId()) eventSocket?.emit("event-admin:join", { publicId: context.publicId, participantId: participantId() }); }
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
  function matchLogoSurface(image, surface) {
    const sample = () => {
      try {
        const width = Math.min(64, image.naturalWidth || 0);
        const height = Math.min(64, image.naturalHeight || 0);
        if (!width || !height) return;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        const colors = new Map();
        for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
          if (x > 2 && x < width - 3 && y > 2 && y < height - 3) continue;
          const offset = (y * width + x) * 4;
          if (pixels[offset + 3] < 220) continue;
          const key = `${Math.round(pixels[offset] / 16) * 16},${Math.round(pixels[offset + 1] / 16) * 16},${Math.round(pixels[offset + 2] / 16) * 16}`;
          colors.set(key, (colors.get(key) || 0) + 1);
        }
        const background = [...colors.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
        if (background) surface.style.setProperty("--brand-logo-surface", `rgb(${background})`);
      } catch (_error) { /* A remote logo keeps the neutral fallback. */ }
    };
    if (image.complete) sample(); else image.addEventListener("load", sample, { once: true });
  }
  function rotateBrandRail() {
    const items = [...(eventBrandRail?.children || [])];
    for (let index = items.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }
    eventBrandRail?.append(...items);
  }
  function startBrandRotation() {
    window.clearInterval(brandRotationTimer);
    brandRotationTimer = window.setInterval(rotateBrandRail, 300000);
  }
  async function refreshBrands() {
    if (!eventBrands || !eventBrandRail) return;
    const data = await request(`${base}/brand-mentions`);
    const brands = (data.brands || []).filter((brand) => brand?.active && brand.logo?.src && brand.target_url);
    eventBrandRail.replaceChildren(...brands.map((brand) => {
      const link = document.createElement("a");
      link.className = "event-brand";
      link.href = brand.target_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = brand.name;
      link.setAttribute("role", "listitem");
      const logo = document.createElement("img");
      logo.src = brand.logo.src;
      logo.alt = brand.name;
      link.append(logo);
      matchLogoSurface(logo, link);
      return link;
    }));
    rotateBrandRail();
    eventBrands.hidden = brands.length === 0;
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
        if (activity.live && activity.canEnter && participantId()) { const enter = document.createElement("button"); enter.className = "enter-button"; enter.textContent = "Entrar"; enter.onclick = async (event) => { event.stopPropagation(); const entry = await request(`/api/event/live-sessions/${encodeURIComponent(activity.liveSessionId)}/enter`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ participantId: participantId() }) }); if (entry.returnPath) { const eventReturn = { liveSessionId: activity.liveSessionId, participantId: participantId(), returnPath: entry.returnPath }; sessionStorage.setItem("immersa:event-live-return", JSON.stringify(eventReturn)); localStorage.setItem("immersa:event-completion", JSON.stringify(eventReturn)); } window.location.assign(entry.audiencePath); }; actions.append(enter); }
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
  const load = async () => { const event = await request(base); title.textContent = event.title; if (registrationEventTitle) registrationEventTitle.textContent = event.title; level.textContent = event.audienceLevel === "PAID" ? "Acceso preferente" : "Acceso libre"; registration.classList.toggle("hidden", Boolean(participantId())); await Promise.all([refreshActivities({ force: true }), refreshBrands()]); startBrandRotation(); if (!activeSection) selectSection(event.audienceLevel === "PAID" ? "program" : "exposition"); joinEventAdminChannel(); revealContent(); };
  document.querySelector("#registration-form").onsubmit = async (event) => { event.preventDefault(); const participantName = document.querySelector("#registration-key").value.trim(); const result = await request(`${base}/registration`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registrationKey: participantName }) }); localStorage.setItem(key, result.participantId); localStorage.setItem(participantNameKey, participantName); await load(); };
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
  eventSocket?.on("connect", joinEventAdminChannel);
  eventSocket?.on("event-admin:interaction:state", (state) => {
    if (adminThankYou) return;
    adminInteraction = state?.active || null;
    adminResponse = state?.response || null;
    const interactionId = adminInteraction?.id;
    if (!adminResponse && interactionId && answeredInteractions().has(interactionId)) {
      adminResponse = { local: true };
      adminThankYou = false;
      renderAdminInteraction();
      return;
    }
    if (adminResponse) { adminThankYou = true; renderAdminInteraction(); closeAdminInteractionAfterThanks(); return; }
    renderAdminInteraction();
  });
  load().catch((error) => { title.textContent = error.message; });
  window.setInterval(() => { refreshActivities().catch(() => {}); }, 5000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshActivities().catch(() => {}); });
})();
