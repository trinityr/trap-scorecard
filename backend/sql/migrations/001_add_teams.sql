-- Adds team support to an existing trap-scorecard database.
-- Safe to run more than once (every step is idempotent).
-- Everything you've already entered gets assigned to a team called
-- "Default Team" — rename it afterward with:
--   UPDATE teams SET name = 'Your Real Team Name' WHERE name = 'Default Team';

BEGIN;

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

INSERT INTO teams (name)
  VALUES ('Default Team')
  ON CONFLICT (name) DO NOTHING;

-- shooters: add team_id, backfill, then enforce it
ALTER TABLE shooters ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE;

UPDATE shooters
  SET team_id = (SELECT id FROM teams WHERE name = 'Default Team')
  WHERE team_id IS NULL;

ALTER TABLE shooters ALTER COLUMN team_id SET NOT NULL;

-- Replace the old global-unique-name constraint with one scoped per team
ALTER TABLE shooters DROP CONSTRAINT IF EXISTS shooters_name_key;
ALTER TABLE shooters DROP CONSTRAINT IF EXISTS shooters_team_id_name_key;
ALTER TABLE shooters ADD CONSTRAINT shooters_team_id_name_key UNIQUE (team_id, name);

-- rounds: same pattern
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE;

UPDATE rounds
  SET team_id = (SELECT id FROM teams WHERE name = 'Default Team')
  WHERE team_id IS NULL;

ALTER TABLE rounds ALTER COLUMN team_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shooters_team ON shooters(team_id);
CREATE INDEX IF NOT EXISTS idx_rounds_team ON rounds(team_id);

COMMIT;
