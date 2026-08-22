-- ===========================================================================
--  Globe News – Zeitpläne
--
--  WICHTIG: In dieser Datei ist genau EINE Stelle auszufüllen, nämlich der
--  service_role-Key in Schritt 2. Die Projekt-Adresse steht bereits drin.
--
--  Die frühere Fassung enthielt Platzhalter <PROJECT_REF> und
--  <SERVICE_ROLE_KEY>. cron.schedule speichert seinen Befehl nur als Text und
--  prüft ihn nicht – der Auftrag wurde also angelegt, lief alle 15 Minuten und
--  rief brav eine Adresse auf, die es nicht gibt. Nach aussen: nichts passiert.
-- ===========================================================================

-- 1 ------------------------------------------------------------ Erweiterungen
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2 ------------------------------------------------------------ Schlüssel
-- Supabase → Project Settings → API → service_role (secret).
-- Der Key steht damit im Tresor, nicht im Klartext in der Auftragsdefinition.
delete from vault.secrets where name = 'service_role_key';
select vault.create_secret('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpncW55cmlyemNncG10eWtocnBtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzAwNzA1NiwiZXhwIjoyMTAyNTgzMDU2fQ.6EIhgbtKIXaUQfvOGH-MtinusPJpWNzX3ZZSMS0pZbE', 'service_role_key');

-- 3 ------------------------------------------------------------ Alte Aufträge
select cron.unschedule('globenews-ingest')
  where exists (select 1 from cron.job where jobname = 'globenews-ingest');
select cron.unschedule('globenews-retention')
  where exists (select 1 from cron.job where jobname = 'globenews-retention');

-- 4 ------------------------------------------------------------ Ingest
-- Alle 15 Minuten, passend zum Rhythmus der GDELT-Dateien.
select cron.schedule(
  'globenews-ingest',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://jgqnyrirzcgpmtykhrpm.supabase.co/functions/v1/ingest',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || (
                   select decrypted_secret from vault.decrypted_secrets
                   where name = 'service_role_key')),
    body    := jsonb_build_object('mode', 'incremental'),
    timeout_milliseconds := 120000
  );
  $$
);

-- 5 ------------------------------------------------------------ Aufräumen
-- Täglich 03:17 UTC: Detaildaten älter als 8 Tage zu Tageswerten verdichten.
select cron.schedule(
  'globenews-retention',
  '17 3 * * *',
  $$ select run_retention(); $$
);

-- 6 ------------------------------------------------------------ Sofort testen
-- Nicht bis zur nächsten Viertelstunde warten – einmal von Hand anstossen.
-- Danach ein paar Sekunden warten und `cron-check.sql` laufen lassen.
select net.http_post(
  url     := 'https://jgqnyrirzcgpmtykhrpm.supabase.co/functions/v1/ingest',
  headers := jsonb_build_object(
               'Content-Type',  'application/json',
               'Authorization', 'Bearer ' || (
                 select decrypted_secret from vault.decrypted_secrets
                 where name = 'service_role_key')),
  body    := jsonb_build_object('mode', 'incremental'),
  timeout_milliseconds := 120000
) as request_id;
