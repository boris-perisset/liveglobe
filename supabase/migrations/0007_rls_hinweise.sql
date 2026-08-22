-- Globe News – Supabase-Sicherheitshinweise abräumen
--
-- Vier Meldungen des Security Advisors, alle älter als das Ereignismodell:
-- drei Ansichten aus 0003/0004 laufen mit den Rechten ihres Erstellers, und
-- PostGIS' eigene Referenztabelle liegt im öffentlichen Schema.
--
-- Keine davon gibt heute Daten preis, die nicht ohnehin öffentlich lesbar sind.
-- Aufgeräumt gehört es trotzdem: Sobald es einmal eine Tabelle mit echten
-- Zeilenrechten gibt, wäre eine Ansicht mit Ersteller-Rechten ein stilles Loch.

-- ---------------------------------------------------------------- Ansichten
--
-- Bis Postgres 14 liefen Ansichten immer mit den Rechten dessen, der sie
-- angelegt hat. Seit 15 gibt es `security_invoker` — dann gelten die Rechte
-- und Zeilenregeln der abfragenden Rolle, so wie man es erwartet.
--
-- Reihenfolge beachten: erst die Rechte auf die zugrundeliegenden Tabellen
-- sicherstellen, dann umschalten. Andersherum entstünde ein Moment, in dem die
-- Ansicht für `anon` bereits die eigenen Rechte verlangt, diese aber noch nicht
-- erteilt sind — die Seite zeigte dann leere Listen statt Meldungen.
grant select on public.articles   to anon, authenticated;
grant select on public.locations  to anon, authenticated;
grant select on public.sources    to anon, authenticated;
grant select on public.events        to anon, authenticated;
grant select on public.event_outlets to anon, authenticated;

-- Und die Leserechte auf die Ansichten selbst. Ohne sie antwortet Postgres mit
-- „permission denied for view" — bisher trugen das stillschweigend die
-- Standardrechte des Schemas. Diese Migration soll nicht davon abhängen, was
-- irgendwann einmal per Vorgabe erteilt wurde.
grant select on public.v_articles_24h    to anon, authenticated;
grant select on public.v_coverage_24h    to anon, authenticated;
grant select on public.v_ownership_stats to anon, authenticated;

alter view public.v_articles_24h    set (security_invoker = on);
alter view public.v_coverage_24h    set (security_invoker = on);
alter view public.v_ownership_stats set (security_invoker = on);

-- ---------------------------------------------------------------- PostGIS
--
-- `spatial_ref_sys` gehört der PostGIS-Erweiterung und enthält die öffentlichen
-- EPSG-Definitionen der Koordinatensysteme — rund 8500 Zeilen Nachschlagewerk,
-- keine Nutzerdaten. Zeilenrechte lassen sich darauf nicht einschalten: Die
-- Tabelle gehört `supabase_admin`, und `alter table ... enable row level
-- security` verlangt Eigentümerschaft. Der Versuch scheitert mit
-- „must be owner of table spatial_ref_sys".
--
-- Was geht, ist sie aus der öffentlichen Schnittstelle zu nehmen. Damit
-- verschwindet der Grund für die Meldung, auch wenn die Meldung selbst
-- bestehen bleiben kann — der Advisor prüft auf RLS, nicht auf Erreichbarkeit.
--
-- Die saubere Lösung wäre, PostGIS in ein eigenes, nicht veröffentlichtes
-- Schema zu legen. Das ist auf einer laufenden Datenbank ein Eingriff, der in
-- keinem Verhältnis zum Nutzen steht.
--
-- Schlägt der folgende Block fehl, ist das folgenlos: Die Tabelle bleibt
-- lesbar, und lesbar war sie ohnehin für jeden.
do $$
begin
  revoke all on public.spatial_ref_sys from anon, authenticated;
exception when insufficient_privilege or others then
  raise notice 'spatial_ref_sys: Rechte unverändert (%). Unbedenklich.', sqlerrm;
end $$;
