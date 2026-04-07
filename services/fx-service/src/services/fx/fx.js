const { convertCurrency, createQuote } = require('./fx.entity');

function fx() {
  this.route.post('/fx/quote', createQuote(this));
  this.route.post('/fx/convert', convertCurrency(this));
}

module.exports = fx;
