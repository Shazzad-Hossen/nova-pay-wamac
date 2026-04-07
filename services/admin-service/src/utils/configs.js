module.exports.configs = {
  port: process.env.PORT || 3006,
  origin: process.env.ORIGIN || '*',
  transactionServiceUrl: process.env.TRANSACTION_SERVICE_URL || null,
  ledgerServiceUrl: process.env.LEDGER_SERVICE_URL || null
};
