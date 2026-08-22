#!/usr/bin/env bash
# „Warum steht dieser Artikel in dieser Rubrik?"
#
#   bash scripts/warum.sh "https://…"
#
# Sucht die Zeile in den aktuellen GKG-Dateien und zeigt Titel, Ort und alle
# Themencodes. Damit lässt sich jede Fehleinordnung an der Quelle nachvollziehen
# statt zu raten – und data/category-map.json gezielt nachschärfen.

set -e
URL="$1"
if [ -z "$URL" ]; then
  echo "Aufruf: bash scripts/warum.sh \"https://…\"" >&2
  exit 1
fi

UA="GlobeNews/0.1 (+https://github.com/) educational news map"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Ohne Protokoll und ohne www suchen, damit auch normalisierte URLs treffen
MUSTER=$(printf '%s' "$URL" | sed 's|^https\{0,1\}://||; s|^www\.||; s|/$||')

gefunden=0
for liste in lastupdate.txt lastupdate-translation.txt; do
  datei=$(curl -sL --max-time 30 -A "$UA" "http://data.gdeltproject.org/gdeltv2/$liste" \
          | grep -i 'gkg' | awk '{print $3}' | head -1)
  [ -z "$datei" ] && continue
  name=$(basename "$datei" .zip)
  curl -sL --max-time 120 -A "$UA" "$datei" -o "$TMP/$name.zip"
  unzip -o -q -d "$TMP/$name" "$TMP/$name.zip"
  csv=$(ls "$TMP/$name"/* | head -1)

  zeile=$(grep -m1 -F "$MUSTER" "$csv" || true)
  [ -z "$zeile" ] && continue

  gefunden=1
  echo "── gefunden in $liste"
  printf '%s' "$zeile" | awk -F'\t' '{
    print "  Quelle:   " $4
    print "  URL:      " substr($5,1,110)
    print "  Zeit:     " $2
    gsub(/<\/?PAGE_TITLE>/,"",$27)
    print "  Titel:    " substr($27,1,110)
    print ""
    print "  Orte:"
    n = split($11, orte, ";")
    for (i = 1; i <= n && i <= 6; i++) if (orte[i] != "") print "    " orte[i]
    print ""
    print "  Themen:"
    m = split($8, t, ";")
    for (i = 1; i <= m; i++) if (t[i] != "") printf "    %s\n", t[i]
  }'
  break
done

if [ "$gefunden" = 0 ]; then
  echo "Nicht in den aktuellen Dateien. Die decken nur die letzten 15 Minuten ab –"
  echo "für ältere Artikel bräuchte es das Archiv unter masterfilelist.txt."
fi
