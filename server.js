// server.js
// Entry point: sets up security middleware, sessions, CSRF protection,
// static file serving, and mounts all API routes.
//
// Changes from the original:
//  1. Database: now calls the async initSchema() from the new Postgres
//     db.js (was the old synchronous initDatabase()).
//  2. Sessions: now stored in Postgres via connect-pg-simple instead of
//     the default in-memory MemoryStore, so admin logins survive
//     restarts/redeploys instead of being wiped every time.
//  3. The one direct db.prepare(...) call (public /api/settings) is now
//     an async query(...) call.

require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { doubleCsrf } = require('csrf-csrf');

const { pool, query, initSchema } = require('./database/db');
const { apiLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);

// ---- Core security headers ----
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"]
    }
  }
}));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// ---- Sessions (used for admin auth) ----
// Backed by Postgres (table auto-created as "session" on first run) so
// admin logins survive service restarts, redeploys, and scaling events —
// instead of the default MemoryStore, which loses all sessions on restart.
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  name: 'awards.sid',
  secret: process.env.SESSION_SECRET || 'dev_only_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd,
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  }
}));

// ---- CSRF protection (double-submit cookie pattern) ----
// The frontend fetches a token from GET /api/csrf-token and sends it back
// in the X-CSRF-Token header on every mutating admin request.
const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET || 'dev_only_change_me_too',
  cookieName: isProd ? '__Host-csrf' : 'csrf-token',
  cookieOptions: { sameSite: 'strict', secure: isProd, path: '/' },
  size: 64,
  getTokenFromRequest: (req) => req.headers['x-csrf-token']
});

app.get('/api/csrf-token', (req, res) => {
  res.json({ csrfToken: generateToken(req, res) });
});

// Only enforce CSRF on state-changing methods, and only for admin-driven
// mutation routes (public voting endpoint is intentionally exempt since
// it has its own rate limiting + uniqueness constraints and needs to work
// simply from the public site without a token round trip).
function csrfOnMutations(req, res, next) {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return doubleCsrfProtection(req, res, next);
  }
  next();
}

app.use('/api/', apiLimiter);

// Public settings endpoint (branding info needed by the public site,
// deliberately separate from the protected /api/admin/settings routes)
app.get('/api/settings', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM settings WHERE id = 1');
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ---- Routes ----
const authRoutes = require('./routes/auth');
const categoryRoutes = require('./routes/categories');
const nomineeRoutes = require('./routes/nominees');
const voteRoutes = require('./routes/votes');
const adminRoutes = require('./routes/admin');

app.use('/api/auth', authRoutes); // login/logout are exempt from CSRF (no session yet)
app.use('/api/categories', csrfOnMutations, categoryRoutes);
app.use('/api/nominees', csrfOnMutations, nomineeRoutes);
app.use('/api/votes', voteRoutes); // public, protected instead by rate limiting + DB constraints
app.use('/api/admin', csrfOnMutations, adminRoutes);

// ---- Static frontend ----
// Uploaded nominee photos may live outside public/ (e.g. a mounted
// persistent volume in production) — serve them at /uploads either way.
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, 'public', 'uploads');
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// Friendly fallback for admin SPA-style routes
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html')));

// Basic error handler (also catches CSRF validation failures)
app.use((err, req, res, next) => {
  if (err && err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ error: 'Invalid or missing security token. Please refresh the page and try again.' });
  }
  console.error(err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

// Schema init is async now (runs SQL against Postgres), so we wait for it
// before accepting traffic.
initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🏆 Awards Voting Platform running at http://localhost:${PORT}`);
      console.log(`   Admin panel: http://localhost:${PORT}/admin\n`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  });
