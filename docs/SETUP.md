# Setup — von null auf laufende Seite

Reihenfolge einhalten; jeder Schritt baut auf dem vorherigen auf.
Zeitaufwand beim ersten Mal: rund eine Stunde.

---

## 1. Lokal starten (5 Min)

```bash
cd globenews
npm install --prefix frontend
npm --prefix frontend run dev
```

Der Globus dreht sich mit Demodaten. Damit lässt sich die Oberfläche entwickeln,
ohne dass irgendetwas anderes eingerichtet sein muss.

---

## 2. GitHub-Repo anlegen (5 Min)

```bash
cd globenews
git init -b main
git add .
git commit -m "Globe News: Grundgerüst"

gh repo create globenews --public --source . --remote origin --push
# ohne gh CLI: Repo auf github.com anlegen, dann
#   git remote add origin git@github.com:<user>/globenews.git
#   git push -u origin main
```

Empfohlener Ablauf danach: `main` ist immer deploybar, Arbeit passiert in
`feature/…`-Branches, Merge via Pull Request. Die CI (`.github/workflows/ci.yml`)
prüft bei jedem PR TypeScript, den Ingest und die PHP-Syntax.

Branch-Schutz auf `main` einschalten: *Settings → Branches → Add rule →
Require status checks to pass*.

---

## 3. Supabase einrichten (20 Min)

### 3.1 Projekt anlegen

1. [supabase.com](https://supabase.com) → neues Projekt, Plan **Free**
2. Region **Frankfurt (eu-central-1)** — nächstgelegen und DSGVO-freundlich
3. Datenbank-Passwort sicher ablegen

### 3.2 Schema einspielen

Im Supabase-Dashboard → **SQL Editor** → Inhalt von
`supabase/migrations/0001_init.sql` einfügen und ausführen.

Prüfen: unter *Table Editor* sollten `sources`, `locations`, `articles`,
`daily_stats` und `ingest_runs` erscheinen.

### 3.3 Quellen-Register einspielen

```bash
export SUPABASE_URL=https://<PROJECT_REF>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service_role key aus Settings → API>
npm run seed:sources
```

### 3.4 Edge Function deployen

```bash
npm install -g supabase        # oder: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <PROJECT_REF>
npm run deploy:function        # synchronisiert das Rubriken-Mapping und deployt
```

Testlauf von Hand:

```bash
curl -X POST "https://<PROJECT_REF>.functions.supabase.co/ingest" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"timespan":"60min"}'
```

Erwartete Antwort: JSON mit `points_fetched`, `inserted`, `locations`.
Ist `inserted` null, aber `points_fetched` grösser null, greift das Dedupe —
das ist beim zweiten Lauf normal.

> **Hinweis:** Die GDELT-Abfragen konnten beim Erstellen dieses Gerüsts nicht live
> getestet werden. Der erste manuelle Lauf ist deshalb der eigentliche Praxistest.
> Falls einzelne Rubriken leer bleiben, liegt es fast immer an einem `theme:`-Code
> in `data/category-map.json` — die Liste gültiger Themes steht in der
> [GDELT-GKG-Dokumentation](https://www.gdeltproject.org/data.html). Die Datei ist
> genau dafür da: anpassen, `npm run deploy:function`, fertig.

### 3.5 Zeitpläne aktivieren

`supabase/migrations/0002_cron.sql` öffnen, `<PROJECT_REF>` und
`<SERVICE_ROLE_KEY>` ersetzen, im SQL Editor ausführen.

Kontrolle:

```sql
select * from cron.job;
select * from ingest_runs order by started_at desc limit 5;
```

Der 15-Minuten-Takt hält das Free-Tier-Projekt nebenbei wach — es pausiert
nur nach einer Woche völliger Inaktivität.

---

## 4. Hostpoint einrichten (20 Min)

### 4.1 Zielverzeichnis

Im Hostpoint Control Panel Domain oder Subdomain auf ein Verzeichnis zeigen lassen,
z. B. `/home/<user>/www/globenews`.

### 4.2 Konfiguration ablegen

Per SFTP/SSH:

```bash
cd ~/www/globenews
cp snapshot.config.example.php snapshot.config.php
# supabase_url und anon_key eintragen (nur der öffentliche anon-Key!)
mkdir -p data && chmod 755 data
```

### 4.3 Cronjob anlegen

Control Panel → *Cronjobs*:

| Feld | Wert |
|---|---|
| Intervall | `*/5 * * * *` |
| Befehl | `/usr/local/bin/php /home/<user>/www/globenews/snapshot.php` |

Von Hand testen:

```bash
ssh <user>@<host>
/usr/local/bin/php ~/www/globenews/snapshot.php
# erwartet: "OK – 214 Cluster, 48213 Bytes, 2026-…"
```

### 4.4 SSH-Key für das Deployment

```bash
ssh-keygen -t ed25519 -C "github-deploy-globenews" -f ~/.ssh/globenews_deploy
ssh-copy-id -i ~/.ssh/globenews_deploy.pub <user>@<host>
```

---

## 5. Deployment verdrahten (10 Min)

Im GitHub-Repo → *Settings → Secrets and variables → Actions*:

**Variables** (nicht geheim):

| Name | Beispiel |
|---|---|
| `SUPABASE_URL` | `https://abcdef.supabase.co` |
| `HOSTPOINT_HOST` | `s123.web.hostpoint.ch` |
| `HOSTPOINT_USER` | dein SSH-Benutzer |
| `HOSTPOINT_PATH` | `/home/<user>/www/globenews` |
| `HOSTPOINT_SSH_PORT` | `22` |

**Secrets**:

| Name | Inhalt |
|---|---|
| `SUPABASE_ANON_KEY` | anon public key |
| `HOSTPOINT_SSH_KEY` | Inhalt von `~/.ssh/globenews_deploy` (privater Teil) |

Dann `git push` auf `main` — der Workflow baut und rsyncht.
`data/` und `snapshot.config.php` sind vom `--delete` ausgenommen und
überleben jedes Deployment.

---

## 6. Abnahme

- [ ] Globus lädt und dreht sich
- [ ] Pins erscheinen in mindestens 30 verschiedenen Ländern
- [ ] Klick auf Pin öffnet Teaser mit funktionierendem Link zur Quelle
- [ ] Rubriken-Filter verändert die Pins, URL spiegelt die Auswahl
- [ ] Zeit-Slider verschiebt das Fenster, „Jetzt" springt zurück
- [ ] `latest.json` ist jünger als 10 Minuten
- [ ] `select count(*) from articles` wächst und bleibt nach 8 Tagen stabil
- [ ] Seite lädt auf dem Mobiltelefon in unter 5 Sekunden

---

## Fehlersuche

| Symptom | Ursache | Lösung |
|---|---|---|
| Globus bleibt leer, Status „Kein Snapshot verfügbar" | `data/latest.json` fehlt | `snapshot.php` von Hand ausführen, Rechte auf `data/` prüfen |
| Snapshot-Cron meldet 401 | falscher Key | anon-Key aus *Settings → API*, nicht das DB-Passwort |
| `ingest_runs.error` voller GDELT-Meldungen | Theme-Code ungültig oder GDELT gedrosselt | `data/category-map.json` anpassen, `GN_MAX_POINTS` senken |
| Datenbank wächst zu schnell | Quote zu hoch | `GN_QUOTA` senken (Supabase → Edge Functions → Secrets) |
| Deploy löscht `data/` | `--exclude` fehlt | `.github/workflows/deploy.yml` prüfen |
| Supabase-Projekt pausiert | keine Aktivität | `cron.job` prüfen — der Ingest hält es wach |
