#!/usr/bin/env bash
# Legt eine kleine Stichprobe der GKG-Rohdaten im Projektordner ab,
# damit der Konnektor gegen echte Daten entwickelt werden kann.
#
#   bash scripts/gkg-sample.sh
#
# Schreibt nach _sample/ (steht in .gitignore).

set -e
UA="GlobeNews/0.1 (+https://github.com/) educational news map"
ZIEL="$(cd "$(dirname "$0")/.." && pwd)/_sample"
mkdir -p "$ZIEL"
TMP=$(mktemp -d)

hole() {
  local liste="$1" name="$2" zeilen="$3"
  echo "── $name"
  local url
  url=$(curl -sL --max-time 30 -A "$UA" "$liste" | grep -i 'gkg' | awk '{print $3}' | head -1)
  if [ -z "$url" ]; then echo "   keine GKG-Datei in $liste"; return; fi
  echo "   $url"
  curl -sL --max-time 120 -A "$UA" "$url" -o "$TMP/$name.zip"
  unzip -o -q -d "$TMP/$name" "$TMP/$name.zip"
  local datei
  datei=$(ls "$TMP/$name"/* | head -1)
  echo "   $(wc -l < "$datei" | tr -d ' ') Zeilen, $(du -h "$datei" | awk '{print $1}')"
  # Nur Zeilen mit Ortsangabe, gekappt auf die ersten N
  awk -F'\t' 'NF>20 && $11 != "" {print; n++} n>='"$zeilen"' {exit}' "$datei" > "$ZIEL/$name.tsv"
  echo "   Stichprobe: $(wc -l < "$ZIEL/$name.tsv" | tr -d ' ') Zeilen, $(du -h "$ZIEL/$name.tsv" | awk '{print $1}')"
}

hole "http://data.gdeltproject.org/gdeltv2/lastupdate.txt"             "gkg-englisch"    40
sleep 3
hole "http://data.gdeltproject.org/gdeltv2/lastupdate-translation.txt" "gkg-uebersetzt"  25

# Spaltenzahl zur Kontrolle
echo
echo "── Spaltenzahl je Datei"
for f in "$ZIEL"/*.tsv; do
  echo "   $(basename "$f"): $(head -1 "$f" | awk -F'\t' '{print NF}') Spalten"
done

rm -rf "$TMP"
echo
echo "Fertig. Liegt in: $ZIEL"
ls -la "$ZIEL"
