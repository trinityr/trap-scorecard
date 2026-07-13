CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS shooters (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (team_id, name)
);

CREATE TABLE IF NOT EXISTS rounds (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scores (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  shooter_id INTEGER NOT NULL REFERENCES shooters(id) ON DELETE CASCADE,
  station_1 SMALLINT,
  station_2 SMALLINT,
  station_3 SMALLINT,
  station_4 SMALLINT,
  station_5 SMALLINT,
  total SMALLINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shooters_team ON shooters(team_id);
CREATE INDEX IF NOT EXISTS idx_rounds_team ON rounds(team_id);
CREATE INDEX IF NOT EXISTS idx_scores_round ON scores(round_id);
CREATE INDEX IF NOT EXISTS idx_scores_shooter ON scores(shooter_id);
CREATE INDEX IF NOT EXISTS idx_rounds_date ON rounds(round_date);
