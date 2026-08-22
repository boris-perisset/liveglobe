-- Behebt: Pins erscheinen, aber der Klick zeigt keine Meldungen.
--
-- Ursache: `articles_at` gab `setof v_articles_24h` zurück – und diese Sicht
-- trägt ein fest eingebautes `published_at > now() - interval '24 hours'`.
-- Die Cluster-Funktion fragt dagegen direkt die Tabelle ab und hält sich an den
-- Zeitregler. Sobald man weiter als 24 Stunden zurückgeht (oder der letzte
-- Ingest-Lauf länger her ist), zeigt der Globus also Pins, hinter denen die
-- Detailabfrage nichts mehr findet. Der Rückgabetyp hat die Parameter
-- stillschweigend ausgehebelt.
--
-- Lösung: eine Sicht ohne Zeitgrenze als Rückgabetyp. Das Zeitfenster kommt
-- ausschliesslich aus den Parametern – dort, wo es hingehört.

drop function if exists articles_at(
  double precision, double precision, integer, timestamptz, timestamptz);
drop function if exists articles_at(
  double precision, double precision, integer, timestamptz, timestamptz, text[], text[]);

create or replace view v_articles as
select
  a.id, a.url, a.title, a.teaser, a.image_url, a.category, a.language,
  a.tone, a.prominence, a.published_at, a.connector,
  l.name    as location_name,
  l.country as country,
  st_y(l.geom::geometry) as lat,
  st_x(l.geom::geometry) as lon,
  s.domain    as source_domain,
  s.name      as source_name,
  s.bias      as source_bias,
  s.ownership as source_ownership
from articles a
join locations l on l.id = a.location_id
left join sources s on s.id = a.source_id;

grant select on v_articles to anon, authenticated;

create function articles_at(
  p_lat double precision,
  p_lon double precision,
  p_radius_m integer default 25000,
  p_from timestamptz default now() - interval '24 hours',
  p_to   timestamptz default now(),
  p_ownership  text[] default null,
  p_connectors text[] default null
)
returns setof v_articles
language sql stable as $$
  select v.* from v_articles v
  where v.published_at between p_from and p_to
    and (p_connectors is null or coalesce(v.connector,'gdelt-en') = any(p_connectors))
    and (p_ownership  is null or coalesce(v.source_ownership,'unknown') = any(p_ownership))
    and st_dwithin(
          st_makepoint(v.lon, v.lat)::geography,
          st_makepoint(p_lon, p_lat)::geography,
          p_radius_m)
  order by v.prominence desc, v.published_at desc
  limit 50;
$$;

-- ---------------------------------------------------------------- Diagnose
-- Nach dem Einspielen ausführen und das Ergebnis anschauen:
--
--   select count(*) as artikel,
--          min(published_at) as aeltester,
--          max(published_at) as neuester,
--          count(*) filter (where published_at > now() - interval '24 hours') as letzte_24h
--   from articles;
--
--   select * from cron.job;   -- läuft der Ingest überhaupt automatisch?
