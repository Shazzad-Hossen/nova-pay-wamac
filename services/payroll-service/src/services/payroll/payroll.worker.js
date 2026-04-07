const { Worker } = require('bullmq');
const { createRedisConnection } = require('../../queue/queue');
const { callTransactionService, updateRunAggregates } = require('./payroll.service');

const startPayrollWorker = ({ pool, settings, connection }) => {
  const workerConnection = connection || createRedisConnection(settings);

  const worker = new Worker(
    settings.queueName,
    async (job) => {
      const payrollJobId = job.data.id;

      const readRes = await pool.query(
        `SELECT id, run_id, employee_id, sender_account_id, receiver_account_id, amount, currency, status
         FROM payroll_jobs
         WHERE id = $1`,
        [payrollJobId]
      );

      if (readRes.rowCount === 0) {
        throw new Error(`Payroll job ${payrollJobId} not found`);
      }

      const payrollJob = readRes.rows[0];

      await pool.query(
        `UPDATE payroll_jobs
         SET status = 'PROCESSING', attempts = $2, updated_at = NOW()
         WHERE id = $1`,
        [payrollJob.id, Number(job.attemptsMade || 0) + 1]
      );

      const txResult = await callTransactionService({ settings, payrollJob });

      if (!txResult.success) {
        throw new Error(txResult.message || 'Transaction service call failed');
      }

      const transactionId =
        txResult.data && txResult.data.transactionId
          ? txResult.data.transactionId
          : null;

      await pool.query(
        `UPDATE payroll_jobs
         SET status = 'SUCCESS', transaction_id = $2, failure_reason = NULL, updated_at = NOW()
         WHERE id = $1`,
        [payrollJob.id, transactionId]
      );

      await updateRunAggregates(pool, payrollJob.run_id);
      return { payrollJobId: payrollJob.id, transactionId };
    },
    {
      connection: workerConnection,
      concurrency: settings.workerConcurrency
    }
  );

  worker.on('failed', async (job, error) => {
    if (!job) return;

    if (job.attemptsMade >= job.opts.attempts) {
      try {
        const readRes = await pool.query('SELECT run_id FROM payroll_jobs WHERE id = $1', [job.data.id]);
        const runId = readRes.rowCount > 0 ? readRes.rows[0].run_id : null;

        await pool.query(
          `UPDATE payroll_jobs
           SET status = 'FAILED', failure_reason = $2, attempts = $3, updated_at = NOW()
           WHERE id = $1`,
          [job.data.id, String(error && error.message ? error.message : 'Unknown worker error'), Number(job.attemptsMade || 0)]
        );

        if (runId) {
          await updateRunAggregates(pool, runId);
        }
      } catch (eventError) {
        console.error('❌ Worker failure handler error:', eventError);
      }
    }
  });

  worker.on('error', (error) => {
    console.error('❌ Payroll worker error:', error);
  });

  return worker;
};

module.exports = {
  startPayrollWorker
};
