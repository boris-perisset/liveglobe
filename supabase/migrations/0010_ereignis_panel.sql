-- Globe News – Meldungen an einem Ort, nach Ereignis gruppiert
--
-- Bisher war das Panel ein Sammelbecken: „alles, was in Zürich passiert ist".
-- Der Ort war die Überschrift, und drei unabhängige Geschehen standen
-- übergangslos untereinander.
--
-- Das ist die falsche Achse. Der Ort ist eine Eigenschaft des Ereignisses, nicht
-- sein Name. Diese Funktion liefert deshalb dieselben Artikel wie
-- `articles_at()`, aber mit dem Ereignis, an dem sie hängen — die Gruppierung
-- macht dann das Frontend.
--
-- `articles_at()` bleibt unverändert bestehen. Solange die Edge Function nicht
-- neu ausgerollt ist, ist `event_id` überall null; das Panel fällt dann
-- selbsttätig auf die alte Darstellung zurück.

create or replace function articles_at_events(
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
  -- Das Ereignis. Null, solange die Zuordnung nicht gelaufen ist.
  event_id                 bigint,
  event_title              text,
  event_outlet_count       integer,
  event_article_count      integer,
  event_first_published_at timestamptz,
  event_last_published_at  timestamptz
)
language sql stable as $$
  select
    a.id, a.url, a.title, a.teaser, a.image_url, a.category, a.language,
    a.tone, a.prominence, a.published_at,
    l.name, l.country,
    st_y(l.geom::geometry), st_x(l.geom::geometry),
    s.domain, s.name, s.bias, s.ownership,
    e.id, e.title, e.outlet_count, e.article_count,
    e.first_published_at, e.last_published_at
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
  -- Werkzeug über Verbreitung ist das die interessantere Reihenfolge als
  -- „neueste zuerst".
  order by e.outlet_count desc nulls last, e.id, a.published_at
  limit 60;
$$;

grant execute on function articles_at_events(
  double precision, double precision, integer, timestamptz, timestamptz, text[], text[]
) to anon, authenticated;
