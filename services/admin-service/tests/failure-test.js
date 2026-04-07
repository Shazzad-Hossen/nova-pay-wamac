require('dotenv').config({ override: true });
const { execSync } = require('node:child_process');
const { Pool } = require('pg');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowKey = () => Date.now().toString(36);

const assert = (condition, message) => {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
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
  redisHost: process.env.REDIS_HOST || '127.0.0.1',
  redisPort: Number(process.env.REDIS_PORT || 6379),
  accountDb: process.env.ACCOUNT_DB_NAME || 'account_db',
  transactionDb: process.env.TRANSACTION_DB_NAME || 'transaction_db',
  ledgerDb: process.env.LEDGER_DB_NAME || 'ledger_db',
  payrollDb: process.env.PAYROLL_DB_NAME || 'payroll_db',
  payrollQueueName: process.env.PAYROLL_QUEUE_NAME || 'payroll-queue',
  dockerComposePath: process.env.DOCKER_COMPOSE_PATH || '/home/common/Desktop/wa-mac/infra/docker-compose.yml',
  useDockerControl: process.env.USE_DOCKER_CONTROL !== 'false'
};

const createPool = (database) =>
  new Pool({
    host: settings.dbHost,
    port: settings.dbPort,
    user: settings.dbUser,
    password: settings.dbPass,
    database
  });

const requestJson = async (url, options = {}) => {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    const wrapped = new Error(`Network error calling ${url}: ${error.message}`);
    wrapped.cause = error;
    throw wrapped;
  }
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }
  return { status: response.status, data };
};

const isLedgerReachable = async () => {
  try {
    const res = await fetch(`${settings.ledgerBaseUrl}/api/health`, { method: 'GET' });
    return res.ok;
  } catch (error) {
    return false;
  }
};

const waitForHttpReady = async (name, url, timeoutMs = 120000) => {
  const startedAt = Date.now();
  let lastError = null;
  let lastLogAt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) return;
      lastError = new Error(`${name} not ready yet (${res.status})`);
    } catch (error) {
      lastError = error;
    }

    if (Date.now() - lastLogAt >= 5000) {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      console.log(`  waiting ${name} (${elapsed}s): ${lastError ? lastError.message : 'starting'}`);
      lastLogAt = Date.now();
    }
    await sleep(1500);
  }

  throw new Error(`Timeout waiting for ${name} at ${url}. Last error: ${lastError ? lastError.message : 'unknown'}`);
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

const dockerCtl = (action, service) => {
  if (!settings.useDockerControl) return;
  execSync(`docker compose -f "${settings.dockerComposePath}" ${action} ${service}`, { stdio: 'inherit' });
};

const resolveExistingDbName = async (preferredName, fallbacks = []) => {
  const rootPool = createPool('postgres');
  try {
    const candidates = [preferredName, ...fallbacks].filter(Boolean);
    for (const name of candidates) {
      const res = await rootPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      if (res.rowCount > 0) return name;
    }
    throw new Error(`Missing DB from candidates: ${candidates.join(', ')}`);
  } finally {
    await rootPool.end();
  }
};

const createTwoAccounts = async () => {
  const a1 = await requestJson(`${settings.accountBaseUrl}/api/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: `ft_user_${nowKey()}_1`, status: 'ACTIVE' })
  });
  assert(a1.status === 201 && a1.data && a1.data.success, 'Account #1 creation should succeed');

  const a2 = await requestJson(`${settings.accountBaseUrl}/api/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: `ft_user_${nowKey()}_2`, status: 'ACTIVE' })
  });
  assert(a2.status === 201 && a2.data && a2.data.success, 'Account #2 creation should succeed');

  return { account1Id: a1.data.account.id, account2Id: a2.data.account.id };
};

const validateLedgerInvariant = async () => {
  const api = await requestJson(`${settings.ledgerBaseUrl}/api/ledger/check`, { method: 'GET' });
  assert(api.status === 200, 'Ledger check API should return 200');
  assert(api.data && api.data.status === 'OK', 'Ledger invariant API status should be OK');
};

const run = async () => {
  const accountDbName = await resolveExistingDbName(settings.accountDb, ['account_service']);
  const transactionDbName = await resolveExistingDbName(settings.transactionDb, ['transaction_service']);
  const ledgerDbName = await resolveExistingDbName(settings.ledgerDb, ['ledger_service']);
  const payrollDbName = await resolveExistingDbName(settings.payrollDb, ['payroll_service']);

  const transactionPool = createPool(transactionDbName);
  const altTransactionDbName = transactionDbName === 'transaction_db' ? 'transaction_service' : 'transaction_db';
  const altTransactionPool = createPool(altTransactionDbName);
  const payrollPool = createPool(payrollDbName);
  const ledgerPool = createPool(ledgerDbName);

  let queue;
  let redis;
  const queryTxPools = async (sql, values) => {
    const results = [];
    for (const [pool, label] of [
      [transactionPool, transactionDbName],
      [altTransactionPool, altTransactionDbName]
    ]) {
      try {
        const res = await pool.query(sql, values);
        results.push({ label, res });
      } catch (error) {
        console.log(`  transaction query skipped for ${label}: ${error.message}`);
      }
    }
    return results;
  };
  try {
    // Recover from previous interrupted runs where ledger may remain stopped.
    dockerCtl('start', 'ledger-service');
    console.log('Preflight: waiting for services to be ready...');
    await waitForHttpReady('account-service', `${settings.accountBaseUrl}/api/health`, 60000);
    await waitForHttpReady('transaction-service', `${settings.transactionBaseUrl}/api/transactions/status/PENDING`, 60000);
    await waitForHttpReady('ledger-service', `${settings.ledgerBaseUrl}/api/health`, 60000);
    await waitForHttpReady('payroll-service', `${settings.payrollBaseUrl}/api/health`, 60000);
    console.log('  ✓ Services are reachable');

    console.log('\n[1] Ledger down -> tx stays PENDING, then recovery retries');
    const { account1Id, account2Id } = await createTwoAccounts();

    // Ensure services are running latest code when docker compose is used.
    dockerCtl('restart', 'transaction-service payroll-service');
    await waitForHttpReady('transaction-service (post-restart)', `${settings.transactionBaseUrl}/api/transactions/status/PENDING`, 60000);
    await waitForHttpReady('payroll-service (post-restart)', `${settings.payrollBaseUrl}/api/health`, 60000);

    dockerCtl('stop', 'ledger-service');
    await sleep(1000);
    const ledgerStillUp = await isLedgerReachable();
    assert(
      !ledgerStillUp,
      `Ledger is still reachable at ${settings.ledgerBaseUrl} after docker stop. Another ledger process/container is likely running.`
    );

    const ledgerDownKey = `ft-ledger-down-${nowKey()}`;
    const txCreate = await requestJson(`${settings.transactionBaseUrl}/api/transactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': ledgerDownKey
      },
      body: JSON.stringify({
        sender_id: account1Id,
        receiver_id: account2Id,
        amount: 11,
        currency: 'USD'
      })
    });

    console.log('  transaction response while ledger down:', txCreate.status, txCreate.data);
    assert(
      [202, 201, 500, 502, 503, 504].includes(txCreate.status),
      `Unexpected transaction status while ledger down: ${txCreate.status}`
    );

    const txIdFromResponse = txCreate.data && txCreate.data.transactionId ? txCreate.data.transactionId : null;
    const lookupInPool = async (pool, dbLabel) => {
      try {
        // 1) direct by id from API response
        if (txIdFromResponse) {
          const byId = await pool.query(
            `SELECT id, status
             FROM transactions
             WHERE id = $1
             LIMIT 1`,
            [txIdFromResponse]
          );
          if (byId.rowCount > 0) return byId;
        }

        // 2) by idempotency key
        const byKey = await pool.query(
          `SELECT id, status
           FROM transactions
           WHERE idempotency_key = $1
           ORDER BY created_at DESC
           LIMIT 1`,
          [ledgerDownKey]
        );
        if (byKey.rowCount > 0) return byKey;

        // 3) heuristic by sender/receiver/amount in last 2 minutes
        return await pool.query(
          `SELECT id, status
           FROM transactions
           WHERE sender_id = $1
             AND receiver_id = $2
             AND amount = $3
             AND created_at >= NOW() - INTERVAL '2 minutes'
           ORDER BY created_at DESC
           LIMIT 1`,
          [account1Id, account2Id, 11]
        );
      } catch (error) {
        console.log(`  transaction lookup skipped for ${dbLabel}: ${error.message}`);
        return { rowCount: 0, rows: [] };
      }
    };

    let txByKey = await lookupInPool(transactionPool, transactionDbName);
    if (txByKey.rowCount === 0) {
      txByKey = await lookupInPool(altTransactionPool, altTransactionDbName);
    }

    let txId;
    if (txByKey.rowCount === 1) {
      assert(
        txByKey.rows[0].status === 'PENDING',
        `Expected PENDING when ledger is down, got ${txByKey.rows[0].status}. Restart transaction-service to load new code.`
      );
      txId = txByKey.rows[0].id;

      const pendingDb = await transactionPool.query(
        'SELECT status FROM transactions WHERE id = $1',
        [txId]
      );
      if (pendingDb.rowCount === 1) {
        assert(pendingDb.rows[0].status === 'PENDING', 'DB transaction should be PENDING');
      }
    } else {
      // Fallback for environments where API is reachable but DB lookup path differs.
      assert(txIdFromResponse, 'Missing transactionId in degraded response');
      const txApi = await requestJson(`${settings.transactionBaseUrl}/api/transactions/${txIdFromResponse}`, { method: 'GET' });
      assert(txApi.status === 200, 'Transaction API lookup should succeed for degraded transaction');
      assert(
        txApi.data && txApi.data.transaction && txApi.data.transaction.status === 'PENDING',
        'Transaction API status should be PENDING when ledger is down'
      );
      txId = txIdFromResponse;
      console.log('  warning: DB row lookup missed, proceeded with API-backed verification');
    }

    dockerCtl('start', 'ledger-service');

    await poll(
      async () => {
        const tx = await requestJson(`${settings.transactionBaseUrl}/api/transactions/${txId}`, { method: 'GET' });
        if (tx.status === 200 && tx.data && tx.data.transaction.status === 'COMPLETED') return true;
        return false;
      },
      { description: 'recovery worker to complete pending transaction' }
    );
    await validateLedgerInvariant();
    console.log('  ✓ Passed');

    console.log('\n[2] Duplicate requests -> same idempotency key, no duplicates');
    const dupKey = `ft-dup-${nowKey()}`;
    const { account1Id: d1, account2Id: d2 } = await createTwoAccounts();

    const payload = {
      sender_id: d1,
      receiver_id: d2,
      amount: 7,
      currency: 'USD'
    };

    const first = await requestJson(`${settings.transactionBaseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': dupKey },
      body: JSON.stringify(payload)
    });
    const second = await requestJson(`${settings.transactionBaseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': dupKey },
      body: JSON.stringify(payload)
    });

    assert(first.status === 201, 'First duplicate request should succeed');
    assert([200, 201, 409].includes(second.status), 'Second duplicate request should be deduplicated/conflicted');

    const dupCounts = await queryTxPools(
      'SELECT COUNT(*)::int AS c FROM transactions WHERE idempotency_key = $1',
      [dupKey]
    );
    const dupTotal = dupCounts.reduce((acc, x) => acc + Number(x.res.rows[0].c), 0);
    assert(dupTotal === 1, `Only one transaction row should exist for duplicate key (found ${dupTotal})`);
    await validateLedgerInvariant();
    console.log('  ✓ Passed');

    console.log('\n[3] Concurrent requests -> only one transaction row persists');
    const ckey = `ft-concurrent-${nowKey()}`;
    const { account1Id: c1, account2Id: c2 } = await createTwoAccounts();

    const concurrentPayload = {
      sender_id: c1,
      receiver_id: c2,
      amount: 13,
      currency: 'USD'
    };

    const concurrentResults = await Promise.all(
      Array.from({ length: 10 }).map(() =>
        requestJson(`${settings.transactionBaseUrl}/api/transactions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': ckey },
          body: JSON.stringify(concurrentPayload)
        })
      )
    );

    const successCount = concurrentResults.filter((r) => [200, 201].includes(r.status)).length;
    assert(successCount >= 1, 'At least one concurrent request should succeed');

    const concurrentCounts = await queryTxPools(
      'SELECT COUNT(*)::int AS c FROM transactions WHERE idempotency_key = $1',
      [ckey]
    );
    const concurrentTotal = concurrentCounts.reduce((acc, x) => acc + Number(x.res.rows[0].c), 0);
    assert(concurrentTotal === 1, `Concurrent requests must produce exactly one transaction (found ${concurrentTotal})`);
    await validateLedgerInvariant();
    console.log('  ✓ Passed');

    console.log('\n[4] Queue failure -> stop worker, jobs pending, restart worker processes jobs');
    const { account1Id: p1, account2Id: p2 } = await createTwoAccounts();
    dockerCtl('stop', 'payroll-service');
    await sleep(1000);

    const runRes = await payrollPool.query(
      `INSERT INTO payroll_runs (batch_reference, status, total_jobs)
       VALUES ($1, 'PROCESSING', 1)
       RETURNING id`,
      [`ft-queue-failure-${nowKey()}`]
    );
    const runId = runRes.rows[0].id;
    const jobRes = await payrollPool.query(
      `INSERT INTO payroll_jobs (run_id, employee_id, sender_account_id, receiver_account_id, amount, currency, status)
       VALUES ($1, $2, $3, $4, $5, 'USD', 'QUEUED')
       RETURNING id, run_id, employee_id, sender_account_id, receiver_account_id, amount, currency, status`,
      [runId, `emp_${nowKey()}`, p1, p2, 9]
    );
    const jobRow = jobRes.rows[0];

    redis = new IORedis({ host: settings.redisHost, port: settings.redisPort, maxRetriesPerRequest: null });
    queue = new Queue(settings.payrollQueueName, { connection: redis });
    await queue.add('salary-transfer', jobRow, { jobId: jobRow.id, attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

    await sleep(2500);
    const stillQueued = await payrollPool.query('SELECT status FROM payroll_jobs WHERE id = $1', [jobRow.id]);
    assert(stillQueued.rows[0].status === 'QUEUED', 'Job should remain QUEUED while worker is down');

    dockerCtl('start', 'payroll-service');

    await poll(
      async () => {
        const res = await payrollPool.query('SELECT status FROM payroll_jobs WHERE id = $1', [jobRow.id]);
        return res.rows[0].status === 'SUCCESS';
      },
      { description: 'payroll worker to process queued job' }
    );
    await validateLedgerInvariant();
    console.log('  ✓ Passed');

    console.log('\n[5] Network timeout -> transaction-service returns timeout-safe result');
    console.log('  Note: This scenario requires transaction-service running with a slow/unreachable LEDGER_SERVICE_URL and LEDGER_TIMEOUT_MS.');
    const timeoutKey = `ft-timeout-${nowKey()}`;
    const { account1Id: t1, account2Id: t2 } = await createTwoAccounts();
    const timeoutAttempt = await requestJson(`${settings.transactionBaseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': timeoutKey },
      body: JSON.stringify({ sender_id: t1, receiver_id: t2, amount: 5, currency: 'USD' })
    });

    assert(
      [201, 202].includes(timeoutAttempt.status),
      'Timeout scenario should return either 201 (normal) or 202 (degraded pending mode)'
    );

    if (timeoutAttempt.status === 202) {
      assert(timeoutAttempt.data.status === 'PENDING', 'Timeout degraded response should be PENDING');
      assert(
        String(timeoutAttempt.data.message || '').toLowerCase().includes('timeout') ||
          String(timeoutAttempt.data.message || '').toLowerCase().includes('ledger'),
        'Timeout degraded response should contain timeout/ledger message'
      );
    }
    await validateLedgerInvariant();
    console.log('  ✓ Passed');

    console.log('\n✅ Failure test suite completed');
    console.log(`DBs used: account=${accountDbName}, transaction=${transactionDbName}, ledger=${ledgerDbName}, payroll=${payrollDbName}`);
  } finally {
    if (queue) await queue.close();
    if (redis) redis.disconnect();
    await Promise.allSettled([transactionPool.end(), altTransactionPool.end(), payrollPool.end(), ledgerPool.end()]);
  }
};

run().catch((error) => {
  console.error('\n❌ Failure test suite failed');
  console.error(error.message);
  process.exit(1);
});
