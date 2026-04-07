const health = require('./health/health');
const account = require('./account/account');

module.exports = (app) => {
  app.configure(health);
  app.configure(account);
};
