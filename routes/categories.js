// routes/categories.js
// Public: list categories with nominees.
// Admin (protected): create / edit / delete categories.

const express = require('express');
const { db } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { isNonEmptyString, sanitizeText } = require('../middleware/validators');

const router = express.Router();

// GET /api/categories - public list, each with its nominees attached
router.get('/', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY display_order ASC, id ASC').all();
  const nomineeStmt = db.prepare('SELECT * FROM nominees WHERE category_id = ? ORDER BY display_order ASC, id ASC');

  const result = categories.map(cat => ({
    ...cat,
    nominees: nomineeStmt.all(cat.id)
  }));

  res.json(result);
});

// GET /api/categories/:id - single category with nominees
router.get('/:id', (req, res) => {
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!category) return res.status(404).json({ error: 'Category not found.' });
  category.nominees = db.prepare('SELECT * FROM nominees WHERE category_id = ? ORDER BY display_order ASC, id ASC').all(category.id);
  res.json(category);
});

// POST /api/categories - admin only
router.post('/', requireAdmin, (req, res) => {
  const { name, description, display_order } = req.body;
  if (!isNonEmptyString(name, 150)) {
    return res.status(400).json({ error: 'Category name is required.' });
  }
  const stmt = db.prepare(
    'INSERT INTO categories (name, description, display_order) VALUES (?, ?, ?)'
  );
  const info = stmt.run(sanitizeText(name), sanitizeText(description || ''), Number(display_order) || 0);
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(category);
});

// PUT /api/categories/:id - admin only
router.put('/:id', requireAdmin, (req, res) => {
  const { name, description, display_order } = req.body;
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found.' });
  if (!isNonEmptyString(name, 150)) {
    return res.status(400).json({ error: 'Category name is required.' });
  }
  db.prepare(
    `UPDATE categories SET name = ?, description = ?, display_order = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(sanitizeText(name), sanitizeText(description || ''), Number(display_order) || 0, req.params.id);
  const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /api/categories/:id - admin only (cascades to nominees & votes)
router.delete('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found.' });
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
