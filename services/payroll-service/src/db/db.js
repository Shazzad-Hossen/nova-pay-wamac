const { Pool, Client } = require('pg');
require('dotenv').config({ override: true });

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
    const res = await rootClient.query('SELECT 1 FROM pg_database WHERE datname=$1', [DB_NAME]);

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
      CREATE TABLE IF NOT EXISTS payroll_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_reference VARCHAR(120) NOT NULL UNIQUE,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
        total_jobs INTEGER NOT NULL CHECK (total_jobs > 0),
        successful_jobs INTEGER NOT NULL DEFAULT 0,
        failed_jobs INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
        employee_id VARCHAR(120) NOT NULL,
        sender_account_id VARCHAR(120) NOT NULL,
        receiver_account_id VARCHAR(120) NOT NULL,
        amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
        currency VARCHAR(10) NOT NULL DEFAULT 'USD',
        status VARCHAR(20) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'PROCESSING', 'SUCCESS', 'FAILED')),
        attempts INTEGER NOT NULL DEFAULT 0,
        transaction_id UUID,
        failure_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query('CREATE INDEX IF NOT EXISTS idx_payroll_jobs_run_id ON payroll_jobs (run_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_payroll_jobs_status ON payroll_jobs (status);');

    await client.query('COMMIT');
    return '✅ Database Successfully Initialized';
  } catch (err) {
    console.error('❌ DB init failed:', err.message);
    if (client) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (client) client.release();
  }
};

module.exports = {
  pool,
  initDB
};
