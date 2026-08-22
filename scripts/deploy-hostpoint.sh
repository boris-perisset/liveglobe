#!/usr/bin/env bash
#
# Globe News → Hostpoint
#
# Baut das Paket und schiebt es per rsync ins Web-Root. Alles, was auf dem
# Server entstanden ist – die Snapshots und die Konfiguration mit dem Key –
# bleibt dabei unangetastet.
#
#   npm run deploy:hostpoint
#
# Erwartet in .env.local:
#   export HOSTPOINT_USER=dein-hosting-benutzername
#   export HOSTPOINT_PATH=/home/dein-benutzer/www/liveglobe.site

set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env.local ] && source .env.local

if [ -z "${HOSTPOINT_USER:-}" ] || [ -z "${HOSTPOINT_PATH:-}" ]; then
  cat >&2 <<'HINWEIS'
HOSTPOINT_USER und HOSTPOINT_PATH fehlen.

In .env.local ergänzen, zum Beispiel:
  export HOSTPOINT_USER=meinbenutzer
  export HOSTPOINT_PATH=/home/meinbenutzer/www/liveglobe.site

Den Benutzernamen findest du im Control Panel unter
Server Übersicht → Identität.
HINWEIS
  exit 1
fi

HOST="${HOSTPOINT_HOST:-${HOSTPOINT_USER}.ssh.cloud.hostpoint.ch}"

npm run package:hostpoint

echo
echo "→ ${HOSTPOINT_USER}@${HOST}:${HOSTPOINT_PATH}"
echo

# Trailing Slash bei der Quelle: der *Inhalt* von upload/ wandert, nicht der Ordner.
# Rechte VOR dem Übertragen setzen, nicht per --chmod: macOS bringt bis heute
# rsync 2.6.9 von 2006 mit, das die Option nicht kennt. rsync -a übernimmt die
# Modi dann unverändert.
#
# Warum das überhaupt nötig ist: Der Webserver läuft unter einem anderen
# Benutzer als du. Kommen die Dateien mit 600 an, kann Apache nicht einmal die
# .htaccess lesen und antwortet auf alles mit 403.
find upload -type d -exec chmod 755 {} +
find upload -type f -exec chmod 644 {} +

rsync -avz --delete \
  --exclude 'snapshot.config.php' \
  --exclude 'data/latest.json' \
  --exclude 'data/latest.json.gz' \
  --exclude 'data/20*.json' \
  upload/ "${HOSTPOINT_USER}@${HOST}:${HOSTPOINT_PATH}/"

echo
echo "Fertig. Prüfen:"
echo "  https://liveglobe.site/"
echo "  https://liveglobe.site/data/latest.json"
