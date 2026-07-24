# 🏆 Awards Voting Platform

A complete, production-ready online awards voting platform built with **vanilla HTML/CSS/JS** on the frontend and **Node.js + Express + SQLite** on the backend.

Includes a public voting site (with phone-number verification, one vote per category, duplicate prevention) and a secure admin dashboard (category/nominee management, live results with Chart.js, CSV export, vote reset, and event/branding settings).

---

## ✨ Features

**Public site**
- Modern, responsive, dark/light-mode UI with animations
- Home page with event info + countdown timer to voting close
- Awards page listing every category and its nominees
- Phone-number verification before voting
- One vote per phone number **per category**, enforced at the database level (`UNIQUE(phone_number, category_id)`) — this holds up across refreshes, new tabs, and different devices, not just in the browser
- Clear success/error messaging, locked UI after voting
- Installable as a PWA (offline app shell via a service worker)

**Admin dashboard**
- Secure session-based login (bcrypt-hashed passwords)
- Full CRUD for categories and nominees, including photo upload
- Enable/disable voting, and optionally schedule a start/end window
- Overview stats + Chart.js graphs (votes over time, votes by category)
- Full results breakdown per category/nominee with percentages
- Nominee search
- CSV export (aggregated results, and a full raw vote log with phone numbers + timestamps)
- Reset all votes (type-to-confirm dialog)
- Branding controls (event name/description/date, logo, primary color)

**Security**
- Prepared SQL statements everywhere (via `better-sqlite3`) — no string-built queries
- Server-side input validation & sanitization (`validator.js`)
- Helmet security headers + a restrictive CSP
- CSRF protection (double-submit cookie) on all admin mutation routes
- Rate limiting (general API, login attempts, and vote submissions)
- Session cookies are `httpOnly`, `sameSite=strict`, and `secure` in production
- Uploaded images are re-named with random hex filenames and type-checked

---

## 📁 Project Structure

```
voting-platform/
├── server.js                 # App entry point
├── package.json
├── .env.example               # Copy to .env and configure
├── database/
│   ├── schema.sql              # Full SQL schema (see below)
│   ├── db.js                   # DB connection + auto-init + default admin
│   └── seed.js                 # Optional demo data (npm run seed)
├── middleware/
│   ├── auth.js                  # requireAdmin session guard
│   ├── rateLimiter.js            # express-rate-limit configs
│   └── validators.js             # phone/text/number validation helpers
├── routes/
│   ├── auth.js                    # /api/auth/* (login/logout/me)
│   ├── categories.js               # /api/categories/*
│   ├── nominees.js                  # /api/nominees/* (incl. photo upload)
│   ├── votes.js                      # /api/votes/* (public voting)
│   └── admin.js                       # /api/admin/* (stats/results/export/settings)
└── public/                              # Static frontend
    ├── index.html                        # Home page
    ├── awards.html                         # Voting page
    ├── admin/
    │   ├── login.html
    │   └── dashboard.html
    ├── css/
    │   ├── style.css                        # Public site styling + theme vars
    │   └── admin.css                         # Admin dashboard styling
    ├── js/
    │   ├── main.js                            # Shared utils (theme, toast, CSRF-aware fetch)
    │   ├── awards.js                           # Voting page logic
    │   └── admin.js                             # Admin dashboard logic
    ├── images/                                  # Static images / default logo
    └── uploads/                                  # Nominee photo uploads (created at runtime)
```

---

## 🗄️ Database Schema

See [`database/schema.sql`](database/schema.sql) for the full DDL. Summary:

| Table | Purpose |
|---|---|
| `admin_users` | Admin login credentials (bcrypt hash) |
| `categories` | Award categories |
| `nominees` | Nominees, each belonging to one category |
| `voters` | Every unique phone number that has registered a vote |
| `votes` | Individual votes: `phone_number`, `category_id`, `nominee_id`, `voted_at`; `UNIQUE(phone_number, category_id)` |
| `settings` | Single-row table: event name/description/date, branding, voting on/off, schedule |

> **Note on the voting rule:** the spec asks for both "one nominee per category" and "one vote per phone number across the entire event." This implementation interprets that as: **each phone number may cast exactly one vote in each category** (so a voter can participate across multiple award categories, but can never vote twice in the *same* category, and can never change a vote once cast). If you instead want a strict single vote total regardless of category count, change the `UNIQUE` constraint on `votes` to just `UNIQUE(phone_number)` and adjust `routes/votes.js` accordingly (see comments in that file).

---

## 🚀 Installation & Setup

### Prerequisites
- Node.js 18+
- npm

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and set SESSION_SECRET, CSRF_SECRET, and your admin credentials

# 3. (Optional) seed some demo categories/nominees
npm run seed

# 4. Start the server
npm start
# or, for auto-reload during development:
npm run dev
```

The app will be available at:
- **Public site:** http://localhost:3000
- **Admin login:** http://localhost:3000/admin

On first run, the server automatically creates the SQLite database file, runs the schema, and creates a default admin account using the `ADMIN_USERNAME` / `ADMIN_PASSWORD` values from your `.env` file (only if no admin exists yet). **Change these credentials before deploying publicly.**

---

## ☁️ Deploying to Fly.io (free tier)

This app ships with a `Dockerfile` and `fly.toml` ready for [Fly.io](https://fly.io), which is one of the few platforms offering a **free persistent volume** — important here since votes/nominees/photos are stored in a SQLite file and uploaded images on disk, not an external database.

```bash
# 1. Install the Fly CLI and sign up (one-time)
curl -L https://fly.io/install.sh | sh
fly auth signup

# 2. From the project root, launch the app
fly launch --no-deploy
# - Picks up the existing Dockerfile/fly.toml automatically
# - Choose a region close to your voters
# - When asked about a Postgres/Redis database, say NO — this app uses SQLite

# 3. Create the persistent volume that will hold voting.db + uploaded photos
fly volumes create voting_data --size 1
# (must match the volume "source" name in fly.toml, and be in the same
#  region you picked above)

# 4. Set your production secrets (never commit these to git)
fly secrets set SESSION_SECRET=$(openssl rand -hex 32)
fly secrets set CSRF_SECRET=$(openssl rand -hex 32)
fly secrets set ADMIN_USERNAME=youradminname
fly secrets set ADMIN_PASSWORD=a_strong_password_here

# 5. Deploy
fly deploy
```

You'll get a live `https://<your-app-name>.fly.dev` URL with HTTPS already configured. `fly.toml` already points `DB_PATH` and `UPLOAD_DIR` at the mounted volume (`/data`), so both the database and nominee photos persist across restarts and redeploys.

**After the first deploy:**
- Run the seed script remotely if you want demo data: `fly ssh console -C "npm run seed"`
- Every future code change just needs `fly deploy` again — it reuses the same volume, so your votes are never wiped
- To back up your data at any time: `fly ssh sftp get /data/voting.db ./backup-voting.db`
- Fly's free allowance is 3 shared VMs and 3GB of volume storage — one small app like this comfortably fits inside that

## 🔐 Production Checklist

- [ ] Set strong, unique values for `SESSION_SECRET` and `CSRF_SECRET`
- [ ] Change the default admin username/password immediately after first login (or before first run, via `.env`)
- [ ] Set `NODE_ENV=production` so cookies are marked `secure` (requires HTTPS)
- [ ] Put the app behind a reverse proxy (e.g. Nginx) with HTTPS/TLS
- [ ] Back up `database/voting.db` regularly (it's a single file — just copy it)
- [ ] Review the rate-limit thresholds in `middleware/rateLimiter.js` for your expected traffic

---

## 🎯 Extending the Bonus Features

A few bonus items from the spec are intentionally left as extension points rather than fully wired up, since they depend on paid third-party services or infrastructure decisions specific to your deployment:

- **SMS OTP verification** (Twilio/Termii): the phone-number field is already validated and normalized server-side; wire in Twilio Verify (or similar) inside `routes/votes.js` before the vote is recorded if you want a true one-time-code step in addition to uniqueness checking.
- **Email confirmation after voting**: add a mailer (e.g. Nodemailer) call inside the same success path in `routes/votes.js`, gated on an optional email field.
- **Database backup/restore UI**: since this is a single SQLite file, backups can already be done with a simple file copy (`cp database/voting.db backups/`); a scheduled job or admin-panel button can call this same operation.
- **Real-time notifications**: the dashboard currently polls every 8 seconds for live-feeling updates without a full refresh; swap this for WebSockets/Server-Sent Events if you need sub-second updates.

Everything else in the requirements (categories/nominees CRUD, photo upload, phone verification, duplicate-vote prevention, admin auth, CSV export, charts, reset, scheduling, branding, dark/light mode, PWA shell, rate limiting, CSRF, input sanitization) is fully implemented and working out of the box.

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express, better-sqlite3, bcryptjs, express-session, csrf-csrf, helmet, express-rate-limit, multer, validator
- **Frontend:** Vanilla HTML/CSS/JavaScript (no build step), Chart.js (via CDN) for admin charts

---

## 📄 License

MIT — use this freely for your own events.
