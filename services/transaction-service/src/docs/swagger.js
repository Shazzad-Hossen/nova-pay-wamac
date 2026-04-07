const swaggerUi = require('swagger-ui-express');

const swaggerSpec = {
  openapi: '3.0.3',
  info: { title: 'Transaction Service API', version: '1.0.0' },
  servers: [{ url: '/api' }],
  paths: {
    '/transactions': { post: { summary: 'Create transaction (idempotent)', responses: { '201': { description: 'Completed' }, '202': { description: 'Pending' } } } },
    '/transactions/{id}': { get: { summary: 'Get transaction by id', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Transaction' } } } },
    '/transactions/status/{status}': { get: { summary: 'List transactions by status', parameters: [{ name: 'status', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'List' } } } }
  }
};

module.exports = { swaggerUi, swaggerSpec };
