const health = require('./health/health');
const auth = require('./auth/auth');

module.exports = (app) => {
  app.configure(health);
  app.configure(auth);
};
