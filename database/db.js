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
