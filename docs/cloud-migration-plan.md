# Future cloud migration plan (not yet executed)

This is a plan for later, if/when it's worth moving Trap Stats off the
home Proxmox VM + Nginx Proxy Manager setup and onto a cloud host instead.
Nothing here has been done — it's notes for when that day comes.

## Why

The current deployment depends on the home network: a Proxmox VM runs the
`db` + `api` containers, a separate NPM (Nginx Proxy Manager) VM reverse-proxies
to it, and the whole thing is only reachable because of port-forwarding /
DNS pointed at a home internet connection. Moving to a cloud host removes
that dependency — the app stays reachable even if the home network, router,
or ISP has an issue, and there's no port-forwarding exposure on the home
LAN.

## What doesn't change

This is the main reason cloud hosting is the cheap option compared to a
full offline rewrite: almost nothing about the app itself changes.

- Same `docker-compose.yml`, same two services (`db`, `api`), same
  `backend/Dockerfile`.
- Same Postgres schema and migrations.
- Google Sign-In, team join-approval + email alerts, Leagues, the
  site-wide leaderboard, and the Admin panel all keep working exactly as
  they do today — none of that depends on where the server happens to
  live.
- The Claude-based scoresheet OCR keeps working as-is (it already needs
  internet).
- The frontend (`backend/public/index.html`) doesn't need any changes
  other than pointing at the new URL.

## What actually moves

1. **Where `docker-compose up` runs** — instead of the home Proxmox VM,
   a small cloud VPS (e.g. Hetzner, DigitalOcean, Linode) or a
   platform-as-a-service host (Railway, Fly.io, Render) that can run
   Docker Compose directly.
2. **The database** — either keep running Postgres in its own container
   on that same VPS (simplest, no code changes), or switch to a managed
   Postgres provider (Neon, Supabase, RDS, the PaaS host's own managed
   DB) if not wanting to manage backups/upgrades by hand. Either way, it's
   just a connection string (`POSTGRES_HOST`/`PORT`/`DB`/`USER`/`PASSWORD`
   in `.env`) — the app code doesn't care which.
3. **DNS + TLS** — point the domain at the new host instead of the home
   network's IP. A cloud VPS can run its own reverse proxy (Caddy or
   Nginx with Let's Encrypt) in place of the home NPM instance, or a PaaS
   host handles TLS automatically.
4. **Secrets** — `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`,
   SMTP credentials, etc. get copied into the new host's `.env` /
   environment config. Same variables as today, per `.env.example`.

## Rough cost

Ballpark only — check current pricing when actually doing this. A small
VPS (1-2GB RAM) running both containers typically runs somewhere in the
$5-15/month range; a managed Postgres tier (if used instead of
self-managed) is often in a similar range or has a free/low-usage tier
depending on provider. Total is usually well under $30/month for an app
this size.

## Rollback

Since nothing about the app itself changes, rolling back just means
pointing DNS back at the home network and restarting the containers
there — the home deployment doesn't need to be torn down until the cloud
one has been running successfully for a while.

## When to actually do this

Worth revisiting once usage grows enough that home-network reliability or
exposure becomes a real concern — not before. Until then, self-hosting on
the home Proxmox VM is the cheaper and simpler option.
