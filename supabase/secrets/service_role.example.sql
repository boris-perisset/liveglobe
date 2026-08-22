-- ===========================================================================
--  Live Globe – der Schlüssel für die Zeitpläne
--
--  Diese Datei nach `service_role.sql` kopieren, den Schlüssel einsetzen und
--  im Supabase-SQL-Editor **einmal** ausführen. Danach erst `0002_cron.sql`.
--
--  `service_role.sql` ist von `.gitignore` ausgenommen und darf nie im Repo
--  landen. Diese Vorlage hier enthält bewusst nur den Platzhalter.
--
--  ---------------------------------------------------------------------------
--  Welchen Schlüssel
--  ---------------------------------------------------------------------------
--
--  Supabase → Project Settings → API Keys → **secret key** (`sb_secret_…`).
--
--  Die alten JWT-Schlüssel (`anon` / `service_role`, beginnend mit `eyJ`)
--  funktionieren noch, laufen aber Ende 2026 aus — und sie lassen sich nur
--  gemeinsam abschalten, nicht einzeln zurückziehen. Ein `sb_secret_`-Schlüssel
--  lässt sich einzeln löschen und ersetzen. Genau das ist der Unterschied, auf
--  den es ankommt, wenn einer einmal irgendwo auftaucht, wo er nicht hingehört.
--
--  Der pg_cron-Auftrag ruft damit die Edge Function auf. Er braucht die vollen
--  Rechte, weil er schreibt — ein öffentlicher Schlüssel käme nicht durch die
--  Zeilenrechte.
-- ===========================================================================

delete from vault.secrets where name = 'service_role_key';
select vault.create_secret('<HIER_DEN_SECRET_KEY_EINSETZEN>', 'service_role_key');

-- Gegenprobe: Es muss genau eine Zeile kommen, und `laenge` darf nicht die des
-- Platzhalters sein. Der Schlüssel selbst wird bewusst nicht ausgegeben.
select name, length(decrypted_secret) as laenge
  from vault.decrypted_secrets
 where name = 'service_role_key';
