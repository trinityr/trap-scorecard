-- Adds user accounts, admin roles, and app settings to an existing
-- trap-scorecard database. Safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id);

COMMIT;

-- The session store table is created automatically by connect-pg-simple
-- on first app startup (createTableIfMissing: true) — nothing to do here.
-- The first person to register through the app becomes an admin
-- automatically; there's no separate bootstrap step required.
