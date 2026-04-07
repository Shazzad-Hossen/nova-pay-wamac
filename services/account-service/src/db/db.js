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
      CREATE TABLE IF NOT EXISTS accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query('CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts (user_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts (status);');

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
