// routes/admin.js
// Protected admin-dashboard routes: statistics, results, CSV export,
// vote reset, branding/settings management, and nominee search.
//
// Rewritten to use PostgreSQL (async/await + parameterized $1, $2... queries)
// instead of the original synchronous better-sqlite3 calls.

const express = require('express');
const { query } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { sanitizeText } = require('../middleware/validators');

const router = express.Router();

// All routes below require an authenticated admin session.
router.use(requireAdmin);

// GET /api/admin/stats - top-line dashboard numbers
router.get('/stats', async (req, res, next) => {
  try {
    const totalVotes = (await query('SELECT COUNT(*) AS count FROM votes')).rows[0].count;
    const totalVoters = (await query('SELECT COUNT(*) AS count FROM voters')).rows[0].count;
    const totalCategories = (await query('SELECT COUNT(*) AS count FROM categories')).rows[0].count;
    const totalNominees = (await query('SELECT COUNT(*) AS count FROM nominees')).rows[0].count;

    // Votes over time (per day) for charting
    const votesByDay = (await query(`
      SELECT date(voted_at) AS day, COUNT(*) AS count
      FROM votes
      GROUP BY day
      ORDER BY day ASC
    `)).rows;

    res.json({
      totalVotes: Number(totalVotes),
      totalVoters: Number(totalVoters),
      totalCategories: Number(totalCategories),
      totalNominees: Number(totalNominees),
      votesByDay
    });
  } catch (err) { next(err); }
});

// GET /api/admin/results - full results broken down by category & nominee
router.get('/results', async (req, res, next) => {
  try {
    const categories = (await query(
      'SELECT * FROM categories ORDER BY display_order ASC, id ASC'
    )).rows;

    const results = [];
    for (const cat of categories) {
      const nominees = (await query(
        'SELECT * FROM nominees WHERE category_id = $1 ORDER BY display_order ASC',
        [cat.id]
      )).rows;

      const totalCategoryVotes = Number((await query(
        'SELECT COUNT(*) AS count FROM votes WHERE category_id = $1',
        [cat.id]
      )).rows[0].count);

      const nomineeResults = [];
      for (const nom of nominees) {
        const voteCount = Number((await query(
          'SELECT COUNT(*) AS count FROM votes WHERE nominee_id = $1',
          [nom.id]
        )).rows[0].count);
        const percentage = totalCategoryVotes > 0
          ? ((voteCount / totalCategoryVotes) * 100).toFixed(1)
          : '0.0';
        nomineeResults.push({ ...nom, voteCount, percentage: Number(percentage) });
      }

      // Sort nominees by vote count descending for leaderboard display
      nomineeResults.sort((a, b) => b.voteCount - a.voteCount);

      results.push({ ...cat, totalVotes: totalCategoryVotes, nominees: nomineeResults });
    }

    res.json(results);
  } catch (err) { next(err); }
});

// GET /api/admin/nominees/search?q=... - search nominees by name across all categories
router.get('/nominees/search', async (req, res, next) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const rows = (await query(`
      SELECT nominees.*, categories.name AS category_name
      FROM nominees
      JOIN categories ON categories.id = nominees.category_id
      WHERE nominees.name ILIKE $1
      ORDER BY nominees.name ASC
    `, [q])).rows;
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/admin/export/csv - full results export
router.get('/export/csv', async (req, res, next) => {
  try {
    const rows = (await query(`
      SELECT categories.name AS category, nominees.name AS nominee,
             COUNT(votes.id) AS vote_count
      FROM nominees
      LEFT JOIN votes ON votes.nominee_id = nominees.id
      JOIN categories ON categories.id = nominees.category_id
      GROUP BY nominees.id, categories.name, nominees.name, categories.display_order, nominees.display_order
      ORDER BY categories.display_order, nominees.display_order
    `)).rows;

    const escapeCsv = (val) => `"${String(val).replace(/"/g, '""')}"`;
    const header = ['Category', 'Nominee', 'Vote Count'].map(escapeCsv).join(',');
    const lines = rows.map(r => [r.category, r.nominee, r.vote_count].map(escapeCsv).join(','));
    const csv = [header, ...lines].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="voting-results-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/admin/export/votes-log-csv - raw individual vote log export
router.get('/export/votes-log-csv', async (req, res, next) => {
  try {
    const rows = (await query(`
      SELECT votes.phone_number, categories.name AS category, nominees.name AS nominee, votes.voted_at
      FROM votes
      JOIN categories ON categories.id = votes.category_id
      JOIN nominees ON nominees.id = votes.nominee_id
      ORDER BY votes.voted_at DESC
    `)).rows;

    const escapeCsv = (val) => `"${String(val).replace(/"/g, '""')}"`;
    const header = ['Phone Number', 'Category', 'Nominee', 'Timestamp'].map(escapeCsv).join(',');
    const lines = rows.map(r => [r.phone_number, r.category, r.nominee, r.voted_at].map(escapeCsv).join(','));
    const csv = [header, ...lines].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="votes-log-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
});

// POST /api/admin/reset-votes - wipe all votes AND registered voters
// (requires the admin to type a confirmation phrase, enforced client-side
// and re-checked here)
router.post('/reset-votes', async (req, res, next) => {
  try {
    const { confirm } = req.body;
    if (confirm !== 'RESET') {
      return res.status(400).json({ error: 'Confirmation phrase mismatch. Type RESET to confirm.' });
    }
    const client = await require('../database/db').pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM votes');
      await client.query('DELETE FROM voters');
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ success: true, message: 'All votes and registered voters have been reset.' });
  } catch (err) { next(err); }
});

// GET /api/admin/eligible-voters?q=... - list registered eligible numbers (optionally filtered)
router.get('/eligible-voters', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    let rows;
    if (q) {
      rows = (await query(
        'SELECT * FROM eligible_voters WHERE phone_number ILIKE $1 OR note ILIKE $2 ORDER BY added_at DESC',
        [`%${q}%`, `%${q}%`]
      )).rows;
    } else {
      rows = (await query(
        'SELECT * FROM eligible_voters ORDER BY added_at DESC LIMIT 500'
      )).rows;
    }
    const total = Number((await query('SELECT COUNT(*) AS count FROM eligible_voters')).rows[0].count);
    res.json({ total, voters: rows });
  } catch (err) { next(err); }
});

// POST /api/admin/eligible-voters - bulk add numbers.
// Body: { numbers: "one per line, or comma/space separated" }
router.post('/eligible-voters', async (req, res, next) => {
  try {
    const { numbers } = req.body;
    if (typeof numbers !== 'string' || !numbers.trim()) {
      return res.status(400).json({ error: 'Please paste at least one phone number.' });
    }

    // Split on newlines, commas, or whitespace, then validate/normalize each.
    const rawList = numbers.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    const valid = [];
    const invalid = [];

    rawList.forEach(raw => {
      const cleaned = raw.replace(/[\s\-()]/g, '');
      if (/^\+?\d{7,15}$/.test(cleaned)) {
        valid.push(cleaned);
      } else {
        invalid.push(raw);
      }
    });

    let added = 0;
    for (const num of valid) {
      const result = await query(
        'INSERT INTO eligible_voters (phone_number) VALUES ($1) ON CONFLICT (phone_number) DO NOTHING',
        [num]
      );
      added += result.rowCount;
    }
    const duplicates = valid.length - added;

    res.status(201).json({
      success: true,
      added,
      duplicates,
      invalidCount: invalid.length,
      invalidSamples: invalid.slice(0, 10)
    });
  } catch (err) { next(err); }
});

// DELETE /api/admin/eligible-voters/:phone - remove a single number from the allowlist
router.delete('/eligible-voters/:phone', async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM eligible_voters WHERE phone_number = $1',
      [req.params.phone]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'That phone number is not on the list.' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/admin/eligible-voters/clear - wipe the entire allowlist (type-to-confirm on the frontend)
router.post('/eligible-voters/clear', async (req, res, next) => {
  try {
    const { confirm } = req.body;
    if (confirm !== 'CLEAR') {
      return res.status(400).json({ error: 'Confirmation phrase mismatch. Type CLEAR to confirm.' });
    }
    await query('DELETE FROM eligible_voters');
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/admin/settings - fetch current event/branding/schedule settings
router.get('/settings', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM settings WHERE id = 1');
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/admin/settings - update event/branding/schedule settings
router.put('/settings', async (req, res, next) => {
  try {
    const {
      event_name, event_description, event_date, logo_url,
      primary_color, voting_enabled, voting_start, voting_end,
      restrict_to_eligible_voters
    } = req.body;

    const current = (await query('SELECT * FROM settings WHERE id = 1')).rows[0];

    await query(`
      UPDATE settings SET
        event_name = $1, event_description = $2, event_date = $3, logo_url = $4,
        primary_color = $5, voting_enabled = $6, voting_start = $7, voting_end = $8,
        restrict_to_eligible_voters = $9
      WHERE id = 1
    `, [
      sanitizeText(event_name ?? current.event_name),
      sanitizeText(event_description ?? current.event_description),
      event_date ?? current.event_date,
      logo_url ?? current.logo_url,
      /^#[0-9A-Fa-f]{6}$/.test(primary_color || '') ? primary_color : current.primary_color,
      voting_enabled !== undefined ? (voting_enabled ? 1 : 0) : current.voting_enabled,
      voting_start !== undefined ? voting_start : current.voting_start,
      voting_end !== undefined ? voting_end : current.voting_end,
      restrict_to_eligible_voters !== undefined ? (restrict_to_eligible_voters ? 1 : 0) : current.restrict_to_eligible_voters
    ]);

    const updated = await query('SELECT * FROM settings WHERE id = 1');
    res.json(updated.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
