const { ledgerInvariantStatus } = require('../../metrics/metrics');
const crypto = require('node:crypto');

module.exports.createEntry = ({ pool }) => async (req, res) => {
  let client;

  try {
    const {
      senderId,
      receiverId,
      amount,
      currency = "USD",
      referenceId = null,
      metadata = {}
    } = req.body;

    // ✅ validation
    if (!senderId || !receiverId || !amount) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (senderId === receiverId) {
      return res.status(400).json({ message: "Sender and receiver cannot be same" });
    }

    if (amount <= 0) {
      return res.status(400).json({ message: "Amount must be greater than 0" });
    }

    client = await pool.connect();
    await client.query('BEGIN');

    // ✅ create transaction (with referenceId)
    const txRes = await client.query(
      `INSERT INTO ledger_transactions (reference_id, type)
       VALUES ($1, $2)
       RETURNING id`,
      [referenceId, 'TRANSFER']
    );

    const transactionId = txRes.rows[0].id;

    // ✅ debit
    await client.query(
      `INSERT INTO ledger_entries 
       (transaction_id, account_id, type, amount, currency, metadata)
       VALUES ($1, $2, 'DEBIT', $3, $4, $5)`,
      [transactionId, senderId, amount, currency, metadata]
    );

    // ✅ credit
    await client.query(
      `INSERT INTO ledger_entries 
       (transaction_id, account_id, type, amount, currency, metadata)
       VALUES ($1, $2, 'CREDIT', $3, $4, $5)`,
      [transactionId, receiverId, amount, currency, metadata]
    );

    const prevRes = await client.query(
      `SELECT hash FROM ledger_audit_log ORDER BY id DESC LIMIT 1 FOR UPDATE`
    );
    const prevHash = prevRes.rowCount > 0 ? prevRes.rows[0].hash : null;
    const auditPayload = JSON.stringify({
      senderId,
      receiverId,
      amount,
      currency,
      referenceId,
      metadata
    });
    const chainInput = `${prevHash || 'GENESIS'}|${transactionId}|TRANSFER_CREATED|${auditPayload}`;
    const hash = crypto.createHash('sha256').update(chainInput).digest('hex');

    await client.query(
      `INSERT INTO ledger_audit_log (transaction_id, event_type, payload, prev_hash, hash)
       VALUES ($1, $2, $3::jsonb, $4, $5)`,
      [transactionId, 'TRANSFER_CREATED', auditPayload, prevHash, hash]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: "Entry created successfully",
      transactionId
    });

  } catch (error) {
    console.error("❌ Ledger error:", error);

    if (client) await client.query('ROLLBACK');

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });

  } finally {
    if (client) client.release();
  }
};

module.exports.checkAuditChain = ({ pool }) => async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, transaction_id, event_type, payload, prev_hash, hash
       FROM ledger_audit_log
       ORDER BY id ASC`
    );

    let previousHash = null;
    for (const row of result.rows) {
      if (row.event_type === 'GENESIS') {
        const expectedGenesis = crypto
          .createHash('sha256')
          .update(`GENESIS|${JSON.stringify(row.payload)}`)
          .digest('hex');
        if (row.hash !== expectedGenesis) {
          return res.status(500).json({
            success: false,
            status: 'TAMPERED',
            message: 'Audit chain tampering detected at genesis block',
            recordId: row.id
          });
        }
        previousHash = row.hash;
        continue;
      }

      const payload = JSON.stringify(row.payload);
      const expected = crypto
        .createHash('sha256')
        .update(`${row.prev_hash || 'GENESIS'}|${row.transaction_id}|${row.event_type}|${payload}`)
        .digest('hex');

      if (row.hash !== expected || row.prev_hash !== previousHash) {
        return res.status(500).json({
          success: false,
          status: 'TAMPERED',
          message: 'Audit chain tampering detected',
          recordId: row.id
        });
      }
      previousHash = row.hash;
    }

    return res.json({
      success: true,
      status: 'OK',
      recordsChecked: result.rows.length
    });
  } catch (error) {
    console.error('❌ Audit chain check error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};


module.exports.checkEntry = ({ pool }) => async (req, res) => {
    try {
        
    } catch (error) {
        console.error("❌ Ledger error:", error);

        return res.status(500).json({
          success: false,
          message: "Internal server error"
        });
        
    }
}

module.exports.checkEntry = ({ pool }) => async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT transaction_id
      FROM ledger_entries
      GROUP BY transaction_id
      HAVING SUM(
        CASE 
          WHEN type = 'DEBIT' THEN amount 
          ELSE -amount 
        END
      ) != 0
    `);

    // ❌ যদি imbalance থাকে
    if (result.rows.length > 0) {
      ledgerInvariantStatus.set(0);
      return res.status(500).json({
        success: false,
        status: "BROKEN",
        message: "Ledger invariant violated",
        invalidTransactions: result.rows
      });
    }

    // ✅ সব ঠিক থাকলে
    ledgerInvariantStatus.set(1);
    return res.json({
      success: true,
      status: "OK",
      message: "Ledger is balanced"
    });

  } catch (error) {
    ledgerInvariantStatus.set(0);
    console.error("❌ Ledger check error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

module.exports.getBalance = ({ pool }) => async (req, res) => {
  try {
    const { accountId } = req.params;

    if (!accountId) {
      return res.status(400).json({
        success: false,
        message: "accountId is required"
      });
    }

    const result = await pool.query(`
      SELECT 
        COALESCE(SUM(
          CASE 
            WHEN type = 'CREDIT' THEN amount
            ELSE -amount
          END
        ), 0) AS balance
      FROM ledger_entries
      WHERE account_id = $1
    `, [accountId]);

    return res.json({
      success: true,
      accountId,
      balance: result.rows[0].balance
    });

  } catch (error) {
    console.error("❌ Balance error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

module.exports.getTransaction = ({ pool }) => async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Transaction id is required"
      });
    }

    // 🟢 get transaction
    const txResult = await pool.query(
      `SELECT * FROM ledger_transactions WHERE id = $1`,
      [id]
    );

    if (txResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found"
      });
    }

    // 🟢 get entries
    const entriesResult = await pool.query(
      `SELECT account_id, type, amount, currency, metadata, created_at
       FROM ledger_entries
       WHERE transaction_id = $1`,
      [id]
    );

    return res.json({
      success: true,
      transaction: txResult.rows[0],
      entries: entriesResult.rows
    });

  } catch (error) {
    console.error("❌ Get transaction error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};