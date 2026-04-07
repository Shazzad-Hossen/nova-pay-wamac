const SUPPORTED_CURRENCY_REGEX = /^[A-Z]{3}$/;

const normalizeCurrency = (value) => {
  if (typeof value !== 'string') return null;
  return value.trim().toUpperCase();
};

const isValidCurrency = (currency) => SUPPORTED_CURRENCY_REGEX.test(currency);

const normalizeAmount = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num;
};

const roundFx = (value) => Math.round(value * 100000000) / 100000000;

module.exports = {
  normalizeCurrency,
  isValidCurrency,
  normalizeAmount,
  roundFx
};
