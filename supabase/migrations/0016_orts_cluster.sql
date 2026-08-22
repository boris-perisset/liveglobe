-- Globe News – zurück zu Ortsclustern, und Ereignisse erst nach dem Klick
--
-- 0015 war der falsche Weg. Ereignisse räumlich zu stapeln erzeugt Bubbles an
-- Orten, die es nicht gibt: Ein Ereignis auf Korsika und eines in Rom landen
-- in derselben groben Zelle, die Bubble sitzt auf dem Mittelwert — im
-- Tyrrhenischen Meer. Wer sie anklickt, fliegt ins Nichts.
--
-- Denselben Mittelwert bildete auch `articles_clustered` schon. Dort fiel es
-- nur nicht auf, weil viele Artikel auf denselben Orten liegen und der
-- Schwerpunkt nah an einem echten Ort blieb. Ereignisse sind dünner gestreut —
-- und legten den Fehler frei, der die ganze Zeit da war.
--
-- ---------------------------------------------------------------------------
-- Die Ordnung, die stimmt
-- ---------------------------------------------------------------------------
--
--   Zoomen  bewegt sich zwischen **Orten**: Kontinent → Land → Region → Ort.
--           Das ist eine räumliche Hierarchie, und die hat die Karte immer
--           sauber getragen.
--
--   Klicken wechselt die Ebene: erst näher heran, bis ein Ort übrig bleibt;
--           dann von Orten zu **Ereignissen**; dann zu den Artikeln eines
--           Ereignisses.
--
-- Ereignisse sind also keine Zoomstufe, sondern ein Schritt nach dem Klick.
-- Zwei Angaben je Bubble machen das möglich: `orte` sagt, ob noch mehrere
-- Orte darin stecken, `ereignisse`, was danach kommt.

create or replace function places_clustered(
  p_from       timestamptz,
  p_to         timestamptz,
  p_categories text[]           default null,
  p_zoom       integer          default 2,
  p_west       double precision default -180,
  p_south      double precision default  -90,
  p_east       double precision default  180,
  p_north      double precision default   90,
  p_ownership  text[]           default null,
  p_connectors text[]           default null,
  p_limit      integer          default 1500
)
returns table (
  lat           double precision,
  lon           double precision,
  n             integer,
  orte          integer,
  ereignisse    integer,
  country       char(2),
  location_name text,
  top_id        bigint,
  top_title     text,
  top_category  category
)
language sql stable as $$
  with raster as (
    -- Unveränderte Weitenformel. Sie ist der Grund, warum sich das Zoomen
    -- vertraut anfühlt, und daran wird nicht gerührt.
    select greatest(0.05, 20.0 / power(2, greatest(p_zoom, 0))) as weite
  ),
  je_ort as (
    -- Erst je Ort verdichten, dann erst rastern. Das ist der Unterschied:
    -- Die Zelle rechnet mit Orten, nicht mit einzelnen Artikeln.
    select l.id                       as ort_id,
           l.name                     as ort_name,
           l.country,
           st_y(l.geom::geometry)     as lat,
           st_x(l.geom::geometry)     as lon,
           count(*)::int              as artikel,
           count(distinct a.event_id)::int as ereignisse,
           (array_agg(a.id       order by a.prominence desc, a.id desc))[1] as top_id,
           (array_agg(a.title    order by a.prominence desc, a.id desc))[1] as top_title,
           (array_agg(a.category order by a.prominence desc, a.id desc))[1] as top_category
    from articles a
    join locations l on l.id = a.location_id
    left join sources s on s.id = a.source_id
    where a.published_at between p_from and p_to
      and (p_categories is null or a.category::text = any(p_categories))
      and (p_connectors is null or coalesce(a.connector, 'gdelt-en') = any(p_connectors))
      and (p_ownership  is null or coalesce(s.ownership, 'unknown') = any(p_ownership))
      and st_intersects(l.geom::geometry,
                        st_makeenvelope(p_west, p_south, p_east, p_north, 4326))
    group by l.id, l.name, l.country, l.geom
  ),
  gerastert as (
    select o.*,
           floor(o.lat / r.weite) as gy,
           floor(o.lon / r.weite) as gx,
           row_number() over (
             partition by floor(o.lat / r.weite), floor(o.lon / r.weite)
             order by o.artikel desc, o.ort_id desc
           ) as rang
    from je_ort o cross join raster r
  )
  select
    -- **Kein Mittelwert.** Die Bubble sitzt auf dem stärksten Ort der Zelle,
    -- also auf einer Koordinate, die wirklich existiert und einen Namen hat.
    -- Wer hinklickt, landet dort, wo etwas passiert ist — und nicht auf halbem
    -- Weg zwischen zwei Orten.
    (array_agg(g.lat          order by g.rang))[1],
    (array_agg(g.lon          order by g.rang))[1],
    sum(g.artikel)::integer                  as n,
    count(*)::integer                        as orte,
    sum(g.ereignisse)::integer               as ereignisse,
    (array_agg(g.country      order by g.rang))[1],
    (array_agg(g.ort_name     order by g.rang))[1],
    (array_agg(g.top_id       order by g.rang))[1],
    (array_agg(g.top_title    order by g.rang))[1],
    (array_agg(g.top_category order by g.rang))[1]
  from gerastert g
  group by g.gy, g.gx
  order by sum(g.artikel) desc
  limit p_limit;
$$;

grant execute on function places_clustered(
  timestamptz, timestamptz, text[], integer,
  double precision, double precision, double precision, double precision,
  text[], text[], integer
) to anon, authenticated;

-- ---------------------------------------------------------------- Ereignisse
/*
 * Die Ereignisse **eines** Ortes.
 *
 * Der zweite Klick: Der Ort ist aufgelöst, jetzt zerfällt er in Ereignisse.
 * Kein Umkreis in Metern, sondern der Ort selbst — dieselbe Rasterzelle wie
 * auf der Karte, damit der Klick genau das liefert, was gezeigt wurde.
 *
 * Zwei Ereignisse an derselben Koordinate bleiben zwei Zeilen; das Auffächern
 * besorgt die Karte.
 */
create or replace function events_at_place(
  p_from       timestamptz,
  p_to         timestamptz,
  p_lat        double precision,
  p_lon        double precision,
  p_zoom       integer          default 9,
  p_categories text[]           default null,
  p_limit      integer          default 40
)
returns table (
  event_id      bigint,
  lat           double precision,
  lon           double precision,
  n             integer,
  outlets       integer,
  country       char(2),
  location_name text,
  title         text,
  category      category
)
language sql stable as $$
  with r as (select greatest(0.05, 20.0 / power(2, greatest(p_zoom, 0))) as weite)
  select e.id,
         st_y(e.geom::geometry), st_x(e.geom::geometry),
         1, e.outlet_count, e.country,
         coalesce(nullif(e.location_name, ''), '—'), e.title, e.category
  from events e, r
  where e.first_published_at <= p_to
    and e.last_published_at  >= p_from
    and (p_categories is null or e.category::text = any(p_categories))
    and floor(st_x(e.geom::geometry) / r.weite) = floor(p_lon / r.weite)
    and floor(st_y(e.geom::geometry) / r.weite) = floor(p_lat / r.weite)
  order by e.outlet_count desc, e.article_count desc
  limit p_limit;
$$;

grant execute on function events_at_place(
  timestamptz, timestamptz, double precision, double precision, integer, text[], integer
) to anon, authenticated;
