# Migration 0030 — Ortsfilter über einen Index

**Geschrieben:** 31.08.2026 als 0028 · **Abgelegt:** 31.08.2026 als **0030**
**Erster Anlauf durchgefallen und überarbeitet:** 31.08.2026
**Eingespielt und geprüft:** 31.08.2026 — P1, P6, P8 und A/B durch
**Anlass:** Supabase-Warnung „Disk IO Budget" · **Zustand:** eingespielt und geprüft

Das SQL liegt im Repo, nicht in diesem Dokument — zwei Orte für dieselbe
Wahrheit sind eine Falle. Hier steht, was zu tun ist und woran man erkennt,
dass es gewirkt hat.

---

## 0 Zwei Dinge, die vor dem Einspielen passiert sind

**Die Nummer.** Geschrieben wurde die Migration als 0028, zu einem
Zeitpunkt, an dem `STAND.md` den Migrationsstand mit 0027 angab. Beim
Ablegen war die Nummer doppelt vergeben: `0028_zuordnung_schnell.sql` und
`0029_buendelung.sql` liegen seit dem Commit *„Datenbank: Migrationen
0020-0029"* im Repo. Also 0030.

> **Lehre.** Eine Migration, die zwischen Schreiben und Ablegen liegen
> bleibt, trägt ihre Nummer nur geliehen. Die Nummer wird beim **Ablegen**
> vergeben, nicht beim Schreiben — sonst beschreibt sie einen Stand, den es
> nicht mehr gibt.

**Der erste Anlauf.** Fassung 1 wurde eingespielt und fiel in der Prüfung
durch, siehe §2. Fassung 2 ersetzt sie; da Fassung 1 nie committet war und
`create or replace` sie restlos überschreibt, gibt es nichts zu bewahren.

Am Ergebnis der Funktion hat sich in keinem der beiden Schritte etwas
geändert. Geprüft: `0028`/`0029` fassen `event_bubbles` nicht an, die
Fassung davor stammt unverändert aus **0022** (0024 nennt sie nur im
Kommentar), und der Rückweg ist im Rumpf zeichengleich mit 0022.

---

## 1 Der Befund in drei Zeilen

`event_bubbles` filtert die Orte mit `st_intersects((geom)::geometry, …)`.
`locations.geom` ist `geography`, und `locations_geom_idx` steht auf
`geography` (`0001_init.sql`, Zeile 47). **Ein Index auf einer Spalte
bedient keinen Ausdruck über dieser Spalte** — der Cast schaltet ihn still
ab.

Gemessen an der Gaza-Box, Zoom 9:

| | vorher |
|---|---|
| Ortsfilter | `Seq Scan on locations`, 16'441 verworfen für 17 Treffer, 243 ms |
| Einstieg | über `published_at`, weil kein anderer Weg offenstand |
| Gelesen | 19'061 Artikel des 24-h-Fensters, 36'356 Blockzugriffe |
| Behalten | 189 Zeilen |

Die Bounding-Box war also nie wirkungslos. Sie kam nur zu spät: Sie hat das
**Ergebnis** eingeschränkt, nicht die **Arbeit**.

---

## 2 Der erste Anlauf und warum er falsch war

Fassung 1 drehte den Ausdruck um: die Box nach `geography` casten und so den
vorhandenen `locations_geom_idx` benutzen. Sie ging sauber ein — und starb
beim ersten Aufruf der Startansicht:

```
ERROR: XX000: Antipodal (180 degrees long) edge detected!
```

Ein Rechteck von −90 bis 90 Grad Breite hat eine Kante **vom Südpol zum
Nordpol**. Auf der Kugel sind das zwei antipodale Punkte, und zwischen
antipodalen Punkten gibt es keinen kürzesten Weg, sondern unendlich viele.
PostGIS bricht deshalb ab, und zwar zu Recht.

Das war kein Randfall. `map.ts` klammert die Breite auf `[-90, 90]`, die
Startansicht schickt genau diese Werte, und der Snapshot fragt mit der
Weltbox. Betroffen waren P2, P5 und P6 — also **jede** Prüfung mit der
Weltbox, und im Betrieb die Karte selbst.

> **Lehre.** Eine Bounding-Box ist ein **flaches** Rechteck in Längen- und
> Breitengraden. Sie in einen Typ zu zwingen, der Flächen auf der Kugel
> meint, macht aus einer Rechteckfrage eine Kugelfrage — und die hat an den
> Polen keine Antwort. Der Typ war nicht der Preis für den Index, er war ein
> zweiter Gegenstand.

> **Lehre über die Prüfung.** P1–P7 haben den Fehler gefunden, aber erst
> beim Ausführen. Es fehlte die Prüfung, die aus der **Form** der Sache
> folgt: „Was passiert an den Polen?" ist eine Frage, die man einem
> Geo-Filter stellt, bevor man ihn schreibt. Sie steht jetzt als P8 drin.

---

## 3 Was Fassung 2 macht

Der Index kommt zur Box statt die Box zum Index:

1. **Ein GIST-Index auf dem Ausdruck** `(geom::geometry)` — genau dem
   Ausdruck, der in der Abfrage steht, damit er ihn bedient. Der Cast
   `geography → geometry` ist immutable, sonst ginge das nicht.
   `locations_geom_idx` bleibt unangetastet: `match_events` rechnet mit
   Entfernungen und braucht weiterhin `geography`.
2. **`&&` statt `st_intersects`** — für ein achsenparalleles Rechteck genügt
   der Vergleich der Hüllrechtecke.
3. **Die Box entsteht in einem eigenen CTE** und zerfällt an der
   Datumsgrenze in zwei sich nicht überschneidende Rechtecke — alles in
   `geometry`, wo die Weltbox unproblematisch ist. Die Breite wird auf
   `[-90, 90]` gekappt: `st_makeenvelope` nimmt 95 Grad anstandslos und
   liefert ein Rechteck, das es nicht gibt.

Preis: ein zweiter Index auf einer Tabelle mit rund 16'000 Zeilen, die
selten geschrieben wird. Kein `concurrently` — der SQL-Editor führt alles in
einer Transaktion aus, dort ist es verboten; die Sperre dauert den Bruchteil
einer Sekunde.

---

## 4 Die drei Dateien

| Datei | Ablage |
|---|---|
| `0030_event_bubbles_geoindex.sql` | `supabase/migrations/` — die Migration |
| `0030_pruefung.sql` | `supabase/checks/` — P0–P8 |
| `0030_zurueck.sql` | `supabase/rollback/` — der Rückweg, samt `drop index` |

Die beiden letzten dürfen unter keinen Umständen in `migrations/` landen:
Der Prüfteil liefe sonst als Teil der Migration mit (P7 setzt mittendrin die
Rolle um), und der Rückweg nähme unmittelbar nach 0030 die Migration wieder
zurück — still. In beiden Ordnern liegt eine `README.md`, die das sagt.

---

## 5 Einspielen

0030 läuft allein. Vorbedingung ist nur, dass 0022 drin ist; zu 0028 und
0029 besteht keine Reihenfolgebedingung. Fassung 2 darf ohne Umweg über den
Rückweg auf Fassung 1 eingespielt werden — `create or replace` und
`create index if not exists` sind beide idempotent.

1. Migration einspielen (SQL-Editor oder CLI, wie die bisherigen).
2. `checks/0030_pruefung.sql` **Abschnitt für Abschnitt** ausführen.
3. Jede `explain`-Abfrage zweimal laufen lassen, den ersten Lauf verwerfen
   (kalter Cache), Median nehmen.

---

## 6 Woran man erkennt, dass es gewirkt hat

| Prüfung | Erwartung |
|---|---|
| **P0** Index vorhanden | genau eine Zeile, `indexdef` enthält `(geom)::geometry` |
| **P1** kleine Box | `Index Scan using locations_geom_geometry_idx`; Buffers deutlich unter 36'356. Kein `Seq Scan on locations` |
| **P2** Weltbox | Einstieg weiterhin über `published_at` — dort ist er richtig. **Ergebnis unverändert** |
| **P3** Datumsgrenze | beide Zahlen gleich |
| **P4** rohe Längengrade | alle drei Zahlen gleich |
| **P5** Weltbox in drei Schreibweisen | alle drei Zahlen gleich |
| **P6** Zoomstufen | grösste Bubble weiter 1082 / 233 / 231 / 1 / 1 bei z = 1, 6, 8, 9, 12 |
| **P7** als `anon` | läuft durch, kein `permission denied` |
| **P8** Pol zu Pol | alle vier Zahlen kommen und sind gleich — kein `Antipodal` |

Bleibt P1 beim alten Plan, **obwohl P0 den Index zeigt**, liegt es an der
Selektivitätsschätzung — dann `analyze locations` wiederholen und den Plan
erneut lesen, bevor irgendetwas umgeschrieben wird.

**P6 ist die wichtigste Zeile der Tabelle.** 0030 soll den Weg zu den Zeilen
ändern, nicht die Zeilen. Weicht dort eine Zahl ab, ist etwas anderes
passiert als beabsichtigt — dann zurück mit `rollback/0030_zurueck.sql`,
nicht nachbessern.

---

## 7 Das Frontend schickt die Box längst — und kappt sie falsch

Der Entwurf nahm an, das Frontend schicke die vier Parameter gar nicht, der
Datumsgrenzen-Fehler schlafe also. **Das stimmt nicht.** `main.ts`
(`load()`) reicht `globe.bounds` an `fetchClusters` durch, `data/api.ts`
setzt daraus `p_west/p_south/p_east/p_north`, sobald `hasSupabase && bounds`.
Der Fehler war aktiv, nicht latent — und dass die Weltbox mitgeschickt wird,
ist auch der Grund, weshalb Fassung 1 sofort auffiel statt erst in einem
halben Jahr.

Offen bleibt der Kappungsausdruck in `map/map.ts`, Getter `bounds`:

```ts
west:  Math.max(-180, b.getWest()),
east:  Math.min( 180, b.getEast()),
```

Beim Schwenken über die Datumsgrenze liefert MapLibre entweder
`west 170 / east -170` — das löst 0030 sauber auf — oder
`west 170 / east 190`, und dann macht `Math.min(180, 190)` daraus **170…180**
und verschluckt die östliche Hälfte, bevor die Abfrage sie sieht. **Die
Kappung der Länge gehört weg, nicht angepasst**; die Kappung der Breite darf
bleiben, sie ist echt. Hauslehre aus 0020: einen Stellvertreter ersetzt man.

Erst nach P0–P8, nicht davor — sonst ändern sich Weg und Aufrufer
gleichzeitig und keine Messung sagt mehr, welcher der beiden gewirkt hat.

Danach, in derselben Ecke: rund 20 % Puffer auf `getBounds()`; die Box auf
die Rasterweite `max(0.05, 20 / 2^zoom)` runden, sonst erzeugt jede
Mausbewegung eine leicht andere Abfrage und kein Cache greift; ein Debounce
auf das **Ende** der Kamerafahrt.

Nicht in dieser Migration, aber im selben Anlass: Snapshot-Takt
(5 → 15 Minuten, nach dem Ingest), Snapshot-Zoom (3 → die tatsächlich
gefragte Stufe), die acht Indizes auf `articles`, die Retention per
`delete`. Siehe `DISK-IO.md`.

---

## 8 Was ohne Datenbank geprüft ist

Aus der Cloud-Sitzung gibt es kein Netz zu Supabase. Geprüft ist:

| Prüfung | Ergebnis |
|---|---|
| `pglast` über alle drei Dateien, **Hülle und Rumpf getrennt** | parst |
| Rückweg gegen 0022, Rumpf ohne Kommentare | zeichengleich |
| 0030 gegen den Rückweg | genau drei Änderungen: `grenzen`/`boxen`-CTE, `join locations … on l.geom::geometry && b.g` statt `st_intersects`, `analyze` am Ende |
| `geography` im SQL-Rumpf | kommt nur noch in Kommentaren vor |
| Signatur in Migration und Rückweg | identisch |
| Nummernkollision in `migrations/` | keine |

Was **nicht** geprüft ist und nur die Datenbank beantworten kann: ob der
Planer den Index tatsächlich nimmt. Dafür ist P1 da. Und, seit diesem Anlauf
mit Nachdruck: ob die Funktion an den Polen überhaupt läuft. Dafür ist P8 da.

---

## 9 Das Ergebnis, gemessen

**P8** — vier gleiche Zahlen (515), kein `Antipodal`. Weltbox, überdrehte Box
(±95°) und Standardbox landen auf demselben Ergebnis: Kappung und
Normalisierung greifen.

**P1** — der Plan nimmt den neuen Weg:

```
Index Scan using locations_geom_geometry_idx on locations l
  Index Cond: ((geom)::geometry && st_makeenvelope(...))
  rows=17   Buffers: shared hit=43
```

17 Orte — exakt die 17 aus der Ausgangsmessung. **Buffers gesamt 1774 statt
36356.** Danach `articles_location_idx` je Ort, dann die Verdichtung. Genau
die Reihenfolge, um die es ging.

**P6** — 723 / 150 / 150 / 1 / 1 statt 1082 / 233 / 231 / 1 / 1. Kein
Rückschritt, sondern ein anderer Tag; siehe §6 und `checks/README.md`.

**A/B** (`checks/0030_ab_vergleich.sql`) — die eigentliche Antwort. Beide
Fassungen auf denselben Daten, sieben Zoomstufen, `except all` in beide
Richtungen:

| Zoom | nur_neu | nur_alt | Zeilen |
|---|---|---|---|
| 1 | 0 | 0 | 203 |
| 2 | 0 | 0 | 515 |
| 4 | 0 | 0 | 1896 |
| 6 | 0 | 0 | 3238 |
| 8 | 0 | 0 | 3660 |
| 9 | 0 | 0 | 12191 |
| 12 | 0 | 0 | 12191 |

Keine Zeile in die eine Richtung, keine in die andere, keine Dublette. 0030
hat den Weg geändert und nichts sonst.

### Der Nebenbefund

Die Spalte „Zeilen" ist mit `p_limit = 1000000` gemessen. Im Betrieb steht
`p_limit = 1500`. Ab Zoom 4 wird also gedeckelt, ab Zoom 9 fallen **88 %**
der Ereignisse weg — und `order by sum(artikel) desc` sorgt dafür, dass es
die **leisesten** zuerst trifft.

Das ist kein Fehler von 0030; es war vorher genauso und ist nur zum ersten
Mal sichtbar. Aber es steht quer zum Zweck der Karte, und mit 0030 ist der
Ortsfilter billig geworden — eine höhere Grenze bei kleiner Box kostet jetzt
wenig. Siehe `STAND.md`, Offen §5.
