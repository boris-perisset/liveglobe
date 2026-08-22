# Globe News auf Hostpoint — liveglobe.site

Kurzfassung: Es gehen **14 Dateien** auf den Server, zusammen gut 1 MB. Alles
andere im Repo ist Quelltext, Werkzeug oder läuft bei Supabase.

---

## 1. Paket bauen — auf deinem Mac

```bash
npm run package:hostpoint
```

Das baut das Frontend und legt daneben einen Ordner `upload/` an, dessen Inhalt
eins zu eins ins Web-Root gehört.

**Wichtig: Das muss auf deinem Rechner laufen, nicht irgendwo sonst.** Vite backt
`VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` beim Bauen fest in das Bündel
ein, und die stehen in `frontend/.env.local`. Fehlt die Datei, entsteht ein
Build, der stumm auf Demodaten zurückfällt — die Seite läuft, zeigt aber immer
dieselben erfundenen Meldungen.

Gegenprobe nach dem Bauen:

```bash
grep -c "supabase.co" upload/assets/index-*.js   # muss ≥ 1 sein
```

---

## 2. Was hochgeladen wird

| Datei | Wozu |
|---|---|
| `index.html` | die Seite |
| `assets/index-*.js` | Anwendungscode, ~27 kB |
| `assets/map-vendor-*.js` | MapLibre, ~932 kB — eigener Brocken, bleibt im Browser-Cache |
| `assets/index-*.css` | Gestaltung |
| `assets/Nohemi-*.woff2` | vier Schriftschnitte |
| `favicon.svg` | Symbol |
| `.htaccess` | HTTPS, Kompression, Caching, Schutz der PHP-Dateien |
| `snapshot.php` | Cron-Skript, holt die Meldungen aus Supabase |
| `snapshot.config.example.php` | Vorlage für die Konfiguration |
| `data/` | leeres Verzeichnis, hier schreibt der Cron hinein |
| `data/latest.demo.json` | Rückfallebene, solange der Cron noch nichts geschrieben hat |

Der Inhalt von `upload/` kommt ins Web-Root, **nicht der Ordner selbst**. Also
`index.html` direkt unter `liveglobe.site/`, nicht unter `liveglobe.site/upload/`.

### Was ausdrücklich nicht hochgeladen wird

`frontend/src`, `node_modules`, `supabase/`, `scripts/`, `data/` im Repo,
`docs/`, `.env.local`, `package.json`. Nichts davon wird zur Laufzeit gebraucht,
und `.env.local` enthält den service_role-Key — der gehört nie auf einen
Webserver.

---

## 3. Auf dem Server einrichten

Per SFTP oder SSH, im Web-Root von liveglobe.site:

```bash
cp snapshot.config.example.php snapshot.config.php
# darin eintragen:
#   supabase_url => https://jgqnyrirzcgpmtykhrpm.supabase.co
#   anon_key     => der anon public key (NICHT service_role)
chmod 755 data
```

Dann im Control Panel einen Cronjob anlegen:

| Feld | Wert |
|---|---|
| Intervall | `*/5 * * * *` |
| Befehl | `/usr/local/bin/php /home/<user>/www/<verzeichnis>/snapshot.php` |

Einmal von Hand testen:

```bash
/usr/local/bin/php ~/www/<verzeichnis>/snapshot.php
# erwartet: OK – 214 Cluster, 48213 Bytes, 2026-…
```

Läuft der Cron, holt jeder Besucher seine Startansicht als fertige JSON-Datei
vom eigenen Server. Supabase wird nur noch angefragt, wenn jemand filtert, in
der Zeit zurückgeht oder einen Pin öffnet. Genau das hält den 5-GB-Egress des
Gratistarifs unangetastet.

---

## 4. SSL zuerst

Die `.htaccess` leitet jeden Aufruf auf HTTPS um. Ist im Control Panel noch kein
Zertifikat aktiv, läuft die Seite ins Leere. Also **erst** bei Hostpoint das
kostenlose Let's-Encrypt-Zertifikat für liveglobe.site einschalten, dann
hochladen.

Falls du bewusst zuerst über `http://` prüfen willst: in `.htaccess` den Block
unter *HTTPS erzwingen* auskommentieren. Die Kartenkacheln kommen ohnehin über
HTTPS und funktionieren auch auf einer HTTP-Seite — umgekehrt wäre es blockiert.

---

## 5. Abnahme auf liveglobe.site

- [ ] Globus lädt, dreht sich, Länder sind als Vektoren sichtbar
- [ ] Statuszeile unten links nennt eine Zahl, nicht „Demodaten"
- [ ] `liveglobe.site/data/latest.json` ist jünger als 10 Minuten
- [ ] Klick auf einen Pin öffnet den Teaser, der Link führt zur Originalquelle
- [ ] `liveglobe.site/snapshot.php` im Browser liefert 403 — die `.htaccess` greift
- [ ] Rubriken-Filter und Zeit-Slider verändern die Pins
- [ ] Auf dem Telefon unter 5 Sekunden bis zu den ersten Pins

---

## 6. Später: automatisch statt von Hand

`.github/workflows/deploy.yml` liegt bereit und rsyncht bei jedem Push auf
`main`. Dafür braucht es ein GitHub-Remote (existiert noch nicht) und die
Secrets aus `docs/SETUP.md`, Abschnitt 5. Solange das nicht steht, ist der
Weg über `npm run package:hostpoint` und SFTP der richtige.
