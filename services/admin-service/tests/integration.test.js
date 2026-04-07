require('dotenv').config({ override: true });
const { Pool } = require('pg');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
};

const settings = {
  accountBaseUrl: process.env.ACCOUNT_SERVICE_URL || 'http://localhost:3003',
  transactionBaseUrl: process.env.TRANSACTION_SERVICE_URL || 'http://localhost:3002',
  ledgerBaseUrl: process.env.LEDGER_SERVICE_URL || 'http://localhost:3001',
  payrollBaseUrl: process.env.PAYROLL_SERVICE_URL || 'http://localhost:3005',
  dbHost: process.env.DB_HOST || '127.0.0.1',
  dbPort: Number(process.env.DB_PORT || 5433),
  dbUser: process.env.DB_USER || 'postgres',
  dbPass: process.env.DB_PASS || 'postgres',
  accountDb: process.env.ACCOUNT_DB_NAME || 'account_db',
  transactionDb: process.env.TRANSACTION_DB_NAME || 'transaction_db',
  ledgerDb: process.env.LEDGER_DB_NAME || 'ledger_db',
  payrollDb: process.env.PAYROLL_DB_NAME || 'payroll_db'
};

const createPool = (database) =>
  new Pool({
    host: settings.dbHost,
    port: settings.dbPort,
    user: settings.dbUser,
    password: settings.dbPass,
    database
  });

const resolveExistingDbName = async (preferredName, fallbacks = []) => {
  const rootPool = createPool('postgres');
  try {
    const candidates = [preferredName, ...fallbacks].filter(Boolean);
    for (const name of candidates) {
      const res = await rootPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      if (res.rowCount > 0) {
        return name;
      }
    }

    throw new Error(
      `None of the databases exist: ${candidates.join(', ')}. Start services first so they initialize DBs.`
    );
  } finally {
    await rootPool.end();
  }
};

const requestJson = async (url, options = {}, expectedStatus = null) => {
  const response = await fetch(url, options);
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (expectedStatus !== null) {
    assert(
      response.status === expectedStatus,
      `Expected ${expectedStatus} from ${url}, got ${response.status} with body ${JSON.stringify(data)}`
    );
  }

  return { status: response.status, data };
};

const poll = async (fn, { timeoutMs = 120000, intervalMs = 2000, description }) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(intervalMs);
  }

  throw new Error(`Timeout while waiting for: ${description}`);
};

const getBalanceFromLedgerDb = async (ledgerPool, accountId) => {
  const res = await ledgerPool.query(
    `SELECT COALESCE(SUM(CASE WHEN type='CREDIT' THEN amount ELSE -amount END), 0) AS balance
     FROM ledger_entries
     WHERE account_id = $1`,
    [accountId]
  );
  return Number(res.rows[0].balance);
};

const run = async () => {
  const accountDbName = await resolveExistingDbName(settings.accountDb, ['account_service']);
  const transactionDbName = await resolveExistingDbName(settings.transactionDb, ['transaction_service']);
  const ledgerDbName = await resolveExistingDbName(settings.ledgerDb, ['ledger_service']);
  const payrollDbName = await resolveExistingDbName(settings.payrollDb, ['payroll_service']);

  const accountPool = createPool(accountDbName);
  const transactionPool = createPool(transactionDbName);
  const ledgerPool = createPool(ledgerDbName);
  const payrollPool = createPool(payrollDbName);

  const cleanup = async () => {
    await Promise.allSettled([
      accountPool.end(),
      transactionPool.end(),
      ledgerPool.end(),
      payrollPool.end()
    ]);
  };

  try {
    console.log('Step 1: Create account #1');
    const createAccount1 = await requestJson(
      `${settings.accountBaseUrl}/api/accounts`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: `integration_user_${Date.now()}_1`, status: 'ACTIVE' })
      },
      201
    );
    assert(createAccount1.data && createAccount1.data.success === true, 'Account #1 response success should be true');
    const account1Id = createAccount1.data.account.id;

    const accountDbCheck1 = await accountPool.query('SELECT id, status FROM accounts WHERE id = $1', [account1Id]);
    assert(accountDbCheck1.rowCount === 1, 'Account #1 should exist in account_db');
    assert(accountDbCheck1.rows[0].status === 'ACTIVE', 'Account #1 should be ACTIVE');

    console.log('Step 2: Create account #2');
    const createAccount2 = await requestJson(
      `${settings.accountBaseUrl}/api/accounts`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: `integration_user_${Date.now()}_2`, status: 'ACTIVE' })
      },
      201
    );
    assert(createAccount2.data && createAccount2.data.success === true, 'Account #2 response success should be true');
    const account2Id = createAccount2.data.account.id;

    const accountDbCheck2 = await accountPool.query('SELECT id FROM accounts WHERE id = $1', [account2Id]);
    assert(accountDbCheck2.rowCount === 1, 'Account #2 should exist in account_db');

    console.log('Step 3: Create transaction');
    const idempotencyKey = `itx-${Date.now()}`;
    const createTx = await requestJson(
      `${settings.transactionBaseUrl}/api/transactions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey
        },
        body: JSON.stringify({
          sender_id: account1Id,
          receiver_id: account2Id,
          amount: 100,
          currency: 'USD'
        })
      },
      201
    );

    assert(createTx.data && createTx.data.success === true, 'Transaction create should succeed');
    const transactionId = createTx.data.transactionId;
    const ledgerTransactionId = createTx.data.ledgerTransactionId;

    console.log('Step 4: Verify transaction status');
    const txStatusRes = await requestJson(
      `${settings.transactionBaseUrl}/api/transactions/${transactionId}`,
      { method: 'GET' },
      200
    );
    assert(txStatusRes.data.transaction.status === 'COMPLETED', 'Transaction status should be COMPLETED');

    const txDbRes = await transactionPool.query(
      'SELECT id, status, ledger_transaction_id FROM transactions WHERE id = $1',
      [transactionId]
    );
    assert(txDbRes.rowCount === 1, 'Transaction should exist in transaction_db');
    assert(txDbRes.rows[0].status === 'COMPLETED', 'DB transaction status should be COMPLETED');
    assert(txDbRes.rows[0].ledger_transaction_id, 'DB ledger_transaction_id should be present');

    console.log('Step 5: Verify ledger entries');
    const ledgerTxRes = await ledgerPool.query(
      'SELECT id FROM ledger_transactions WHERE reference_id = $1',
      [transactionId]
    );
    assert(ledgerTxRes.rowCount === 1, 'Ledger transaction should exist by reference_id');
    const actualLedgerTxId = ledgerTxRes.rows[0].id;
    assert(
      !ledgerTransactionId || actualLedgerTxId === ledgerTransactionId,
      'Returned ledgerTransactionId should match ledger DB'
    );

    const ledgerEntriesRes = await ledgerPool.query(
      `SELECT account_id, type, amount
       FROM ledger_entries
       WHERE transaction_id = $1`,
      [actualLedgerTxId]
    );
    assert(ledgerEntriesRes.rowCount === 2, 'Ledger should have exactly 2 entries for transaction');

    const hasDebit = ledgerEntriesRes.rows.some((row) => row.account_id === account1Id && row.type === 'DEBIT');
    const hasCredit = ledgerEntriesRes.rows.some((row) => row.account_id === account2Id && row.type === 'CREDIT');
    assert(hasDebit, 'Ledger should contain sender DEBIT entry');
    assert(hasCredit, 'Ledger should contain receiver CREDIT entry');

    console.log('Step 6: Verify balance correctness + invariant');
    const account1BalanceApi = await requestJson(
      `${settings.accountBaseUrl}/api/accounts/${account1Id}/balance`,
      { method: 'GET' },
      200
    );
    const account2BalanceApi = await requestJson(
      `${settings.accountBaseUrl}/api/accounts/${account2Id}/balance`,
      { method: 'GET' },
      200
    );

    const account1BalanceDb = await getBalanceFromLedgerDb(ledgerPool, account1Id);
    const account2BalanceDb = await getBalanceFromLedgerDb(ledgerPool, account2Id);

    assert(Number(account1BalanceApi.data.balance) === account1BalanceDb, 'Account #1 API balance should match ledger DB');
    assert(Number(account2BalanceApi.data.balance) === account2BalanceDb, 'Account #2 API balance should match ledger DB');
    assert(account1BalanceDb === -100, 'Account #1 should be -100 after transfer');
    assert(account2BalanceDb === 100, 'Account #2 should be +100 after transfer');

    const invariantApi = await requestJson(`${settings.ledgerBaseUrl}/api/ledger/check`, { method: 'GET' }, 200);
    assert(invariantApi.data.status === 'OK', 'Ledger invariant API should be OK');

    const invariantDb = await ledgerPool.query(`
      SELECT transaction_id
      FROM ledger_entries
      GROUP BY transaction_id
      HAVING SUM(CASE WHEN type='DEBIT' THEN amount ELSE -amount END) != 0
    `);
    assert(invariantDb.rowCount === 0, 'No imbalanced ledger transactions should exist');

    console.log('Step 7: Run payroll');
    const batchRef = `it-batch-${Date.now()}`;
    const runPayrollRes = await requestJson(
      `${settings.payrollBaseUrl}/api/payroll/run`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          batch_reference: batchRef,
          jobs: [
            {
              employee_id: 'emp-it-001',
              sender_account_id: account1Id,
              receiver_account_id: account2Id,
              amount: 25,
              currency: 'USD'
            }
          ]
        })
      },
      202
    );
    assert(runPayrollRes.data.success === true, 'Payroll run should be accepted');
    const runId = runPayrollRes.data.runId;

    console.log('Step 8: Verify queue processed');
    const runState = await poll(
      async () => {
        const runApi = await requestJson(`${settings.payrollBaseUrl}/api/payroll/run/${runId}`, { method: 'GET' }, 200);
        const status = runApi.data.run.status;
        if (status === 'COMPLETED' || status === 'FAILED') return runApi.data;
        return null;
      },
      { description: 'payroll run completion' }
    );

    assert(runState.run.status === 'COMPLETED', `Payroll run should be COMPLETED, got ${runState.run.status}`);
    assert(runState.jobs.length === 1, 'Payroll should contain exactly one job');
    assert(runState.jobs[0].status === 'SUCCESS', 'Payroll job should be SUCCESS');
    assert(runState.jobs[0].transaction_id, 'Payroll job should have transaction_id');

    const payrollDbRun = await payrollPool.query(
      'SELECT status, successful_jobs, failed_jobs FROM payroll_runs WHERE id = $1',
      [runId]
    );
    assert(payrollDbRun.rowCount === 1, 'Payroll run should exist in payroll_db');
    assert(payrollDbRun.rows[0].status === 'COMPLETED', 'Payroll DB run status should be COMPLETED');
    assert(Number(payrollDbRun.rows[0].successful_jobs) === 1, 'Payroll DB successful_jobs should be 1');
    assert(Number(payrollDbRun.rows[0].failed_jobs) === 0, 'Payroll DB failed_jobs should be 0');

    console.log('Step 9: Verify ledger updated by payroll');
    const payrollTxId = runState.jobs[0].transaction_id;
    const payrollTxDb = await transactionPool.query('SELECT status FROM transactions WHERE id = $1', [payrollTxId]);
    assert(payrollTxDb.rowCount === 1, 'Payroll transaction should exist in transaction_db');
    assert(payrollTxDb.rows[0].status === 'COMPLETED', 'Payroll transaction status should be COMPLETED');

    const payrollLedgerTx = await ledgerPool.query(
      'SELECT id FROM ledger_transactions WHERE reference_id = $1',
      [payrollTxId]
    );
    assert(payrollLedgerTx.rowCount === 1, 'Payroll ledger transaction should exist');

    const payrollLedgerEntries = await ledgerPool.query(
      'SELECT account_id, type, amount FROM ledger_entries WHERE transaction_id = $1',
      [payrollLedgerTx.rows[0].id]
    );
    assert(payrollLedgerEntries.rowCount === 2, 'Payroll ledger transaction should have 2 entries');

    const finalBalance1 = await getBalanceFromLedgerDb(ledgerPool, account1Id);
    const finalBalance2 = await getBalanceFromLedgerDb(ledgerPool, account2Id);
    assert(finalBalance1 === -125, `Final account #1 balance should be -125, got ${finalBalance1}`);
    assert(finalBalance2 === 125, `Final account #2 balance should be 125, got ${finalBalance2}`);

    const finalInvariantApi = await requestJson(`${settings.ledgerBaseUrl}/api/ledger/check`, { method: 'GET' }, 200);
    assert(finalInvariantApi.data.status === 'OK', 'Final ledger invariant should be OK');

    console.log('\n✅ Full integration test passed');
    console.log(`DBs: account=${accountDbName}, transaction=${transactionDbName}, ledger=${ledgerDbName}, payroll=${payrollDbName}`);
    console.log(`Accounts: ${account1Id}, ${account2Id}`);
    console.log(`Transaction: ${transactionId}`);
    console.log(`Payroll run: ${runId}`);
  } finally {
    await cleanup();
  }
};

run().catch((error) => {
  console.error('\n❌ Integration test failed');
  console.error(error.message);
  process.exit(1);
});
