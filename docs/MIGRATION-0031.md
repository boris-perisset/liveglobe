# 0031 — Der Verteiler: schmale Box über den Index, weite über published_at

**Befund vom 31.08.2026 · noch nicht gebaut**

0030 ist nicht falsch, sondern unfertig. Es macht den schmalen Fall
dramatisch billiger und den weiten spürbar teurer, und es hat keine
Möglichkeit, die beiden auseinanderzuhalten.

---

## 1 Die Messung

Alle warm, `now() - 24 h`, ohne Rubrikfilter.

| Fall | Blöcke | Zeit | Einstieg | wer fragt so |
|---|---|---|---|---|
| Gaza-Box, z9, **mit** 0030 | 1'774 | ~50 ms | `locations_geom_geometry_idx` | Nutzer beim Hineinzoomen |
| Halbkugel (−90/−60/90/60), z1, **mit** 0030 | 168'115 | 404 ms | dito, 12'582 Orte | die Startansicht |
| Weltbox, z1, **mit** 0030 | 215'390 | 2'135 ms warm, 7'418–11'426 kalt | dito, 16'855 Orte | **nur der Snapshot** |
| Weltbox, z1, **vor** 0030 | 38'673 | 516 ms | `articles_cat_pub_idx` + Memoize | — |

## 2 Warum

Der Plan sagt es in einer Zeile:

```
Index Scan using locations_geom_geometry_idx on locations l
  (cost=... rows=2)  (actual ... rows=16842)
```

**`rows=2` geschätzt, 16'842 tatsächlich.** Die Box entsteht erst zur
Laufzeit aus den Parametern; der Planer kann ihre Grösse nicht kennen und
hält den Ortsfilter deshalb für hochselektiv. Bei schmaler Box stimmt das
und ist der ganze Gewinn. Bei weiter Box wählt er danach seinen ganzen Plan
— erst alle Orte, dann je Ort einzeln in `articles` nachschlagen und acht
von neun Zeilen wegwerfen (198'521 der 215'390 Blöcke stecken in dieser
einen Zeile).

**Die Lehre:** Ich habe den Planer eine Entscheidung treffen lassen, für die
ihm die Information fehlt. Das ist kein Fehler im SQL und keiner des
Planers — es ist ein Fehler in der Aufgabenteilung.

## 3 Der Bauplan

`event_bubbles` wird ein **Verteiler in plpgsql**, der die Fläche der Box
prüft und eine von zwei SQL-Funktionen aufruft:

- `event_bubbles_box` — der Weg aus 0030, über `locations_geom_geometry_idx`
- `event_bubbles_weit` — der Weg vor 0030, über `published_at` mit
  `st_intersects` als Nachfilter (wortgleich aus `rollback/0030_zurueck.sql`)

Ausdrücklich **kein** Planer-Trick (kein `union all` mit Einmal-Filter, keine
Schätzhilfen). Zwei getrennte Abfragen, jede für sich geplant, jede für sich
messbar. Die Signatur von `event_bubbles` bleibt unverändert — das Frontend
merkt nichts.

### Die Schwelle

Aus den Messungen: Der Box-Weg kostet rund **zwölf Blöcke je getroffenem
Ort** (198'521 / 16'855), der weite Weg pauschal **38'673**. Gleichstand bei
rund **3'200 Orten** — knapp einem Fünftel der 16'855.

Als Fläche der Box ausgedrückt, nicht als Zoomkonstante: Ändert sich die
Ortsdichte, wandert die Schwelle mit. Erster Ansatz `0.2`, danach an M1/M3
nachjustieren.

### Was zwingend dazugehört

Die Prüfung misst **Kosten, nicht nur Zeilen**. Der A/B-Vergleich aus 0030
hat bewiesen, dass die Zeilen gleich sind — über den Preis sagte er nichts,
und genau dort lag der Fehler. Für 0031 gilt beides als Pflicht:

1. `checks/0030_ab_vergleich.sql` erneut, unverändert → alle Nullen
2. `checks/0030_kosten_weltbox.sql` erneut → die Weltbox muss zurück auf
   rund 38'673 Blöcke, die Gaza-Box auf 1'774 bleiben
3. Beide Zahlen ins Protokoll, bevor irgendetwas als erledigt gilt

## 4 Was 0031 NICHT löst

Der Snapshot fragt weiterhin die ganze Welt und braucht dafür rund eine
halbe Sekunde — knapp genug unter der Drei-Sekunden-Grenze für `anon`, aber
ohne Reserve, und schon am 29.08. hat es einmal nicht gereicht. Ob seine
Rechnung dauerhaft in die Datenbank vorverlegt gehört (pg_cron füllt eine
Tabelle, `snapshot.php` holt nur noch ab) oder ob der Snapshot ganz
abgeschafft wird, ist eine eigene Entscheidung. Siehe `STAND.md`, Offen §8.
