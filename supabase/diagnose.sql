-- Warum erscheinen Pins, aber keine Meldungen?
-- Im SQL Editor ausführen und die Ausgabe zurückmelden.

select 'Artikel gesamt' as frage, count(*)::text as antwort from articles

union all
select 'davon letzte 24 h',
       count(*) filter (where published_at > now() - interval '24 hours')::text
from articles

union all
select 'ältester / neuester',
       coalesce(to_char(min(published_at), 'DD.MM. HH24:MI') || '  –  ' ||
                to_char(max(published_at), 'DD.MM. HH24:MI'), '—')
from articles

union all
select 'Herkunftsströme',
       coalesce(string_agg(connector || ': ' || n, ',  '), '—')
from (select coalesce(connector, '(leer)') as connector, count(*)::text as n
      from articles group by 1) x

union all
select 'Trägerschaft der Quellen',
       coalesce(string_agg(ownership || ': ' || n, ',  '), '—')
from (select coalesce(ownership, '(leer)') as ownership, count(*)::text as n
      from sources group by 1) y

union all
select 'Zeitpläne aktiv',
       coalesce((select string_agg(jobname || ' (' || schedule || ')', ',  ') from cron.job),
                'KEINE – 0002_cron.sql wurde nie ausgeführt')

union all
select 'letzte Ingest-Läufe',
       coalesce((select string_agg(to_char(started_at, 'DD.MM. HH24:MI') ||
                                   ': ' || inserted || ' neu', ',  ')
                 from (select * from ingest_runs order by started_at desc limit 3) z), '—')

union all
-- Die Detailabfrage einmal gegen den neuesten Artikel gegenprüfen:
-- findet sie ihn, stimmt die Kette Pin → Panel.
select 'Detailabfrage am neuesten Pin',
       coalesce((
         select count(*)::text || ' Treffer'
         from articles a
         join locations l on l.id = a.location_id
         cross join lateral articles_at(
           st_y(l.geom::geometry), st_x(l.geom::geometry), 200000,
           now() - interval '8 days', now()) t
         where a.id = (select id from articles order by published_at desc limit 1)
       ), 'keine Artikel vorhanden');
