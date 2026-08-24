(function () {
  const key = window.ImmersaPresentationCompletion?.STORAGE_KEY || "immersa:presentation-completion";
  let record = {};
  try { record = JSON.parse(sessionStorage.getItem(key) || "{}"); } catch (_error) {}
  const eventReturnKey = "immersa:event-live-return";
  let eventReturn = null;
  try { eventReturn = JSON.parse(sessionStorage.getItem(eventReturnKey) || "null"); } catch (_error) {}
  const summary = record.summary || {};
  const number = (value) => Math.max(0, Number(value) || 0);
  const duration = number(summary.durationSeconds);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const values = { duration: minutes ? `${minutes} min${seconds ? ` ${seconds} s` : ""}` : `${seconds} s`, attendance: number(summary.attendance), activity: number(summary.activityCount) };
  document.querySelectorAll("[data-value]").forEach((node) => { if (values[node.dataset.value] !== undefined) node.textContent = values[node.dataset.value]; });
  if (record.role === "audience" && eventReturn?.returnPath) {
    const eyebrow = document.querySelector(".eyebrow");
    const heading = document.querySelector("h1");
    const lead = document.querySelector(".lead");
    const button = document.querySelector(".actions .button");
    const hint = document.querySelector(".hint");
    const publicId = String(eventReturn.returnPath).replace(/^\//, "");
    const setEventCopy = (eventName) => {
      const title = String(eventName || "este evento").trim() || "este evento";
      if (eyebrow) eyebrow.textContent = "Gracias por participar";
      if (heading) heading.innerHTML = "Las mejores ideas <span>se viven</span>";
      if (lead) lead.textContent = `La presentación terminó pero ${title} tiene mucho más para ti.`;
      if (button) { button.textContent = "Regresar al Programa"; button.href = eventReturn.returnPath; }
      if (hint) hint.textContent = "";
    };
    setEventCopy("este evento");
    if (publicId) {
      fetch(`/api/event/public/${encodeURIComponent(publicId)}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((event) => setEventCopy(event?.title || "este evento"))
        .catch(() => {});
    }
  }
  const metrics = document.querySelector("[data-metrics-link]");
  if (metrics) {
    const query = new URLSearchParams({ tab: "metrics" });
    if (record.deckId) query.set("deck", record.deckId);
    if (record.presentationSessionId) query.set("session", record.presentationSessionId);
    metrics.href = `/home?${query}`;
  }
})();