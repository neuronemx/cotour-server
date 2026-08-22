(() => {
  const context = window.IMMERSA_EVENT_PUBLIC;
  if (!context?.publicId) return;
  const base = `/api/event/public/${encodeURIComponent(context.publicId)}`;
  const key = `immersa-event-participant:${context.publicId}`;
  const title = document.querySelector("#event-title");
  const level = document.querySelector("#event-level");
  const registration = document.querySelector("#registration");
  const list = document.querySelector("#activity-list");
  const participantId = () => localStorage.getItem(key);
  registration.classList.toggle("hidden", Boolean(participantId()));
  const request = async (url, options) => {
    const response = await fetch(url, options);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "No se pudo completar la operación");
    return body;
  };
  const render = (activities) => {
    list.replaceChildren(...activities.map((activity) => {
      const item = document.createElement("article"); item.className = "activity";
      const detail = document.createElement("div");
      detail.innerHTML = `<h3></h3><p></p>`; detail.querySelector("h3").textContent = activity.title;
      detail.querySelector("p").textContent = `${activity.stage.name}${activity.live ? " · EN VIVO" : ""}`;
      const action = document.createElement("div");
      if (activity.live && activity.canEnter && participantId()) {
        const button = document.createElement("button"); button.textContent = "Entrar";
        button.onclick = async () => { const entry = await request(`/api/event/live-sessions/${encodeURIComponent(activity.liveSessionId)}/enter`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ participantId: participantId() }) }); window.location.assign(entry.audiencePath); };
        action.append(button);
      } else if (activity.live && !activity.canEnter) { const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = "Acceso de paga"; action.append(badge); }
      item.append(detail, action); return item;
    }));
  };
  const load = async () => { const [event, activityData] = await Promise.all([request(base), request(`${base}/activities`)]); title.textContent = event.title; level.textContent = event.audienceLevel === "PAID" ? "Acceso de paga" : "Acceso gratuito"; registration.classList.toggle("hidden", Boolean(participantId())); render(activityData.activities); };
  document.querySelector("#registration-form").onsubmit = async (event) => { event.preventDefault(); const registrationKey = document.querySelector("#registration-key").value.trim(); const result = await request(`${base}/registration`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registrationKey }) }); localStorage.setItem(key, result.participantId); await load(); };
  load().catch((error) => { title.textContent = error.message; });
})();
