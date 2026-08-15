(() => {
  const openButton = document.getElementById("billingOpen");
  const modal = document.getElementById("billingModal");
  const closeButton = document.getElementById("billingClose");
  const plansRoot = document.getElementById("billingPlans");
  const notice = document.getElementById("billingNotice");
  const current = document.getElementById("billingCurrent");
  const currentPlan = document.getElementById("billingCurrentPlan");
  const renewal = document.getElementById("billingRenewal");
  const portalButton = document.getElementById("billingPortal");
  const offerWrap = document.getElementById("billingOfferWrap");
  const offerSelect = document.getElementById("billingOffer");
  const intervalButtons = [...document.querySelectorAll("[data-billing-interval]")];
  let state = null;
  let interval = "monthly";

  const money = (centavos) => new Intl.NumberFormat("es-MX", {
    style: "currency", currency: "MXN", maximumFractionDigits: 0
  }).format(Math.max(0, Number(centavos) || 0) / 100);
  const date = (value) => value ? new Intl.DateTimeFormat("es-MX", { dateStyle: "long" }).format(new Date(value)) : "";
  const label = (plan) => String(plan || "FREE").replace(/_/g, " ");

  function showNotice(message, kind = "") {
    notice.textContent = message || "";
    notice.className = "billing-notice" + (kind ? " " + kind : "");
    notice.hidden = !message;
  }

  function selectedOffer() {
    return state?.foundersAvailable && offerSelect.value === "founders" ? "founders" : "official";
  }

  function planFeatures(plan) {
    return plan === "SPEAKER"
      ? ["5 Decks · 200 MB", "Hasta 100 personas", "Encuestas, Q&A y métricas básicas"]
      : ["15 Decks · 500 MB", "Hasta 300 personas", "Evaluaciones, sorteos, trivias y métricas detalladas"];
  }

  function render() {
    if (!state) return;
    const subscription = state.subscription;
    current.hidden = !subscription && !(state.grants || []).length;
    currentPlan.textContent = label(state.effectivePlan);
    if (subscription) {
      const status = subscription.status === "past_due" ? "Pago pendiente" : (subscription.cancelAtPeriodEnd ? "Cancelación programada" : "Suscripción activa");
      renewal.textContent = status + (subscription.currentPeriodEnd ? " · " + date(subscription.currentPeriodEnd) : "");
      portalButton.hidden = false;
    } else {
      const grant = state.grants?.[0];
      renewal.textContent = grant ? label(grant.origin) + (grant.ends_at ? " · hasta " + date(grant.ends_at) : " · sin vencimiento") : "";
      portalButton.hidden = true;
    }
    offerWrap.hidden = !state.foundersAvailable;
    if (!state.foundersAvailable) offerSelect.value = "official";
    plansRoot.replaceChildren();
    for (const plan of ["SPEAKER", "SPEAKER_PRO"]) {
      const card = document.createElement("article");
      card.className = "billing-plan" + (plan === "SPEAKER_PRO" ? " is-pro" : "");
      const amount = state.plans?.[plan]?.[interval]?.[selectedOffer()];
      const period = interval === "annual" ? "al año" : "al mes";
      const active = subscription && subscription.plan === plan && subscription.interval === interval;
      card.innerHTML = `<p>${plan === "SPEAKER_PRO" ? "Más capacidad" : "Para presentar e interactuar"}</p><h3>${label(plan)}</h3><strong>${money(amount)} <small>${period}</small></strong><ul>${planFeatures(plan).map((item) => "<li>" + item + "</li>").join("")}</ul><button type="button">${active ? "Plan actual" : (subscription ? "Administrar cambio" : "Continuar al pago")}</button>`;
      const button = card.querySelector("button");
      button.disabled = active || !state.checkoutEnabled;
      button.addEventListener("click", () => subscription ? openPortal() : checkout(plan, button));
      plansRoot.appendChild(card);
    }
    if (!state.enabled) showNotice("Los cobros aún no están habilitados en este ambiente.", "pending");
    else if (!state.checkoutEnabled && !subscription) showNotice("El flujo está en pruebas. Todavía no se aceptan pagos.", "pending");
  }

  async function load() {
    const response = await fetch("/api/billing/status", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo consultar Cobros");
    state = data;
    render();
    return data;
  }

  async function checkout(plan, button) {
    button.disabled = true;
    showNotice("Preparando Checkout seguro…", "pending");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, interval, offer: selectedOffer() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo iniciar el pago");
      window.location.assign(data.url);
    } catch (error) {
      showNotice(error.message, "error");
      button.disabled = false;
    }
  }

  async function openPortal() {
    portalButton.disabled = true;
    showNotice("Abriendo administración de pagos…", "pending");
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo abrir el portal");
      window.location.assign(data.url);
    } catch (error) {
      showNotice(error.message, "error");
      portalButton.disabled = false;
    }
  }

  async function open() {
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    showNotice("Consultando tu estado…", "pending");
    try { await load(); showNotice(""); } catch (error) { showNotice(error.message, "error"); }
  }
  function close() {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }

  openButton?.addEventListener("click", open);
  closeButton?.addEventListener("click", close);
  modal?.addEventListener("click", (event) => { if (event.target === modal) close(); });
  intervalButtons.forEach((button) => button.addEventListener("click", () => {
    interval = button.dataset.billingInterval;
    intervalButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    render();
  }));
  offerSelect?.addEventListener("change", render);
  portalButton?.addEventListener("click", openPortal);

  const query = new URLSearchParams(location.search);
  if (query.has("upgrade") || query.get("billing") === "success") {
    void open().then(async () => {
      if (query.get("billing") !== "success") return;
      showNotice("Pago recibido. Estamos esperando la confirmación segura de Stripe…", "pending");
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const next = await load().catch(() => null);
        if (next?.subscription?.status === "active") {
          showNotice("Pago confirmado. Tu plan ya está activo.", "success");
          window.dispatchEvent(new Event("immersa:billing-updated"));
          break;
        }
      }
    });
  }
})();