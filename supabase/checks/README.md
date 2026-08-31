# supabase/checks

Prüfskripte zu einzelnen Migrationen. **Hier läuft nichts automatisch.**

Ein Prüfskript wird nach dem Einspielen der gleichnamigen Migration von Hand
ausgeführt — **Abschnitt für Abschnitt**, nicht als Ganzes: Manche setzen
zwischendurch die Rolle um, und `explain (analyze)` will zweimal gelaufen sein,
der erste Lauf verworfen (kalter Cache).

Diese Dateien gehören **nicht** nach `migrations/`. Dort liefen sie als Teil der
Migration mit, und ein `set role` mitten in einer Migration ist keine Migration.

| Datei | zur Migration |
|---|---|
| `0030_pruefung.sql` | `0030_event_bubbles_geoindex.sql` |
| `0030_ab_vergleich.sql` | dieselbe — der eigentliche Regressionstest |

## Eine Lehre, die hier hingehört

**Ein Prüfwert, der aus einer Messung von gestern stammt, misst das Datum
mit.** `0030_pruefung.sql` P6 hielt die grösste Bubble je Zoomstufe gegen
Zahlen vom 23.08.2026 — gemessen am 24-Stunden-Fenster jenes Tages, während
die Abfrage `now() - interval '24 hours'` fragt. Eine Woche später wichen
sie ab, und niemand konnte sagen, ob das die Migration war oder der
Kalender.

Wo es um eine Regression geht, gehören **zwei Fassungen auf dieselben
Daten** und die Erwartung ist eine Null. Absolute Zahlen dürfen daneben
stehen, aber als Beschreibung der **Form** — „auf der Ortsstufe genau 1" —
nicht als Sollwert.
