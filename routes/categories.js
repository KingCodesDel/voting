// routes/categories.js
// Public: list categories with nominees.
// Admin (protected): create / edit / delete categories.
//
// Rewritten to use PostgreSQL (async/await + parameterized $1, $2... queries
// and RETURNING instead of lastInsertRowid) instead of the original
// synchronous better-sqlite3 calls.

const express = require('express');
const { query } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { isNonEmptyString, sanitizeText } = require('../middleware/validators');

const router = express.Router();

// GET /api/categories - public list, each with its nominees attached
router.get('/', async (req, res, next) => {
  try {
    const categories = (await query(
      'SELECT * FROM categories ORDER BY display_order ASC, id ASC'
    )).rows;

    const result = [];
    for (const cat of categories) {
      const nominees = (await query(
        'SELECT * FROM nominees WHERE category_id = $1 ORDER BY display_order ASC, id ASC',
        [cat.id]
      )).rows;
      result.push({ ...cat, nominees });
    }

    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/categories/:id - single category with nominees
router.get('/:id', async (req, res, next) => {
  try {
    const category = (await query(
      'SELECT * FROM categories WHERE id = $1',
      [req.params.id]
    )).rows[0];
    if (!category) return res.status(404).json({ error: 'Category not found.' });

    category.nominees = (await query(
      'SELECT * FROM nominees WHERE category_id = $1 ORDER BY display_order ASC, id ASC',
      [category.id]
    )).rows;

    res.json(category);
  } catch (err) { next(err); }
});

// POST /api/categories - admin only
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, description, display_order } = req.body;
    if (!isNonEmptyString(name, 150)) {
      return res.status(400).json({ error: 'Category name is required.' });
    }
    const inserted = await query(
      'INSERT INTO categories (name, description, display_order) VALUES ($1, $2, $3) RETURNING *',
      [sanitizeText(name), sanitizeText(description || ''), Number(display_order) || 0]
    );
    res.status(201).json(inserted.rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/categories/:id - admin only
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name, description, display_order } = req.body;
    const existing = (await query(
      'SELECT * FROM categories WHERE id = $1',
      [req.params.id]
    )).rows[0];
    if (!existing) return res.status(404).json({ error: 'Category not found.' });
    if (!isNonEmptyString(name, 150)) {
      return res.status(400).json({ error: 'Category name is required.' });
    }

    const updated = await query(
      `UPDATE categories SET name = $1, description = $2, display_order = $3, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [sanitizeText(name), sanitizeText(description || ''), Number(display_order) || 0, req.params.id]
    );
    res.json(updated.rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/categories/:id - admin only (cascades to nominees & votes)
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const existing = (await query(
      'SELECT * FROM categories WHERE id = $1',
      [req.params.id]
    )).rows[0];
    if (!existing) return res.status(404).json({ error: 'Category not found.' });

    await query('DELETE FROM categories WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
