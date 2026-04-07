const swaggerUi = require('swagger-ui-express');

const swaggerSpec = {
  openapi: '3.0.3',
  info: { title: 'Auth Service API', version: '1.0.0' },
  servers: [{ url: '/api' }],
  paths: {
    '/health': { get: { summary: 'Health check', responses: { '200': { description: 'OK' } } } },
    '/auth/register': { post: { summary: 'Register user', responses: { '201': { description: 'Registered' } } } },
    '/auth/login': { post: { summary: 'Login and issue tokens', responses: { '200': { description: 'Tokens issued' } } } },
    '/auth/refresh': { post: { summary: 'Refresh token with rotation', responses: { '200': { description: 'Tokens refreshed' } } } },
    '/auth/logout': { post: { summary: 'Logout (invalidate refresh token)', responses: { '200': { description: 'Logged out' } } } },
    '/auth/validate': { get: { summary: 'Gateway token validation endpoint', responses: { '200': { description: 'Valid token' } } } },
    '/auth/.well-known/jwks.json': { get: { summary: 'JWKS public keys', responses: { '200': { description: 'JWKS' } } } }
  }
};

module.exports = { swaggerUi, swaggerSpec };
