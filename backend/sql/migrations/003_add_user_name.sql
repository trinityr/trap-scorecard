-- Adds an optional display name to user accounts, for the Profile tab.
-- Run manually against an existing database:
--   docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/003_add_user_name.sql
-- (swap trapadmin/trapscores for your actual POSTGRES_USER/POSTGRES_DB if you changed them)

ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
