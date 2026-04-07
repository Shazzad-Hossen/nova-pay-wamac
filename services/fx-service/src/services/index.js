const health = require('./health/health');
const fx = require('./fx/fx');

module.exports = (app) => {
  app.configure(health);
  app.configure(fx);
};
