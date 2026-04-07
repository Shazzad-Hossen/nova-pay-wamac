module.exports.configs = {
  port: process.env.PORT || 3005,
  origin: process.env.ORIGIN || '*',
  transactionServiceUrl: process.env.TRANSACTION_SERVICE_URL || null,
  redisHost: process.env.REDIS_HOST || '127.0.0.1',
  redisPort: Number(process.env.REDIS_PORT || 6379),
  redisPassword: process.env.REDIS_PASSWORD || null,
  queueName: process.env.PAYROLL_QUEUE_NAME || 'payroll-queue',
  payrollJobAttempts: Number(process.env.PAYROLL_JOB_ATTEMPTS || 5),
  payrollBackoffMs: Number(process.env.PAYROLL_BACKOFF_MS || 5000),
  workerConcurrency: Number(process.env.PAYROLL_WORKER_CONCURRENCY || 5)
};
