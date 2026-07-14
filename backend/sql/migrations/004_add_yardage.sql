-- Adds a yardage field to rounds (one value per round — the distance the
-- whole squad shot from that day, e.g. 16-yard singles).
-- Run manually against an existing database:
--   docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/004_add_yardage.sql
-- (swap trapadmin/trapscores for your actual POSTGRES_USER/POSTGRES_DB if you changed them)

ALTER TABLE rounds ADD COLUMN IF NOT EXISTS yardage SMALLINT;
