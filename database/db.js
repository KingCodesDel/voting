// database/db.js
// PostgreSQL connection pool (replaces the old SQLite/better-sqlite3 setup).
// Requires the DATABASE_URL environment variable to be set — on Render,
// this should be the Internal Database URL of your Postgres instance.

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Add it as an environment variable in your ' +
    'Render service settings (Environment tab) using your Postgres ' +
    'Internal Database URL.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render's managed Postgres requires SSL; this setting works for both
  // Render's internal and external connection strings.
  ssl: { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client', err);
});

// Runs schema.sql once at startup so tables exist. Safe to run every
// boot since every statement uses IF NOT EXISTS / ON CONFLICT.
async function initSchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
  console.log('✓ Database schema ready (PostgreSQL)');
}

// Thin query helper so route files can call db.query(...) directly.
async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query, initSchema };
