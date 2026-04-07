const { hashRequest, callLedgerService } = require('./transaction.service');
const { transactionsTotal, transactionsFailed, transactionsPending } = require('../../metrics/metrics');

const getNextRetryAt = (attempt) => {
  const baseDelayMs = Number(process.env.RECOVERY_BASE_DELAY_MS || 5000);
  const delay = baseDelayMs * Math.pow(2, Math.max(attempt - 1, 0));
  return new Date(Date.now() + delay);
};

const claimIdempotency = async (client, { key, requestHash, expiresAt }) => {
  const insertRes = await client.query(
    `INSERT INTO idempotency_keys (key, request_hash, status, expires_at)
     VALUES ($1, $2, 'PROCESSING', $3)
     ON CONFLICT (key) DO NOTHING
     RETURNING key, request_hash, status, response, expires_at`,
    [key, requestHash, expiresAt]
  );

  if (insertRes.rowCount > 0) {
    return { status: 'CLAIMED' };
  }

  const existingRes = await client.query(
    `SELECT key, request_hash, status, response, expires_at
     FROM idempotency_keys
     WHERE key = $1
     FOR UPDATE`,
    [key]
  );

  if (existingRes.rowCount === 0) {
    const retryRes = await client.query(
      `INSERT INTO idempotency_keys (key, request_hash, status, expires_at)
       VALUES ($1, $2, 'PROCESSING', $3)
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [key, requestHash, expiresAt]
    );

    if (retryRes.rowCount > 0) {
      return { status: 'CLAIMED' };
    }

    return { status: 'PROCESSING' };
  }

  const existing = existingRes.rows[0];
  const now = new Date();
  const expired = existing.expires_at && new Date(existing.expires_at) < now;

  if (expired) {
    await client.query('DELETE FROM idempotency_keys WHERE key = $1', [key]);
    const reinsertRes = await client.query(
      `INSERT INTO idempotency_keys (key, request_hash, status, expires_at)
       VALUES ($1, $2, 'PROCESSING', $3)
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [key, requestHash, expiresAt]
    );

    if (reinsertRes.rowCount > 0) {
      return { status: 'CLAIMED' };
    }

    return { status: 'PROCESSING' };
  }

  if (existing.request_hash !== requestHash) {
    return { status: 'HASH_MISMATCH' };
  }

  if (existing.status === 'COMPLETED') {
    return { status: 'COMPLETED', response: existing.response };
  }

  return { status: 'PROCESSING' };
};

const finalizeIdempotency = async ({ pool, key, transactionId, statusCode, body, transactionStatus, ledgerTransactionId }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (transactionId) {
      await client.query(
        'UPDATE transactions SET status = $1, ledger_transaction_id = COALESCE($2, ledger_transaction_id) WHERE id = $3',
        [transactionStatus, ledgerTransactionId || null, transactionId]
      );
    }
    await client.query(
      'UPDATE idempotency_keys SET status = $1, response = $2 WHERE key = $3',
      ['COMPLETED', { statusCode, body }, key]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const createTransaction = ({ pool, settings }) => async (req, res) => {
  let client;
  let idempotencyKey;
  let transactionId;

  try {
    idempotencyKey = req.header('idempotency-key') || req.body.idempotency_key;

    const {
      sender_id: senderId,
      receiver_id: receiverId,
      amount,
      currency = 'USD',
      reference_id: referenceId = null,
      metadata = {}
    } = req.body;

    if (!idempotencyKey) {
      return res.status(400).json({
        success: false,
        message: 'idempotency_key is required'
      });
    }

    if (!senderId || !receiverId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    if (senderId === receiverId) {
      return res.status(400).json({
        success: false,
        message: 'Sender and receiver cannot be same'
      });
    }

    if (Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    const requestPayload = {
      sender_id: senderId,
      receiver_id: receiverId,
      amount: Number(amount),
      currency,
      reference_id: referenceId,
      metadata
    };

    const requestHash = hashRequest(requestPayload);
    const expiresAt = new Date(Date.now() + settings.idempotencyTtlMinutes * 60 * 1000);

    client = await pool.connect();
    await client.query('BEGIN');

    const claim = await claimIdempotency(client, {
      key: idempotencyKey,
      requestHash,
      expiresAt
    });

    if (claim.status === 'HASH_MISMATCH') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Idempotency key already used with different payload'
      });
    }

    if (claim.status === 'COMPLETED') {
      await client.query('COMMIT');
      const response = claim.response || { statusCode: 200, body: {} };
      return res.status(response.statusCode).json(response.body);
    }

    if (claim.status === 'PROCESSING') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Request already in progress'
      });
    }

    const txRes = await client.query(
      `INSERT INTO transactions
       (sender_id, receiver_id, amount, currency, status, idempotency_key, request_hash, retry_count)
       VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, 0)
       RETURNING id, status, created_at`,
      [senderId, receiverId, Number(amount), currency, idempotencyKey, requestHash]
    );

    transactionId = txRes.rows[0].id;
    transactionsTotal.inc();

    await client.query('COMMIT');

    const ledgerPayload = {
      senderId,
      receiverId,
      amount: Number(amount),
      currency,
      referenceId: transactionId,
      metadata
    };

    const ledgerResult = await callLedgerService(settings, ledgerPayload);

    const finalStatus = ledgerResult.success ? 'COMPLETED' : 'PENDING';
    const statusCode = ledgerResult.success ? 201 : 202;
    const ledgerTransactionId = ledgerResult.success && ledgerResult.data ? ledgerResult.data.transactionId : null;

    const responseBody = ledgerResult.success
      ? { success: true, transactionId, ledgerTransactionId, status: finalStatus }
      : { success: false, transactionId, message: ledgerResult.message || 'Ledger service error', status: finalStatus };

    if (!ledgerResult.success && transactionId) {
      transactionsPending.inc();
      await pool.query(
        `UPDATE transactions
         SET status = 'PENDING',
             retry_count = 0,
             last_retry_at = NULL,
             next_retry_at = $2
         WHERE id = $1`,
        [transactionId, getNextRetryAt(1)]
      );
    }

    await finalizeIdempotency({
      pool,
      key: idempotencyKey,
      transactionId,
      statusCode,
      body: responseBody,
      transactionStatus: finalStatus,
      ledgerTransactionId
    });

    return res.status(statusCode).json(responseBody);
  } catch (error) {
    console.error('❌ Transaction error:', error);

    if (client) {
      await client.query('ROLLBACK');
    }

    if (idempotencyKey) {
      try {
        if (transactionId) {
          transactionsFailed.inc();
        }
        await finalizeIdempotency({
          pool,
          key: idempotencyKey,
          transactionId,
          statusCode: 500,
          body: { success: false, message: 'Internal server error' },
          transactionStatus: transactionId ? 'FAILED' : 'PENDING',
          ledgerTransactionId: null
        });
      } catch (finalizeError) {
        console.error('❌ Idempotency finalize error:', finalizeError);
      }
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  } finally {
    if (client) client.release();
  }
};

const listTransactionsByStatus = ({ pool }) => async (req, res) => {
  try {
    const { status } = req.params;
    const { sender_id: senderId, receiver_id: receiverId, page = '1', limit = '50' } = req.query;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'status is required'
      });
    }

    const allowed = ['PENDING', 'FAILED', 'COMPLETED'];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of ${allowed.join(', ')}`
      });
    }

    const pageNumber = Math.max(Number(page) || 1, 1);
    const limitNumber = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const offsetNumber = (pageNumber - 1) * limitNumber;

    const filters = ['status = $1'];
    const values = [status];

    if (senderId) {
      values.push(senderId);
      filters.push(`sender_id = $${values.length}`);
    }

    if (receiverId) {
      values.push(receiverId);
      filters.push(`receiver_id = $${values.length}`);
    }

    values.push(limitNumber, offsetNumber);

    const result = await pool.query(
      `SELECT id, sender_id, receiver_id, amount, currency, status, ledger_transaction_id,
              retry_count, last_retry_at, next_retry_at, created_at
       FROM transactions
       WHERE ${filters.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return res.json({
      success: true,
      status,
      count: result.rows.length,
      page: pageNumber,
      limit: limitNumber,
      transactions: result.rows
    });
  } catch (error) {
    console.error('❌ List transactions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

const getTransactionById = ({ pool }) => async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'id is required'
      });
    }

    const result = await pool.query(
      `SELECT id, sender_id, receiver_id, amount, currency, status, ledger_transaction_id,
              idempotency_key, request_hash, retry_count, last_retry_at, next_retry_at, created_at
       FROM transactions
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    return res.json({
      success: true,
      transaction: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Get transaction error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  createTransaction,
  listTransactionsByStatus,
  getTransactionById
};
