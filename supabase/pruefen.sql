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
