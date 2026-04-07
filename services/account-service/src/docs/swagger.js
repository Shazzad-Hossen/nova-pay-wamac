const swaggerUi = require('swagger-ui-express');

const swaggerSpec = {
  openapi: '3.0.3',
  info: { title: 'Account Service API', version: '1.0.0' },
  servers: [{ url: '/api' }],
  paths: {
    '/health': { get: { summary: 'Health check', responses: { '200': { description: 'OK' } } } },
    '/accounts': { post: { summary: 'Create account', responses: { '201': { description: 'Created' } } } },
    '/accounts/{id}': { get: { summary: 'Get account by id', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Account' } } } },
    '/accounts/{id}/balance': { get: { summary: 'Get account balance', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Balance' } } } }
  }
};

module.exports = { swaggerUi, swaggerSpec };
