# Trap Scorecard

Docker Compose stack: Postgres + a Node/TypeScript API that also serves
the scorecard frontend as static files. SSL and the reverse proxy are
handled by your existing Nginx Proxy Manager VM, not by anything in this
stack.

![Trap Scorecard leaderboard screenshot](docs/screenshot.png)

## Layout
```
docker-compose.yml
.env.example
docs/
  cloud-migration-plan.md  <- notes for a future move off the home network onto a cloud host (not yet done)
mobile/
  capacitor.config.json    <- Capacitor shell wrapping backend/public for app-store distribution
  package.json
  README.md                <- setup/build instructions (needs Android Studio and/or Xcode, run locally)
backend/
  Dockerfile
  package.json
  tsconfig.json
  sql/init.sql             <- schema, auto-loaded on first Postgres start (fresh installs only)
  sql/migrations/
    001_add_teams.sql       <- run manually against an existing database to add team support
    002_add_auth.sql        <- run manually against an existing database to add user accounts
    003_add_user_name.sql   <- run manually to add the optional display-name column to users
    004_add_yardage.sql     <- run manually to add the yardage column to rounds
    005_add_round_number.sql <- run manually to add the round-number column to rounds
    006_add_substitutes.sql <- run manually to add substitute tracking to scores
    007_add_contact_info.sql <- run manually to add phone/address columns to users
    008_add_google_oauth_and_squad_leader.sql <- run manually to add Google sign-in + Squad Leader/approval columns
    009_add_team_logo.sql   <- run manually to add the team logo column
    010_add_leagues.sql     <- run manually to add the leagues table + teams.league_id
  public/
    index.html              <- the scorecard web app: sign-in/register + admin panel + scoring UI
    sw.js                    <- service worker (PWA installability + basic offline shell caching)
    site.webmanifest, favicon*, icon-*.png <- PWA/app icons
    vendor/tesseract/        <- vendored Tesseract.js (offline "Standard OCR" scoresheet reading)
  src/
    index.ts
    db.ts
    types.ts
    auth.ts                <- password hashing, requireAuth/requireAdmin/requireApprovedTeam middleware
    settings.ts             <- DB-backed runtime settings (falls back to .env)
    email.ts                <- nodemailer wrapper, SMTP config from DB settings (falls back to .env), never throws
    session.d.ts             <- TypeScript types for the session's logged-in user
    routes/auth.ts          <- POST /api/auth/register, /login, /google, /team, /logout, GET/PUT /me; emails the team's Squad Leaders/admins on a pending join request
    routes/admin.ts         <- admin-only: app settings (incl. SMTP), users, teams, leagues, shooters, rounds
    routes/teams.ts         <- GET /api/teams (public, needed for the registration form), PUT /api/teams/:id/logo
    routes/team.ts          <- pending team-join approvals, for Squad Leaders and admins
    routes/leagues.ts       <- GET /api/leagues (signed-in, no team required — browsable while teamless)
    routes/rounds.ts        <- POST/GET/DELETE /api/rounds (scoped to your session's team)
    routes/stats.ts         <- GET /api/stats/leaderboard, /api/stats/trends (scoped to your team)
    routes/site.ts          <- GET /api/site/leaderboard (cross-team scoreboard)
    routes/extract.ts       <- POST /api/extract (reads scoresheet photos via Claude)
    routes/public.ts        <- GET /api/public-settings (pre-login settings the sign-in page needs)
```

## Quick start

NPM runs on its own VM, separate from wherever this stack runs — so
instead of Docker network tricks, the api container just publishes its
port on this VM's network, and NPM proxies to that VM's IP.

1. Find this VM/container's LAN IP (`ip addr` or check it in the Proxmox
   UI) — you'll point NPM at this.
2. `cp .env.example .env` and fill in `POSTGRES_PASSWORD`, `API_HOST_IP`
   (this VM's own IP), `API_HOST_PORT` if 3000 is already taken by
   something else on this VM, `ANTHROPIC_API_KEY` (from
   https://console.anthropic.com/settings/keys), and `SESSION_SECRET`
   (generate one with `openssl rand -base64 32`). The API key and CORS
   origin are just bootstrap defaults now — see Accounts & admin below.
3. `docker compose up -d --build`
4. Visit `http://<this-vm-ip>:<API_HOST_PORT>/` in a browser — you should
   land on a sign-in/register screen.
5. Register the first account. It becomes an admin automatically and
   you'll be asked to create your team's name right there.
6. In the Nginx Proxy Manager UI, add a new **Proxy Host**:
   - Domain: your Cloudflare domain (e.g. `scores.yourclub.com`)
   - Forward Hostname/IP: this VM's LAN IP
   - Forward Port: whatever you set `API_HOST_PORT` to (default `3000`)
   - SSL tab: request a new **Let's Encrypt** certificate, force SSL,
     enable HTTP/2. Use NPM's **DNS Challenge** option with the
     Cloudflare provider and an API token if you'd rather not open port
     80 on your router at all.
7. Test from outside your LAN: visit `https://yourdomain.com/` — sign in
   there and confirm your session persists.

Make sure your Proxmox firewall (and the VM's own firewall, if any) allows
inbound traffic on your chosen `API_HOST_PORT` from the NPM VM's IP
specifically — no need to open it to the whole LAN, let alone the internet.

## Accounts & admin

Everyone needs an account to use the app now — no more anonymous shared
access. Registration asks for an email, password, and a team (join an
existing one or create a new one).

**Recommended: pre-seed an admin account via the LXC script** rather than
relying on self-registration for your first login. When you run
`create-trap-scorecard-lxc.sh`, it'll offer to create a known admin
account (email + a random 15-character password, both saved in the
credentials file and printed at the end) right after the containers come
up — independent of whether anyone ever uses the registration form. This
avoids being blocked if registration has an issue, and avoids the (small,
but real) risk of someone else beating you to the signup page and
becoming admin first if the app is reachable before you get to it.

If you skip that, the app falls back to its original behavior: **the
first account anyone creates via self-registration becomes admin
automatically.**

To pre-seed an admin account manually against an already-running
deployment (or to add a second admin later), the same script the LXC
tool uses is available directly:
```bash
docker compose exec -T api node dist/create-admin.js "you@yourclub.com" "a-real-password" "Your Team Name"
```
It's idempotent — running it again with the same email does nothing if
that account already exists.

Admins get an **Admin** tab in the app with:
- **App settings** — set/replace the Anthropic API key, restrict CORS to
  your real domain, and toggle whether new people can register at all
  (useful once your roster is set and you want to close the signup form).
  These are stored in the database and take effect immediately, no
  redeploy needed — the `.env` values are just what the app falls back to
  before an admin sets anything.
- **Users** — reassign anyone to a different team, promote/demote admins,
  or remove an account.
- **Teams** — create, rename, or delete teams at any time. Deleting a team
  also deletes every shooter, round, and score that belongs to it, so it's
  blocked while any user account is still assigned to that team — reassign
  or remove those users first.
- **Shooters** — add a shooter to a roster ahead of their first round,
  rename one (their score history follows, since it's tied to their
  account row, not their name), move them to a different team, or delete
  them (this also deletes all of their logged scores).
- **Rounds** — browse every round across every team and edit its date,
  round number, yardage, team, or individual scores (including who subbed
  for whom), or delete it outright — not limited to your own team the way
  the regular Team → New Round / History sub-tabs are. Changing the Team dropdown
  moves the round to that team and re-matches shooter names against its
  roster. Shooter-name and "subbing for" fields autocomplete against the
  full cross-team roster to cut down on typos. Each shooter row also has
  its own **Rnd** number — useful when a Read Scoresheet scan (or a manual
  entry mistake) combined two separate rounds into one saved record: give
  the rows that actually belong to a different round their own Rnd number
  and save, and they're split out into their own round record
  automatically, keeping the same date/yardage/team.

Admins also see a **Team** picker at the top of Team → New Round, so they
can log a round on behalf of any team, not just their own — the saved
round shows up under that team everywhere (Dashboard, History, Admin
Rounds), not the admin's own team.

Any signed-in user (not just admins) also gets a **Profile** tab to set an
optional display name, phone number, and mailing address — basic contact
info shown instead of their email around the app, and visible to admins in
the Users table.

Sessions are stored in Postgres (via `connect-pg-simple`) and last 30
days. If you ever change `SESSION_SECRET`, everyone gets signed out — this
is expected, not a bug.

### Google Sign-In

Optional. If configured, a "Continue with Google" button appears above the
regular sign-in/register form and works for both — Google's Identity
Services library hands back a signed ID token, which the server verifies
directly (no OAuth redirect dance, no client secret needed).

To set it up:
1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project (or reuse one), then go to **APIs & Services → Credentials**.
2. Configure the **OAuth consent screen** if you haven't already —
   "Internal" if everyone signing in is in your Google Workspace, otherwise
   "External" with a small, unverified test-user list is fine for a
   private club app.
3. Create an **OAuth 2.0 Client ID**, application type **Web application**.
   Add your app's real domain (the one behind Nginx Proxy Manager, e.g.
   `https://scores.yourclub.com`) as an **Authorized JavaScript origin**.
   No redirect URI is needed for this flow.
4. Copy the generated **Client ID** (looks like
   `xxxxxxxx.apps.googleusercontent.com`) into Admin → App settings →
   **Google Client ID**, and save. The button appears on the sign-in
   screen immediately — no redeploy needed. (You can also set
   `GOOGLE_CLIENT_ID` in `.env` as a fallback default, same pattern as
   `ANTHROPIC_API_KEY`.)

Behavior:
- If the Google account's email matches an existing password-based
  account, it's **auto-linked** — that person can then sign in either way.
- If it's a brand-new email, an account is created with no password (only
  usable via Google from then on) and the person is immediately walked
  through **picking a team** (see below), same as the tail end of
  registration.
- The very first account on the whole app becomes admin automatically
  whether created via Google or the regular form.

### Squad Leaders and team-join approval

Each team can have one or more **Squad Leaders** — a title an admin grants
from the Users table (or that's granted automatically to whoever creates a
brand-new team, since nobody else exists yet to grant it). A Squad Leader
is shown with a small orange "C" badge next to their name everywhere it
appears — Dashboard, Team Leaderboard, Trends legend, History, the
site-wide scoreboard, and the individual drilldown page — not just the
session bar and Admin Users table. They also get a **Team Admin** sub-tab
(inside the Team tab — see Navigation below) for approving people who've
asked to join their team, and for managing their team's logo (see Team
logos below).

Whenever someone picks an **existing** team — during registration, on the
post-Google-sign-in team picker, or any other time a teamless account
chooses a team — their membership starts out **pending**. They see a
"waiting for approval" screen instead of the app until a Squad Leader or
admin on that team approves them from Team → Team Admin (or an admin flips
their "Approved" checkbox directly in Admin → Users). Denying a request
clears their team so they can pick again.

Creating a **brand-new** team skips this entirely — the creator is
auto-approved and becomes that team's Squad Leader immediately, since
there's nobody else around yet who could approve them. The very first
account on the whole app is also auto-approved for the same reason.

### Team logos

A team's Squad Leader (for their own team) or an admin (for any team) can
upload a logo — from **Team → Team Admin**, or from Admin → Teams. Images are
resized client-side and stored directly in the database as a PNG data URL,
same approach as scoresheet photo uploads, so there's no separate object
storage to configure. Uploading a new logo replaces the old one; there's a
**Remove logo** option to clear it back to no logo.

The logo shows up as a subtle gradient background behind that team's box
on the Dashboard's site-wide scoreboard whenever the team, or one of its
shooters, is the individual/team leader — otherwise the callout falls back
to its normal plain background. Teams without a logo look exactly like
they always have.

**If you already had this app running before accounts were added**, run
this migration once against your existing database before deploying this
version:
```bash
docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/002_add_auth.sql
```
(swap `trapadmin`/`trapscores` for your actual `POSTGRES_USER`/`POSTGRES_DB`
if you changed them). It only adds the new tables — nothing you've already
entered is touched. After that, everyone just registers as normal; the
first person to do so becomes admin.

**If you already had accounts before the Profile tab, yardage, round
numbers, substitutes, contact info, Google sign-in, Squad Leaders, team
logos, or Leagues were added**, run these migrations once against your
existing database (all are additive — nothing existing is touched, and
everyone already on a team stays approved so nobody gets locked out):
```bash
docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/003_add_user_name.sql
docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/004_add_yardage.sql
docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/005_add_round_number.sql
docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/006_add_substitutes.sql
docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/007_add_contact_info.sql
docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/008_add_google_oauth_and_squad_leader.sql
docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/009_add_team_logo.sql
docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/010_add_leagues.sql
```

## Teams

Every round and shooter belongs to a team, so multiple teams/squads can
share the same deployment without seeing each other's data. Team
membership is now tied to your account (set at registration, changeable
by an admin afterward) rather than a browser-local switcher.

**If you already had this app running before teams were added at all**
(before accounts existed too), there's an earlier migration for that:
```bash
docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/001_add_teams.sql
```
This is very unlikely to apply to you if you're adopting both changes at
once — the auth migration above assumes teams already exist.

## Navigation

Signed-in users see four top-level tabs: **Dashboard**, **Team**, **League**,
and **Profile** (plus **Admin** for admins, and a temporary **Join a Team**
tab for teamless users — see Browsing without a team below).

Everything team-scoped now lives under the **Team** tab as four sub-tabs:
- **Team Dashboard** — team stats (rounds logged, active shooters, team
  average, best round ever), the full Team Leaderboard, and the full
  interactive Team Trends chart. This is what opens by default whenever you
  click the Team tab, and what "View full leaderboard" on the main
  Dashboard jumps to.
- **New Round** — upload a scoresheet photo or enter scores by hand (same
  flow as before, including the admin Team picker for logging a round on
  behalf of another team).
- **History** — every past round for your team, expandable for full
  station-by-station detail.
- **Team Admin** — only visible to that team's Squad Leaders and admins:
  pending join-request approvals and team logo management (previously the
  whole content of a standalone Team tab).

The Team tab (and its sub-tabs) is hidden entirely for teamless users, same
as the individual tabs it replaces used to be.

## Rounds, substitutes, and drilldown

Clubs that shoot more than one round a night can set a **Rnd** number on
each individual shooter row in New Round (auto-suggested from how many
rounds already exist for that date, but editable per row). If the Read
Scoresheet extraction — or a single manual entry session — actually covers
more than one round, just change the Rnd number on the rows that belong to
Round 2 before saving: on Save, rows get grouped by their Rnd number and
saved as separate round records automatically, all under the same date and
yardage. Round number shows up in History and the Admin round list/editor.

If someone filled in for a regular team member, put that member's name in
the **Subbing for** field next to the sub's row. This keeps two things true
at once:
- The sub's own score stays under their own name for individual purposes —
  their Trends line, their entry in the round history, and their
  **drilldown** page.
- On the **Team Leaderboard** (and the Dashboard's condensed team board)
  only, that score is rolled into the line of the team member they subbed
  for, so the team's roster average reflects a full squad even when someone
  was out. The subbed-for member's row shows a "(N subbed)" note when this
  has happened.

Site-wide stats, Trends, and drilldown never roll substitutions up — they
always reflect who actually pulled the trigger that round. In the History
tab, a shooter's name is followed by an asterisk (`*`) whenever that
appearance was as a substitute for someone else, in addition to the
existing "SUB for ___" tag.

Click any name in the Team Leaderboard (Team → Team Dashboard) or the main
Dashboard's condensed team board to open their **drilldown**: rounds shot,
average, best round, station-by-station accuracy, a trend chart, and a full
round-by-round history (each row tagged if it was shot as a substitute for
someone else).

## Dashboard

Signed-in users land on a Dashboard tab showing their own team's quick
stats (rounds logged, active shooters, team average, best round ever), a
condensed version of their team's leaderboard ("View full leaderboard"
jumps to Team → Team Dashboard), a condensed **Team Trends** chart (top 5
shooters by rounds shot, non-interactive — the full interactive version
with a clickable legend lives on Team → Team Dashboard), plus a **site-wide
scoreboard** ranking every shooter and every team across the whole
deployment — not just your own team — and a **Site Trends** chart: one
line plotting the average score across every team, per round date. The
site-wide scoreboard and Site Trends are visible even to teamless
(view-only) users; the team-scoped cards are not (see Browsing without a
team below). Ranking on the site-wide scoreboard is by total combined
score across every round ever logged (so it rewards consistent, frequent
shooting, not just a single good week). The leading individual and
leading team are called out prominently at the top, with a top-10 list
below each. If the leading individual's team, or the leading team itself,
has uploaded a logo, it's shown as a subtle gradient background on that
callout box (see Team logos below).

The header's station-accuracy arc always reflects whatever you're
currently looking at: your own team by default, or a single shooter's
own numbers when you're on their drilldown page — it swaps back the
moment you navigate away.

## Email alerts on pending team-join requests

Optional. When someone registers for (or later switches to) an existing
team, that team's Squad Leaders are emailed so they know to go approve
or deny the request from the **Team** tab — falling back to the team's
admins if it has no Squad Leader yet. Nothing else about the approval
flow changes; this is purely a notification.

Email is off until you configure SMTP in **Admin → App settings** (host,
port, username, password, and a From address like
`team@trapscores.yourdomain.com`). Until then, the app just logs a note
to the container logs (`docker compose logs api`) instead of sending
anything — registration and team-join requests work exactly the same
either way, since a missing or failing SMTP config never blocks the
request that triggered it. You can also set `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in `.env` as fallback defaults,
same pattern as `ANTHROPIC_API_KEY` and `GOOGLE_CLIENT_ID`.

## Light/dark theme

A toggle button in the top-right corner switches between the app's
default dark theme and a light theme. The choice is remembered per
browser (`localStorage`) and applies immediately, no reload needed.

## Installing as an app

Trap Stats is a Progressive Web App: a manifest (`site.webmanifest`), an
icon set, and a service worker (`sw.js`) let a phone or desktop browser
install it as a standalone app with its own home-screen icon, rather than
just bookmarking a tab.

- **Android/Chrome/Edge** — open the site, then use the browser's
  **Install app** option (in the address bar or the ⋮ menu).
- **iOS/Safari** — open the site, tap the Share icon, then **Add to Home
  Screen**.
- **Desktop Chrome/Edge** — an install icon appears in the address bar.

The service worker only caches the app shell and static icons, and always
prefers a fresh copy from the network when one's reachable — it exists to
satisfy install requirements and provide a basic offline fallback, not to
cache aggressively. It does not cache anything under `/api/`, so the app
still needs a live connection to actually load or submit scores. This
requires the deployment to be served over HTTPS (any modern reverse proxy
setup, including the Nginx Proxy Manager setup described above, already
does this).

### Real Android/iOS app (Capacitor)

The `mobile/` folder wraps this same web app in a [Capacitor](https://capacitorjs.com/)
native shell so it can be built, signed, and submitted to the Play Store /
App Store as an actual installable app, rather than a browser-installed
PWA. It reuses `backend/public` directly as its web assets — no separate
build step, no code fork. See `mobile/README.md` for setup; building and
publishing require tooling this repo doesn't include (Android Studio
and/or Xcode, plus your own developer accounts), so that part has to run
on your own machine.

## Reading a scoresheet: Claude Vision vs. Standard OCR

The **Read Scoresheet** step in New Round has two engines to choose from,
via the toggle above the "Read scoresheet" button:

- **Claude Vision** (default) — sends the photo to Claude's vision API
  (`POST /api/extract`, needs `ANTHROPIC_API_KEY` configured — see Admin →
  App settings). It understands the sheet as a table, handles cross-outs
  and corrections, and reads messy handwriting well. Requires internet.
- **Standard OCR** — runs entirely on-device using a vendored copy of
  [Tesseract.js](https://github.com/naptha/tesseract.js) (`backend/public/vendor/tesseract/`,
  ~11MB, cached by the service worker after first use). No network call,
  no API key, works offline — including inside the Capacitor app. It's
  plain text recognition with no understanding that it's looking at a
  scoresheet table, so a best-effort line parser tries to line numbers up
  into station columns; accuracy on handwriting is noticeably lower than
  Claude Vision. Always double-check the numbers it fills in before
  saving.

Either path lands in the same editable review table, so switching engines
or falling back to typing scores in by hand always works the same way.

## Leagues

Teams can optionally belong to a **League** — a separate entity with its
own name, location, contact info, schedule, and cost breakdown, intended
for deployments serving multiple clubs/teams across different leagues.
Every signed-in user (including teamless ones — see below) gets a
**League** tab listing every league on the deployment, with their own
team's league (if any) pinned to the top.

Admins manage leagues from **Admin → Leagues** (create, edit, delete) and
assign a team to a league from the League dropdown in **Admin → Teams**.
Deleting a league just clears the assignment on any team that had it —
nothing else about those teams is touched. A team with no league assigned
works exactly as before; leagues are entirely optional.

## Browsing without a team

You can now sign in (or register) without picking a team right away —
registration has a "Skip for now" option, and Google sign-in already
worked this way for brand-new accounts. A teamless account can still see
the site-wide scoreboard and Site Trends on the Dashboard and browse the
League tab, but the whole **Team** tab (Team Dashboard, New Round,
History, Team Admin) is hidden until they join a team, since there's no
team data to show. A dedicated **Join a team** tab appears right after
Dashboard for exactly this — pick an existing team (same pending-approval
flow as before) or start a new one (auto-approved, makes you its Squad
Leader). Everything else about a user's permissions (Profile, etc.) is
unaffected.

## API

- `POST /api/auth/register` — body: `{ "email", "password", "name" (optional), "teamId" or "newTeamName" or neither to stay teamless }` — joining an existing team starts out pending approval and emails that team's Squad Leaders/admins; creating a new team auto-approves you and makes you its Squad Leader; omitting both leaves you teamless (join later from the Join a Team tab)
- `POST /api/auth/login` — body: `{ "email", "password" }` — fails with a generic invalid-credentials error for Google-only accounts (no password on file)
- `POST /api/auth/google` — body: `{ "credential": "<Google ID token>" }` — verifies the token, signs in (auto-linking by verified email to an existing password account if one matches), or creates a new teamless account
- `POST /api/auth/team` — body: `{ "teamId" }` or `{ "newTeamName" }` — requires sign-in (with or without a team already); same approval/Squad Leader/email-notification rules as registration
- `POST /api/auth/logout`
- `GET /api/auth/me` — current session user, or 401
- `PUT /api/auth/me` — body: `{ "name", "phone", "address" }` — requires sign-in, sets/clears your own display name and contact info
- `GET /api/public-settings` — public, currently just `{ googleClientId }` so the sign-in page knows whether to render the Google button
- `GET /api/team/pending` — requires being a Squad Leader or admin, lists accounts awaiting approval on your own team
- `POST /api/team/pending/:id/approve` — Squad Leader or admin, approves a pending teammate
- `POST /api/team/pending/:id/deny` — Squad Leader or admin, clears the pending account's team so they can pick again
- `GET /api/team/squad-leaders` — requires sign-in, every Squad Leader across every team as `{ name, team_id }` — used to badge their name everywhere they appear, not just their own team's views
- `GET /api/admin/settings` / `PUT /api/admin/settings` (now includes `google_client_id`, `smtp_host`, `smtp_port`, `smtp_user`, `smtp_from`, and `smtp_pass_set`/`smtp_pass`) — admin only
- `GET /api/admin/users` (includes `phone`, `is_squad_leader`, `team_approved`) / `PUT /api/admin/users/:id` (body: `{ "isAdmin"?, "isSquadLeader"?, "teamApproved"?, "teamId"? }`) / `DELETE /api/admin/users/:id` — admin only
- `POST /api/admin/teams` — admin only, create a team
- `PUT /api/admin/teams/:id` — admin only, body: `{ "name", "leagueId"? }`, rename a team and/or assign/clear its league (omit `leagueId` to leave it untouched, `null`/falsy to clear it)
- `DELETE /api/admin/teams/:id` — admin only, cascades to that team's shooters/rounds/scores; blocked while users are still assigned to it
- `GET /api/leagues` — requires sign-in only (no team needed), every league's full info
- `POST /api/admin/leagues` — admin only, body: `{ "name" }`
- `PUT /api/admin/leagues/:id` — admin only, body: `{ "name", "location"?, "contactName"?, "contactEmail"?, "contactPhone"?, "scheduleText"?, "costsText"?, "description"? }`
- `DELETE /api/admin/leagues/:id` — admin only, clears the league assignment on any team that had it; deletes nothing else
- `GET /api/admin/shooters` — admin only, every shooter across every team with a round count
- `POST /api/admin/shooters` — admin only, body: `{ "name", "teamId" }`
- `PUT /api/admin/shooters/:id` — admin only, body: `{ "name"?, "teamId"? }` — rename and/or reassign team
- `DELETE /api/admin/shooters/:id` — admin only, also deletes that shooter's score history
- `GET /api/admin/rounds` — admin only, every round across every team
- `GET /api/admin/rounds/:id` — admin only, full shooter/score detail for one round, including who subbed for whom
- `PUT /api/admin/rounds/:id` — admin only, body: `{ "date", "yardage", "roundNumber", "teamId"?, "shooters": [{ "name", "stations", "total", "subFor"?, "roundNumber"? }] }` — replaces the round's date/round number/yardage/scores; passing a different `teamId` moves the round to that team and re-matches shooters against its roster. If any shooter's own `roundNumber` differs from the round's, those shooters are split out into new round records (same date/yardage/team) instead of being saved onto this one; the response includes `{ ok: true, splitIntoRoundIds: [...] }` listing the newly created round IDs (empty if nothing was split)
- `DELETE /api/admin/rounds/:id` — admin only, deletes any round regardless of team
- `GET /api/teams` — list all teams (public, used by the registration form), each including `logo_data`, `league_id`, `league_name`
- `PUT /api/teams/:id/logo` — requires sign-in as that team's Squad Leader or an admin, body: `{ "logoData": "data:image/...;base64,..." }` to set or `{ "logoData": null }` to clear
- `POST /api/rounds` — body: `{ "date": "YYYY-MM-DD", "yardage": n or null, "roundNumber": n (default 1), "teamId"? (admin only, logs the round for a different team), "shooters": [{ "name", "stations": [n,n,n,n,n], "total": n, "subFor": "team member's name" or null }] }` — requires sign-in **and an approved team**, scoped to your team automatically (non-admins can't override `teamId`)
- `GET /api/rounds` — every saved round for your team, each shooter entry includes `subFor` if they were subbing — requires sign-in and an approved team
- `DELETE /api/rounds/:id` — requires sign-in, only deletes rounds belonging to your own team
- `GET /api/stats/leaderboard` — requires sign-in and an approved team, scoped to your team, **rolls substitute scores into the team member they subbed for**
- `GET /api/stats/trends` — requires sign-in and an approved team, scoped to your team, per actual shooter (never rolled up)
- `GET /api/site/leaderboard` — requires sign-in, cross-team scoreboard: `{ individuals: [...], teams: [...] }`, each ranked by total combined score, top 10, never rolled up
- `GET /api/site/trends` — requires sign-in only (no team needed), `[{ "date", "avg" }, ...]` — the average score across every team/shooter for each round date, powers the Dashboard's Site Trends chart
- `POST /api/extract` — body: `{ "image": "<base64, no data: prefix>" }` — requires sign-in and an approved team, returns parsed `{date, yardage, shooters}` read from the photo

Routes marked "requires an approved team" return `403` for a signed-in
account that hasn't picked a team yet, or whose join request is still
pending — the frontend routes those cases to the team-pick or
waiting-for-approval screen automatically rather than hitting these
endpoints in the first place.

## Local development without Docker

```
cd backend
npm install
npm run dev   # requires a local Postgres reachable via DATABASE_URL, plus ANTHROPIC_API_KEY and SESSION_SECRET set
```
