#!/usr/bin/env bash
#
# create-trap-scorecard-lxc.sh
#
# Run this ON THE PROXMOX HOST (as root) to create an LXC container,
# install Docker inside it, and deploy the trap-scorecard stack.
#
# Usage (from a GitHub repo — recommended):
#   REPO_URL=https://github.com/<you>/trap-scorecard.git ./create-trap-scorecard-lxc.sh
#
# Usage (from a local zip instead):
#   ./create-trap-scorecard-lxc.sh
#   (expects trap-scorecard-backend.zip in the same directory, or set ZIP_PATH)
#
# Override any other default by exporting it first, e.g.:
#   CTID=210 MEMORY=4096 NET_CONFIG=192.168.1.50/24,gw=192.168.1.1 \
#     REPO_URL=https://github.com/you/trap-scorecard.git ./create-trap-scorecard-lxc.sh

set -euo pipefail

# ---------- Config (override via env vars) ----------
HOSTNAME="${HOSTNAME:-trap-scorecard}"
CORES="${CORES:-2}"
MEMORY="${MEMORY:-2048}"
DISK_GB="${DISK_GB:-8}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
BRIDGE="${BRIDGE:-vmbr0}"
NET_CONFIG="${NET_CONFIG:-dhcp}"          # "dhcp" or e.g. "192.168.1.50/24,gw=192.168.1.1"
CTID="${CTID:-}"                          # blank = auto-pick next free ID
CT_PASSWORD="${CT_PASSWORD:-}"            # blank = auto-generate
TEMPLATE_PATTERN="${TEMPLATE_PATTERN:-debian-12-standard}"
REPO_URL="${REPO_URL:-}"                  # e.g. https://github.com/you/trap-scorecard.git
REPO_BRANCH="${REPO_BRANCH:-main}"
ZIP_PATH="${ZIP_PATH:-./trap-scorecard-backend.zip}"  # fallback if REPO_URL is not set

log()  { echo -e "\n\033[1;32m==>\033[0m $1"; }
fail() { echo -e "\n\033[1;31mERROR:\033[0m $1" >&2; exit 1; }

# ---------- Sanity checks ----------
[ "$(id -u)" -eq 0 ] || fail "Run this as root on the Proxmox host."
command -v pct >/dev/null 2>&1 || fail "pct not found — this must run on a Proxmox host, not inside a container."
if [ -z "$REPO_URL" ] && [ ! -f "$ZIP_PATH" ]; then
  fail "Set REPO_URL to your GitHub repo, or put trap-scorecard-backend.zip next to this script."
fi

if [ -z "$CT_PASSWORD" ]; then
  CT_PASSWORD="$(openssl rand -base64 18)"
fi

if [ -z "$CTID" ]; then
  CTID="$(pvesh get /cluster/nextid)"
fi

log "Using container ID $CTID"

# ---------- Template ----------
log "Checking for a Debian 12 template"
TEMPLATE="$(pveam list "$TEMPLATE_STORAGE" | awk '{print $1}' | grep "$TEMPLATE_PATTERN" | sort | tail -n1 || true)"
if [ -z "$TEMPLATE" ]; then
  log "No local template found — downloading one"
  pveam update
  LATEST="$(pveam available | grep "$TEMPLATE_PATTERN" | awk '{print $2}' | sort | tail -n1)"
  [ -n "$LATEST" ] || fail "Couldn't find a $TEMPLATE_PATTERN template to download."
  pveam download "$TEMPLATE_STORAGE" "$LATEST"
  TEMPLATE="${TEMPLATE_STORAGE}:vztmpl/${LATEST}"
fi
log "Using template: $TEMPLATE"

# ---------- Network config string ----------
if [ "$NET_CONFIG" = "dhcp" ]; then
  NET0="name=eth0,bridge=${BRIDGE},firewall=1,ip=dhcp"
else
  NET0="name=eth0,bridge=${BRIDGE},firewall=1,ip=${NET_CONFIG}"
fi

# ---------- Create container ----------
log "Creating LXC container $CTID ($HOSTNAME)"
pct create "$CTID" "$TEMPLATE" \
  --hostname "$HOSTNAME" \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --swap 512 \
  --rootfs "${STORAGE}:${DISK_GB}" \
  --net0 "$NET0" \
  --unprivileged 1 \
  --features nesting=1,keyctl=1 \
  --password "$CT_PASSWORD" \
  --onboot 1

log "Starting container"
pct start "$CTID"

log "Waiting for network"
for i in $(seq 1 30); do
  IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [ -n "$IP" ] && break
  sleep 2
done
[ -n "$IP" ] || fail "Container never got an IP address. Check networking and try again."
log "Container IP: $IP"

# ---------- Install Docker inside the container ----------
log "Installing Docker and git (this takes a minute)"
pct exec "$CTID" -- bash -c "
  set -e
  apt-get update -y
  apt-get upgrade -y
  apt-get install -y curl unzip git ca-certificates
  curl -fsSL https://get.docker.com | sh
  apt-get install -y docker-compose-plugin
"

# ---------- Ship the project in ----------
if [ -n "$REPO_URL" ]; then
  log "Cloning $REPO_URL (branch: $REPO_BRANCH)"
  pct exec "$CTID" -- bash -c "
    set -e
    cd /root
    git clone --branch '$REPO_BRANCH' --depth 1 '$REPO_URL' trap-scorecard
  "
else
  log "No REPO_URL set — falling back to copying trap-scorecard-backend.zip into the container"
  pct push "$CTID" "$ZIP_PATH" /root/trap-scorecard-backend.zip
  pct exec "$CTID" -- bash -c "cd /root && unzip -o trap-scorecard-backend.zip"
fi

log "Configuring .env"
POSTGRES_PW="$(openssl rand -base64 24)"
pct exec "$CTID" -- bash -c "
  set -e
  cd /root/trap-scorecard
  cp .env.example .env
  sed -i 's|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PW}|' .env
  sed -i 's|^API_HOST_IP=.*|API_HOST_IP=${IP}|' .env
"

log "Building and starting the stack (this takes a few minutes on first run)"
pct exec "$CTID" -- bash -c "cd /root/trap-scorecard && docker compose up -d --build"

log "Waiting for the API to come up"
for i in $(seq 1 20); do
  if pct exec "$CTID" -- curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 3
done

echo
echo "=================================================================="
echo " Container:        CT $CTID ($HOSTNAME) at $IP"
echo " Root password:     $CT_PASSWORD"
echo " Postgres password: $POSTGRES_PW"
echo " (both also saved in /root/.env inside the container)"
if [ "${HEALTHY:-0}" = "1" ]; then
  echo " API health check:  OK  (curl http://$IP:3000/api/health)"
else
  echo " API health check:  NOT RESPONDING YET — check with:"
  echo "   pct exec $CTID -- docker compose -f /root/trap-scorecard/docker-compose.yml logs"
fi
echo
echo " Next steps:"
echo " 1. Give this container a DHCP reservation for $IP so it never changes."
echo " 2. In Nginx Proxy Manager, add a Proxy Host forwarding your domain"
echo "    to $IP : 3000, and request a Let's Encrypt cert."
echo " 3. Firewall port 3000 on this container down to just the NPM VM's IP."
if [ -n "$REPO_URL" ]; then
echo " 4. To deploy future updates:"
echo "    pct exec $CTID -- bash -c 'cd /root/trap-scorecard && git pull && docker compose up -d --build'"
fi
echo "=================================================================="
