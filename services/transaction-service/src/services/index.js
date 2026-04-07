const transaction = require('./transaction/transaction');

module.exports = (app) => {
  app.configure(transaction);
};
