// routes/admin.js
// Protected admin-dashboard routes: statistics, results, CSV export,
// vote reset, branding/settings management, and nominee search.

const express = require('express');
const { db } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { sanitizeText } = require('../middleware/validators');

const router = express.Router();

// All routes below require an authenticated admin session.
router.use(requireAdmin);

// GET /api/admin/stats - top-line dashboard numbers
router.get('/stats', (req, res) => {
  const totalVotes = db.prepare('SELECT COUNT(*) AS count FROM votes').get().count;
  const totalVoters = db.prepare('SELECT COUNT(*) AS count FROM voters').get().count;
  const totalCategories = db.prepare('SELECT COUNT(*) AS count FROM categories').get().count;
  const totalNominees = db.prepare('SELECT COUNT(*) AS count FROM nominees').get().count;

  // Votes over time (per day) for charting
  const votesByDay = db.prepare(`
    SELECT date(voted_at) AS day, COUNT(*) AS count
    FROM votes
    GROUP BY day
    ORDER BY day ASC
  `).all();

  res.json({ totalVotes, totalVoters, totalCategories, totalNominees, votesByDay });
});

// GET /api/admin/results - full results broken down by category & nominee
router.get('/results', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY display_order ASC, id ASC').all();

  const results = categories.map(cat => {
    const nominees = db.prepare('SELECT * FROM nominees WHERE category_id = ? ORDER BY display_order ASC').all(cat.id);
    const totalCategoryVotes = db.prepare('SELECT COUNT(*) AS count FROM votes WHERE category_id = ?').get(cat.id).count;

    const nomineeResults = nominees.map(nom => {
      const voteCount = db.prepare('SELECT COUNT(*) AS count FROM votes WHERE nominee_id = ?').get(nom.id).count;
      const percentage = totalCategoryVotes > 0 ? ((voteCount / totalCategoryVotes) * 100).toFixed(1) : '0.0';
      return { ...nom, voteCount, percentage: Number(percentage) };
    });

    // Sort nominees by vote count descending for leaderboard display
    nomineeResults.sort((a, b) => b.voteCount - a.voteCount);

    return { ...cat, totalVotes: totalCategoryVotes, nominees: nomineeResults };
  });

  res.json(results);
});

// GET /api/admin/nominees/search?q=... - search nominees by name across all categories
router.get('/nominees/search', (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const rows = db.prepare(`
    SELECT nominees.*, categories.name AS category_name
    FROM nominees
    JOIN categories ON categories.id = nominees.category_id
    WHERE nominees.name LIKE ?
    ORDER BY nominees.name ASC
  `).all(q);
  res.json(rows);
});

// GET /api/admin/export/csv - full results export
router.get('/export/csv', (req, res) => {
  const rows = db.prepare(`
    SELECT categories.name AS category, nominees.name AS nominee,
           COUNT(votes.id) AS vote_count
    FROM nominees
    LEFT JOIN votes ON votes.nominee_id = nominees.id
    JOIN categories ON categories.id = nominees.category_id
    GROUP BY nominees.id
    ORDER BY categories.display_order, nominees.display_order
  `).all();

  const escapeCsv = (val) => `"${String(val).replace(/"/g, '""')}"`;
  const header = ['Category', 'Nominee', 'Vote Count'].map(escapeCsv).join(',');
  const lines = rows.map(r => [r.category, r.nominee, r.vote_count].map(escapeCsv).join(','));
  const csv = [header, ...lines].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="voting-results-${Date.now()}.csv"`);
  res.send(csv);
});

// GET /api/admin/export/votes-log-csv - raw individual vote log export
router.get('/export/votes-log-csv', (req, res) => {
  const rows = db.prepare(`
    SELECT votes.phone_number, categories.name AS category, nominees.name AS nominee, votes.voted_at
    FROM votes
    JOIN categories ON categories.id = votes.category_id
    JOIN nominees ON nominees.id = votes.nominee_id
    ORDER BY votes.voted_at DESC
  `).all();

  const escapeCsv = (val) => `"${String(val).replace(/"/g, '""')}"`;
  const header = ['Phone Number', 'Category', 'Nominee', 'Timestamp'].map(escapeCsv).join(',');
  const lines = rows.map(r => [r.phone_number, r.category, r.nominee, r.voted_at].map(escapeCsv).join(','));
  const csv = [header, ...lines].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="votes-log-${Date.now()}.csv"`);
  res.send(csv);
});

// POST /api/admin/reset-votes - wipe all votes AND registered voters
// (requires the admin to type a confirmation phrase, enforced client-side
// and re-checked here)
router.post('/reset-votes', (req, res) => {
  const { confirm } = req.body;
  if (confirm !== 'RESET') {
    return res.status(400).json({ error: 'Confirmation phrase mismatch. Type RESET to confirm.' });
  }
  const resetTx = db.transaction(() => {
    db.prepare('DELETE FROM votes').run();
    db.prepare('DELETE FROM voters').run();
  });
  resetTx();
  res.json({ success: true, message: 'All votes and registered voters have been reset.' });
});

// GET /api/admin/eligible-voters?q=... - list registered eligible numbers (optionally filtered)
router.get('/eligible-voters', (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    rows = db.prepare('SELECT * FROM eligible_voters WHERE phone_number LIKE ? OR note LIKE ? ORDER BY added_at DESC')
      .all(`%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare('SELECT * FROM eligible_voters ORDER BY added_at DESC LIMIT 500').all();
  }
  const total = db.prepare('SELECT COUNT(*) AS count FROM eligible_voters').get().count;
  res.json({ total, voters: rows });
});

// POST /api/admin/eligible-voters - bulk add numbers.
// Body: { numbers: "one per line, or comma/space separated" }
router.post('/eligible-voters', (req, res) => {
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

  const insert = db.prepare('INSERT OR IGNORE INTO eligible_voters (phone_number) VALUES (?)');
  const insertMany = db.transaction((list) => {
    let added = 0;
    list.forEach(num => { added += insert.run(num).changes; });
    return added;
  });

  const added = insertMany(valid);
  const duplicates = valid.length - added;

  res.status(201).json({
    success: true,
    added,
    duplicates,
    invalidCount: invalid.length,
    invalidSamples: invalid.slice(0, 10)
  });
});

// DELETE /api/admin/eligible-voters/:phone - remove a single number from the allowlist
router.delete('/eligible-voters/:phone', (req, res) => {
  const info = db.prepare('DELETE FROM eligible_voters WHERE phone_number = ?').run(req.params.phone);
  if (info.changes === 0) return res.status(404).json({ error: 'That phone number is not on the list.' });
  res.json({ success: true });
});

// POST /api/admin/eligible-voters/clear - wipe the entire allowlist (type-to-confirm on the frontend)
router.post('/eligible-voters/clear', (req, res) => {
  const { confirm } = req.body;
  if (confirm !== 'CLEAR') {
    return res.status(400).json({ error: 'Confirmation phrase mismatch. Type CLEAR to confirm.' });
  }
  db.prepare('DELETE FROM eligible_voters').run();
  res.json({ success: true });
});

// GET /api/admin/settings - fetch current event/branding/schedule settings
router.get('/settings', (req, res) => {
  res.json(db.prepare('SELECT * FROM settings WHERE id = 1').get());
});

// PUT /api/admin/settings - update event/branding/schedule settings
router.put('/settings', (req, res) => {
  const {
    event_name, event_description, event_date, logo_url,
    primary_color, voting_enabled, voting_start, voting_end,
    restrict_to_eligible_voters
  } = req.body;

  const current = db.prepare('SELECT * FROM settings WHERE id = 1').get();

  db.prepare(`
    UPDATE settings SET
      event_name = ?, event_description = ?, event_date = ?, logo_url = ?,
      primary_color = ?, voting_enabled = ?, voting_start = ?, voting_end = ?,
      restrict_to_eligible_voters = ?
    WHERE id = 1
  `).run(
    sanitizeText(event_name ?? current.event_name),
    sanitizeText(event_description ?? current.event_description),
    event_date ?? current.event_date,
    logo_url ?? current.logo_url,
    /^#[0-9A-Fa-f]{6}$/.test(primary_color || '') ? primary_color : current.primary_color,
    voting_enabled !== undefined ? (voting_enabled ? 1 : 0) : current.voting_enabled,
    voting_start !== undefined ? voting_start : current.voting_start,
    voting_end !== undefined ? voting_end : current.voting_end,
    restrict_to_eligible_voters !== undefined ? (restrict_to_eligible_voters ? 1 : 0) : current.restrict_to_eligible_voters
  );

  res.json(db.prepare('SELECT * FROM settings WHERE id = 1').get());
});

module.exports = router;
