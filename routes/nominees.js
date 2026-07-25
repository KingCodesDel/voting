// routes/nominees.js
// Public: fetch nominees. Admin (protected): create/edit/delete + photo upload.
//
// Rewritten to use PostgreSQL (async/await + parameterized $1, $2... queries
// and RETURNING instead of lastInsertRowid) instead of the original
// synchronous better-sqlite3 calls.
//
// NOTE: the photo upload logic itself (multer, UPLOAD_DIR) is unchanged —
// see the important caveat below about why this still needs attention on
// Render's free tier even after this file is converted.

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { query } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { isNonEmptyString, isPositiveInteger, sanitizeText } = require('../middleware/validators');

const router = express.Router();

// Uploads live under public/uploads by default (fine for local dev), but
// can be pointed at a mounted persistent volume in production via
// UPLOAD_DIR, so photos survive redeploys/restarts. server.js serves
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
router.get('/', async (req, res, next) => {
  try {
    const { category_id } = req.query;
    let rows;
    if (category_id) {
      rows = (await query(
        'SELECT * FROM nominees WHERE category_id = $1 ORDER BY display_order ASC, id ASC',
        [category_id]
      )).rows;
    } else {
      rows = (await query(
        'SELECT * FROM nominees ORDER BY category_id ASC, display_order ASC, id ASC'
      )).rows;
    }
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/nominees - admin only, optional photo field named "photo"
router.post('/', requireAdmin, (req, res) => {
  upload.single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    try {
      const { category_id, name, bio, display_order } = req.body;
      if (!isPositiveInteger(category_id)) {
        return res.status(400).json({ error: 'A valid category_id is required.' });
      }
      if (!isNonEmptyString(name, 150)) {
        return res.status(400).json({ error: 'Nominee name is required.' });
      }
      const category = (await query('SELECT id FROM categories WHERE id = $1', [category_id])).rows[0];
      if (!category) return res.status(400).json({ error: 'Category does not exist.' });

      const photo_url = req.file ? `/uploads/${req.file.filename}` : '';

      const inserted = await query(
        'INSERT INTO nominees (category_id, name, bio, photo_url, display_order) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [category_id, sanitizeText(name), sanitizeText(bio || ''), photo_url, Number(display_order) || 0]
      );

      res.status(201).json(inserted.rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Something went wrong while creating the nominee.' });
    }
  });
});

// PUT /api/nominees/:id - admin only, optional new photo
router.put('/:id', requireAdmin, (req, res) => {
  upload.single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    try {
      const existing = (await query('SELECT * FROM nominees WHERE id = $1', [req.params.id])).rows[0];
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

      const updated = await query(
        `UPDATE nominees SET name = $1, bio = $2, photo_url = $3, display_order = $4, category_id = $5, updated_at = NOW()
         WHERE id = $6 RETURNING *`,
        [
          sanitizeText(name),
          sanitizeText(bio || ''),
          photo_url,
          Number(display_order) || 0,
          isPositiveInteger(category_id) ? category_id : existing.category_id,
          req.params.id
        ]
      );

      res.json(updated.rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Something went wrong while updating the nominee.' });
    }
  });
});

// DELETE /api/nominees/:id - admin only
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const existing = (await query('SELECT * FROM nominees WHERE id = $1', [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Nominee not found.' });

    if (existing.photo_url && existing.photo_url.startsWith('/uploads/')) {
      const oldPath = path.join(__dirname, '..', 'public', existing.photo_url);
      fs.unlink(oldPath, () => {});
    }

    await query('DELETE FROM nominees WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
