// routes/auth.js
// Admin login / logout / session-check endpoints.

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../database/db');
const { loginLimiter } = require('../middleware/rateLimiter');
const { isNonEmptyString } = require('../middleware/validators');

const router = express.Router();

// POST /api/auth/login
router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;

  if (!isNonEmptyString(username, 100) || !isNonEmptyString(password, 200)) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username.trim());

  // Always run bcrypt.compare even if admin not found, to reduce timing
  // side-channels that reveal valid usernames.
  const hashToCheck = admin ? admin.password_hash : '$2a$12$invalidsaltinvalidsaltinvalidsaltuO';
  const isValid = bcrypt.compareSync(password, hashToCheck);

  if (!admin || !isValid) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  // Regenerate the session on login to prevent session fixation attacks.
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Login failed. Please try again.' });
    req.session.adminId = admin.id;
    req.session.username = admin.username;
    res.json({ success: true, username: admin.username });
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// GET /api/auth/me - check current session
router.get('/me', (req, res) => {
  if (req.session && req.session.adminId) {
    return res.json({ authenticated: true, username: req.session.username });
  }
  res.json({ authenticated: false });
});

module.exports = router;
