#!/usr/bin/env bash
# Nasazení na Debian server přes SSH.
#
#   ./deploy/deploy.sh uzivatel@server            # nasadí aktuální verzi
#   ./deploy/deploy.sh uzivatel@server -p 2222    # vlastní SSH port
#
# Co se stane:
#   1. zdrojáky se přes ssh (tar) nahrají do ~/vyuctovani-release na serveru
#   2. přes sudo se spustí deploy/remote-install.sh, který (idempotentně):
#      - nainstaluje Node.js 24 LTS (NodeSource), pokud chybí nebo je starý
#      - vytvoří systémového uživatele „vyuctovani“
#      - nakopíruje aplikaci do /opt/vyuctovani, data jsou v /var/lib/vyuctovani
#      - nainstaluje a restartuje systemd službu vyuctovani.service
set -euo pipefail

TARGET="${1:-}"
shift || true
if [[ -z "$TARGET" ]]; then
  echo "Použití: $0 uzivatel@server [další volby ssh, např. -p 2222]" >&2
  exit 1
fi
SSH_OPTS=("$@")

cd "$(dirname "$0")/.."

echo "==> Testy"
npm test --silent

echo "==> Nahrávám na $TARGET"
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -czf - \
  --exclude ./node_modules --exclude ./data --exclude ./.git --exclude ./.env --exclude ./.claude --exclude .DS_Store . \
  | ssh ${SSH_OPTS[@]+"${SSH_OPTS[@]}"} "$TARGET" 'rm -rf ~/vyuctovani-release && mkdir -p ~/vyuctovani-release && tar xzf - -C ~/vyuctovani-release'


echo "==> Instalace na serveru (může se zeptat na sudo heslo)"
ssh -t ${SSH_OPTS[@]+"${SSH_OPTS[@]}"} "$TARGET" 'if [ "$(id -u)" = 0 ]; then bash ~/vyuctovani-release/deploy/remote-install.sh ~/vyuctovani-release; else sudo bash ~/vyuctovani-release/deploy/remote-install.sh ~/vyuctovani-release; fi'
