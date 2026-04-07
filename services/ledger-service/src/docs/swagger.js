const swaggerUi = require('swagger-ui-express');

const swaggerSpec = {
  openapi: '3.0.3',
  info: { title: 'Ledger Service API', version: '1.0.0' },
  servers: [{ url: '/api' }],
  paths: {
    '/health': { get: { summary: 'Health check', responses: { '200': { description: 'OK' } } } },
    '/ledger': { post: { summary: 'Create double-entry transfer', responses: { '201': { description: 'Created' } } } },
    '/ledger/check': { get: { summary: 'Check ledger invariant', responses: { '200': { description: 'Balanced' } } } },
    '/ledger/audit/check': { get: { summary: 'Verify audit hash chain', responses: { '200': { description: 'Chain valid' } } } },
    '/ledger/balance/{accountId}': { get: { summary: 'Get account balance', parameters: [{ name: 'accountId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Balance' } } } },
    '/ledger/transaction/{id}': { get: { summary: 'Get transaction entries', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Entries' } } } }
  }
};

module.exports = { swaggerUi, swaggerSpec };
