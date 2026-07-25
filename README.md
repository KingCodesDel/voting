# Postgres Migration Files — Awards Voting Platform

These files replace the SQLite (better-sqlite3) versions in your repo
with PostgreSQL equivalents, so your data survives Render restarts,
redeploys, and crashes.

## Where each file goes in your repo

- database/schema.sql   -> replaces database/schema.sql
- database/db.js        -> replaces database/db.js
- server.js             -> replaces server.js (root of repo)
- routes/auth.js        -> replaces routes/auth.js
- routes/categories.js  -> replaces routes/categories.js
- routes/nominees.js    -> replaces routes/nominees.js
- routes/votes.js       -> replaces routes/votes.js
- routes/admin.js       -> replaces routes/admin.js

## Steps to deploy

1. In your repo, update dependencies:
     npm uninstall better-sqlite3
     npm install pg connect-pg-simple

2. Copy all files above into your repo at the matching paths,
   overwriting the existing ones.

3. Commit and push to GitHub.

4. In Render, on your web service (voting-1):
   - Go to the Environment tab
   - Add DATABASE_URL = <your Postgres Internal Database URL>
     (copy this from your Render Postgres database's Connect/Info page)
   - Save, rebuild, and deploy

5. Watch the Logs tab for this line, confirming success:
     Database schema ready (PostgreSQL)

6. Test it:
   - Cast a vote
   - Log into /admin
   - Manually restart the service (Manual Deploy -> Deploy latest commit)
   - Confirm the vote and your admin login both survived the restart

## Note on photo uploads

Nominee photos are still stored on local disk (not in the database),
so they will still be lost on restart/redeploy. This was left as-is
per your request. If this becomes a problem later, the fix is to
switch photo storage to a service like Cloudinary or S3.
