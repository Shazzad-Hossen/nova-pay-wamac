const STATUS = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED'
};

const allowedStatus = new Set(Object.values(STATUS));

const isValidUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const callLedgerBalance = async (settings, accountId) => {
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

  const url = new URL(`/api/ledger/balance/${accountId}`, settings.ledgerServiceUrl);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'content-type': 'application/json'
    }
  });

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
      message: data && data.message ? data.message : 'Ledger balance fetch failed',
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
  STATUS,
  allowedStatus,
  isValidUuid,
  callLedgerBalance
};
