CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  address TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- connect-pg-simple's session store. We create this ourselves rather
-- than relying on its own createTableIfMissing option, because that
-- creates the table lazily on first use — on a brand-new database, the
-- very first incoming request can arrive before that finishes, causing
-- the store to error out. Pre-creating it here removes that race
-- entirely. Schema matches connect-pg-simple's own default exactly.
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey'
  ) THEN
    ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

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
  round_number SMALLINT NOT NULL DEFAULT 1,
  yardage SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scores (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  shooter_id INTEGER NOT NULL REFERENCES shooters(id) ON DELETE CASCADE,
  -- Set when shooter_id shot as a substitute filling in for another team
  -- member that night. The sub's own score row (and thus their individual
  -- stats/trends/drilldown) always stays attributed to shooter_id; only the
  -- Team Leaderboard rolls this score into sub_for_shooter_id's line.
  sub_for_shooter_id INTEGER REFERENCES shooters(id) ON DELETE SET NULL,
  station_1 SMALLINT,
  station_2 SMALLINT,
  station_3 SMALLINT,
  station_4 SMALLINT,
  station_5 SMALLINT,
  total SMALLINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shooters_team ON shooters(team_id);
CREATE INDEX IF NOT EXISTS idx_rounds_team ON rounds(team_id);
CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id);
CREATE INDEX IF NOT EXISTS idx_scores_round ON scores(round_id);
CREATE INDEX IF NOT EXISTS idx_scores_shooter ON scores(shooter_id);
CREATE INDEX IF NOT EXISTS idx_scores_sub_for ON scores(sub_for_shooter_id);
CREATE INDEX IF NOT EXISTS idx_rounds_date ON rounds(round_date);
