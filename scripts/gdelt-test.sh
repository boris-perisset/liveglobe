#!/usr/bin/env bash
# Probiert verschiedene Aufrufformen der GDELT-APIs durch und meldet,
# welche wirklich antwortet. Ergebnis bitte komplett zurückmelden.
#
#   bash scripts/gdelt-test.sh

UA="GlobeNews/0.1 (+https://github.com/) educational news map"

pruefe() {
  local name="$1" url="$2"
  local out code body
  out=$(curl -sL --max-time 45 -A "$UA" -w '\n@@%{http_code}@@%{url_effective}' "$url" 2>&1)
  code=$(printf '%s' "$out" | sed -n 's/.*@@\([0-9]*\)@@.*/\1/p')
  body=$(printf '%s' "$out" | sed 's/@@[0-9]*@@.*//' | tr -d '\n' | cut -c1-160)
  printf '%-42s  HTTP %-4s  %s\n' "$name" "${code:-???}" "$body"
  printf '\n'
}

echo "== GEO 2.0 =="
pruefe "https + PointData + GeoJSON" \
  "https://api.gdeltproject.org/api/v2/geo/geo?query=flood&mode=PointData&format=GeoJSON&timespan=60min&maxpoints=5"

pruefe "http  + PointData + GeoJSON" \
  "http://api.gdeltproject.org/api/v2/geo/geo?query=flood&mode=PointData&format=GeoJSON&timespan=60min&maxpoints=5"

pruefe "https + pointdata + geojson (klein)" \
  "https://api.gdeltproject.org/api/v2/geo/geo?query=flood&mode=pointdata&format=geojson&timespan=60min&maxpoints=5"

pruefe "https ohne timespan/maxpoints" \
  "https://api.gdeltproject.org/api/v2/geo/geo?query=flood&mode=PointData&format=GeoJSON"

pruefe "https bekanntes Doku-Beispiel" \
  "https://api.gdeltproject.org/api/v2/geo/geo?query=%22donald%20trump%22&mode=sourcecountry&format=imagehtmlshow"

pruefe "https mit theme-Operator" \
  "https://api.gdeltproject.org/api/v2/geo/geo?query=%28theme%3ANATURAL_DISASTER%29&mode=PointData&format=GeoJSON&timespan=60min&maxpoints=5"

echo "== DOC 2.0 (Gegenprobe) =="
pruefe "https DOC ArtList json" \
  "https://api.gdeltproject.org/api/v2/doc/doc?query=flood&mode=ArtList&format=json&timespan=24h&maxrecords=3"

echo "== Erreichbarkeit =="
pruefe "Startseite api.gdeltproject.org" "https://api.gdeltproject.org/"
