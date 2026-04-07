const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'ledger_service_' });

const ledgerInvariantStatus = new client.Gauge({
  name: 'ledger_invariant_status',
  help: 'Ledger invariant status: 1=OK, 0=BROKEN',
  registers: [register]
});
ledgerInvariantStatus.set(1);

const metricsHandler = async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
};

module.exports = {
  register,
  metricsHandler,
  ledgerInvariantStatus
};
