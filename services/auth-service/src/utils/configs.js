module.exports.configs = {
  port: process.env.PORT || 3008,
  origin: process.env.ORIGIN || '*',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS || 7),
  jwtKid: process.env.JWT_KID || 'fintech-auth-v1'
};
