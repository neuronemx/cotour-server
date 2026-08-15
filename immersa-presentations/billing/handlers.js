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
    portal: async (req, res) => {
      try {
        res.json(await service.createPortal(req.accountContext));
      } catch (error) {
        errorResponse(res, error, "No se pudo abrir la administración de pagos");
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
