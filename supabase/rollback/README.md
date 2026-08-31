# supabase/rollback

Rückwege zu einzelnen Migrationen. **Hier läuft nichts automatisch.**

Jede Datei stellt den Stand **vor** der gleichnamigen Migration wieder her,
wortgleich aus `pg_get_functiondef` zum Zeitpunkt, als die Migration
geschrieben wurde.

Diese Dateien gehören **auf keinen Fall** nach `migrations/`. Dort liefen sie
unmittelbar nach der Migration und nähmen sie wieder zurück — eine Migration,
die sich selbst aufhebt, und zwar still.

| Datei | nimmt zurück |
|---|---|
| `0030_zurueck.sql` | `0030_event_bubbles_geoindex.sql` |
