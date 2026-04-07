module.exports.configs = {
  port: process.env.PORT || 3004,
  origin: process.env.ORIGIN || '*',
  quoteTtlSeconds: Number(process.env.FX_QUOTE_TTL_SECONDS || 30)
};
