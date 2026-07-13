# Trap Scorecard

Docker Compose stack: Postgres + a Node/TypeScript API that also serves
the scorecard frontend as static files. SSL and the reverse proxy are
handled by your existing Nginx Proxy Manager VM, not by anything in this
stack.

## Layout
```
docker-compose.yml
.env.example
backend/
  Dockerfile
  package.json
  tsconfig.json
  sql/init.sql             <- schema, auto-loaded on first Postgres start (fresh installs only)
  sql/migrations/
    001_add_teams.sql       <- run manually against an existing database to add team support
  public/
    index.html              <- the actual scorecard web app (served at "/")
  src/
    index.ts
    db.ts
    types.ts
    routes/teams.ts        <- GET/POST /api/teams
    routes/rounds.ts       <- POST/GET/DELETE /api/rounds (scoped by teamId)
    routes/stats.ts        <- GET /api/stats/leaderboard, /api/stats/trends (scoped by teamId)
    routes/extract.ts      <- POST /api/extract (reads scoresheet photos via Claude)
```

## Quick start

NPM runs on its own VM, separate from wherever this stack runs — so
instead of Docker network tricks, the api container just publishes its
port on this VM's network, and NPM proxies to that VM's IP.

1. Find this VM/container's LAN IP (`ip addr` or check it in the Proxmox
   UI) — you'll point NPM at this.
2. `cp .env.example .env` and fill in `POSTGRES_PASSWORD`, `API_HOST_IP`
   (this VM's own IP), `API_HOST_PORT` if 3000 is already taken by
   something else on this VM, and `ANTHROPIC_API_KEY` (from
   https://console.anthropic.com/settings/keys — required, this is what
   lets the app read scoresheet photos).
3. `docker compose up -d --build`
4. Visit `http://<this-vm-ip>:<API_HOST_PORT>/` in a browser — you should
   see the actual scorecard app, not just a JSON response.
5. In the Nginx Proxy Manager UI, add a new **Proxy Host**:
   - Domain: your Cloudflare domain (e.g. `scores.yourclub.com`)
   - Forward Hostname/IP: this VM's LAN IP
   - Forward Port: whatever you set `API_HOST_PORT` to (default `3000`)
   - SSL tab: request a new **Let's Encrypt** certificate, force SSL,
     enable HTTP/2. Use NPM's **DNS Challenge** option with the
     Cloudflare provider and an API token if you'd rather not open port
     80 on your router at all.
6. Test from outside your LAN: visit `https://yourdomain.com/` — the
   scorecard app should load there directly, ready for the whole team.

Make sure your Proxmox firewall (and the VM's own firewall, if any) allows
inbound traffic on your chosen `API_HOST_PORT` from the NPM VM's IP
specifically — no need to open it to the whole LAN, let alone the internet.

## Teams

Every round and shooter belongs to a team, so multiple teams/squads can
share the same deployment without seeing each other's data. The app
prompts you to create a team the first time it's opened, remembers your
choice per browser, and shows a switcher at the top if there's more than
one.

**If you already had this app running before teams were added**, run the
migration once against your existing database before deploying this
version — it moves everything you've already entered into a "Default
Team" instead of losing it:
```bash
docker compose exec -T db psql -U trapadmin -d trapscores < backend/sql/migrations/001_add_teams.sql
```
(swap `trapadmin`/`trapscores` for your actual `POSTGRES_USER`/`POSTGRES_DB`
if you changed them). Afterward, rename it from the app's team switcher,
or directly: `UPDATE teams SET name = 'Your Real Name' WHERE name = 'Default Team';`

## API

- `GET /api/teams` — list all teams
- `POST /api/teams` — body: `{ "name": "..." }`, creates a team or returns the existing one with that name
- `POST /api/rounds` — body: `{ "teamId": n, "date": "YYYY-MM-DD", "shooters": [{ "name": "...", "stations": [n,n,n,n,n], "total": n }] }`
- `GET /api/rounds?teamId=n` — every saved round with scores, for one team
- `DELETE /api/rounds/:id` — remove a round
- `GET /api/stats/leaderboard?teamId=n` — averages, best score, per-station averages, sorted best-first
- `GET /api/stats/trends?teamId=n` — each shooter's score history over time, for charting
- `POST /api/extract` — body: `{ "image": "<base64, no data: prefix>" }`, returns parsed `{date, shooters}` read from the photo (not team-scoped — it's a stateless read of the photo)

## Local development without Docker

```
cd backend
npm install
npm run dev   # requires a local Postgres reachable via DATABASE_URL, and ANTHROPIC_API_KEY set
```
