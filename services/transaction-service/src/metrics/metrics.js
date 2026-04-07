const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'transaction_service_' });

const transactionsTotal = new client.Counter({
  name: 'transactions_total',
  help: 'Total number of transactions created',
  registers: [register]
});

const transactionsFailed = new client.Counter({
  name: 'transactions_failed',
  help: 'Total number of failed transactions',
  registers: [register]
});

const transactionsPending = new client.Counter({
  name: 'transactions_pending',
  help: 'Total number of transactions moved to pending',
  registers: [register]
});

const metricsHandler = async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
};

module.exports = {
  register,
  metricsHandler,
  transactionsTotal,
  transactionsFailed,
  transactionsPending
};
