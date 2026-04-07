module.exports.configs = {
  port: process.env.PORT || 3002,
  origin: process.env.ORIGIN || '*',
  idempotencyTtlMinutes: Number(process.env.IDEMPOTENCY_TTL_MINUTES || 10),
  ledgerServiceUrl: process.env.LEDGER_SERVICE_URL || null,
  ledgerTimeoutMs: Number(process.env.LEDGER_TIMEOUT_MS || 3000)
};
