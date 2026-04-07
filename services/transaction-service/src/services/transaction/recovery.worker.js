const { callLedgerService } = require('./transaction.service');
const { transactionsFailed, transactionsPending } = require('../../metrics/metrics');

const recoverPendingTransactions = async ({ pool, settings }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const maxRetries = Number(process.env.RECOVERY_MAX_RETRIES || 5);
    const now = new Date();

    const pendingRes = await client.query(
      `SELECT id, sender_id, receiver_id, amount, currency, idempotency_key, retry_count
       FROM transactions
       WHERE status = 'PENDING'
         AND (next_retry_at IS NULL OR next_retry_at <= $1)
         AND retry_count < $2
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 25`,
      [now, maxRetries]
    );

    await client.query('COMMIT');

    for (const row of pendingRes.rows) {
      const attempt = Number(row.retry_count || 0) + 1;

      const ledgerPayload = {
        senderId: row.sender_id,
        receiverId: row.receiver_id,
        amount: Number(row.amount),
        currency: row.currency,
        referenceId: row.id,
        metadata: {}
      };

      const ledgerResult = await callLedgerService(settings, ledgerPayload);
      const finalStatus = ledgerResult.success ? 'COMPLETED' : 'FAILED';
      const statusCode = ledgerResult.success ? 201 : (ledgerResult.statusCode || 502);
      const ledgerTransactionId = ledgerResult.success && ledgerResult.data ? ledgerResult.data.transactionId : null;

      const baseDelayMs = Number(process.env.RECOVERY_BASE_DELAY_MS || 5000);
      const nextDelayMs = baseDelayMs * Math.pow(2, Math.max(attempt - 1, 0));
      const nextRetryAt = new Date(Date.now() + nextDelayMs);
      const shouldRetry = !ledgerResult.success && attempt < maxRetries;
      if (shouldRetry) {
        transactionsPending.inc();
      } else if (!ledgerResult.success) {
        transactionsFailed.inc();
      }

      const responseBody = ledgerResult.success
        ? { success: true, transactionId: row.id, ledgerTransactionId, status: finalStatus }
        : { success: false, message: ledgerResult.message || 'Ledger service error', status: finalStatus };

      const updateClient = await pool.connect();
      try {
        await updateClient.query('BEGIN');
        await updateClient.query(
          `UPDATE transactions
           SET status = $1,
               ledger_transaction_id = COALESCE($2, ledger_transaction_id),
               retry_count = $3,
               last_retry_at = NOW(),
               next_retry_at = $4
           WHERE id = $5`,
          [shouldRetry ? 'PENDING' : finalStatus, ledgerTransactionId, attempt, shouldRetry ? nextRetryAt : null, row.id]
        );

        if (row.idempotency_key) {
          if (!shouldRetry) {
            await updateClient.query(
              'UPDATE idempotency_keys SET status = $1, response = $2 WHERE key = $3',
              ['COMPLETED', { statusCode, body: responseBody }, row.idempotency_key]
            );
          }
        }

        await updateClient.query('COMMIT');
      } catch (error) {
        await updateClient.query('ROLLBACK');
        console.error('❌ Recovery update failed:', error);
      } finally {
        updateClient.release();
      }
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Recovery scan failed:', error);
  } finally {
    client.release();
  }
};

const startRecoveryWorker = ({ pool, settings }) => {
  const intervalMs = Number(process.env.RECOVERY_INTERVAL_MS || 30000);

  const run = () => {
    recoverPendingTransactions({ pool, settings }).catch((error) => {
      console.error('❌ Recovery worker error:', error);
    });
  };

  run();
  return setInterval(run, intervalMs);
};

module.exports = {
  startRecoveryWorker,
  recoverPendingTransactions
};
