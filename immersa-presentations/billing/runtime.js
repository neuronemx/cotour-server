const { BillingRepository } = require("./repository");
const { StripeBillingService } = require("./stripe-service");
const { createBillingHandlers } = require("./handlers");

function createBillingRuntime(options = {}) {
  const repository = options.repository || (options.pool ? new BillingRepository(options.pool) : null);
  const service = options.service || new StripeBillingService({ ...options, repository });
  return {
    repository,
    service,
    handlers: createBillingHandlers(service, { isAdmin: options.isAdmin })
  };
}

module.exports = { createBillingRuntime };
