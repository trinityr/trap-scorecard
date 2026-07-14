-- Adds a round number, for clubs that shoot more than one round a night
-- (e.g. Round 1 and Round 2 on the same date). Defaults existing rows to 1.
-- Run manually against an existing database:
--   docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/005_add_round_number.sql
-- (swap trapadmin/trapscores for your actual POSTGRES_USER/POSTGRES_DB if you changed them)

ALTER TABLE rounds ADD COLUMN IF NOT EXISTS round_number SMALLINT NOT NULL DEFAULT 1;
