const { getTransactions, getLedgerStatus, triggerRecovery } = require('./admin.entity');

function admin() {
  this.route.get('/admin/transactions', getTransactions(this));
  this.route.get('/admin/ledger-status', getLedgerStatus(this));
  this.route.post('/admin/recovery', triggerRecovery(this));
}

module.exports = admin;
