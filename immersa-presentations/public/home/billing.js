(() => {
  const openButton = document.getElementById("billingOpen");
  const modal = document.getElementById("billingModal");
  const closeButton = document.getElementById("billingClose");
  const plansRoot = document.getElementById("billingPlans");
  const notice = document.getElementById("billingNotice");
  const portalButton = document.getElementById("billingPortal");
  const invoiceOpenButton = document.getElementById("billingInvoiceOpen");
  const invoiceForm = document.getElementById("billingInvoiceForm");
  const invoiceCancelButton = document.getElementById("billingInvoiceCancel");
  const invoiceSelect = document.getElementById("billingInvoiceSelect");
  const invoiceTiming = document.getElementById("billingInvoiceTiming");
  const invoiceStatus = document.getElementById("billingInvoiceStatus");
  const changeConfirm = document.getElementById("billingChangeConfirm");
  const changeConfirmTitle = document.getElementById("billingChangeConfirmTitle");
  const changeConfirmSummary = document.getElementById("billingChangeConfirmSummary");
  const changeConfirmCharge = document.getElementById("billingChangeConfirmCharge");
  const changeConfirmCard = document.getElementById("billingChangeConfirmCard");
  const changeConfirmCancel = document.getElementById("billingChangeConfirmCancel");
  const changeConfirmBack = document.getElementById("billingChangeConfirmBack");
  const changeConfirmSubmit = document.getElementById("billingChangeConfirmSubmit");

  const offerWrap = document.getElementById("billingOfferWrap");
  const offerSelect = document.getElementById("billingOffer");
  const offerButtons = [...document.querySelectorAll("[data-billing-offer]")];
  const intervalButtons = [...document.querySelectorAll("[data-billing-interval]")];
  let state = null;
  let interval = "monthly";
  let invoices = [];
  let pendingPlanChange = null;

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

  function closePlanChangeConfirmation() {
    pendingPlanChange = null;
    if (changeConfirm) changeConfirm.hidden = true;
    if (plansRoot) plansRoot.hidden = false;
  }

  function planChangeTiming(plan) {
    const ranks = { FREE: 0, SPEAKER: 1, SPEAKER_PRO: 2 };
    const currentPlan = state?.subscription?.plan || state?.effectivePlan || "FREE";
    const currentInterval = state?.subscription?.interval || "monthly";
    return ranks[plan] < (ranks[currentPlan] || 0)
      || (currentInterval === "annual" && interval === "monthly")
      ? "period_end"
      : "immediate";
  }

  function openPlanChangeConfirmation(plan, button) {
    if (!state?.subscription || !changeConfirm) return;
    const amount = state.plans?.[plan]?.[interval]?.[selectedOffer()];
    const period = interval === "annual" ? "Anual · paga 10 meses" : "Mensual";
    const timing = planChangeTiming(plan);
    pendingPlanChange = { plan, button };
    changeConfirmTitle.textContent = "Cambiar a " + label(plan);
    changeConfirmSummary.textContent = label(plan) + " · " + period + " · " + money(amount);
    if (timing === "period_end") {
      changeConfirmCharge.textContent = "El cambio quedará programado para el final de tu periodo actual. No habrá un cobro inmediato.";
      changeConfirmCard.textContent = "Conservarás tu plan actual hasta esa fecha. Stripe mostrará la fecha exacta y IMMERSA no eliminará tus Decks.";
    } else {
      changeConfirmCharge.textContent = "Al confirmar, Stripe calculará el prorrateo. Tu tarjeta guardada podría cobrarse automáticamente; el importe exacto se mostrará en Stripe.";
      changeConfirmCard.textContent = "Este paso sí inicia la actualización en Stripe. Si el banco requiere autenticación, Stripe te la solicitará.";
    }
    plansRoot.hidden = true;
    changeConfirm.hidden = false;
    changeConfirmSubmit.disabled = false;
    showNotice("");
  }

  function planFeatures(plan) {
    return plan === "SPEAKER"
      ? ["5 Decks · 200 MB", "Hasta 100 personas", "Encuestas, Q&A y métricas básicas"]
      : ["15 Decks · 500 MB", "Hasta 300 personas", "Encuestas, Q&A y métricas básicas", "Evaluaciones, sorteos, trivias, historial y métricas detalladas"];
  }

  function render() {
    if (!state) return;
    const subscription = ["active", "past_due"].includes(String(state.subscription?.status || ""))
      ? state.subscription
      : null;
    const subscriptionStatus = subscription
      ? (subscription.status === "past_due" ? "Pago pendiente" : (subscription.cancelAtPeriodEnd ? "Cancelación programada" : "Suscripción activa"))
      : "";
    if (subscription) {
      if (portalButton) portalButton.hidden = true;
      invoiceOpenButton.hidden = false;
    } else {
      if (portalButton) portalButton.hidden = true;
      invoiceOpenButton.hidden = true;
      invoiceForm.hidden = true;
    }
    offerWrap.hidden = !state.foundersAvailable;
    if (!state.foundersAvailable) offerSelect.value = "official";
    offerButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.billingOffer === selectedOffer()));
    plansRoot.replaceChildren();
    for (const plan of ["SPEAKER", "SPEAKER_PRO"]) {
      const card = document.createElement("article");
      card.className = "billing-plan" + (plan === "SPEAKER_PRO" ? " is-pro" : "");
      const amount = state.plans?.[plan]?.[interval]?.[selectedOffer()];
      const period = interval === "annual" ? "al año" : "al mes";
      const active = subscription && subscription.plan === plan && subscription.interval === interval;
      const statusMarkup = active && subscriptionStatus
        ? `<small class="billing-plan-status">${subscriptionStatus}${subscription.currentPeriodEnd ? " · " + date(subscription.currentPeriodEnd) : ""}</small>${state.pendingChange ? `<small class="billing-plan-status billing-plan-scheduled">Cambio programado al finalizar tu periodo actual.</small>` : ""}`
        : "";
      card.innerHTML = `<p>${plan === "SPEAKER_PRO" ? "Más capacidad" : "Para presentar e interactuar"}</p><h3>${label(plan)}</h3><strong>${money(amount)} <small>${period}</small></strong><ul>${planFeatures(plan).map((item) => "<li>" + item + "</li>").join("")}</ul><button type="button">${active ? "Plan actual" : (subscription ? "Administrar cambio" : "Continuar al pago")}</button>${statusMarkup}`;
      const button = card.querySelector("button");
      button.disabled = !active && !state.checkoutEnabled;
      button.classList.toggle("is-current", Boolean(active));
      button.addEventListener("click", () => {
        if (active) return;
        subscription ? openPlanChangeConfirmation(plan, button) : checkout(plan, button);
      });
      plansRoot.appendChild(card);
    }
    if (!state.enabled) showNotice("Los cobros aún no están habilitados en este ambiente.", "pending");
    else if (!state.checkoutEnabled && !subscription) showNotice("El flujo está en pruebas. Todavía no se aceptan pagos.", "pending");
  }

  function syncIntervalFromSubscription(data) {
    const current = String(data?.subscription?.interval || "");
    if (!["monthly", "annual"].includes(current)) return;
    interval = current;
    intervalButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.billingInterval === interval);
    });
  }

  async function load() {
    const response = await fetch("/api/billing/status", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo consultar Cobros");
    state = data;
    syncIntervalFromSubscription(data);
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


  async function changePlan(plan, button) {
    button.disabled = true;
    showNotice("Preparando el cambio seguro en Stripe…", "pending");
    try {
      const response = await fetch("/api/billing/change", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, interval })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo preparar el cambio");
      if (data.timing === "period_end") {
        const end = Number(data.currentPeriodEnd || 0);
        const dateLabel = end ? date(new Date(end * 1000)) : "el final de tu periodo actual";
        closePlanChangeConfirmation();
        await load();
        showNotice("Cambio programado para " + dateLabel + ". No habrá un cobro inmediato.", "pending");
        return;
      } else if (data.timing === "scheduled_exists") {
        showNotice(data.message, "pending");
      } else {
        showNotice("Stripe calculará el crédito y el cobro inmediato antes de confirmar el cambio.", "pending");
      }
      if (data.url) window.location.assign(data.url);
    } catch (error) {
      showNotice(error.message, "error");
      button.disabled = false;
    }
  }

  const invoiceStatusLabel = (status) => ({
    pending: "Pendiente",
    in_process: "En proceso",
    sent: "Enviada",
    correction_required: "Requiere corrección"
  })[status] || status;

  function selectedInvoice() {
    return invoices.find((invoice) => invoice.id === invoiceSelect.value) || null;
  }

  function renderInvoiceTiming() {
    const invoice = selectedInvoice();
    if (!invoice) {
      invoiceTiming.textContent = "Selecciona un pago confirmado.";
      return;
    }
    if (invoice.request) {
      invoiceTiming.textContent = "Solicitud " + invoiceStatusLabel(invoice.request.status).toLowerCase()
        + " · " + date(invoice.request.requested_at || invoice.request.requestedAt);
      return;
    }
    invoiceTiming.textContent = invoice.timing === "late"
      ? "Solicitud extemporánea: será revisada administrativamente."
      : "Plazo ordinario hasta " + date(invoice.ordinaryDeadlineAt) + ".";
  }

  async function openInvoiceForm() {
    invoiceOpenButton.disabled = true;
    invoiceStatus.textContent = "Consultando pagos confirmados…";
    invoiceStatus.className = "billing-invoice-status";
    try {
      const response = await fetch("/api/billing/invoices", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron consultar tus pagos");
      invoices = Array.isArray(data.invoices) ? data.invoices : [];
      invoiceSelect.replaceChildren();
      for (const invoice of invoices) {
        const option = document.createElement("option");
        option.value = invoice.id;
        option.textContent = (invoice.number ? "Factura Stripe " + invoice.number : "Pago del " + date(invoice.paidAt))
          + " · " + money(invoice.amountTotal)
          + (invoice.request ? " · " + invoiceStatusLabel(invoice.request.status) : "");
        invoiceSelect.appendChild(option);
      }
      if (!invoices.length) {
        invoiceStatus.textContent = "Todavía no hay pagos confirmados disponibles para facturar.";
        invoiceStatus.classList.add("error");
        invoiceForm.hidden = false;
        invoiceForm.querySelector(".billing-invoice-submit").disabled = true;
        return;
      }
      invoiceForm.querySelector(".billing-invoice-submit").disabled = false;
      invoiceForm.hidden = false;
      invoiceStatus.textContent = "";
      renderInvoiceTiming();
      invoiceForm.querySelector("input[name='rfc']")?.focus();
    } catch (error) {
      invoiceForm.hidden = false;
      invoiceStatus.textContent = error.message;
      invoiceStatus.classList.add("error");
    } finally {
      invoiceOpenButton.disabled = false;
    }
  }

  async function submitInvoiceRequest(event) {
    event.preventDefault();
    const invoice = selectedInvoice();
    if (!invoice) return;
    if (invoice.request) {
      invoiceStatus.textContent = "Ya existe una solicitud para este pago: " + invoiceStatusLabel(invoice.request.status) + ".";
      return;
    }
    const button = invoiceForm.querySelector(".billing-invoice-submit");
    button.disabled = true;
    invoiceStatus.textContent = "Registrando solicitud…";
    invoiceStatus.className = "billing-invoice-status";
    const values = new FormData(invoiceForm);
    try {
      const response = await fetch("/api/billing/invoice-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: values.get("invoiceId"),
          rfc: values.get("rfc"),
          legalName: values.get("legalName"),
          fiscalPostalCode: values.get("fiscalPostalCode"),
          fiscalRegime: values.get("fiscalRegime"),
          cfdiUse: values.get("cfdiUse")
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo registrar la solicitud");
      invoice.request = data.request;
      renderInvoiceTiming();
      invoiceStatus.textContent = data.request.timing === "late"
        ? "Solicitud extemporánea recibida. IMMERSA la revisará administrativamente."
        : "Solicitud recibida. Enviaremos tu CFDI en un máximo de 3 días hábiles.";
      invoiceStatus.classList.add("success");
    } catch (error) {
      invoiceStatus.textContent = error.message;
      invoiceStatus.classList.add("error");
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
    closePlanChangeConfirmation();
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    showNotice("Consultando tu estado…", "pending");
    try { await load(); showNotice(""); } catch (error) { showNotice(error.message, "error"); }
  }
  function clearBillingReturnQuery() {
    const url = new URL(window.location.href);
    ["billing", "target_plan", "target_interval", "checkout_session_id", "upgrade"].forEach((key) => {
      url.searchParams.delete(key);
    });
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }

  function close() {
    closePlanChangeConfirmation();
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    invoiceForm.hidden = true;
    clearBillingReturnQuery();
  }

  openButton?.addEventListener("click", open);
  closeButton?.addEventListener("click", close);
  modal?.addEventListener("click", (event) => { if (event.target === modal) close(); });
  intervalButtons.forEach((button) => button.addEventListener("click", () => {
    closePlanChangeConfirmation();
    interval = button.dataset.billingInterval;
    intervalButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    render();
  }));
  offerSelect?.addEventListener("change", () => { closePlanChangeConfirmation(); render(); });
  offerButtons.forEach((button) => button.addEventListener("click", () => {
    offerSelect.value = button.dataset.billingOffer;
    offerButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    closePlanChangeConfirmation();
    render();
  }));
  portalButton?.addEventListener("click", openPortal);
  changeConfirmCancel?.addEventListener("click", closePlanChangeConfirmation);
  changeConfirmBack?.addEventListener("click", closePlanChangeConfirmation);
  changeConfirmSubmit?.addEventListener("click", () => {
    if (!pendingPlanChange) return;
    changeConfirmSubmit.disabled = true;
    void changePlan(pendingPlanChange.plan, changeConfirmSubmit);
  });
  invoiceOpenButton?.addEventListener("click", openInvoiceForm);
  invoiceCancelButton?.addEventListener("click", () => { invoiceForm.hidden = true; });
  invoiceSelect?.addEventListener("change", renderInvoiceTiming);
  invoiceForm?.addEventListener("submit", submitInvoiceRequest);

  const query = new URLSearchParams(location.search);
  if (query.has("upgrade") || ["success", "change-return"].includes(query.get("billing"))) {
    void open().then(async () => {
      if (query.get("billing") !== "success") {
        const targetPlan = query.get("target_plan") || "";
        const targetInterval = query.get("target_interval") || "";
        showNotice("Estamos confirmando el cambio directamente con Stripe…", "pending");
        let confirmed = false;
        for (let attempt = 0; attempt < 15; attempt += 1) {
          const next = await load().catch(() => null);
          const nextSubscription = next?.subscription;
          confirmed = Boolean(
            nextSubscription
            && nextSubscription.status === "active"
            && (!targetPlan || nextSubscription.plan === targetPlan)
            && (!targetInterval || nextSubscription.interval === targetInterval)
          );
          if (confirmed) break;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        if (confirmed) {
          showNotice("Cambio confirmado. Tu plan ya está actualizado.", "success");
          window.dispatchEvent(new Event("immersa:billing-updated"));
        } else {
          showNotice("El pago sigue procesándose. Actualizaremos este estado automáticamente cuando Stripe confirme el cambio.", "pending");
        }
        return;
      }
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
