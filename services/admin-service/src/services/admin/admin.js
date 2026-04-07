const { getTransactions, getLedgerStatus, triggerRecovery } = require('./admin.entity');
const { requireRole } = require('../../middleware/security');

function admin() {
  this.route.get('/admin/transactions', requireRole(['admin']), getTransactions(this));
  this.route.get('/admin/ledger-status', requireRole(['admin']), getLedgerStatus(this));
  this.route.post('/admin/recovery', requireRole(['admin']), triggerRecovery(this));
}

module.exports = admin;
