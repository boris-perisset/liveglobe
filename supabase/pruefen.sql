-- Globe News – Kontrollabfrage
-- Im Supabase SQL Editor ausführen und das Ergebnis zurückmelden.

select 'Tabellen' as pruefung,
       string_agg(table_name, ', ' order by table_name) as ergebnis
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'

union all
select 'PostGIS',
       coalesce((select extversion from pg_extension where extname = 'postgis'), 'FEHLT')

union all
select 'pg_cron',
       coalesce((select extversion from pg_extension where extname = 'pg_cron'), 'FEHLT')

union all
select 'pg_net',
       coalesce((select extversion from pg_extension where extname = 'pg_net'), 'FEHLT')

union all
select 'Funktionen',
       coalesce(string_agg(p.proname, ', ' order by p.proname), 'KEINE')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('articles_clustered', 'articles_at', 'run_retention')

union all
select 'Quellen im Register', count(*)::text from sources

-- Daueralarm für die Domain-Normalisierung (Migration 0027).
--
-- Muss 0 sein. Steht hier eine Zahl, legt der Ingest wieder Zeilen an, die
-- nicht auf die registrierbare Domain normalisiert sind — in aller Regel, weil
-- `npm run deploy:function` fehlt. Jede solche Zeile ist ein Medium, das seinen
-- Sitz nicht findet, und das fällt sonst nirgends auf: Es entsteht kein Fehler,
-- nur eine leere Zeile ohne Namen, Land und Koordinate.
union all
select 'Domains nicht normalisiert',
       count(*)::text || case when count(*) > 0 then '  <-- deploy:function fehlt?' else '' end
from sources where gn_basisdomain(domain) <> domain

-- Phantomeinträge: eine Domain, die selbst ein öffentliches Suffix ist
-- (`com.py`, `gov.br`), kann kein Medienhaus sein. 0027 hat 150 davon entfernt.
union all
select 'Phantom-Domains', count(*)::text
from sources
where array_length(string_to_array(domain, '.'), 1) = 2
  and split_part(domain, '.', 1) in
      ('com','co','net','org','gov','edu','ac','or','ne','go','mil','int')
  and length(split_part(domain, '.', 2)) = 2

-- Verortungsgrad: Nur Outlets mit Punkt bekommen im Replay einen Bogen.
union all
select 'davon mit Redaktionssitz',
       count(*) filter (where home_geom is not null)::text || ' von ' || count(*)::text
from sources

union all
select 'Artikel', count(*)::text from articles

union all
select 'Orte', count(*)::text from locations

union all
select 'Cron-Jobs',
       coalesce((select string_agg(jobname || ' (' || schedule || ')', ', ')
                 from cron.job), 'KEINE')

union all
select 'Letzter Ingest',
       coalesce((select 'gefunden ' || fetched || ', neu ' || inserted ||
                        coalesce(', Fehler: ' || left(error, 120), '') ||
                        ' – ' || to_char(started_at, 'DD.MM. HH24:MI')
                 from ingest_runs order by started_at desc limit 1), 'noch keiner');
