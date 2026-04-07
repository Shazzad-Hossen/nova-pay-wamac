const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createHash, randomBytes, createPublicKey } = require('node:crypto');

const hashRefreshToken = (token) =>
  createHash('sha256').update(token).digest('hex');

const normalizePem = (value) => (value ? String(value).replace(/\\n/g, '\n') : null);

const getJwtKeys = () => {
  const privateKey = normalizePem(process.env.AUTH_PRIVATE_KEY);
  const publicKey = normalizePem(process.env.AUTH_PUBLIC_KEY);
  if (!privateKey || !publicKey) {
    throw new Error('AUTH_PRIVATE_KEY and AUTH_PUBLIC_KEY are required');
  }
  return { privateKey, publicKey };
};

const getJwks = ({ kid = 'fintech-auth-v1' } = {}) => {
  const { publicKey } = getJwtKeys();
  const keyObject = createPublicKey(publicKey);
  const jwk = keyObject.export({ format: 'jwk' });
  return {
    keys: [
      {
        kty: 'RSA',
        kid,
        use: 'sig',
        alg: 'RS256',
        n: jwk.n,
        e: jwk.e
      }
    ]
  };
};

const issueAccessToken = ({ userId, role, settings }) => {
  const { privateKey } = getJwtKeys();
  return jwt.sign({ sub: userId, role }, privateKey, {
    algorithm: 'RS256',
    expiresIn: settings.accessTokenTtl,
    keyid: settings.jwtKid
  });
};

const issueRefreshToken = () => randomBytes(64).toString('hex');

const buildRefreshExpiry = ({ settings }) => {
  const days = Number(settings.refreshTokenDays || 7);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
};

const verifyAccessToken = (token) => {
  const { publicKey } = getJwtKeys();
  return jwt.verify(token, publicKey, { algorithms: ['RS256'] });
};

const comparePassword = (plain, hash) => bcrypt.compare(plain, hash);
const hashPassword = (plain) => bcrypt.hash(plain, 12);

module.exports = {
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  buildRefreshExpiry,
  verifyAccessToken,
  getJwks,
  comparePassword,
  hashPassword
};
