# Globe News

Ein drehbarer 3D-Globus mit aktuellen Nachrichten — verortet dort, wo sie passieren.
Konzeptioneller Verwandter von [radio.garden](https://radio.garden/), nur mit
Presse­meldungen statt Radiostationen.

- **Pins** an Stadt-/Ortsebene, Klick öffnet Teaser und verlinkt zur Originalquelle
- **12 Rubriken** (Naturkatastrophen, Konflikte, Friedensgespräche, Politik, Diplomatie,
  Unfälle, Sport, Kultur, Kunst, Wetter, Natur, Übriges)
- **Zeitfenster** letzte 24 h, per Slider und Datepicker bis 8 Tage zurück
- **Einordnung der Quelle** nach einer Ground-News-artigen Skala (−3 … +3) plus Trägerschaft
- **Laufende Kosten: 0.–**

Der ausführliche Architektur- und Umsetzungsplan liegt im Claude-Projekt
(`claude/ARCHITEKTUR.md`) — dort stehen die Begründungen zu Stack, Datenmodell,
Quellenstrategie und Roadmap.

---

## Stack

| Schicht | Technik | Wo |
|---|---|---|
| Frontend | Vite · TypeScript · [globe.gl](https://globe.gl) (three.js) | Hostpoint (statisch) |
| Daten | Postgres + PostGIS, PostgREST, RLS | Supabase Free |
| Ingest | Deno Edge Function, alle 15 Min via `pg_cron` | Supabase |
| Cache | PHP-Cron schreibt `data/latest.json` | Hostpoint |
| Quelle | [GDELT](https://www.gdeltproject.org/) GEO 2.0 / DOC 2.0 | — |

Warum Supabase *und* Hostpoint: Supabase liefert PostGIS und eine fertige API,
Hostpoint liefert das statische Ausspielen. Der Snapshot-Cron auf Hostpoint sorgt
dafür, dass Besucher nie direkt gegen Supabase laufen — damit bleibt das
5-GB-Egress-Limit des Free Tiers unangetastet.

---

## Verzeichnisse

```
frontend/            Vite-App (Globus, Filter, Zeitleiste, Teaser-Panel)
supabase/
  migrations/        SQL-Schema, RPCs, Retention, RLS
  functions/ingest/  GDELT-Ingest als Edge Function (+ Tests)
hostpoint/           snapshot.php, .htaccess, Beispielkonfiguration
data/                Rubriken-Mapping und Quellen-Register (versioniert)
scripts/             Seed- und Sync-Hilfen
.github/workflows/   CI und Deploy nach Hostpoint
```

## Schnellstart

```bash
npm install --prefix frontend
npm --prefix frontend run dev
```

Läuft sofort mit den mitgelieferten Demodaten (`frontend/public/data/latest.demo.json`).
Für echte Daten: siehe [docs/SETUP.md](docs/SETUP.md).

## Tests

```bash
npm --prefix frontend run typecheck   # TypeScript
deno test supabase/functions/ingest/  # Ingest-Parser
php -l hostpoint/snapshot.php         # PHP-Syntax
```

## Gestaltung

Dunkle, zurückhaltende Oberfläche; der Globus (NASA-Nachtaufnahme) trägt das Bild,
Farbe kommt ausschliesslich von den Rubriken. Schrift: **Nohemi** in vier Schnitten.

> Nohemi ist eine kommerzielle Schrift. Für den Livebetrieb wird eine Webfont-Lizenz
> der Foundry benötigt — siehe `frontend/src/fonts/README.md`.

## Lizenz und Daten

Code: noch nicht festgelegt (Vorschlag: MIT).
Nachrichtendaten stammen vom [GDELT Project](https://www.gdeltproject.org/) und sind
für nicht-kommerzielle Nutzung frei — die Attribution im Footer bitte stehen lassen.
Es werden ausschliesslich Titel, ein kurzer Teaser und die Bild-URL gespeichert;
Volltexte bleiben bei den Verlagen, jeder Klick führt zur Originalquelle.
