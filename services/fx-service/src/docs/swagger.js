const swaggerUi = require('swagger-ui-express');

const swaggerSpec = {
  openapi: '3.0.3',
  info: { title: 'FX Service API', version: '1.0.0' },
  servers: [{ url: '/api' }],
  paths: {
    '/health': { get: { summary: 'Health check', responses: { '200': { description: 'OK' } } } },
    '/fx/quote': { post: { summary: 'Create FX quote', responses: { '201': { description: 'Quote created' } } } },
    '/fx/convert': { post: { summary: 'Convert currency (quote or rate)', responses: { '200': { description: 'Converted' } } } }
  }
};

module.exports = { swaggerUi, swaggerSpec };
