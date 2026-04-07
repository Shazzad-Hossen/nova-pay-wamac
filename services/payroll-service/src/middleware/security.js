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

const gatewayAuth = ({ publicPaths = [] } = {}) => (req, res, next) => {
  if (publicPaths.some((p) => req.path === p || req.path.startsWith(`${p}/`))) {
    return next();
  }

  const verified = req.header('x-auth-verified');
  const userId = req.header('x-user-id');
  const role = req.header('x-user-role');

  if (verified !== 'true' || !userId || !role) {
    return res.status(401).json({ success: false, message: 'Unauthorized (gateway auth required)' });
  }

  req.user = {
    sub: userId,
    role
  };

  return next();
};

const requireRole = (roles = []) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  return next();
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

  app.use('/api', gatewayAuth({ publicPaths: ['/health'] }));

  app.use('/api', buildLimiter({ windowMs: 60 * 1000, max: 600 }));

  sensitivePaths.forEach((path) => {
    app.use(`/api${path}`, buildLimiter({ windowMs: 60 * 1000, max: 60 }));
  });
};

module.exports = {
  applySecurity,
  requireRole
};
