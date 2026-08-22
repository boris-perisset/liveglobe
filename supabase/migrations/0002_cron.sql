-- ===========================================================================
--  Live Globe – Zeitpläne
--
--  Diese Datei enthält **keinen Schlüssel** und darf nie einen enthalten.
--  Sie liegt in einem öffentlichen Repo.
--
--  Der Schlüssel kommt aus `supabase/secrets/service_role.sql` — eine Datei,
--  die nicht versioniert wird. Vorlage: `service_role.example.sql`.
--
--  ---------------------------------------------------------------------------
--  Warum die Trennung eine Zeit lang nicht hielt
--  ---------------------------------------------------------------------------
--
--  Hier standen einmal Platzhalter <PROJECT_REF> und <SERVICE_ROLE_KEY>.
--  `cron.schedule` speichert seinen Befehl nur als Text und prüft ihn nicht —
--  der Auftrag wurde also angelegt, lief alle 15 Minuten und rief brav eine
--  Adresse auf, die es nicht gibt. Nach aussen: nichts passiert. Daraufhin
--  wanderte der echte Schlüssel in die Datei, und von dort ins Repo.
--
--  Der Fehler war nicht der Platzhalter, sondern sein **Schweigen**. Deshalb
--  steht in Schritt 2 jetzt eine Prüfung, die laut abbricht, wenn der Tresor
--  leer ist. Ein fehlender Schlüssel fällt damit sofort auf — und niemand
--  kommt mehr auf die Idee, ihn hier hineinzuschreiben.
-- ===========================================================================

-- 1 ------------------------------------------------------------ Erweiterungen
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2 ------------------------------------------------------------ Schlüssel
-- Zuerst `supabase/secrets/service_role.sql` im SQL-Editor ausführen. Erst
-- danach diese Datei — sonst bricht sie hier ab, statt einen Auftrag anzulegen,
-- der nur so tut als ob.
do $$
declare
  s text;
begin
  select decrypted_secret into s
    from vault.decrypted_secrets
   where name = 'service_role_key';

  if s is null or s = '' or s like '<%' or s like 'DEIN_%' then
    raise exception 'Kein Schlüssel im Tresor unter dem Namen service_role_key.'
      using hint = 'Zuerst supabase/secrets/service_role.sql ausführen. '
                   'Die Datei liegt nicht im Repo; Vorlage ist service_role.example.sql.';
  end if;
end $$;

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
