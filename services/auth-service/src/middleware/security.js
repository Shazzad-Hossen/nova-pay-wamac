const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const { randomUUID } = require('node:crypto');

const requestContext = () => (req, res, next) => {
  const incoming = req.header('x-correlation-id');
  const correlationId = incoming && String(incoming).trim() ? String(incoming).trim() : randomUUID();
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  next();
};

const requestLogger = (serviceName) => {
  morgan.token('cid', (req) => req.correlationId || '-');
  return morgan(
    '{"ts":":date[iso]","service":"' + serviceName + '","cid":":cid","method":":method","path":":url","status":":status","duration_ms":":response-time"}',
    {
      stream: {
        write: (line) => {
          console.log(line.trim());
        }
      }
    }
  );
};

const buildLimiter = ({ windowMs = 60 * 1000, max = 100 } = {}) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests' }
  });

const applySecurity = (app) => {
  app.use(requestContext());
  app.use(helmet());
  app.use(requestLogger('auth-service'));
  app.use('/api', buildLimiter({ windowMs: 60 * 1000, max: 600 }));
  app.use('/api/auth/login', buildLimiter({ windowMs: 60 * 1000, max: 30 }));
  app.use('/api/auth/refresh', buildLimiter({ windowMs: 60 * 1000, max: 60 }));
};

module.exports = { applySecurity };
