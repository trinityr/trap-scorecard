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
# Run with no env vars set at all and this drops you into an interactive
# wizard that asks for every setting below, one at a time, showing the
# default in [brackets] — just hit Enter to accept it. Set NONINTERACTIVE=1
# (or pass any of these as env vars) to skip the wizard and run straight
# through with defaults, for scripted/repeat deploys.
#
# Override any default by exporting it first, e.g.:
#   CTID=210 MEMORY=4096 NET_CONFIG=192.168.1.50/24,gw=192.168.1.1 \
#     REPO_URL=https://github.com/you/trap-scorecard.git ./create-trap-scorecard-lxc.sh
#
# To configure the app's .env at deploy time, set any of:
#   POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, CORS_ORIGIN
# e.g.:
#   REPO_URL=https://github.com/you/trap-scorecard.git \
#   POSTGRES_PASSWORD='my-real-password' \
#   CORS_ORIGIN='https://scores.yourclub.com' \
#   ./create-trap-scorecard-lxc.sh

set -euo pipefail

# ---------- Config (override via env vars) ----------
CT_HOSTNAME="${CT_HOSTNAME:-trap-scorecard}"
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

# .env values for the app itself — override any of these to configure the
# deployment; anything left blank gets a sensible default or is generated.
POSTGRES_DB="${POSTGRES_DB:-trapscores}"
POSTGRES_USER="${POSTGRES_USER:-trapadmin}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"   # blank = auto-generate
CORS_ORIGIN="${CORS_ORIGIN:-*}"              # set to your real frontend origin once you have one
API_HOST_PORT="${API_HOST_PORT:-3000}"       # published port on this VM — change if 3000 is already taken
AUTO_LOGIN_CONSOLE="${AUTO_LOGIN_CONSOLE:-0}" # 1 = passwordless root login on `pct console`
NONINTERACTIVE="${NONINTERACTIVE:-0}"         # 1 = skip the wizard, use defaults/env vars as-is

log()  { echo -e "\n\033[1;32m==>\033[0m $1"; }
fail() { echo -e "\n\033[1;31mERROR:\033[0m $1" >&2; exit 1; }

prompt() {
  # prompt VAR "Label" "default"  -- sets VAR to user input, or default if blank
  local __var="$1" __label="$2" __default="$3" __input
  read -rp "$__label [$__default]: " __input
  printf -v "$__var" '%s' "${__input:-$__default}"
}

confirm() {
  # confirm "Label" y|n  -- returns 0 (true) for yes
  local __label="$1" __default="$2" __suffix="[y/N]" __input
  [ "$__default" = "y" ] && __suffix="[Y/n]"
  read -rp "$__label $__suffix: " __input
  __input="${__input:-$__default}"
  [[ "$__input" =~ ^[Yy] ]]
}

run_wizard() {
  echo "=========================================================="
  echo " Trap Scorecard LXC deploy — interactive setup"
  echo " Press Enter on any question to accept the default shown."
  echo "=========================================================="
  prompt CT_HOSTNAME "Container hostname" "$CT_HOSTNAME"
  prompt CTID "Container ID (blank = auto-pick next free)" "${CTID:-auto}"
  [ "$CTID" = "auto" ] && CTID=""
  prompt CORES "CPU cores" "$CORES"
  prompt MEMORY "Memory in MB" "$MEMORY"
  prompt DISK_GB "Disk size in GB" "$DISK_GB"
  prompt STORAGE "Storage pool for the container's disk" "$STORAGE"
  prompt BRIDGE "Network bridge" "$BRIDGE"

  if confirm "Use a static IP instead of DHCP?" n; then
    local ip_cidr gw
    prompt ip_cidr "Static IP with CIDR, e.g. 192.168.1.50/24" ""
    prompt gw "Gateway IP" ""
    NET_CONFIG="${ip_cidr},gw=${gw}"
  else
    NET_CONFIG="dhcp"
  fi

  prompt CT_PASSWORD "Root console password (blank = auto-generate)" "${CT_PASSWORD:-auto-generate}"
  [ "$CT_PASSWORD" = "auto-generate" ] && CT_PASSWORD=""

  prompt REPO_URL "GitHub repo URL (blank = use a local zip instead)" "$REPO_URL"
  if [ -n "$REPO_URL" ]; then
    prompt REPO_BRANCH "Branch to deploy" "$REPO_BRANCH"
  else
    prompt ZIP_PATH "Path to trap-scorecard-backend.zip" "$ZIP_PATH"
  fi

  prompt POSTGRES_DB "Postgres database name" "$POSTGRES_DB"
  prompt POSTGRES_USER "Postgres username" "$POSTGRES_USER"
  prompt POSTGRES_PASSWORD "Postgres password (blank = auto-generate)" "${POSTGRES_PASSWORD:-auto-generate}"
  [ "$POSTGRES_PASSWORD" = "auto-generate" ] && POSTGRES_PASSWORD=""
  prompt CORS_ORIGIN "CORS origin (* is fine for now, or your real domain)" "$CORS_ORIGIN"

  if confirm "Enable passwordless root auto-login on the console (pct console)? Security trade-off — see notes." n; then
    AUTO_LOGIN_CONSOLE=1
  fi

  echo
  echo "--- Review ---"
  echo " Hostname:        $CT_HOSTNAME"
  echo " Container ID:    ${CTID:-auto-pick}"
  echo " Resources:       ${CORES} cores, ${MEMORY}MB RAM, ${DISK_GB}GB disk on ${STORAGE}"
  echo " Network:         ${NET_CONFIG} on ${BRIDGE}"
  echo " Source:          ${REPO_URL:-$ZIP_PATH}"
  echo " Postgres:        db=${POSTGRES_DB} user=${POSTGRES_USER} password=${POSTGRES_PASSWORD:-<auto-generate>}"
  echo " CORS origin:     $CORS_ORIGIN"
  echo " Console auto-login: $([ "$AUTO_LOGIN_CONSOLE" = "1" ] && echo enabled || echo disabled)"
  echo
  confirm "Proceed with these settings?" y || fail "Cancelled."
}

if [ "$NONINTERACTIVE" != "1" ] && [ -t 0 ]; then
  run_wizard
fi

# ---------- Sanity checks ----------
[ "$(id -u)" -eq 0 ] || fail "Run this as root on the Proxmox host."
command -v pct >/dev/null 2>&1 || fail "pct not found — this must run on a Proxmox host, not inside a container."
if [ -z "$REPO_URL" ] && [ ! -f "$ZIP_PATH" ]; then
  fail "Set REPO_URL to your GitHub repo, or put trap-scorecard-backend.zip next to this script."
fi

if [ -z "$CT_PASSWORD" ]; then
  CT_PASSWORD="$(openssl rand -base64 18)"
fi

if [ -z "$POSTGRES_PASSWORD" ]; then
  POSTGRES_PASSWORD="$(openssl rand -base64 24)"
fi

if [ -z "$CTID" ]; then
  CTID="$(pvesh get /cluster/nextid)"
fi

log "Using container ID $CTID"

# Write credentials to a local file on the Proxmox host RIGHT NOW, before
# anything that could fail — so if a later step errors out, the generated
# passwords are still recoverable instead of lost with the script's exit.
# (For LXC, `pct enter <CTID>` also gets you a root shell without needing
# this password at all, in case this file goes missing too.)
CRED_FILE="./trap-scorecard-${CTID}-credentials.txt"
cat > "$CRED_FILE" <<EOF
Container ID:      $CTID
Container hostname: $CT_HOSTNAME
Root password:      $CT_PASSWORD
Postgres password:  $POSTGRES_PASSWORD
Generated:           $(date)
EOF
chmod 600 "$CRED_FILE"
log "Credentials saved to $CRED_FILE (in case anything below fails partway through)"

trap 'echo -e "\n\033[1;31mScript exited early.\033[0m Credentials generated so far are saved in: $CRED_FILE\nIf CT $CTID exists but is stuck, get in with: pct enter $CTID (no password needed as root on this host)."' ERR

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
log "Creating LXC container $CTID ($CT_HOSTNAME)"
pct create "$CTID" "$TEMPLATE" \
  --hostname "$CT_HOSTNAME" \
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
pct exec "$CTID" -- bash -c "test -f /root/trap-scorecard/.env.example" \
  || fail "No .env.example found in /root/trap-scorecard — the git clone or unzip step likely didn't complete. Check with: pct exec $CTID -- ls -la /root/trap-scorecard"
pct exec "$CTID" -- bash -c "
  set -e
  cd /root/trap-scorecard
  cp .env.example .env
  sed -i 's|^POSTGRES_DB=.*|POSTGRES_DB=${POSTGRES_DB}|' .env
  sed -i 's|^POSTGRES_USER=.*|POSTGRES_USER=${POSTGRES_USER}|' .env
  sed -i 's|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|' .env
  sed -i 's|^API_HOST_IP=.*|API_HOST_IP=${IP}|' .env
  sed -i 's|^CORS_ORIGIN=.*|CORS_ORIGIN=${CORS_ORIGIN}|' .env
"
pct exec "$CTID" -- bash -c "test -s /root/trap-scorecard/.env" \
  || fail ".env was not created successfully in /root/trap-scorecard. Check with: pct exec $CTID -- cat /root/trap-scorecard/.env"
log ".env configured"

log "Building and starting the stack (this takes a few minutes on first run)"
pct exec "$CTID" -- bash -c "cd /root/trap-scorecard && docker compose up -d --build"

if [ "$AUTO_LOGIN_CONSOLE" = "1" ]; then
  log "Enabling passwordless root console auto-login"
  pct exec "$CTID" -- bash -c '
    set -e
    mkdir -p /etc/systemd/system/container-getty@1.service.d
    cat > /etc/systemd/system/container-getty@1.service.d/override.conf <<"EOF"
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin root --noclear %I $TERM
EOF
    systemctl daemon-reload
    systemctl restart container-getty@1
  '
fi

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
echo " Container:        CT $CTID ($CT_HOSTNAME) at $IP"
echo " Root password:     $CT_PASSWORD"
echo " Postgres password: $POSTGRES_PASSWORD"
echo " (also saved in $CRED_FILE on this Proxmox host, and in /root/.env inside the container)"
if [ "$AUTO_LOGIN_CONSOLE" = "1" ]; then
  echo " Console auto-login: ENABLED — 'pct console $CTID' drops into root with no password."
fi
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
