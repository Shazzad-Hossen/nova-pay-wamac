const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
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
  morgan.token('uid', (req) => (req.user && req.user.sub ? req.user.sub : '-'));

  return morgan(
    '{"ts":":date[iso]","service":"' + serviceName + '","cid":":cid","uid":":uid","method":":method","path":":url","status":":status","duration_ms":":response-time"}',
    {
      stream: {
        write: (line) => {
          console.log(line.trim());
        }
      }
    }
  );
};

const authMiddleware = ({ publicPaths = [] } = {}) => (req, res, next) => {
  if (publicPaths.some((p) => req.path === p || req.path.startsWith(`${p}/`))) {
    return next();
  }

  const authHeader = req.header('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Missing bearer token' });
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ success: false, message: 'JWT secret is not configured' });
  }

  try {
    req.user = jwt.verify(token, secret);
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

const buildLimiter = ({ windowMs = 60 * 1000, max = 100 } = {}) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests' }
  });

const applySecurity = (app, { serviceName, sensitivePaths = [] }) => {
  app.use(requestContext());
  app.use(helmet());
  app.use(requestLogger(serviceName));

  app.use('/api', authMiddleware({ publicPaths: ['/health'] }));

  // Generic API limit
  app.use('/api', buildLimiter({ windowMs: 60 * 1000, max: 600 }));

  // Stricter limits for sensitive endpoints
  sensitivePaths.forEach((path) => {
    app.use(`/api${path}`, buildLimiter({ windowMs: 60 * 1000, max: 60 }));
  });
};

module.exports = {
  applySecurity
};
