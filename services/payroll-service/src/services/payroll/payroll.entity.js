const { validatePayrollRequest } = require('./payroll.service');

module.exports.runPayroll = ({ pool, settings, payrollQueue }) => async (req, res) => {
  let client;

  try {
    if (!payrollQueue) {
      return res.status(500).json({ success: false, message: 'Payroll queue is not initialized' });
    }

    const validationError = validatePayrollRequest(req.body || {});
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const { batch_reference: batchReference, jobs } = req.body;

    client = await pool.connect();
    await client.query('BEGIN');

    const runRes = await client.query(
      `INSERT INTO payroll_runs (batch_reference, status, total_jobs)
       VALUES ($1, 'PENDING', $2)
       RETURNING id, batch_reference, status, total_jobs, successful_jobs, failed_jobs, created_at`,
      [batchReference.trim(), jobs.length]
    );

    const run = runRes.rows[0];

    const insertedJobs = [];
    for (const item of jobs) {
      const jobRes = await client.query(
        `INSERT INTO payroll_jobs (run_id, employee_id, sender_account_id, receiver_account_id, amount, currency, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'QUEUED')
         RETURNING id, run_id, employee_id, sender_account_id, receiver_account_id, amount, currency, status`,
        [
          run.id,
          item.employee_id,
          item.sender_account_id,
          item.receiver_account_id,
          Number(item.amount),
          item.currency.toUpperCase()
        ]
      );
      insertedJobs.push(jobRes.rows[0]);
    }

    await client.query(`UPDATE payroll_runs SET status = 'PROCESSING' WHERE id = $1`, [run.id]);

    await client.query('COMMIT');

    await Promise.all(
      insertedJobs.map((job) =>
        payrollQueue.add('salary-transfer', job, {
          jobId: job.id,
          attempts: settings.payrollJobAttempts,
          backoff: {
            type: 'exponential',
            delay: settings.payrollBackoffMs
          },
          removeOnComplete: 1000,
          removeOnFail: 2000
        })
      )
    );

    return res.status(202).json({
      success: true,
      message: 'Payroll run accepted',
      runId: run.id,
      batchReference: run.batch_reference,
      totalJobs: run.total_jobs
    });
  } catch (error) {
    console.error('❌ Run payroll error:', error);

    if (client) await client.query('ROLLBACK');

    if (String(error.message || '').includes('payroll_runs_batch_reference_key')) {
      return res.status(409).json({
        success: false,
        message: 'batch_reference already exists'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  } finally {
    if (client) client.release();
  }
};

module.exports.getPayrollRunById = ({ pool }) => async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ success: false, message: 'run id is required' });
    }

    const runRes = await pool.query(
      `SELECT id, batch_reference, status, total_jobs, successful_jobs, failed_jobs, created_at
       FROM payroll_runs
       WHERE id = $1`,
      [id]
    );

    if (runRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Payroll run not found' });
    }

    const jobsRes = await pool.query(
      `SELECT id, employee_id, sender_account_id, receiver_account_id, amount, currency, status,
              attempts, transaction_id, failure_reason, created_at, updated_at
       FROM payroll_jobs
       WHERE run_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    return res.json({
      success: true,
      run: runRes.rows[0],
      jobs: jobsRes.rows
    });
  } catch (error) {
    console.error('❌ Get payroll run error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
