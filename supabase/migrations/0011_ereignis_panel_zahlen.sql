-- Globe News – ehrliche Zahlen im Ereignis-Panel
--
-- 0010 hatte zwei Schwächen, die erst am echten Bildschirm auffielen:
--
-- 1. `limit 60` traf bei dichten Rasterzellen zu. Das Panel schrieb dann
--    „60 Meldungen" — eine Zahl, die nicht die Menge beschreibt, sondern die
--    eigene Obergrenze. Genau die Sorte stiller Halbwahrheit, die dieses
--    Projekt vermeiden will.
--
-- 2. Der Ortsname kam aus der Rasterzelle, nicht aus dem Ereignis. Bei einem
--    Pin, dessen Schwerpunkt zufällig bei Riga liegt, standen darunter
--    Ereignisse aus Tallinn und Vilnius — und der Kopf behauptete „Riga".
--
-- Diese Fassung liefert die tatsächliche Trefferzahl mit (Fensterfunktion,
-- also vor dem `limit` berechnet) und hebt die Grenze an. Den Ortsnamen je
-- Ereignis trägt das Frontend aus `location_name` zusammen.

drop function if exists articles_at_events(
  double precision, double precision, integer, timestamptz, timestamptz, text[], text[]
);

create function articles_at_events(
  p_lat        double precision,
  p_lon        double precision,
  p_radius_m   integer     default 25000,
  p_from       timestamptz default now() - interval '24 hours',
  p_to         timestamptz default now(),
  p_ownership  text[]      default null,
  p_connectors text[]      default null
)
returns table (
  id            bigint,
  url           text,
  title         text,
  teaser        text,
  image_url     text,
  category      category,
  language      char(3),
  tone          real,
  prominence    integer,
  published_at  timestamptz,
  location_name text,
  country       char(2),
  lat           double precision,
  lon           double precision,
  source_domain text,
  source_name   text,
  source_bias   smallint,
  source_ownership text,
  event_id                 bigint,
  event_title              text,
  event_outlet_count       integer,
  event_article_count      integer,
  event_first_published_at timestamptz,
  event_last_published_at  timestamptz,
  -- Wie viele Meldungen es an diesem Ort im Zeitfenster wirklich gibt.
  -- Die Fensterfunktion rechnet vor dem `limit`, liefert also die volle Zahl.
  gesamt                   bigint
)
language sql stable as $$
  select * from (
    select
      a.id, a.url, a.title, a.teaser, a.image_url, a.category, a.language,
      a.tone, a.prominence, a.published_at,
      l.name, l.country,
      st_y(l.geom::geometry), st_x(l.geom::geometry),
      s.domain, s.name, s.bias, s.ownership,
      e.id, e.title, e.outlet_count, e.article_count,
      e.first_published_at, e.last_published_at,
      count(*) over () as gesamt
    from articles a
    join locations l on l.id = a.location_id
    left join sources s on s.id = a.source_id
    left join events  e on e.id = a.event_id
    where a.published_at between p_from and p_to
      and (p_connectors is null or coalesce(a.connector, 'gdelt-en') = any(p_connectors))
      and (p_ownership  is null or coalesce(s.ownership, 'unknown') = any(p_ownership))
      and st_dwithin(l.geom, st_makepoint(p_lon, p_lat)::geography, p_radius_m)
    -- Ereignisse mit der grössten Reichweite zuerst; innerhalb eines Ereignisses
    -- aufsteigend nach Zeit. Wer zuerst berichtet hat, steht oben — bei einem
    -- Werkzeug über Verbreitung ist das die interessantere Reihenfolge.
    order by e.outlet_count desc nulls last, e.id, a.published_at
    limit 120
  ) t;
$$;

grant execute on function articles_at_events(
  double precision, double precision, integer, timestamptz, timestamptz, text[], text[]
) to anon, authenticated;
