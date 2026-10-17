#!/usr/bin/env bash
# Run from a copy of this repository on an Ubuntu 24.04 x86_64 droplet.
set -Eeuo pipefail
DOMAIN=''
PHONE=0
DRY_RUN=0
BASE=/opt/uchaaran-helper
SOURCE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
usage() {
  cat <<'HELP'
Usage: sudo bash scripts/deploy_droplet.sh [--domain paath.example.org] [--with-phone-model]
       bash scripts/deploy_droplet.sh [--domain paath.example.org] --dry-run

Without --domain, installs a loopback-only service for access through an SSH tunnel.
With --domain, installs Caddy for automatic HTTPS. Point DNS at this droplet first.
Ubuntu 24.04 x86_64 only. Installs the timestamp model by default (Learn + timestamps).
--with-phone-model also installs CPU PyTorch and the optional ~1.26 GB phone model.
--dry-run prints the plan and configuration without root, downloads or installation.
HELP
}
fail() { echo "Error: $*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --domain) [[ $# -ge 2 ]] || fail '--domain needs a value'; DOMAIN=$2; shift 2 ;;
    --with-phone-model) PHONE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done
cd -- "$SOURCE_DIR"
# Validate domain input before executing any installation commands.
python3 - "$DOMAIN" <<'PY'
import sys
from scripts.droplet_config import configs
configs(sys.argv[1])
PY
if ((DRY_RUN)); then
  python3 - "$DOMAIN" "$PHONE" <<'PY'
import sys
from scripts.droplet_config import configs
print('PLAN: Ubuntu 24.04 amd64; apt packages, dedicated service user, new source release,')
print('Python 3.12 venv, pinned timestamp model, supplied reference WAV, systemd service.')
print('Optional phone model:', bool(int(sys.argv[2])))
print('Public HTTPS + Caddy.' if sys.argv[1] else 'Private SSH-tunnel mode; no public web listener.')
for name, value in configs(sys.argv[1]).items():
    print(f'\n--- {name} ---\n{value}')
PY
  exit 0
fi
[[ $EUID -eq 0 ]] || fail 'Run with sudo on the droplet.'
# shellcheck disable=SC1091
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || fail 'This installer supports Ubuntu 24.04; check /etc/os-release.'
[[ $(dpkg --print-architecture) == amd64 ]] || fail 'Pinned ML wheels require an x86_64/amd64 droplet.'
[[ ! -e $BASE || -f $BASE/.managed-by-uchaaran ]] || fail "$BASE exists and was not created by this installer."
if [[ -z $DOMAIN && -f /etc/uchaaran-helper/environment ]] && grep -q '^UCHAARAN_PUBLIC_ORIGIN=https://' /etc/uchaaran-helper/environment; then
  fail 'This installation has a domain. Re-run with the same --domain to preserve HTTPS access.'
fi
if [[ -n $DOMAIN && -f /etc/caddy/Caddyfile ]] && ! grep -q '^# Managed by Uchaaran Helper droplet installer$' /etc/caddy/Caddyfile; then
  fail 'An existing Caddy configuration is present. This installer will not replace another site.'
fi
if command -v ss >/dev/null && [[ ! -f $BASE/.managed-by-uchaaran ]]; then
  [[ -z $(ss -ltnH '( sport = :8767 )') ]] || fail 'Port 8767 is already used by another process.'
fi
if [[ -n $DOMAIN ]] && command -v ss >/dev/null && [[ ! -f $BASE/.managed-by-uchaaran ]]; then
  [[ -z $(ss -ltnH '( sport = :80 or sport = :443 )') ]] || fail 'Ports 80/443 are already in use; use SSH-tunnel mode or configure your existing proxy.'
fi
NEW_CADDY_CONFIG=0
if [[ -n $DOMAIN && ! -f /etc/caddy/Caddyfile ]]; then NEW_CADDY_CONFIG=1; fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y python3.12 python3.12-venv python3.12-dev build-essential cmake pkg-config git ffmpeg ca-certificates curl libgomp1
id uchaaran >/dev/null 2>&1 || useradd --system --home-dir "$BASE/shared" --shell /usr/sbin/nologin uchaaran
install -d -m 755 "$BASE" "$BASE/releases" "$BASE/shared" "$BASE/shared/models" "$BASE/shared/audio" /etc/uchaaran-helper
touch "$BASE/.managed-by-uchaaran"
chown uchaaran:uchaaran "$BASE/shared/models" "$BASE/shared/audio"
RELEASE="$BASE/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
python3.12 -m scripts.deployment_files "$RELEASE"
ln -s "$BASE/shared/models" "$RELEASE/models"
install -d "$RELEASE/data/lessons"
ln -s "$BASE/shared/audio" "$RELEASE/data/lessons/audio"
[[ -x $BASE/shared/venv/bin/python ]] || python3.12 -m venv "$BASE/shared/venv"
PYTHON="$BASE/shared/venv/bin/python"
"$PYTHON" -m pip install --upgrade pip
"$PYTHON" -m pip install -r "$RELEASE/requirements-timestamps.txt"
if ((PHONE)); then
  "$PYTHON" -m pip install 'torch==2.2.0' --index-url https://download.pytorch.org/whl/cpu
  "$PYTHON" -m pip install -r "$RELEASE/requirements-phonetics.txt"
fi
cd -- "$RELEASE"
runuser -u uchaaran -- "$PYTHON" -m scripts.download_timestamp_model
if ((PHONE)); then runuser -u uchaaran -- "$PYTHON" -m scripts.download_phone_model; fi
runuser -u uchaaran -- "$PYTHON" -m scripts.prepare_japji_audio
CONFIG_DIR=$(mktemp -d)
trap 'rm -rf -- "$CONFIG_DIR"' EXIT
python3.12 -m scripts.droplet_config --domain "$DOMAIN" --output "$CONFIG_DIR"
if [[ -n $DOMAIN ]]; then
  apt-get install -y caddy
  # Claim only the package-default file created by this installation, allowing retries.
  if ((NEW_CADDY_CONFIG)); then sed -i '1i# Managed by Uchaaran Helper droplet installer' /etc/caddy/Caddyfile; fi
  caddy fmt --overwrite "$CONFIG_DIR/Caddyfile"
  caddy validate --config "$CONFIG_DIR/Caddyfile" --adapter caddyfile
fi
# Keep the previous release available, and switch only after setup succeeds.
if [[ -L $BASE/current ]]; then readlink "$BASE/current" > "$BASE/previous-release"; fi
ln -sfn "$RELEASE" "$BASE/current"
install -m 600 "$CONFIG_DIR/environment" /etc/uchaaran-helper/environment
install -m 644 "$CONFIG_DIR/uchaaran-helper.service" /etc/systemd/system/uchaaran-helper.service
systemctl daemon-reload
systemctl enable uchaaran-helper
systemctl restart uchaaran-helper
HEALTHY=0
for attempt in {1..20}; do
  if systemctl is-active --quiet uchaaran-helper && curl --fail --silent http://127.0.0.1:8767/api/status >/dev/null; then HEALTHY=1; break; fi
  sleep 1
done
((HEALTHY)) || fail 'Service did not start. Run journalctl -u uchaaran-helper -n 60.'
curl --fail --silent 'http://127.0.0.1:8767/api/learn/screens/audio?lesson_id=japji-sahib-full&screen_id=line-001-1' -o /dev/null
if [[ -n $DOMAIN ]]; then
  install -m 644 "$CONFIG_DIR/Caddyfile" /etc/caddy/Caddyfile
  systemctl enable caddy
  systemctl restart caddy
  echo "Installed. Open https://$DOMAIN (allow a moment for certificate issuance)."
  echo 'Ensure DNS points here and inbound TCP 80/443 is allowed in your existing firewalls.'
else
  echo 'Installed in private SSH-tunnel mode. On your laptop, run:'
  echo 'ssh -N -L 8767:127.0.0.1:8767 root@DROPLET_IP'
  echo 'Then open http://127.0.0.1:8767 on that laptop.'
fi
echo 'Learn sends recordings to this droplet for in-memory checking; no automatic audio files or access logs are saved.'
echo 'Logs: journalctl -u uchaaran-helper -f'
