const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'payroll_service_' });

const queueJobsProcessed = new client.Counter({
  name: 'queue_jobs_processed',
  help: 'Total number of payroll queue jobs processed successfully',
  registers: [register]
});

const queueJobsFailed = new client.Counter({
  name: 'queue_jobs_failed',
  help: 'Total number of payroll queue jobs failed after retries',
  registers: [register]
});

const metricsHandler = async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
};

module.exports = {
  register,
  metricsHandler,
  queueJobsProcessed,
  queueJobsFailed
};
