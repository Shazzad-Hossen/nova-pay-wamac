const { Pool, Client } = require('pg');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS
};

const DB_NAME = process.env.DB_NAME;

const pool = new Pool({
  ...dbConfig,
  database: DB_NAME
});

const initDB = async () => {
  let client;

  try {
    console.log('🚀 Initializing DB...');

    const rootClient = new Client({
      ...dbConfig,
      database: 'postgres'
    });

    await rootClient.connect();

    const res = await rootClient.query(
      'SELECT 1 FROM pg_database WHERE datname=$1',
      [DB_NAME]
    );

    if (res.rowCount === 0) {
      await rootClient.query(`CREATE DATABASE ${DB_NAME}`);
      console.log(`✅ Database ${DB_NAME} created`);
    } else {
      console.log(`ℹ️  Database ${DB_NAME} already exists`);
    }

    await rootClient.end();

    client = await pool.connect();
    await client.query('BEGIN');

    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sender_id VARCHAR(50) NOT NULL,
        receiver_id VARCHAR(50) NOT NULL,
        amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
        currency VARCHAR(10) DEFAULT 'USD',
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        ledger_transaction_id UUID,
        idempotency_key VARCHAR(120),
        request_hash VARCHAR(64) NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_retry_at TIMESTAMP,
        next_retry_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS ledger_transaction_id UUID;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key VARCHAR(120) PRIMARY KEY,
        request_hash VARCHAR(64) NOT NULL,
        response JSONB,
        status VARCHAR(20) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query('CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at ON idempotency_keys (expires_at);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_transactions_sender_receiver ON transactions (sender_id, receiver_id);');

    await client.query('COMMIT');

    return '✅ Database Successfully Initialized';
  } catch (err) {
    console.error('❌ DB init failed:', err.message);

    if (client) {
      await client.query('ROLLBACK');
    }

    throw err;
  } finally {
    if (client) client.release();
  }
};

module.exports = {
  pool,
  initDB
};
