// database/db.js
// PostgreSQL connection pool (replaces the old SQLite/better-sqlite3 setup).
// Requires the DATABASE_URL environment variable to be set — on Render,
// this should be the Internal Database URL of your Postgres instance.

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
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

// If no admin account exists yet (e.g. first-ever boot against a fresh
// Postgres database), create one with a default username/password so you
// can log in. Change this password immediately after logging in — there
// is no "forgot password" flow, so treat this as a one-time bootstrap.
const DEFAULT_ADMIN_USERNAME = process.env.DEFAULT_ADMIN_USERNAME || 'daniel';
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'voting';

async function seedDefaultAdmin() {
  const { rows } = await pool.query('SELECT COUNT(*) AS count FROM admin_users');
  if (Number(rows[0].count) > 0) return; // an admin already exists, do nothing

  const passwordHash = bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 12);
  await pool.query(
    'INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)',
    [DEFAULT_ADMIN_USERNAME, passwordHash]
  );

  console.log(`✓ Default admin account created — username: "${DEFAULT_ADMIN_USERNAME}"`);
  console.log('  Please log in and change this password/username for production use.');
}

// Runs schema.sql once at startup so tables exist, then seeds a default
// admin account if the admin_users table is empty. Safe to run every boot
// since every schema statement uses IF NOT EXISTS / ON CONFLICT, and the
// admin seed only inserts when zero admins are found.
async function initSchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
  console.log('✓ Database schema ready (PostgreSQL)');
  await seedDefaultAdmin();
}

// Thin query helper so route files can call db.query(...) directly.
async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query, initSchema };
