const buildIdempotencyKey = (job) => `payroll-${job.id}`;

const validatePayrollRequest = (body) => {
  const { batch_reference: batchReference, jobs } = body;

  if (!batchReference || typeof batchReference !== 'string' || !batchReference.trim()) {
    return 'batch_reference is required';
  }

  if (!Array.isArray(jobs) || jobs.length === 0) {
    return 'jobs must be a non-empty array';
  }

  for (const [index, job] of jobs.entries()) {
    if (!job || typeof job !== 'object') {
      return `jobs[${index}] must be an object`;
    }

    const {
      employee_id: employeeId,
      sender_account_id: senderAccountId,
      receiver_account_id: receiverAccountId,
      amount,
      currency = 'USD'
    } = job;

    if (!employeeId || !senderAccountId || !receiverAccountId) {
      return `jobs[${index}] missing employee_id/sender_account_id/receiver_account_id`;
    }

    if (senderAccountId === receiverAccountId) {
      return `jobs[${index}] sender and receiver cannot be same`;
    }

    const num = Number(amount);
    if (!Number.isFinite(num) || num <= 0) {
      return `jobs[${index}] amount must be greater than 0`;
    }

    if (typeof currency !== 'string' || currency.trim().length !== 3) {
      return `jobs[${index}] currency must be 3-letter code`;
    }
  }

  return null;
};

const callTransactionService = async ({ settings, payrollJob }) => {
  if (typeof fetch !== 'function') {
    return { success: false, statusCode: 500, message: 'Global fetch is not available' };
  }

  if (!settings.transactionServiceUrl) {
    return { success: false, statusCode: 503, message: 'Transaction service URL not configured' };
  }

  const url = new URL('/api/transactions', settings.transactionServiceUrl);

  const payload = {
    sender_id: payrollJob.sender_account_id,
    receiver_id: payrollJob.receiver_account_id,
    amount: Number(payrollJob.amount),
    currency: payrollJob.currency,
    metadata: {
      payroll_run_id: payrollJob.run_id,
      payroll_job_id: payrollJob.id,
      employee_id: payrollJob.employee_id
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': buildIdempotencyKey(payrollJob)
    },
    body: JSON.stringify(payload)
  });

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    return {
      success: false,
      statusCode: response.status,
      message: data && data.message ? data.message : 'Transaction service error',
      data
    };
  }

  return {
    success: true,
    statusCode: response.status,
    data
  };
};

const updateRunAggregates = async (pool, runId) => {
  await pool.query(
    `UPDATE payroll_runs r
     SET successful_jobs = agg.success_count,
         failed_jobs = agg.failed_count,
         status = CASE
           WHEN agg.success_count + agg.failed_count = r.total_jobs AND agg.failed_count = 0 THEN 'COMPLETED'
           WHEN agg.success_count + agg.failed_count = r.total_jobs AND agg.failed_count > 0 THEN 'FAILED'
           ELSE 'PROCESSING'
         END
     FROM (
       SELECT run_id,
              COUNT(*) FILTER (WHERE status = 'SUCCESS')::int AS success_count,
              COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed_count
       FROM payroll_jobs
       WHERE run_id = $1
       GROUP BY run_id
     ) agg
     WHERE r.id = agg.run_id`,
    [runId]
  );
};

module.exports = {
  validatePayrollRequest,
  callTransactionService,
  updateRunAggregates
};
