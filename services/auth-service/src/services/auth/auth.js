const { register, login, refresh, logout, validate, jwks } = require('./auth.entity');

function auth() {
  this.route.post('/auth/register', register(this));
  this.route.post('/auth/login', login(this));
  this.route.post('/auth/refresh', refresh(this));
  this.route.post('/auth/logout', logout(this));
  this.route.get('/auth/validate', validate(this));
  this.route.get('/auth/.well-known/jwks.json', jwks(this));
}

module.exports = auth;
