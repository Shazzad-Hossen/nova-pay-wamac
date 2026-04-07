const {
  fetchTransactions,
  fetchLedgerStatus,
  triggerTransactionRecovery
} = require('./admin.service');

module.exports.getTransactions = ({ pool, settings }) => async (req, res) => {
  try {
    const { status = 'PENDING', page = '1', limit = '50' } = req.query;

    const allowed = ['PENDING', 'FAILED', 'COMPLETED'];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of ${allowed.join(', ')}`
      });
    }

    const result = await fetchTransactions({
      settings,
      status,
      page: Number(page),
      limit: Number(limit)
    });

    if (!result.success) {
      return res.status(result.statusCode || 502).json({
        success: false,
        message: result.message || 'Failed to fetch transactions'
      });
    }

    return res.json({
      success: true,
      source: 'transaction-service',
      data: result.data
    });
  } catch (error) {
    console.error('❌ Admin get transactions error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports.getLedgerStatus = ({ settings }) => async (req, res) => {
  try {
    const result = await fetchLedgerStatus({ settings });

    if (!result.success) {
      return res.status(result.statusCode || 502).json({
        success: false,
        message: result.message || 'Failed to fetch ledger status'
      });
    }

    return res.json({
      success: true,
      source: 'ledger-service',
      data: result.data
    });
  } catch (error) {
    console.error('❌ Admin ledger status error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports.triggerRecovery = ({ pool, settings }) => async (req, res) => {
  try {
    const result = await triggerTransactionRecovery({ settings });

    const status = result.success ? 'SUCCESS' : 'FAILED';
    await pool.query(
      `INSERT INTO admin_actions (action, payload, status)
       VALUES ($1, $2, $3)`,
      ['MANUAL_RECOVERY', result.data || null, status]
    );

    if (!result.success) {
      return res.status(result.statusCode || 502).json({
        success: false,
        message: result.message || 'Failed to trigger recovery'
      });
    }

    return res.json({
      success: true,
      message: 'Manual recovery trigger completed',
      data: result.data
    });
  } catch (error) {
    console.error('❌ Admin trigger recovery error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
