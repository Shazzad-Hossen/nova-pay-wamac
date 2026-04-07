const { healthCheck } = require('./health.entity');

function health() {
  this.route.get('/health', healthCheck(this));
}

module.exports = health;
