const { Pool, Client } = require('pg');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
};

const DB_NAME = process.env.DB_NAME;

const pool = new Pool({
  ...dbConfig,
  database: DB_NAME,
});

const initDB = async () => {
  let client;

  try {
    console.log("🚀 Initializing DB...");

    // 🥇 Create DB if not exists
    const rootClient = new Client({
      ...dbConfig,
      database: 'postgres',
    });

    await rootClient.connect();

    const res = await rootClient.query(
      `SELECT 1 FROM pg_database WHERE datname=$1`,
      [DB_NAME]
    );

    if (res.rowCount === 0) {
      await rootClient.query(`CREATE DATABASE ${DB_NAME}`);
      console.log(`✅ Database ${DB_NAME} created`);
    } else {
      console.log(`ℹ️  Database ${DB_NAME} already exists`);
    }

    await rootClient.end();

    // 🥈 Connect to actual DB
    client = await pool.connect();

    await client.query('BEGIN');

    // extension
    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    // transactions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reference_id VARCHAR(100),
        type VARCHAR(50),
        status VARCHAR(20) DEFAULT 'COMPLETED',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // entries table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id UUID REFERENCES ledger_transactions(id),

        account_id VARCHAR(50) NOT NULL,

        type VARCHAR(10) CHECK (type IN ('DEBIT', 'CREDIT')),

        amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),

        currency VARCHAR(10) DEFAULT 'USD',

        metadata JSONB,

        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');

    return "✅ Database Successfully Initialized";

  } catch (err) {
    console.error("❌ DB init failed:", err.message);

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