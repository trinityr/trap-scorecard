-- Run manually against an existing database to add League support:
--   docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/010_add_leagues.sql
-- (swap trapadmin/trapscores for your actual POSTGRES_USER/POSTGRES_DB if different)
--
-- Adds a leagues table (a team can optionally belong to one league) so the
-- app can eventually host multiple leagues, each with its own info,
-- location, contact, schedule, and cost breakdown. Purely additive —
-- existing teams simply have no league until an admin assigns one.

CREATE TABLE IF NOT EXISTS leagues (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  location TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  -- Free-text fields (rendered with line breaks preserved) rather than a
  -- structured schedule/cost model, to keep this simple for now.
  schedule_text TEXT,
  costs_text TEXT,
  description TEXT
);

ALTER TABLE teams ADD COLUMN IF NOT EXISTS league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_teams_league ON teams(league_id);
