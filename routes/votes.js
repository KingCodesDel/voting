// routes/votes.js
// Public voting endpoints. This is the most security-sensitive part of the
// app: it must prevent duplicate votes per phone number per category,
// reject invalid input, and respect the admin's voting on/off + schedule
// settings.
//
// Rewritten to use PostgreSQL (async/await + parameterized $1, $2... queries
// and a real transaction via a checked-out client) instead of the original
// synchronous better-sqlite3 calls.

const express = require('express');
const { query, pool } = require('../database/db');
const { voteLimiter } = require('../middleware/rateLimiter');
const { isValidPhoneNumber, normalizePhoneNumber, isPositiveInteger } = require('../middleware/validators');

const router = express.Router();

async function getSettings() {
  const result = await query('SELECT * FROM settings WHERE id = 1');
  return result.rows[0];
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
router.get('/status', async (req, res, next) => {
  try {
    const settings = await getSettings();
    res.json({
      voting_enabled: !!settings.voting_enabled,
      voting_open: isVotingOpen(settings),
      voting_start: settings.voting_start,
      voting_end: settings.voting_end
    });
  } catch (err) { next(err); }
});

// GET /api/votes/my-votes?phone=... - returns which categories this phone
// number has already voted in, so the frontend can lock those categories
// even after a refresh or on a different device.
router.get('/my-votes', async (req, res, next) => {
  try {
    const { phone } = req.query;
    if (!isValidPhoneNumber(phone || '')) {
      return res.status(400).json({ error: 'A valid phone number is required.' });
    }
    const normalized = normalizePhoneNumber(phone);
    const rows = (await query(
      'SELECT category_id, nominee_id, voted_at FROM votes WHERE phone_number = $1',
      [normalized]
    )).rows;
    res.json({ votes: rows });
  } catch (err) { next(err); }
});

// POST /api/votes - cast a vote.
// Body: { phone, category_id, nominee_id }
router.post('/', voteLimiter, async (req, res, next) => {
  let client;
  try {
    const settings = await getSettings();
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

    // If the admin has restricted voting to a pre-approved list of phone
    // numbers, reject anyone not on that list before touching the votes
    // table at all.
    if (settings.restrict_to_eligible_voters) {
      const eligible = (await query(
        'SELECT phone_number FROM eligible_voters WHERE phone_number = $1',
        [normalizedPhone]
      )).rows[0];
      if (!eligible) {
        return res.status(403).json({ error: 'This phone number is not registered for voting in this event.' });
      }
    }

    const category = (await query('SELECT * FROM categories WHERE id = $1', [category_id])).rows[0];
    if (!category) return res.status(400).json({ error: 'Category does not exist.' });

    const nominee = (await query(
      'SELECT * FROM nominees WHERE id = $1 AND category_id = $2',
      [nominee_id, category_id]
    )).rows[0];
    if (!nominee) return res.status(400).json({ error: 'Nominee does not belong to this category.' });

    // Transaction: register the voter (idempotent) and insert the vote.
    // The UNIQUE(phone_number, category_id) constraint on `votes` is the
    // real source of truth preventing duplicate votes — this holds even
    // under concurrent requests, refreshes, or votes from another device.
    client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'INSERT INTO voters (phone_number) VALUES ($1) ON CONFLICT (phone_number) DO NOTHING',
        [normalizedPhone]
      );

      const alreadyVoted = (await client.query(
        'SELECT id FROM votes WHERE phone_number = $1 AND category_id = $2',
        [normalizedPhone, category_id]
      )).rows[0];

      if (alreadyVoted) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This phone number has already voted in this category.' });
      }

      await client.query(
        'INSERT INTO votes (phone_number, category_id, nominee_id) VALUES ($1, $2, $3)',
        [normalizedPhone, category_id, nominee_id]
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      // Postgres unique_violation error code
      if (e.code === '23505') {
        return res.status(409).json({ error: 'This phone number has already voted in this category.' });
      }
      throw e;
    } finally {
      client.release();
    }

    res.status(201).json({ success: true, message: `Your vote for "${nominee.name}" has been recorded!` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong while casting your vote. Please try again.' });
  }
});

module.exports = router;
