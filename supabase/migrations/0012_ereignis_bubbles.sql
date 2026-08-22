-- Globe News – ein Bubble je Ereignis
--
-- Bisher zeigt der Globus Rasterzellen aus `articles_clustered`: Was räumlich
-- nah beieinander liegt, wird zu einem Punkt zusammengefasst, egal ob es
-- dasselbe Geschehen betrifft. Drei unabhängige Ereignisse in Zürich ergaben
-- eine Bubble mit der Zahl 3.
--
-- Ab hier gibt es beim Hineinzoomen **ein Bubble je Ereignis**. Die weite
-- Ansicht bleibt bei den Artikel-Zellen — dort sind Ereignisse zu zahlreich,
-- und der vorgefertigte Snapshot soll weiter tragen.
--
-- Drei Teile:
--   1. Ereignisse merken sich ihren Ortsnamen (bisher hing der am Artikel,
--      und der verschwindet nach der Aufbewahrungsfrist)
--   2. `events_in_bounds()` — Ereignisse im sichtbaren Ausschnitt
--   3. `articles_of_event()` — die Meldungen genau eines Ereignisses

-- ---------------------------------------------------------------- Ortsname
alter table events add column if not exists location_name text;

-- Nachtragen, was sich noch aus den vorhandenen Artikeln ablesen lässt.
update events e
   set location_name = q.name
  from (
    select distinct on (a.event_id) a.event_id, l.name
    from articles a
    join locations l on l.id = a.location_id
    where a.event_id is not null
    order by a.event_id, a.published_at
  ) q
 where q.event_id = e.id
   and e.location_name is null;

-- ---------------------------------------------------------------- Zuordnung
-- Unverändert bis auf eine Zeile: Der Ortsname wandert beim Anlegen mit ins
-- Ereignis. Der Rest steht wortgleich in 0006 und ist dort begründet.
create or replace function match_events(p_url_hashes text[])
returns table (zugeordnet integer, neu integer)
language plpgsql as $$
declare
  k        match_config%rowtype;
  a        record;
  treffer  record;
  ev_id    bigint;
  ist_neu  boolean;
  n_zu     integer := 0;
  n_neu    integer := 0;
begin
  select * into k from match_config where id;

  for a in
    select ar.id, ar.url_hash, ar.category, ar.published_at,
           ar.title, ar.source_id,
           coalesce(ar.title_tokens, '{}') as tokens,
           coalesce(ar.names, '{}')        as names,
           l.geom, l.country, l.name as ortsname
    from articles ar
    join locations l on l.id = ar.location_id
    where ar.url_hash = any(p_url_hashes)
      and ar.event_id is null
    order by ar.published_at, ar.id
  loop
    select e.id,
           ( gn_shared(a.names, e.names) >= k.stark_namen
             and st_distance(a.geom, e.geom) <= k.voll_meter ) as stark,
           ( k.gewicht_zeit  * greatest(0, 1 - abs(extract(epoch from (a.published_at - e.last_published_at))) / (k.max_stunden * 3600))
           + k.gewicht_ort   * greatest(0, least(1, 1 - (st_distance(a.geom, e.geom) - k.voll_meter) / nullif(k.max_meter - k.voll_meter, 0)))
           + k.gewicht_token * gn_overlap(a.tokens, e.tokens)
           + k.gewicht_name  * gn_overlap(a.names,  e.names)
           )::real as score
      into treffer
    from events e
    where e.category = a.category
      and e.last_published_at between a.published_at - make_interval(hours => k.max_stunden::int)
                                  and a.published_at + make_interval(hours => k.max_stunden::int)
      and a.published_at <= e.first_published_at + make_interval(hours => k.max_gesamt_std::int)
      and st_dwithin(a.geom, e.geom, k.max_meter)
      and ( gn_overlap(a.tokens, e.tokens) >= k.mindest_token
         or gn_shared(a.names, e.names)      >= k.mindest_namen )
    order by score desc
    limit 1;

    if treffer.id is not null and (treffer.score >= k.schwelle or treffer.stark) then
      ev_id := treffer.id;
      ist_neu := false;
      n_zu := n_zu + 1;

      update events e
         set last_published_at = greatest(e.last_published_at, a.published_at),
             article_count     = e.article_count + 1,
             tokens = case when e.article_count < k.lern_bis
                           then (select array_agg(distinct t) from unnest(e.tokens || a.tokens) t)
                           else e.tokens end,
             names  = case when e.article_count < k.lern_bis
                           then (select array_agg(distinct t) from unnest(e.names || a.names) t)
                           else e.names end
       where e.id = ev_id;
    else
      insert into events (category, country, geom, title, location_name,
                          first_published_at, last_published_at,
                          article_count, tokens, names)
      values (a.category, a.country, a.geom, a.title, a.ortsname,
              a.published_at, a.published_at, 1, a.tokens, a.names)
      returning id into ev_id;
      ist_neu := true;
      n_neu := n_neu + 1;
    end if;

    update articles
       set event_id = ev_id,
           event_match_confidence = case when ist_neu then null else treffer.score end
     where id = a.id;

    if a.source_id is not null then
      insert into event_outlets (event_id, source_id, first_seen_at, article_url_hash, confidence)
      values (ev_id, a.source_id, a.published_at, a.url_hash,
              case when ist_neu then 1.0 else treffer.score end)
      on conflict (event_id, source_id) do update
        set first_seen_at    = excluded.first_seen_at,
            article_url_hash = excluded.article_url_hash
        where excluded.first_seen_at < event_outlets.first_seen_at;
    end if;
  end loop;

  update events e
     set outlet_count = (select count(*) from event_outlets eo where eo.event_id = e.id)
   where e.id in (select ar.event_id from articles ar where ar.url_hash = any(p_url_hashes));

  zugeordnet := n_zu;
  neu := n_neu;
  return next;
end $$;

-- ---------------------------------------------------------------- Ausschnitt
--
-- Ereignisse im sichtbaren Kartenausschnitt, einzeln — nicht gruppiert. Das ist
-- der Kern: Zwei Ereignisse am selben Ort bleiben zwei Zeilen und werden vom
-- Frontend nebeneinander gesetzt, statt zu einer Zahl zu verschmelzen.
--
-- Der Ausschnitt ist Pflicht, keine Kosmetik. Ohne ihn lieferte die Abfrage bei
-- feiner Zoomstufe jedes Ereignis der Welt — bei zehntausenden pro Tag ist das
-- weder für die Datenbank noch für die Leitung zumutbar.
create or replace function events_in_bounds(
  p_from       timestamptz,
  p_to         timestamptz,
  p_categories text[]           default null,
  p_west       double precision default -180,
  p_south      double precision default  -90,
  p_east       double precision default  180,
  p_north      double precision default   90,
  p_limit      integer          default 1200
)
returns table (
  id            bigint,
  lat           double precision,
  lon           double precision,
  n             integer,
  outlets       integer,
  country       char(2),
  location_name text,
  title         text,
  category      category,
  first_published_at timestamptz,
  last_published_at  timestamptz
)
language sql stable as $$
  select e.id,
         st_y(e.geom::geometry), st_x(e.geom::geometry),
         e.article_count, e.outlet_count,
         e.country, coalesce(e.location_name, ''), e.title, e.category,
         e.first_published_at, e.last_published_at
  from events e
  where e.first_published_at <= p_to
    and e.last_published_at  >= p_from
    and (p_categories is null or e.category::text = any(p_categories))
    -- `st_makeenvelope` mit SRID 4326, gegen die Geometrie statt die Geographie
    -- geprüft: Beim Ausschnitt zählt Schnelligkeit, nicht Genauigkeit auf den
    -- Meter — und der GIST-Index greift so unmittelbar.
    and st_intersects(
          e.geom::geometry,
          st_makeenvelope(p_west, p_south, p_east, p_north, 4326))
  -- Reichweite zuerst: Wird die Grenze erreicht, fallen die unbedeutendsten
  -- Ereignisse weg, nicht die zufällig zuletzt eingelaufenen.
  order by e.outlet_count desc, e.article_count desc, e.id
  limit p_limit;
$$;

-- ---------------------------------------------------------------- Ein Ereignis
-- Die Meldungen genau eines Ereignisses. Wird gebraucht, sobald der Klick einer
-- Bubble gilt und nicht mehr einem Umkreis.
create or replace function articles_of_event(p_event_id bigint)
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
  gesamt                   bigint
)
language sql stable as $$
  select a.id, a.url, a.title, a.teaser, a.image_url, a.category, a.language,
         a.tone, a.prominence, a.published_at,
         l.name, l.country,
         st_y(l.geom::geometry), st_x(l.geom::geometry),
         s.domain, s.name, s.bias, s.ownership,
         e.id, e.title, e.outlet_count, e.article_count,
         e.first_published_at, e.last_published_at,
         count(*) over ()
  from articles a
  join events   e on e.id = a.event_id
  join locations l on l.id = a.location_id
  left join sources s on s.id = a.source_id
  where a.event_id = p_event_id
  order by a.published_at
  limit 120;
$$;

grant execute on function events_in_bounds(
  timestamptz, timestamptz, text[], double precision, double precision,
  double precision, double precision, integer
) to anon, authenticated;
grant execute on function articles_of_event(bigint) to anon, authenticated;
