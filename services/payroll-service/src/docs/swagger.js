const swaggerUi = require('swagger-ui-express');

const swaggerSpec = {
  openapi: '3.0.3',
  info: { title: 'Payroll Service API', version: '1.0.0' },
  servers: [{ url: '/api' }],
  paths: {
    '/health': { get: { summary: 'Health check', responses: { '200': { description: 'OK' } } } },
    '/payroll/run': { post: { summary: 'Run payroll batch', responses: { '202': { description: 'Accepted' } } } },
    '/payroll/run/{id}': { get: { summary: 'Get payroll run state', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Run state' } } } }
  }
};

module.exports = { swaggerUi, swaggerSpec };
