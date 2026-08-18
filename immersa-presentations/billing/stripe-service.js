const Stripe = require("stripe");
const {
  PRICE_ENV_KEYS,
  FOUNDERS_COUPON_ENV_KEYS,
  billingFlags,
  publicCatalog,
  resolveCatalogEntry,
  PLAN_RANK,
  publicError
} = require("./config");


const INVOICE_REQUEST_STATUSES = Object.freeze([
  "pending", "in_process", "sent", "correction_required"
]);
const FISCAL_TIME_ZONE = "America/Mexico_City";

function invoiceRequestDeadline(paidAt) {
  const value = paidAt instanceof Date ? paidAt : new Date(paidAt);
  if (!Number.isFinite(value.getTime())) throw new Error("A valid invoice payment date is required");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: FISCAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  let year = Number(parts.year);
  let month = Number(parts.month) + 1;
  if (month === 13) { month = 1; year += 1; }
  return new Date(`${year}-${String(month).padStart(2, "0")}-03T23:59:59-06:00`);
}

function fiscalData(payload = {}) {
  const rfc = String(payload.rfc || "").trim().toUpperCase();
  const legalName = String(payload.legalName || "").trim();
  const fiscalPostalCode = String(payload.fiscalPostalCode || "").trim();
  const fiscalRegime = String(payload.fiscalRegime || "").trim();
  const cfdiUse = String(payload.cfdiUse || "").trim().toUpperCase();
  if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) {
    throw publicError("INVALID_FISCAL_RFC", "Ingresa un RFC válido");
  }
  if (!legalName || legalName.length > 200) {
    throw publicError("INVALID_FISCAL_NAME", "Ingresa el nombre o razón social fiscal");
  }
  if (!/^\d{5}$/.test(fiscalPostalCode)) {
    throw publicError("INVALID_FISCAL_POSTAL_CODE", "Ingresa el código postal fiscal de 5 dígitos");
  }
  if (!/^\d{3}$/.test(fiscalRegime)) {
    throw publicError("INVALID_FISCAL_REGIME", "Selecciona un régimen fiscal válido");
  }
  if (!/^[A-Z0-9]{3}$/.test(cfdiUse)) {
    throw publicError("INVALID_CFDI_USE", "Selecciona un uso de CFDI válido");
  }
  return { rfc, legalName, fiscalPostalCode, fiscalRegime, cfdiUse };
}

function invoicePaidAt(invoice = {}) {
  const seconds = invoice.status_transitions?.paid_at || invoice.created;
  const date = new Date(Number(seconds || 0) * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

const PAYMENT_RECOVERY_MS = 7 * 24 * 60 * 60 * 1000;
const RELEVANT_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.pending_update_applied",
  "customer.subscription.pending_update_expired"
]);

function subscriptionIdFromInvoice(invoice = {}) {
  const value = invoice.subscription
    || invoice.parent?.subscription_details?.subscription
    || invoice.lines?.data?.find((line) => line.parent?.subscription_item_details)?.parent?.subscription_item_details?.subscription;
  return typeof value === "string" ? value : value?.id || "";
}

function stripeId(value) {
  return typeof value === "string" ? value : value?.id || "";
}

function stripeDiscountId(discount) {
  return stripeId(
    discount?.promotion_code
      || discount?.coupon
      || discount?.source?.promotion_code
      || discount?.source?.coupon
      || discount
  );
}

class StripeBillingService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.env = options.env || process.env;
    this.logger = options.logger || console;
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.isWorkspaceActive = options.isWorkspaceActive || (async () => false);
    this.flags = billingFlags(this.env);
    this.baseUrl = String(this.env.BETTER_AUTH_URL || "https://app.immersalive.com").replace(/\/$/, "");
    this.webhookSecret = String(this.env.STRIPE_WEBHOOK_SECRET || "").trim();
    this.stripe = options.stripe || (this.flags.enabled ? new Stripe(String(this.env.STRIPE_SECRET_KEY || "").trim(), {
      maxNetworkRetries: 2
    }) : null);
  }

  assertEnabled() {
    if (!this.flags.enabled || !this.stripe || !this.repository) throw publicError("BILLING_DISABLED", "Los cobros todavía no están habilitados", 503);
  }

  catalog() {
    return { enabled: this.flags.enabled, checkoutEnabled: this.flags.checkoutEnabled, ...publicCatalog(this.env, this.now()) };
  }

  async status(workspaceId) {
    if (!this.repository) return { ...this.catalog(), effectivePlan: "FREE", subscription: null, grants: [] };
    return { ...this.catalog(), ...(await this.repository.accountStatus(workspaceId)) };
  }

  async assertManualPlanChangeAllowed(workspaceId, targetPlan) {
    if (!this.repository) return;
    const subscription = await this.repository.getSubscription(workspaceId);
    if (!subscription || !["active", "past_due"].includes(String(subscription.status))) return;
    const currentRank = { FREE: 0, SPEAKER: 1, SPEAKER_PRO: 2 }[String(subscription.plan)] || 0;
    const targetRank = { FREE: 0, SPEAKER: 1, SPEAKER_PRO: 2 }[String(targetPlan).trim().toUpperCase()] ?? -1;
    if (targetRank < currentRank) {
      throw publicError(
        "PAID_SUBSCRIPTION_PROTECTED",
        "No puedes reducir manualmente una suscripción pagada activa. Programa el cambio desde Cobros.",
        409
      );
    }
  }

  async createPlanGrant(accountContext, workspaceId, payload = {}) {
    if (!this.repository) throw publicError("BILLING_UNAVAILABLE", "Cobros no está disponible", 503);
    const plan = String(payload.plan || "").trim().toUpperCase();
    const origin = String(payload.origin || "").trim().toLowerCase();
    if (!["SPEAKER", "SPEAKER_PRO"].includes(plan)) {
      throw publicError("INVALID_GRANT_PLAN", "Selecciona SPEAKER o SPEAKER PRO");
    }
    if (!["pilot", "courtesy", "manual", "support"].includes(origin)) {
      throw publicError("INVALID_GRANT_ORIGIN", "Selecciona piloto, cortesía, manual o soporte");
    }
    const endsAt = payload.endsAt ? new Date(payload.endsAt) : null;
    if (endsAt && (!Number.isFinite(endsAt.getTime()) || endsAt.getTime() <= this.now())) {
      throw publicError("INVALID_GRANT_END", "La vigencia debe terminar en una fecha futura");
    }
    await this.assertManualPlanChangeAllowed(workspaceId, plan);
    const currentStatus = await this.repository.accountStatus(workspaceId);
    const ranks = { FREE: 0, SPEAKER: 1, SPEAKER_PRO: 2 };
    if ((ranks[plan] || 0) < (ranks[currentStatus?.effectivePlan] || 0)) {
      throw publicError(
        "GRANT_CANNOT_DOWNGRADE",
        "Usa el flujo de downgrade para reducir límites y validar Decks o almacenamiento excedente.",
        409
      );
    }
    const grant = await this.repository.createPlanGrant({
      workspaceId,
      plan,
      origin,
      endsAt,
      note: payload.note,
      actorUserId: accountContext.user.id
    });
    const protectDowngrade = await this.isWorkspaceActive(workspaceId);
    const entitlement = await this.repository.recalculateEntitlement(workspaceId, {
      now: this.now(),
      protectDowngrade
    });
    return { grant, entitlement, status: await this.repository.accountStatus(workspaceId) };
  }

  async createCheckout(accountContext, payload = {}, options = {}) {
    this.assertEnabled();
    if (!this.flags.checkoutEnabled && !options.admin) throw publicError("BILLING_CHECKOUT_DISABLED", "La contratación todavía no está disponible", 503);
    const workspaceId = String(accountContext?.workspace?.id || "");
    if (!workspaceId) throw publicError("BILLING_ACCOUNT_REQUIRED", "Inicia sesión para contratar", 401);
    const entry = resolveCatalogEntry({ ...payload, env: this.env, now: this.now() });
    const current = await this.repository.getSubscription(workspaceId);
    if (current && ["active", "past_due"].includes(String(current.status))) {
      throw publicError("SUBSCRIPTION_ALREADY_EXISTS", "Administra tu suscripción actual para cambiar de plan", 409);
    }
    const reusable = await this.repository.findReusableCheckout({
      workspaceId, plan: entry.plan, interval: entry.interval, offer: entry.offer
    });
    if (reusable?.provider_checkout_session_id) {
      const session = await this.stripe.checkout.sessions.retrieve(String(reusable.provider_checkout_session_id));
      if (session?.url) return { url: session.url, reused: true };
    }
    const customerDetails = {
      email: String(accountContext.user?.email || "") || undefined,
      name: String(accountContext.user?.name || "") || undefined,
      metadata: { immersa_workspace_id: workspaceId }
    };
    let customerId = await this.repository.getCustomer(workspaceId);
    let replacedCustomerId = null;
    if (customerId && typeof this.stripe.customers.retrieve === "function") {
      try {
        const existing = await this.stripe.customers.retrieve(customerId);
        if (existing?.deleted) {
          replacedCustomerId = customerId;
          if (typeof this.repository.clearCustomer === "function") {
            await this.repository.clearCustomer(workspaceId, customerId);
          }
          customerId = null;
        }
      } catch (error) {
        const isMissingCustomer = error?.code === "resource_missing"
          && (error?.param === "customer" || String(error?.message || "").includes("No such customer"));
        if (!isMissingCustomer) throw error;
        this.logger.warn?.("[billing] stored Stripe customer is no longer available; creating a replacement", {
          workspaceId
        });
        replacedCustomerId = customerId;
        if (typeof this.repository.clearCustomer === "function") {
          await this.repository.clearCustomer(workspaceId, customerId);
        }
        customerId = null;
      }
    }
    if (!customerId) {
      const customer = await this.stripe.customers.create(
        customerDetails,
        { idempotencyKey: `customer:${workspaceId}${replacedCustomerId ? `:recovery:${replacedCustomerId}` : ""}` }
      );
      customerId = await this.repository.saveCustomer(workspaceId, customer.id);
    }
    const attempt = await this.repository.createCheckoutAttempt({
      workspaceId, plan: entry.plan, interval: entry.interval, offer: entry.offer, priceId: entry.priceId
    });
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: entry.priceId, quantity: 1 }],
      ...(entry.couponId ? { discounts: [{ coupon: entry.couponId }] } : { allow_promotion_codes: true }),
      success_url: `${this.baseUrl}/home?billing=success&checkout_session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.baseUrl}/home?billing=cancelled`,
      metadata: {
        immersa_workspace_id: workspaceId,
        immersa_checkout_attempt_id: attempt.id,
        immersa_plan: entry.plan,
        immersa_interval: entry.interval,
        immersa_offer: entry.offer
      },
      subscription_data: {
        metadata: { immersa_workspace_id: workspaceId, immersa_checkout_attempt_id: attempt.id }
      }
    }, { idempotencyKey: attempt.idempotencyKey });
    await this.repository.attachCheckoutSession(attempt.id, session);
    return { url: session.url, reused: false };
  }


  async listInvoices(accountContext) {
    this.assertEnabled();
    const workspaceId = String(accountContext?.workspace?.id || "");
    const customerId = await this.repository.getCustomer(workspaceId);
    if (!customerId) return { invoices: [] };
    const [stripeInvoices, requests] = await Promise.all([
      this.stripe.invoices.list({ customer: customerId, status: "paid", limit: 12 }),
      this.repository.listInvoiceRequests(workspaceId)
    ]);
    const byInvoice = new Map(requests.map((request) => [String(request.provider_invoice_id), request]));
    return {
      invoices: (stripeInvoices.data || []).map((invoice) => {
        const paidAt = invoicePaidAt(invoice);
        const deadline = invoiceRequestDeadline(paidAt);
        return {
          id: String(invoice.id),
          number: invoice.number || null,
          paidAt,
          amountTotal: Math.max(0, Number(invoice.amount_paid ?? invoice.total) || 0),
          currency: String(invoice.currency || "mxn").toUpperCase(),
          ordinaryDeadlineAt: deadline,
          timing: this.now() <= deadline.getTime() ? "ordinary" : "late",
          request: byInvoice.get(String(invoice.id)) || null
        };
      })
    };
  }

  async requestInvoice(accountContext, payload = {}) {
    this.assertEnabled();
    const workspaceId = String(accountContext?.workspace?.id || "");
    const customerId = await this.repository.getCustomer(workspaceId);
    if (!customerId) throw publicError("BILLING_CUSTOMER_NOT_FOUND", "No encontramos pagos facturables", 404);
    let invoice;
    if (payload.invoiceId) {
      invoice = await this.stripe.invoices.retrieve(String(payload.invoiceId));
    } else {
      const listed = await this.stripe.invoices.list({ customer: customerId, status: "paid", limit: 1 });
      invoice = listed.data?.[0];
    }
    if (!invoice || stripeId(invoice.customer) !== customerId || String(invoice.status) !== "paid") {
      throw publicError("INVOICE_NOT_ELIGIBLE", "El pago seleccionado no está disponible para facturación", 404);
    }
    const existing = await this.repository.getInvoiceRequest(workspaceId, invoice.id);
    if (existing) return { request: existing, duplicate: true };
    const paidAt = invoicePaidAt(invoice);
    const ordinaryDeadlineAt = invoiceRequestDeadline(paidAt);
    const timing = this.now() <= ordinaryDeadlineAt.getTime() ? "ordinary" : "late";
    const request = await this.repository.createInvoiceRequest({
      workspaceId,
      providerInvoiceId: invoice.id,
      providerCustomerId: customerId,
      paidAt,
      amountTotal: invoice.amount_paid ?? invoice.total,
      currency: invoice.currency || "mxn",
      ordinaryDeadlineAt,
      timing,
      ...fiscalData(payload)
    });
    return { request, duplicate: false };
  }

  async listAdminInvoiceRequests(status = "") {
    if (!this.repository) return { requests: [] };
    const normalized = String(status || "").trim();
    if (normalized && !INVOICE_REQUEST_STATUSES.includes(normalized)) {
      throw publicError("INVALID_INVOICE_REQUEST_STATUS", "Estado de factura no válido");
    }
    return { requests: await this.repository.listAdminInvoiceRequests(normalized) };
  }

  async updateAdminInvoiceRequest(id, payload = {}) {
    const status = String(payload.status || "").trim();
    if (!INVOICE_REQUEST_STATUSES.includes(status)) {
      throw publicError("INVALID_INVOICE_REQUEST_STATUS", "Estado de factura no válido");
    }
    return {
      request: await this.repository.updateInvoiceRequest({
        id,
        status,
        adminNote: payload.adminNote,
        cfdiUuid: payload.cfdiUuid
      })
    };
  }

  founderOfferForDiscount(discountId) {
    const current = String(discountId || "");
    return Object.values(FOUNDERS_COUPON_ENV_KEYS)
      .flatMap((intervals) => Object.values(intervals))
      .some((key) => String(this.env[key] || "") === current)
      ? "founders"
      : "official";
  }

  changeTiming(current, target) {
    const planDowngrade = (PLAN_RANK[target.plan] || 0) < (PLAN_RANK[current.plan] || 0);
    const shorterInterval = current.interval === "annual" && target.interval === "monthly";
    return planDowngrade || shorterInterval ? "period_end" : "immediate";
  }

  async schedulePeriodEndChange({ subscription, item, target, workspaceId }) {
    let schedule = null;
    try {
      schedule = await this.stripe.subscriptionSchedules.create({
        from_subscription: String(subscription.id)
      }, {
        idempotencyKey: `plan-schedule:${subscription.id}:${target.priceId}`
      });
      const currentPhase = schedule.phases?.[0];
      const currentStart = currentPhase?.start_date;
      const currentEnd = currentPhase?.end_date;
      const currentPrice = stripeId(currentPhase?.items?.[0]?.price) || stripeId(item.price);
      if (!schedule?.id || !currentStart || !currentEnd || !currentPrice) {
        throw publicError("SUBSCRIPTION_NOT_SCHEDULABLE", "No pudimos programar el cambio al final de tu periodo", 409);
      }
      const currentDiscount = stripeDiscountId(subscription.discounts?.[0] || subscription.discount);
      const currentMetadata = { ...(subscription.metadata || {}) };
      const targetMetadata = {
        ...currentMetadata,
        immersa_workspace_id: workspaceId,
        immersa_target_plan: target.plan,
        immersa_target_interval: target.interval,
        immersa_offer: target.offer
      };
      await this.stripe.subscriptionSchedules.update(String(schedule.id), {
        end_behavior: "release",
        proration_behavior: "none",
        phases: [
          {
            items: [{
              price: currentPrice,
              quantity: Number(currentPhase.items?.[0]?.quantity || item.quantity || 1)
            }],
            start_date: currentStart,
            end_date: currentEnd,
            ...(currentDiscount ? { discounts: [{ coupon: currentDiscount }] } : {}),
            metadata: currentMetadata,
            proration_behavior: "none"
          },
          {
            items: [{ price: target.priceId, quantity: 1 }],
            duration: { interval: target.interval === "annual" ? "year" : "month", interval_count: 1 },
            ...(target.couponId ? { discounts: [{ coupon: target.couponId }] } : { discounts: [] }),
            metadata: targetMetadata,
            proration_behavior: "none"
          }
        ]
      }, {
        idempotencyKey: `plan-schedule-update:${schedule.id}:${target.priceId}`
      });
      return { scheduleId: String(schedule.id), currentPeriodEnd: currentEnd };
    } catch (error) {
      if (schedule?.id && typeof this.stripe.subscriptionSchedules.release === "function") {
        try {
          await this.stripe.subscriptionSchedules.release(String(schedule.id));
        } catch (releaseError) {
          this.logger.warn?.("[billing] unable to release incomplete subscription schedule", {
            subscriptionId: subscription.id,
            scheduleId: schedule.id,
            error: String(releaseError?.message || releaseError)
          });
        }
      }
      if (/coupon|cupón|promotion code/i.test(String(error?.message || ""))) {
        throw publicError(
          "FOUNDERS_COUPON_UNAVAILABLE",
          "El Precio Fundadores configurado en Stripe ya no está disponible. Actualiza el cupón antes de programar este cambio.",
          409
        );
      }
      throw error;
    }
  }

  async createPlanChangePortal(accountContext, payload = {}) {
    this.assertEnabled();
    if (!this.flags.checkoutEnabled) {
      throw publicError("BILLING_CHECKOUT_DISABLED", "Los cambios de membresía todavía no están habilitados", 503);
    }
    const workspaceId = String(accountContext?.workspace?.id || "");
    const current = await this.repository.getSubscription(workspaceId);
    if (!current || String(current.status) !== "active") {
      throw publicError(
        "ACTIVE_SUBSCRIPTION_REQUIRED",
        String(current?.status) === "past_due"
          ? "Actualiza tu forma de pago antes de cambiar de membresía"
          : "Necesitas una suscripción activa para cambiar de membresía",
        409
      );
    }
    const customerId = await this.repository.getCustomer(workspaceId);
    const subscription = await this.stripe.subscriptions.retrieve(String(current.provider_subscription_id), {
      expand: ["discounts"]
    });
    const liveDiscount = subscription.discounts?.[0] || subscription.discount || null;
    const offer = this.founderOfferForDiscount(
      stripeDiscountId(liveDiscount)
    );
    const target = resolveCatalogEntry({
      ...payload,
      offer,
      env: this.env,
      now: this.now(),
      retainFounders: offer === "founders"
    });
    const currentPlan = String(current.plan || "");
    const currentInterval = String(current.billing_interval || "");
    if (currentPlan === target.plan && currentInterval === target.interval) {
      throw publicError("SUBSCRIPTION_CHANGE_NOT_NEEDED", "Esa ya es tu membresía actual", 409);
    }
    const item = subscription.items?.data?.[0];
    if (!customerId || !item?.id || !subscription.id) {
      throw publicError("SUBSCRIPTION_NOT_MANAGEABLE", "No pudimos preparar el cambio de membresía", 409);
    }
    const configuration = String(this.env.STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID || "").trim();
    const returnUrl = `${this.baseUrl}/home?billing=change-return&target_plan=${encodeURIComponent(target.plan)}&target_interval=${encodeURIComponent(target.interval)}`;
    const common = {
      customer: customerId,
      return_url: returnUrl,
      ...(configuration ? { configuration } : {})
    };
    if (stripeId(subscription.schedule)) {
      const session = await this.stripe.billingPortal.sessions.create(common);
      return {
        url: session.url,
        timing: "scheduled_exists",
        message: "Ya existe un cambio programado. Revísalo o cancélalo en el portal antes de solicitar otro."
      };
    }
    const timing = this.changeTiming(
      { plan: currentPlan, interval: currentInterval },
      { plan: target.plan, interval: target.interval }
    );

    // Immediate changes are executed server-side so Founder discounts are
    // applied to the subscription update and the resulting invoice. The
    // Customer Portal remains the right surface for payment methods,
    // invoices, cancellation, and period-end changes.
    if (timing === "immediate") {
      const updated = await this.stripe.subscriptions.update(String(subscription.id), {
        items: [{ id: String(item.id), price: target.priceId, quantity: 1 }],
        proration_behavior: "always_invoice",
        payment_behavior: "pending_if_incomplete",
        ...(target.couponId ? { discounts: [{ coupon: target.couponId }] } : {}),
        metadata: {
          immersa_workspace_id: workspaceId,
          immersa_target_plan: target.plan,
          immersa_target_interval: target.interval,
          immersa_offer: target.offer
        }
      }, {
        idempotencyKey: `plan-change:${subscription.id}:${target.priceId}`
      });
      const latestInvoice = typeof updated.latest_invoice === "object" ? updated.latest_invoice : null;
      const hostedInvoiceUrl = String(latestInvoice?.hosted_invoice_url || "").trim();
      const paymentIntent = latestInvoice?.payment_intent;
      const paymentRequired = Boolean(
        paymentIntent
        && typeof paymentIntent === "object"
        && !["succeeded", "processing"].includes(String(paymentIntent.status || ""))
      );
      return {
        url: hostedInvoiceUrl || returnUrl,
        timing,
        targetPlan: target.plan,
        targetInterval: target.interval,
        offer,
        paymentRequired,
        providerSubscriptionId: String(updated.id || subscription.id)
      };
    }

    const scheduled = await this.schedulePeriodEndChange({ subscription, item, target, workspaceId });
    return {
      timing,
      targetPlan: target.plan,
      targetInterval: target.interval,
      offer,
      scheduled: true,
      scheduleId: scheduled.scheduleId,
      currentPeriodEnd: scheduled.currentPeriodEnd
    };
  }

  async createPortal(accountContext) {
    this.assertEnabled();
    const workspaceId = String(accountContext?.workspace?.id || "");
    const customerId = await this.repository.getCustomer(workspaceId);
    if (!customerId) throw publicError("BILLING_CUSTOMER_NOT_FOUND", "Todavía no tienes una suscripción para administrar", 404);
    const configuration = String(this.env.STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID || "").trim();
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${this.baseUrl}/home?billing=portal-return`,
      ...(configuration ? { configuration } : {})
    });
    return { url: session.url };
  }

  catalogForPrice(priceId) {
    for (const [plan, intervals] of Object.entries(PRICE_ENV_KEYS)) {
      for (const [interval, key] of Object.entries(intervals)) {
        if (String(this.env[key] || "") === String(priceId)) {
          return {
            plan,
            interval,
            foundersCouponIds: Object.values(FOUNDERS_COUPON_ENV_KEYS[plan]).map((couponKey) => String(this.env[couponKey] || "")).filter(Boolean)
          };
        }
      }
    }
    return null;
  }

  async reconcileSubscription(subscription, eventCreatedAt = new Date(this.now())) {
    const customerId = stripeId(subscription.customer);
    const subscriptionId = String(subscription.id || "");
    const workspaceId = await this.repository.workspaceForProvider({ customerId, subscriptionId });
    if (!workspaceId) throw new Error(`No Immersa workspace found for Stripe subscription ${subscriptionId}`);
    const item = subscription.items?.data?.[0] || {};
    const priceId = stripeId(item.price);
    const catalog = this.catalogForPrice(priceId);
    if (!catalog) throw new Error(`Unknown Stripe price ${priceId}`);
    const periodStart = item.current_period_start || subscription.current_period_start;
    const periodEnd = item.current_period_end || subscription.current_period_end;
    const status = String(subscription.status || "");
    const existing = await this.repository.getSubscription(workspaceId);
    const accessUntil = status === "past_due"
      ? (existing?.access_until || new Date(this.now() + PAYMENT_RECOVERY_MS))
      : (status === "active" ? new Date(Number(periodEnd || 0) * 1000) : null);
    const discount = subscription.discounts?.[0] || subscription.discount || null;
    await this.repository.upsertSubscription(workspaceId, {
      subscriptionId,
      priceId,
      plan: catalog.plan,
      interval: catalog.interval,
      status,
      currentPeriodStart: periodStart ? new Date(Number(periodStart) * 1000) : null,
      currentPeriodEnd: periodEnd ? new Date(Number(periodEnd) * 1000) : null,
      accessUntil,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      canceledAt: subscription.canceled_at ? new Date(Number(subscription.canceled_at) * 1000) : null,
      discountId: stripeDiscountId(discount),
      eventCreatedAt
    });
    const protectDowngrade = await this.isWorkspaceActive(workspaceId);
    const entitlement = await this.repository.recalculateEntitlement(workspaceId, { now: this.now(), protectDowngrade });
    return { ...entitlement, workspaceId };
  }

  async processEvent(event) {
    if (!RELEVANT_EVENTS.has(event.type)) return { ignored: true };
    const object = event.data?.object || {};
    if (event.type === "checkout.session.expired") {
      await this.repository.markCheckoutSession(object.id, "expired");
      return { expired: true };
    }
    if (event.type === "checkout.session.completed") {
      const customerId = stripeId(object.customer);
      const workspaceId = await this.repository.workspaceForProvider({
        customerId,
        checkoutSessionId: object.id
      });
      if (workspaceId && customerId) await this.repository.saveCustomer(workspaceId, customerId);
      const subscriptionId = stripeId(object.subscription);
      await this.repository.markCheckoutSession(object.id, "completed", subscriptionId);
      if (!subscriptionId) return { pending: true };
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, { expand: ["discounts"] });
      const result = await this.reconcileSubscription(subscription, new Date(Number(event.created) * 1000));
      await this.repository.queueBillingEmail({
        workspaceId: result.workspaceId,
        eventId: event.id,
        kind: "subscription-active",
        objectId: object.id,
        plan: result.plan,
        periodEnd: subscription.items?.data?.[0]?.current_period_end
          ? new Date(Number(subscription.items.data[0].current_period_end) * 1000)
          : null
      });
      return result;
    }
    const subscriptionId = event.type.startsWith("invoice.")
      ? subscriptionIdFromInvoice(object)
      : String(object.id || "");
    if (!subscriptionId) return { ignored: true };
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, { expand: ["discounts"] });
    const result = await this.reconcileSubscription(subscription, new Date(Number(event.created) * 1000));
    let kind = "";
    let objectId = String(object.id || subscriptionId);
    if (event.type === "invoice.paid") kind = "payment-receipt";
    if (event.type === "invoice.payment_failed" || event.type === "invoice.payment_action_required") kind = "payment-failed";
    if (
      event.type === "customer.subscription.updated"
      && object.cancel_at_period_end
      && event.data?.previous_attributes?.cancel_at_period_end === false
    ) kind = "cancellation-scheduled";
    if (event.type === "customer.subscription.deleted") kind = "cancellation-effective";
    if (kind) {
      const periodEndSeconds = subscription.items?.data?.[0]?.current_period_end || subscription.current_period_end;
      await this.repository.queueBillingEmail({
        workspaceId: result.workspaceId,
        eventId: event.id,
        kind,
        objectId,
        plan: result.plan,
        amountTotal: event.type.startsWith("invoice.") ? (object.amount_paid ?? object.amount_due ?? object.total) : null,
        currency: object.currency || subscription.currency || "mxn",
        periodEnd: periodEndSeconds ? new Date(Number(periodEndSeconds) * 1000) : null
      });
    }
    return result;
  }

  async recalculateWorkspaceForDeck(deckId, options = {}) {
    if (!this.flags.enabled || !this.repository) return null;
    const workspaceId = await this.repository.workspaceForDeck(deckId);
    if (!workspaceId) return null;
    const [subscription, grants] = await Promise.all([
      this.repository.getSubscription(workspaceId),
      this.repository.getActiveGrants(workspaceId)
    ]);
    if (!subscription && !grants.length) return null;
    const protectDowngrade = options.force ? false : await this.isWorkspaceActive(workspaceId);
    return this.repository.recalculateEntitlement(workspaceId, {
      now: this.now(),
      protectDowngrade
    });
  }

  async receiveWebhook(rawBody, signature) {
    this.assertEnabled();
    if (!this.webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is required when billing is enabled");
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    const claimed = await this.repository.claimWebhookEvent(event);
    if (!claimed) return { duplicate: true };
    try {
      const result = await this.processEvent(event);
      await this.repository.finishWebhookEvent(event.id);
      return result;
    } catch (error) {
      await this.repository.finishWebhookEvent(event.id, error).catch(() => {});
      throw error;
    }
  }
}

module.exports = {
  StripeBillingService,
  PAYMENT_RECOVERY_MS,
  RELEVANT_EVENTS,
  subscriptionIdFromInvoice,
  stripeId,
  invoiceRequestDeadline,
  fiscalData,
  invoicePaidAt,
  INVOICE_REQUEST_STATUSES,
  FISCAL_TIME_ZONE
};
