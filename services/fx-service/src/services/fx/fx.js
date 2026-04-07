const { convertCurrency } = require('./fx.entity');

function fx() {
  this.route.post('/fx/convert', convertCurrency(this));
}

module.exports = fx;
