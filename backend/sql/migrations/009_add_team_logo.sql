-- Adds an optional team logo, stored directly as a base64 data URL (same
-- pattern as scoresheet photo uploads — no object storage needed for a
-- self-hosted deployment this size). Used as a gradient background behind
-- the Individual Leader and Leading Team callouts on the site-wide
-- scoreboard.
-- Run manually against an existing database:
--   docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/009_add_team_logo.sql
-- (swap trapadmin/trapscores for your actual POSTGRES_USER/POSTGRES_DB if you changed them)

ALTER TABLE teams ADD COLUMN IF NOT EXISTS logo_data TEXT;
