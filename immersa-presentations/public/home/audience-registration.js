(() => {
  const form = document.getElementById("audienceRegistrationForm");
  if (!form) return;
  const mode = form.elements.mode, terms = form.elements.termsUrl, save = form.querySelector("button"), status = form.querySelector('[role="status"]');
  let deckId = "", revision = 0, epoch = 0;
  const url = () => "/api/decks/" + encodeURIComponent(deckId) + "/audience-registration";
  function fields() {
    terms.parentElement.hidden = mode.value === "name";
    terms.required = mode.value !== "name";
  }
  mode.addEventListener("change", fields);
  document.addEventListener("immersa:deck-detail-open", async event => {
    const mine = ++epoch;
    deckId = event.detail?.deck?.deckId || "";
    revision = 0;
    form.hidden = true;
    if (!deckId) return;
    try {
      const response = await fetch(url(), { cache: "no-store" });
      if (!response.ok) return;
      const config = await response.json();
      if (mine !== epoch) return;
      revision = config.revision;
      mode.value = config.mode;
      terms.value = config.termsUrl;
      status.textContent = "";
      save.disabled = false;
      form.hidden = false;
      fields();
    } catch (_) {}
  });
  document.addEventListener("immersa:deck-detail-close", () => { epoch++; deckId = ""; form.hidden = true; });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!deckId || save.disabled || !form.reportValidity()) return;
    const mine = epoch;
    save.disabled = true;
    status.textContent = "Guardando…";
    try {
      const response = await fetch(url(), {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: mode.value, termsUrl: terms.value, revision })
      });
      const config = await response.json();
      if (mine !== epoch) return;
      if (!response.ok) throw new Error(config.error || "No se pudo guardar.");
      revision = config.revision;
      status.textContent = "Configuración guardada para los próximos accesos por QR.";
    } catch (error) {
      if (mine === epoch) status.textContent = error.message;
    } finally {
      if (mine === epoch) save.disabled = false;
    }
  });
})();
