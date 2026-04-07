const crypto = require('node:crypto');

const normalizeObject = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeObject(item));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = normalizeObject(value[key]);
        return acc;
      }, {});
  }

  return value;
};

const hashRequest = (payload) => {
  const normalized = normalizeObject(payload);
  const json = JSON.stringify(normalized);
  return crypto.createHash('sha256').update(json).digest('hex');
};

const callLedgerService = async (settings, payload) => {
  if (typeof fetch !== 'function') {
    return {
      success: false,
      statusCode: 500,
      message: 'Global fetch is not available; use Node 18+ or provide a fetch polyfill'
    };
  }

  if (!settings.ledgerServiceUrl) {
    return {
      success: false,
      statusCode: 503,
      message: 'Ledger service URL not configured'
    };
  }

  const url = new URL('/api/ledger', settings.ledgerServiceUrl);

  const timeoutMs = Number(settings.ledgerTimeoutMs || 3000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error && error.name === 'AbortError') {
      return {
        success: false,
        statusCode: 504,
        message: `Ledger service timeout after ${timeoutMs}ms`
      };
    }

    return {
      success: false,
      statusCode: 502,
      message: 'Ledger service unreachable'
    };
  } finally {
    clearTimeout(timeout);
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    return {
      success: false,
      statusCode: response.status,
      message: data && data.message ? data.message : 'Ledger service error',
      data
    };
  }

  return {
    success: true,
    statusCode: response.status,
    data
  };
};

module.exports = {
  normalizeObject,
  hashRequest,
  callLedgerService
};
