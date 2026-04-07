const swaggerUi = require('swagger-ui-express');

const swaggerSpec = {
  openapi: '3.0.3',
  info: { title: 'Admin Service API', version: '1.0.0' },
  servers: [{ url: '/api' }],
  paths: {
    '/health': { get: { summary: 'Health check', responses: { '200': { description: 'OK' } } } },
    '/admin/transactions': { get: { summary: 'View transactions (admin)', responses: { '200': { description: 'Transactions' } } } },
    '/admin/ledger-status': { get: { summary: 'View ledger status (admin)', responses: { '200': { description: 'Ledger status' } } } },
    '/admin/recovery': { post: { summary: 'Trigger manual recovery (admin)', responses: { '200': { description: 'Triggered' } } } }
  }
};

module.exports = { swaggerUi, swaggerSpec };
