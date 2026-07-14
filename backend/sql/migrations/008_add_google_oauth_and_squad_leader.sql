-- Adds Google OAuth sign-in and the Squad Leader role with a team-join
-- approval workflow.
-- Run manually against an existing database:
--   docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/008_add_google_oauth_and_squad_leader.sql
-- (swap trapadmin/trapscores for your actual POSTGRES_USER/POSTGRES_DB if you changed them)

-- Google-only accounts have no password.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Links an account to a Google identity (the token's "sub" claim). Null for
-- password-only accounts. A password account signing in with Google for the
-- first time gets auto-linked here by matching verified email address.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;

-- Squad Leader: a per-team title, toggled by an admin (or auto-granted to
-- whoever creates a brand-new team). Squad Leaders can approve pending
-- teammates for their own team, same as an admin can.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_squad_leader BOOLEAN NOT NULL DEFAULT false;

-- Whether this account's team membership has been approved. Existing rows
-- default to true so nobody already on a team gets locked out by this
-- migration. New signups joining an EXISTING team start out false and need
-- a Squad Leader or admin to approve them; someone creating a brand-new
-- team (or the very first account on the whole app) is auto-approved, since
-- there's nobody else yet who could approve them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_approved BOOLEAN NOT NULL DEFAULT true;
