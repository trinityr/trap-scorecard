# Trap Scorecard — backend

Docker Compose stack: Postgres + a Node/TypeScript API. SSL and the
reverse proxy are handled by your existing Nginx Proxy Manager VM, not by
anything in this stack.

## Layout
```
docker-compose.yml
.env.example
backend/
  Dockerfile
  package.json
  tsconfig.json
  sql/init.sql             <- schema, auto-loaded on first Postgres start
  src/
    index.ts
    db.ts
    types.ts
    routes/rounds.ts       <- POST/GET/DELETE /api/rounds
    routes/stats.ts        <- GET /api/stats/leaderboard, /api/stats/trends
```

## Quick start

NPM runs on its own VM, separate from wherever this stack runs — so
instead of Docker network tricks, the api container just publishes its
port on this VM's network, and NPM proxies to that VM's IP.

1. Find this VM/container's LAN IP (`ip addr` or check it in the Proxmox
   UI) — you'll point NPM at this.
2. `cp .env.example .env` and fill in `POSTGRES_PASSWORD` and `API_HOST_IP`
   (this VM's own IP, so the port only binds on your internal network).
3. `docker compose up -d --build`
4. Confirm it's reachable from the NPM VM: `curl http://<this-vm-ip>:3000/api/health`
5. In the Nginx Proxy Manager UI, add a new **Proxy Host**:
   - Domain: your Cloudflare domain (e.g. `scores.yourclub.com`)
   - Forward Hostname/IP: this VM's LAN IP
   - Forward Port: `3000`
   - SSL tab: request a new **Let's Encrypt** certificate, force SSL,
     enable HTTP/2. Use NPM's **DNS Challenge** option with the
     Cloudflare provider and an API token if you'd rather not open port
     80 on your router at all.
6. Test from outside your LAN: `curl https://yourdomain.com/api/health` → `{"status":"ok"}`

Make sure your Proxmox firewall (and the VM's own firewall, if any) allows
inbound traffic on port 3000 from the NPM VM's IP specifically — no need
to open it to the whole LAN, let alone the internet.

## API

- `POST /api/rounds` — body: `{ "date": "YYYY-MM-DD", "shooters": [{ "name": "...", "stations": [n,n,n,n,n], "total": n }] }`
- `GET /api/rounds` — every saved round with scores
- `DELETE /api/rounds/:id` — remove a round
- `GET /api/stats/leaderboard` — averages, best score, per-station averages, sorted best-first
- `GET /api/stats/trends` — each shooter's score history over time, for charting

## Wiring up the frontend

Point your web/mobile app's requests at `https://yourdomain.com/api/...`
instead of calling the Anthropic API directly from the browser — the AI
vision call for reading the scoresheet photo should move server-side too
(add a route here that receives the photo, calls the Claude API with your
key from an env var, and returns the parsed JSON). That keeps your API key
off the client entirely.

## Local development without Docker

```
cd backend
npm install
npm run dev   # requires a local Postgres reachable via DATABASE_URL
```
