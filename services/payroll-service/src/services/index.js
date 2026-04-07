const health = require('./health/health');
const payroll = require('./payroll/payroll');

module.exports = (app) => {
  app.configure(health);
  app.configure(payroll);
};
