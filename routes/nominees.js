// routes/nominees.js
// Public: fetch nominees. Admin (protected): create/edit/delete + photo upload.

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { isNonEmptyString, isPositiveInteger, sanitizeText } = require('../middleware/validators');

const router = express.Router();

// Uploads live under public/uploads by default (fine for local dev), but
// can be pointed at a mounted persistent volume in production (e.g. Fly.io)
// via UPLOAD_DIR, so photos survive redeploys/restarts. server.js serves
// this same directory at the /uploads URL path regardless of where it is.
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
    cb(null, `${crypto.randomBytes(16).toString('hex')}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, WEBP, or GIF images are allowed.'));
    }
    cb(null, true);
  }
});

// GET /api/nominees?category_id=1 - public
router.get('/', (req, res) => {
  const { category_id } = req.query;
  let rows;
  if (category_id) {
    rows = db.prepare('SELECT * FROM nominees WHERE category_id = ? ORDER BY display_order ASC, id ASC').all(category_id);
  } else {
    rows = db.prepare('SELECT * FROM nominees ORDER BY category_id ASC, display_order ASC, id ASC').all();
  }
  res.json(rows);
});

// POST /api/nominees - admin only, optional photo field named "photo"
router.post('/', requireAdmin, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const { category_id, name, bio, display_order } = req.body;
    if (!isPositiveInteger(category_id)) {
      return res.status(400).json({ error: 'A valid category_id is required.' });
    }
    if (!isNonEmptyString(name, 150)) {
      return res.status(400).json({ error: 'Nominee name is required.' });
    }
    const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(category_id);
    if (!category) return res.status(400).json({ error: 'Category does not exist.' });

    const photo_url = req.file ? `/uploads/${req.file.filename}` : '';

    const info = db.prepare(
      'INSERT INTO nominees (category_id, name, bio, photo_url, display_order) VALUES (?, ?, ?, ?, ?)'
    ).run(category_id, sanitizeText(name), sanitizeText(bio || ''), photo_url, Number(display_order) || 0);

    const nominee = db.prepare('SELECT * FROM nominees WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(nominee);
  });
});

// PUT /api/nominees/:id - admin only, optional new photo
router.put('/:id', requireAdmin, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const existing = db.prepare('SELECT * FROM nominees WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Nominee not found.' });

    const { name, bio, display_order, category_id } = req.body;
    if (!isNonEmptyString(name, 150)) {
      return res.status(400).json({ error: 'Nominee name is required.' });
    }

    let photo_url = existing.photo_url;
    if (req.file) {
      // Remove old photo file if it existed and was locally stored
      if (existing.photo_url && existing.photo_url.startsWith('/uploads/')) {
        const oldPath = path.join(__dirname, '..', 'public', existing.photo_url);
        fs.unlink(oldPath, () => {});
      }
      photo_url = `/uploads/${req.file.filename}`;
    }

    db.prepare(
      `UPDATE nominees SET name = ?, bio = ?, photo_url = ?, display_order = ?, category_id = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      sanitizeText(name),
      sanitizeText(bio || ''),
      photo_url,
      Number(display_order) || 0,
      isPositiveInteger(category_id) ? category_id : existing.category_id,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM nominees WHERE id = ?').get(req.params.id);
    res.json(updated);
  });
});

// DELETE /api/nominees/:id - admin only
router.delete('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM nominees WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Nominee not found.' });

  if (existing.photo_url && existing.photo_url.startsWith('/uploads/')) {
    const oldPath = path.join(__dirname, '..', 'public', existing.photo_url);
    fs.unlink(oldPath, () => {});
  }

  db.prepare('DELETE FROM nominees WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
