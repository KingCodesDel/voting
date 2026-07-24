-- ============================================================
-- Awards Voting Platform - Database Schema (SQLite)
-- ============================================================

-- Admin users who can log into the dashboard
CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Award categories (e.g. "Best Actor", "Best Song")
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Nominees, each belonging to one category
CREATE TABLE IF NOT EXISTS nominees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    bio TEXT DEFAULT '',
    photo_url TEXT DEFAULT '',
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Registered voter phone numbers (uniqueness enforced globally)
CREATE TABLE IF NOT EXISTS voters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number TEXT NOT NULL UNIQUE,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Votes cast. A voter may cast at most ONE vote PER CATEGORY
-- (enforced by the UNIQUE(phone_number, category_id) constraint),
-- and can never change that vote once cast.
CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    nominee_id INTEGER NOT NULL REFERENCES nominees(id) ON DELETE CASCADE,
    voted_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(phone_number, category_id)
);

-- Single-row settings table controlling event-wide configuration
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    event_name TEXT NOT NULL DEFAULT 'Annual Awards Night',
    event_description TEXT NOT NULL DEFAULT 'Vote for your favorite nominees!',
    event_date TEXT DEFAULT '',
    logo_url TEXT DEFAULT '',
    primary_color TEXT NOT NULL DEFAULT '#6366f1',
    voting_enabled INTEGER NOT NULL DEFAULT 1,
    voting_start TEXT DEFAULT NULL,
    voting_end TEXT DEFAULT NULL,
    -- When enabled, only phone numbers present in eligible_voters may vote.
    -- Off by default so existing events are unaffected.
    restrict_to_eligible_voters INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO settings (id) VALUES (1);

-- Optional allowlist of phone numbers permitted to vote, used only when
-- settings.restrict_to_eligible_voters = 1. Populated by the admin
-- (e.g. from a list of ticket holders or registered attendees).
CREATE TABLE IF NOT EXISTS eligible_voters (
    phone_number TEXT PRIMARY KEY,
    note TEXT DEFAULT '',
    added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_nominees_category ON nominees(category_id);
CREATE INDEX IF NOT EXISTS idx_votes_category ON votes(category_id);
CREATE INDEX IF NOT EXISTS idx_votes_nominee ON votes(nominee_id);
CREATE INDEX IF NOT EXISTS idx_votes_phone ON votes(phone_number);
