// middleware/auth.js
// Protects admin-only routes. Requires an active, server-side session
// created at /api/admin/login.

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  return res.status(401).json({ error: 'Not authenticated. Please log in.' });
}

module.exports = { requireAdmin };
