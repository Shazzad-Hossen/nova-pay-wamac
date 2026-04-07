const health = require('./health/health');
const admin = require('./admin/admin');

module.exports = (app) => {
  app.configure(health);
  app.configure(admin);
};
