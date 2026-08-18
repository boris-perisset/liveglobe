-- Zeitpläne. Vor dem Ausführen die Platzhalter ersetzen:
--   <PROJECT_REF>   z. B. abcdefghijklmnop
--   <SERVICE_ROLE_KEY>  Supabase → Settings → API → service_role
--
-- Sicherer Weg (empfohlen), damit der Key nicht im Klartext in der Job-Definition steht:
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
-- und unten dann per (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')

-- Ingest alle 15 Minuten
select cron.schedule(
  'globenews-ingest',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/ingest',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer <SERVICE_ROLE_KEY>'),
    body    := jsonb_build_object('mode','incremental'),
    timeout_milliseconds := 120000
  );
  $$
);

-- Retention + Rollup, täglich um 03:17 UTC
select cron.schedule(
  'globenews-retention',
  '17 3 * * *',
  $$ select run_retention(); $$
);

-- Jobs prüfen:  select * from cron.job;
-- Läufe prüfen: select * from cron.job_run_details order by start_time desc limit 20;
-- Job entfernen: select cron.unschedule('globenews-ingest');
