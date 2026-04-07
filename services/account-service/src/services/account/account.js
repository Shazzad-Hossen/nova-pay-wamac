const { createAccount, getAccountById, getAccountBalance } = require('./account.entity');

function account() {
  this.route.post('/accounts', createAccount(this));
  this.route.get('/accounts/:id', getAccountById(this));
  this.route.get('/accounts/:id/balance', getAccountBalance(this));
}

module.exports = account;
