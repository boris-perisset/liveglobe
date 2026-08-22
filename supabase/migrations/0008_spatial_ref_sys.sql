-- Globe News – die letzten beiden Sicherheitshinweise
--
-- Teil 1: `v_articles` aus 0005 — in 0007 uebersehen, weil ich nach
-- `v_articles_24h` gesucht hatte und die Namen sich nur im Suffix
-- unterscheiden. Sie liest aus denselben drei Tabellen wie die anderen drei
-- Ansichten und traegt `articles_at()`, also das Teaser-Panel.
--
-- Teil 2: spatial_ref_sys.
--
-- 0007 hat versucht, die Tabelle aus der öffentlichen Schnittstelle zu nehmen.
-- Das war der falsche Hebel: Der Advisor prüft, ob Zeilenrechte eingeschaltet
-- sind — nicht, ob jemand die Tabelle erreichen kann. Die Meldung blieb deshalb
-- stehen.
--
-- Der richtige Weg ist, die Zeilenrechte tatsächlich einzuschalten und ihnen
-- eine Regel mitzugeben, die alles zum Lesen freigibt. Das klingt nach einer
-- Geste, ist aber genau die richtige Beschreibung des Sachverhalts: Der Inhalt
-- — rund 8500 EPSG-Definitionen von Koordinatensystemen — ist öffentliches
-- Nachschlagewerk und soll es bleiben. Ausgesagt wird jetzt „bewusst für alle
-- lesbar" statt „nie darüber nachgedacht".
--
-- Ob es klappt, hängt an der Eigentümerschaft. `alter table ... enable row
-- level security` verlangt, dass man Eigentümer ist. Wurde PostGIS seinerzeit
-- als `postgres` eingerichtet, gehört die Tabelle `postgres` und es geht.
-- Gehört sie `supabase_admin`, geht es aus dem SQL-Editor nicht — dann bleibt
-- die Meldung, und sie ist folgenlos.
--
-- Deshalb der Block mit Ausnahmebehandlung: Er tut, was geht, und sagt
-- verständlich Bescheid, wenn nicht.

-- ---------------------------------------------------------------- v_articles
alter view public.v_articles set (security_invoker = on);
grant select on public.v_articles to anon, authenticated;

-- ---------------------------------------------------------------- spatial_ref_sys
do $$
begin
  execute 'alter table public.spatial_ref_sys enable row level security';

  -- Lesen für alle, ausdrücklich. Ohne diese Regel würde das Einschalten der
  -- Zeilenrechte die Tabelle für `anon` dichtmachen — und jede PostGIS-Funktion,
  -- die ein Koordinatensystem nachschlägt (etwa `ST_Transform`), liefe künftig
  -- ins Leere. Heute braucht das keine unserer Abfragen, weil durchgängig mit
  -- `geography` in SRID 4326 gerechnet wird. Aber ein Fehler, der erst in
  -- einem Jahr bei der ersten Umrechnung auftaucht, ist der unangenehmste.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'spatial_ref_sys' and policyname = 'p_read_srs'
  ) then
    execute 'create policy p_read_srs on public.spatial_ref_sys for select to anon, authenticated using (true)';
  end if;

  -- Den Entzug aus 0007 zurücknehmen: Jetzt tragen die Zeilenrechte die
  -- Aussage, nicht mehr der fehlende Zugriff.
  execute 'grant select on public.spatial_ref_sys to anon, authenticated';

  raise notice 'spatial_ref_sys: Zeilenrechte aktiv, Lesen ausdrücklich erlaubt.';

exception when insufficient_privilege then
  raise notice 'spatial_ref_sys gehoert einer anderen Rolle — Hinweis bleibt bestehen. Unbedenklich: oeffentliche EPSG-Referenzdaten, keine Nutzerdaten.';
end $$;
