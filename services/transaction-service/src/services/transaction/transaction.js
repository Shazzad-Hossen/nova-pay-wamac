const { createTransaction, listTransactionsByStatus, getTransactionById } = require('./transaction.entity');

function transaction() {
  this.route.post('/transactions', createTransaction(this));
  this.route.get('/transactions/status/:status', listTransactionsByStatus(this));
  this.route.get('/transactions/:id', getTransactionById(this));
}

module.exports = transaction;
