const { BillingRepository } = require("./repository");
const { StripeBillingService } = require("./stripe-service");
const { createBillingHandlers } = require("./handlers");
const { BillingNotifier } = require("./notifier");

function createBillingRuntime(options = {}) {
  const repository = options.repository || (options.pool ? new BillingRepository(options.pool) : null);
  const service = options.service || new StripeBillingService({ ...options, repository });
  const notifier = options.notifier || (options.pool ? new BillingNotifier(options.pool, options) : null);
  notifier?.start();
  return {
    repository,
    service,
    notifier,
    handlers: createBillingHandlers(service, { isAdmin: options.isAdmin })
  };
}

module.exports = { createBillingRuntime };
