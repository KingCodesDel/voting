// routes/votes.js
// Public voting endpoints. This is the most security-sensitive part of the
// app: it must prevent duplicate votes per phone number per category,
// reject invalid input, and respect the admin's voting on/off + schedule
// settings.

const express = require('express');
const { db } = require('../database/db');
const { voteLimiter } = require('../middleware/rateLimiter');
const { isValidPhoneNumber, normalizePhoneNumber, isPositiveInteger } = require('../middleware/validators');

const router = express.Router();

function getSettings() {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get();
}

// Determine whether voting is currently open, factoring in the manual
// enable/disable toggle AND an optional scheduled start/end window.
function isVotingOpen(settings) {
  if (!settings.voting_enabled) return false;
  const now = new Date();
  if (settings.voting_start && now < new Date(settings.voting_start)) return false;
  if (settings.voting_end && now > new Date(settings.voting_end)) return false;
  return true;
}

// GET /api/votes/status - is voting currently open? used by frontend to
// show/hide the vote buttons and drive the countdown timer.
router.get('/status', (req, res) => {
  const settings = getSettings();
  res.json({
    voting_enabled: !!settings.voting_enabled,
    voting_open: isVotingOpen(settings),
    voting_start: settings.voting_start,
    voting_end: settings.voting_end
  });
});

// GET /api/votes/my-votes?phone=... - returns which categories this phone
// number has already voted in, so the frontend can lock those categories
// even after a refresh or on a different device.
router.get('/my-votes', (req, res) => {
  const { phone } = req.query;
  if (!isValidPhoneNumber(phone || '')) {
    return res.status(400).json({ error: 'A valid phone number is required.' });
  }
  const normalized = normalizePhoneNumber(phone);
  const rows = db.prepare(
    'SELECT category_id, nominee_id, voted_at FROM votes WHERE phone_number = ?'
  ).all(normalized);
  res.json({ votes: rows });
});

// POST /api/votes - cast a vote.
// Body: { phone, category_id, nominee_id }
router.post('/', voteLimiter, (req, res) => {
  const settings = getSettings();
  if (!isVotingOpen(settings)) {
    return res.status(403).json({ error: 'Voting is currently closed.' });
  }

  const { phone, category_id, nominee_id } = req.body;

  if (!isValidPhoneNumber(phone || '')) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }
  if (!isPositiveInteger(category_id) || !isPositiveInteger(nominee_id)) {
    return res.status(400).json({ error: 'Invalid category or nominee selection.' });
  }

  const normalizedPhone = normalizePhoneNumber(phone);

  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(category_id);
  if (!category) return res.status(400).json({ error: 'Category does not exist.' });

  const nominee = db.prepare('SELECT * FROM nominees WHERE id = ? AND category_id = ?').get(nominee_id, category_id);
  if (!nominee) return res.status(400).json({ error: 'Nominee does not belong to this category.' });

  // Transaction: register the voter (idempotent) and insert the vote.
  // The UNIQUE(phone_number, category_id) constraint on `votes` is the
  // real source of truth preventing duplicate votes — this holds even
  // under concurrent requests, refreshes, or votes from another device.
  const castVote = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO voters (phone_number) VALUES (?)').run(normalizedPhone);

    const alreadyVoted = db.prepare(
      'SELECT id FROM votes WHERE phone_number = ? AND category_id = ?'
    ).get(normalizedPhone, category_id);

    if (alreadyVoted) {
      const err = new Error('ALREADY_VOTED');
      throw err;
    }

    db.prepare(
      'INSERT INTO votes (phone_number, category_id, nominee_id) VALUES (?, ?, ?)'
    ).run(normalizedPhone, category_id, nominee_id);
  });

  try {
    castVote();
  } catch (e) {
    if (e.message === 'ALREADY_VOTED' || (e.code && e.code === 'SQLITE_CONSTRAINT_UNIQUE')) {
      return res.status(409).json({ error: 'This phone number has already voted in this category.' });
    }
    console.error(e);
    return res.status(500).json({ error: 'Something went wrong while casting your vote. Please try again.' });
  }

  res.status(201).json({ success: true, message: `Your vote for "${nominee.name}" has been recorded!` });
});

module.exports = router;
