-- ===========================================================================
--  Globe News – läuft der Zeitplan?
--  Abschnitt für Abschnitt im SQL-Editor ausführen. Jeder Block beantwortet
--  eine Frage; die erste, die nicht stimmt, ist die Ursache.
-- ===========================================================================

-- 1. Sind die Erweiterungen überhaupt da?
--    Erwartet: zwei Zeilen, pg_cron und pg_net.
select extname, extversion from pg_extension
where extname in ('pg_cron', 'pg_net');

-- 2. Stehen die Aufträge – und steht die richtige Adresse drin?
--    Erwartet: zwei Zeilen, active = true, und in `command` die echte
--    Projekt-Adresse. Steht dort noch <PROJECT_REF>, war das der Fehler.
select jobid, jobname, schedule, active, command
from cron.job
order by jobname;

-- 3. Liegt der Schlüssel im Tresor?
--    Erwartet: eine Zeile, laenge um die 200 Zeichen. 0 Zeilen = Schritt 2
--    von 0002_cron.sql wurde nicht ausgeführt.
select name, length(decrypted_secret) as laenge
from vault.decrypted_secrets
where name = 'service_role_key';

-- 4. Wurde der Auftrag ausgeführt, und wie ging er aus?
--    `status` = succeeded heisst nur: das SQL lief. Ob der Aufruf ankam,
--    steht in Abschnitt 5.
select jobid, status, return_message, start_time, end_time
from cron.job_run_details
order by start_time desc
limit 10;

-- 5. Was hat die Edge Function geantwortet?
--    Das ist der entscheidende Block. Erwartet: status_code 200 und im
--    Inhalt die Zahl der übernommenen Meldungen.
--      401 → Schlüssel falsch oder fehlt
--      404 → Function nicht deployt (npm run deploy:function)
--      546 / timeout → Function läuft zu lange
select id, status_code, error_msg, left(content, 400) as antwort, created
from net._http_response
order by id desc
limit 5;

-- 6. Kommen Daten an?
--    Erwartet: alle 15 Minuten eine neue Zeile mit inserted > 0.
select id, connector, started_at, finished_at, fetched, inserted, skipped,
       left(coalesce(error, ''), 200) as fehler
from ingest_runs
order by started_at desc
limit 10;

-- 7. Wie frisch sind die Meldungen wirklich?
--    Erwartet: juengste liegt wenige Minuten zurück.
select count(*) as meldungen,
       min(published_at) as aelteste,
       max(published_at) as juengste,
       now() - max(published_at) as alter_der_juengsten
from articles;

-- 8. Und wie verteilen sie sich über die Länder?
--    Der Rundlauf soll verhindern, dass ein Land die Hälfte stellt.
select l.country, count(*) as n
from articles a
join locations l on l.id = a.location_id
where a.published_at > now() - interval '24 hours'
group by 1
order by n desc
limit 20;
