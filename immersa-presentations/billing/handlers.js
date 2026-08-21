function errorResponse(res, error, fallback) {
  const status = Number(error?.statusCode) || 500;
  if (status >= 500) console.error(fallback, error);
  return res.status(status).json({
    error: error?.publicMessage || (status < 500 ? error?.message : fallback),
    code: error?.code || "BILLING_REQUEST_FAILED"
  });
}

function createBillingHandlers(service, options = {}) {
  const isAdmin = options.isAdmin || (() => false);
  return {
    catalog: (_req, res) => res.json(service.catalog()),
    status: async (req, res) => {
      try {
        res.set("Cache-Control", "no-store");
        res.json(await service.status(req.accountContext.workspace.id));
      } catch (error) {
        errorResponse(res, error, "No se pudo consultar tu suscripción");
      }
    },
    checkout: async (req, res) => {
      try {
        res.json(await service.createCheckout(req.accountContext, req.body, { admin: isAdmin(req.accountContext) }));
      } catch (error) {
        errorResponse(res, error, "No se pudo iniciar el pago");
      }
    },
    eventPassCheckout: async (req, res) => {
      try {
        res.json(await service.createEventPassCheckout(req.accountContext, req.body, { admin: isAdmin(req.accountContext) }));
      } catch (error) {
        errorResponse(res, error, "No se pudo iniciar el pase de 7 días");
      }
    },
    adminGrant: async (req, res) => {
      if (!isAdmin(req.accountContext)) return res.status(403).json({ error: "Administración de IMMERSA requerida" });
      try {
        res.json(await service.createPlanGrant(req.accountContext, req.params.workspaceId, req.body));
      } catch (error) {
        errorResponse(res, error, "No se pudo registrar la activación comercial");
      }
    },
    adminStatus: async (req, res) => {
      if (!isAdmin(req.accountContext)) return res.status(403).json({ error: "Administración de IMMERSA requerida" });
      try {
        res.set("Cache-Control", "no-store");
        res.json(await service.status(req.params.workspaceId));
      } catch (error) {
        errorResponse(res, error, "No se pudo consultar el estado comercial");
      }
    },
    invoices: async (req, res) => {
      try {
        res.set("Cache-Control", "no-store");
        res.json(await service.listInvoices(req.accountContext));
      } catch (error) {
        errorResponse(res, error, "No se pudieron consultar tus pagos facturables");
      }
    },
    requestInvoice: async (req, res) => {
      try {
        res.status(201).json(await service.requestInvoice(req.accountContext, req.body));
      } catch (error) {
        errorResponse(res, error, "No se pudo registrar la solicitud de factura");
      }
    },
    adminInvoiceRequests: async (req, res) => {
      if (!isAdmin(req.accountContext)) return res.status(403).json({ error: "Administración de IMMERSA requerida" });
      try {
        res.set("Cache-Control", "no-store");
        res.json(await service.listAdminInvoiceRequests(req.query.status));
      } catch (error) {
        errorResponse(res, error, "No se pudieron consultar las solicitudes de factura");
      }
    },
    adminUpdateInvoiceRequest: async (req, res) => {
      if (!isAdmin(req.accountContext)) return res.status(403).json({ error: "Administración de IMMERSA requerida" });
      try {
        res.json(await service.updateAdminInvoiceRequest(req.params.requestId, req.body));
      } catch (error) {
        errorResponse(res, error, "No se pudo actualizar la solicitud de factura");
      }
    },
    change: async (req, res) => {
      try {
        res.json(await service.createPlanChangePortal(req.accountContext, req.body));
      } catch (error) {
        errorResponse(res, error, "No se pudo preparar el cambio de membresía");
      }
    },
    cancel: async (req, res) => {
      try {
        res.json(await service.cancelSubscriptionAtPeriodEnd(req.accountContext));
      } catch (error) {
        errorResponse(res, error, "No se pudo programar la cancelación");
      }
    },
    portal: async (req, res) => {
      try {
        res.json(await service.createPortal(req.accountContext));
      } catch (error) {
        errorResponse(res, error, "No se pudo abrir la administración de pagos");
      }
    },
    recoverPayment: async (req, res) => {
      try {
        res.json(await service.recoverPayment(req.accountContext));
      } catch (error) {
        errorResponse(res, error, "No se pudo intentar el cobro de la factura pendiente");
      }
    },
    webhook: async (req, res) => {
      try {
        const result = await service.receiveWebhook(req.body, req.get("stripe-signature"));
        res.json({ received: true, ...result });
      } catch (error) {
        const signatureError = /signature|payload/i.test(String(error?.message || ""));
        if (!signatureError) console.error("Unable to process Stripe webhook", error);
        res.status(signatureError ? 400 : 500).json({ received: false });
      }
    }
  };
}

module.exports = { createBillingHandlers, errorResponse };
