const safeJson = async (response) => {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
};

const fetchTransactions = async ({ settings, status, page, limit }) => {
  if (typeof fetch !== 'function') {
    return { success: false, statusCode: 500, message: 'Global fetch is not available' };
  }

  if (!settings.transactionServiceUrl) {
    return { success: false, statusCode: 503, message: 'Transaction service URL not configured' };
  }

  const query = new URLSearchParams();
  if (page) query.set('page', String(page));
  if (limit) query.set('limit', String(limit));

  const url = new URL(`/api/transactions/status/${status}?${query.toString()}`, settings.transactionServiceUrl);
  const response = await fetch(url, { method: 'GET' });
  const data = await safeJson(response);

  if (!response.ok) {
    return {
      success: false,
      statusCode: response.status,
      message: data && data.message ? data.message : 'Transaction service error',
      data
    };
  }

  return { success: true, statusCode: response.status, data };
};

const fetchLedgerStatus = async ({ settings }) => {
  if (typeof fetch !== 'function') {
    return { success: false, statusCode: 500, message: 'Global fetch is not available' };
  }

  if (!settings.ledgerServiceUrl) {
    return { success: false, statusCode: 503, message: 'Ledger service URL not configured' };
  }

  const url = new URL('/api/ledger/check', settings.ledgerServiceUrl);
  const response = await fetch(url, { method: 'GET' });
  const data = await safeJson(response);

  if (!response.ok) {
    return {
      success: false,
      statusCode: response.status,
      message: data && data.message ? data.message : 'Ledger service error',
      data
    };
  }

  return { success: true, statusCode: response.status, data };
};

const triggerTransactionRecovery = async ({ settings }) => {
  if (typeof fetch !== 'function') {
    return { success: false, statusCode: 500, message: 'Global fetch is not available' };
  }

  if (!settings.transactionServiceUrl) {
    return { success: false, statusCode: 503, message: 'Transaction service URL not configured' };
  }

  const url = new URL('/api/transactions/status/PENDING?limit=200', settings.transactionServiceUrl);
  const response = await fetch(url, { method: 'GET' });
  const data = await safeJson(response);

  if (!response.ok) {
    return {
      success: false,
      statusCode: response.status,
      message: data && data.message ? data.message : 'Transaction service error',
      data
    };
  }

  return {
    success: true,
    statusCode: 200,
    data: {
      message: 'Manual recovery scan requested (pending transactions fetched)',
      pendingCount: data && typeof data.count === 'number' ? data.count : 0,
      pendingTransactions: data && data.transactions ? data.transactions : []
    }
  };
};

module.exports = {
  fetchTransactions,
  fetchLedgerStatus,
  triggerTransactionRecovery
};
