// database/db.js
// Sets up the SQLite connection, runs the schema, and seeds the default admin.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'voting.db');

const db = new Database(DB_PATH);

// Pragmas for safety + performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  // Lightweight migration: if this DB was created before the eligible-
  // voters feature existed, the settings table won't have the new column
  // yet (CREATE TABLE IF NOT EXISTS doesn't alter existing tables).
  const columns = db.prepare("PRAGMA table_info(settings)").all().map(c => c.name);
  if (!columns.includes('restrict_to_eligible_voters')) {
    db.exec('ALTER TABLE settings ADD COLUMN restrict_to_eligible_voters INTEGER NOT NULL DEFAULT 0');
    console.log('✔ Migrated settings table: added restrict_to_eligible_voters column');
  }

  // Create a default admin account only if none exists yet.
  const existing = db.prepare('SELECT COUNT(*) AS count FROM admin_users').get();
  if (existing.count === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
    const hash = bcrypt.hashSync(password, 12);
    db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)')
      .run(username, hash);
    console.log(`✔ Default admin account created — username: "${username}"`);
    console.log('  Please log in and change this password/username setup for production use.');
  }
}

module.exports = { db, initDatabase };
