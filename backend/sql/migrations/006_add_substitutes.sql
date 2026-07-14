-- Lets a score row record that the shooter was subbing for another team
-- member that night. The sub's own score always stays attributed to them
-- for individual stats/trends; only the Team Leaderboard rolls it into the
-- subbed-for member's line.
-- Run manually against an existing database:
--   docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/006_add_substitutes.sql
-- (swap trapadmin/trapscores for your actual POSTGRES_USER/POSTGRES_DB if you changed them)

ALTER TABLE scores ADD COLUMN IF NOT EXISTS sub_for_shooter_id INTEGER REFERENCES shooters(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_scores_sub_for ON scores(sub_for_shooter_id);
