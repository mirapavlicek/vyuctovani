#!/usr/bin/env bash
# Spouští se na serveru jako root (volá ho deploy.sh). Lze pouštět opakovaně.
set -euo pipefail

SRC="${1:?cesta k nahraným zdrojákům}"
APP_DIR=/opt/vyuctovani
DATA_DIR=/var/lib/vyuctovani
SVC_USER=vyuctovani
NODE_MAJOR=24
MIN_NODE="22.13.0"

export DEBIAN_FRONTEND=noninteractive

version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }

# --- základní balíčky ---
MISSING=""
for c in curl rsync gpg; do command -v "$c" >/dev/null 2>&1 || MISSING="$MISSING $c"; done
if [ -n "$MISSING" ]; then
  echo "==> Instaluji:$MISSING"
  apt-get update -q
  apt-get install -y -q ca-certificates curl rsync gnupg
fi

# --- Node.js ---
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  CUR="$(node -p 'process.versions.node')"
  if version_ge "$CUR" "$MIN_NODE"; then NEED_NODE=0; fi
fi
if [ "$NEED_NODE" = 1 ]; then
  echo "==> Instaluji Node.js $NODE_MAJOR (NodeSource)"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get install -y -q nodejs
fi
echo "    Node $(node -v)"

# --- uživatel a adresáře ---
if ! id "$SVC_USER" >/dev/null 2>&1; then
  echo "==> Vytvářím systémového uživatele $SVC_USER"
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SVC_USER"
fi
install -d -o "$SVC_USER" -g "$SVC_USER" -m 0750 "$DATA_DIR"
install -d -o root -g root -m 0755 "$APP_DIR"

# --- aplikace ---
echo "==> Kopíruji aplikaci do $APP_DIR"
rsync -a --delete --exclude node_modules --exclude .env "$SRC/" "$APP_DIR/"
chown -R root:root "$APP_DIR"

if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<EOF
# Konfigurace aplikace Vyúčtování
HOST=127.0.0.1
PORT=3000
DATA_DIR=$DATA_DIR
# Reverzní proxy na stejném stroji = loopback. Proxy na jiném stroji: HOST=0.0.0.0 a TRUST_PROXY=<IP proxy>
TRUST_PROXY=loopback
BACKUP_KEEP=30
EOF
fi
chmod 0644 "$APP_DIR/.env"

echo "==> npm ci"
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund --loglevel=error

# --- systemd ---
install -m 0644 "$APP_DIR/deploy/vyuctovani.service" /etc/systemd/system/vyuctovani.service
install -m 0755 "$APP_DIR/deploy/vyuctovani-user" /usr/local/bin/vyuctovani-user
systemctl daemon-reload
systemctl enable vyuctovani >/dev/null 2>&1
systemctl restart vyuctovani

# --- kontrola ---
PORT="$(grep -E '^PORT=' "$APP_DIR/.env" | cut -d= -f2)"
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1; then
    echo "==> Hotovo, aplikace běží na 127.0.0.1:${PORT:-3000}"
    if ! runuser -u "$SVC_USER" -- bash -c "cd $APP_DIR && node src/cli.js list" | grep -q .; then
      echo
      echo "!! Zatím neexistuje žádný uživatel. Vytvoř ho na serveru:"
      echo "   sudo vyuctovani-user add <jmeno>"
    fi
    exit 0
  fi
  sleep 0.5
done
echo "!! Aplikace neodpovídá. Log: journalctl -u vyuctovani -n 50" >&2
journalctl -u vyuctovani -n 30 --no-pager >&2 || true
exit 1
