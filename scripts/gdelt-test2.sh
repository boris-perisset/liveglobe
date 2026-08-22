#!/usr/bin/env bash
# Zweiter Durchgang: klärt, ob die GEO-API wirklich weg ist und ob der
# Rohdaten-Weg (GKG-Dateien alle 15 Minuten) als Ersatz taugt.
# Pausen von 6 Sekunden, damit wir nicht ins Ratenlimit laufen.
#
#   bash scripts/gdelt-test2.sh

UA="GlobeNews/0.1 (+https://github.com/) educational news map"

kopf() { printf '\n── %s\n' "$1"; }

zeig() {
  local name="$1" url="$2" n="${3:-200}"
  local out code body
  out=$(curl -sL --max-time 60 -A "$UA" -w '\n@@%{http_code}@@' "$url" 2>&1)
  code=$(printf '%s' "$out" | sed -n 's/.*@@\([0-9]*\)@@.*/\1/p')
  body=$(printf '%s' "$out" | sed 's/@@[0-9]*@@//' | tr -d '\r' | tr '\n' ' ' | cut -c1-"$n")
  printf '%s\n  HTTP %s\n  %s\n' "$name" "${code:-???}" "$body"
  sleep 6
}

kopf "1. GEO-API ohne Parameter"
zeig "geo/geo (nackt)" "https://api.gdeltproject.org/api/v2/geo/geo"

kopf "2. GEO-API Verzeichnisebene"
zeig "api/v2/geo/" "https://api.gdeltproject.org/api/v2/geo/"

kopf "3. DOC-API sauber, mit Pause davor"
zeig "doc ArtList json" \
  "https://api.gdeltproject.org/api/v2/doc/doc?query=flood&mode=artlist&format=json&timespan=1h&maxrecords=3" 600

kopf "4. Rohdaten: welche Dateien liegen aktuell an?"
zeig "gdeltv2/lastupdate.txt" "http://data.gdeltproject.org/gdeltv2/lastupdate.txt" 500

kopf "5. Rohdaten: Grösse der aktuellen GKG-Datei"
GKG=$(curl -sL --max-time 30 -A "$UA" http://data.gdeltproject.org/gdeltv2/lastupdate.txt \
      | grep -i 'gkg' | awk '{print $3}' | head -1)
echo "  URL: ${GKG:-nicht gefunden}"
if [ -n "$GKG" ]; then
  curl -sIL --max-time 60 -A "$UA" "$GKG" | grep -iE '^(HTTP/|content-length|content-type)' | sed 's/^/  /'
fi
sleep 2

kopf "6. Rohdaten: erste Zeile der GKG-Datei (gekürzt)"
if [ -n "$GKG" ]; then
  curl -sL --max-time 90 -A "$UA" "$GKG" -o /tmp/gn_gkg.zip
  echo "  heruntergeladen: $(du -h /tmp/gn_gkg.zip | awk '{print $1}')"
  if command -v unzip >/dev/null; then
    unzip -o -q -d /tmp/gn_gkg /tmp/gn_gkg.zip 2>/dev/null
    F=$(ls /tmp/gn_gkg/* 2>/dev/null | head -1)
    echo "  entpackt: $F ($(du -h "$F" 2>/dev/null | awk '{print $1}'))"
    echo "  Zeilen: $(wc -l < "$F" 2>/dev/null | tr -d ' ')"
    echo "  --- Spalten 1-11 der ersten Zeile mit Koordinaten ---"
    awk -F'\t' '$11 != "" {print substr($1,1,30)" | "substr($4,1,25)" | "substr($5,1,60)"\n  Locations: "substr($11,1,220); exit}' "$F" | sed 's/^/  /'
  else
    echo "  unzip nicht vorhanden"
  fi
fi

kopf "fertig"
