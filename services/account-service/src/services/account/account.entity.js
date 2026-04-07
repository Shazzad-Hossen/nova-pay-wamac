const { STATUS, allowedStatus, isValidUuid, callLedgerBalance } = require('./account.service');

module.exports.createAccount = ({ pool }) => async (req, res) => {
  let client;

  try {
    const { user_id: userId, status = STATUS.ACTIVE } = req.body;

    if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'user_id is required'
      });
    }

    if (!allowedStatus.has(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of ${Array.from(allowedStatus).join(', ')}`
      });
    }

    client = await pool.connect();
    await client.query('BEGIN');

    const insertRes = await client.query(
      `INSERT INTO accounts (user_id, status)
       VALUES ($1, $2)
       RETURNING id, user_id, status, created_at`,
      [userId.trim(), status]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      account: insertRes.rows[0]
    });
  } catch (error) {
    console.error('❌ Create account error:', error);

    if (client) {
      await client.query('ROLLBACK');
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  } finally {
    if (client) client.release();
  }
};

module.exports.getAccountById = ({ pool }) => async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !isValidUuid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Valid account id is required'
      });
    }

    const result = await pool.query(
      `SELECT id, user_id, status, created_at
       FROM accounts
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    return res.json({
      success: true,
      account: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Get account error:', error);

    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports.getAccountBalance = ({ pool, settings }) => async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !isValidUuid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Valid account id is required'
      });
    }

    const accountRes = await pool.query(
      `SELECT id, user_id, status
       FROM accounts
       WHERE id = $1`,
      [id]
    );

    if (accountRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    const ledgerResult = await callLedgerBalance(settings, id);

    if (!ledgerResult.success) {
      return res.status(ledgerResult.statusCode || 502).json({
        success: false,
        message: ledgerResult.message || 'Failed to fetch ledger balance'
      });
    }

    return res.json({
      success: true,
      account: accountRes.rows[0],
      balance: ledgerResult.data && ledgerResult.data.balance ? ledgerResult.data.balance : '0'
    });
  } catch (error) {
    console.error('❌ Get account balance error:', error);

    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
