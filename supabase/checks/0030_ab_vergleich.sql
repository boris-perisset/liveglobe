-- =====================================================================
-- 0030 · A/B-Vergleich — der Regressionstest, der P6 hätte sein müssen
--
-- Ablage:  supabase/checks/0030_ab_vergleich.sql
--
-- ---------------------------------------------------------------------
-- WARUM P6 DIE FRAGE NICHT BEANTWORTEN KANN
--
-- P6 hält die grösste Bubble je Zoomstufe gegen 1082/233/231/1/1 aus
-- STAND.md. Diese Zahlen wurden am 23.08.2026 gemessen — am 24-Stunden-
-- Fenster jenes Tages. Die Abfrage fragt aber `now() - interval '24 hours'.
-- Eine Woche später stehen dort andere Artikel, und die Zahlen weichen ab,
-- ohne dass irgendetwas kaputt wäre.
--
-- Ein Test, der Tagesdaten gegen eine Konstante hält, misst das Datum mit.
-- Das ist derselbe Fehlertyp wie die geliehene Migrationsnummer: ein Wert,
-- der nur zum Zeitpunkt seines Aufschreibens galt.
--
-- ---------------------------------------------------------------------
-- WAS STATTDESSEN
--
-- Die alte Fassung unter anderem Namen danebenstellen und beide auf
-- **denselben** Daten laufen lassen. Dann ist die Erwartung eine Null und
-- keine Zahl aus einem Notizbuch — sie gilt heute, morgen und in einem Jahr.
--
-- Zwei Vorkehrungen, ohne die der Vergleich lügen würde:
--
--   1. `p_limit = 1000000`. Bei 1500 ist die Grenze ab Zoom 6 gesättigt
--      (STAND.md, Offen §5). Unter einem `limit` mit Gleichständen in
--      `sum(artikel)` darf jede Fassung eine andere Zeile wählen — der
--      Unterschied käme dann von der Grenze, nicht von der Migration.
--
--   2. Nur die Weltbox. An der Datumsgrenze **müssen** sich die beiden
--      unterscheiden: Genau dort korrigiert 0030 einen Fehler. Ein Test,
--      der dort Gleichheit verlangt, verlangt den Fehler zurück.
--
-- Läuft in einer Transaktion, die am Ende zurückgenommen wird. Die
-- Hilfsfunktion existiert also nur währenddessen; auch wenn mittendrin
-- etwas abbricht, bleibt nichts stehen.
-- =====================================================================

begin;

create or replace function public.event_bubbles_vor_0030(
  p_from        timestamptz,
  p_to          timestamptz,
  p_categories  text[]  default null,
  p_zoom        integer default 2,
  p_west        double precision default -180,
  p_south       double precision default -90,
  p_east        double precision default 180,
  p_north       double precision default 90,
  p_ownership   text[]  default null,
  p_connectors  text[]  default null,
  p_limit       integer default 1500
)
returns table(
  event_id bigint, article_id bigint,
  lat double precision, lon double precision,
  n integer, orte integer, ereignisse integer, outlets integer,
  country character, location_name text,
  top_id bigint, top_title text, top_category category
)
language sql
stable
as $function$
  with raster as (
    select w.weite, w.weite <= 0.05 as ortsstufe
    from (select greatest(0.05, 20.0 / power(2, greatest(p_zoom, 0))) as weite) w
  ),
  gefiltert as (
    select a.id, a.title, a.category, a.prominence, a.source_id,
           coalesce(a.event_id, -a.id) as einheit,
           l.id                   as ort_id,
           l.name                 as ort_name,
           l.country,
           st_y(l.geom::geometry) as lat,
           st_x(l.geom::geometry) as lon
    from articles a
    join locations l on l.id = a.location_id
    left join sources s on s.id = a.source_id
    where a.published_at between p_from and p_to
      and (p_categories is null or a.category::text = any(p_categories))
      and (p_connectors is null or coalesce(a.connector, 'gdelt-en') = any(p_connectors))
      and (p_ownership  is null or coalesce(s.ownership, 'unknown') = any(p_ownership))
      and st_intersects(l.geom::geometry,
                        st_makeenvelope(p_west, p_south, p_east, p_north, 4326))
  ),
  einheiten as materialized (
    select g.*,
           floor(g.lat / r.weite) as gy,
           floor(g.lon / r.weite) as gx,
           r.ortsstufe
    from (
      select einheit,
             count(*)::int                  as artikel,
             count(distinct source_id)::int as medien,
             (array_agg(ort_id   order by prominence desc, id desc))[1] as ort_id,
             (array_agg(ort_name order by prominence desc, id desc))[1] as ort_name,
             (array_agg(country  order by prominence desc, id desc))[1] as country,
             (array_agg(lat      order by prominence desc, id desc))[1] as lat,
             (array_agg(lon      order by prominence desc, id desc))[1] as lon,
             (array_agg(id       order by prominence desc, id desc))[1] as top_id,
             (array_agg(title    order by prominence desc, id desc))[1] as top_title,
             (array_agg(category order by prominence desc, id desc))[1] as top_category
      from gefiltert
      group by einheit
    ) g
    cross join raster r
  ),
  gruppiert as (
    select e.*,
           case when e.ortsstufe then e.einheit end as gruppe,
           row_number() over (
             partition by e.gy, e.gx, (case when e.ortsstufe then e.einheit end)
             order by e.artikel desc, e.einheit desc
           ) as rang
    from einheiten e
  )
  select
    case when count(*) = 1 and min(g.einheit) > 0 then  min(g.einheit) end,
    case when count(*) = 1 and min(g.einheit) < 0 then -min(g.einheit) end,
    (array_agg(g.lat          order by g.rang))[1],
    (array_agg(g.lon          order by g.rang))[1],
    sum(g.artikel)::integer                   as n,
    count(distinct g.ort_id)::integer         as orte,
    count(*)::integer                         as ereignisse,
    max(g.medien)::integer                    as outlets,
    (array_agg(g.country      order by g.rang))[1],
    (array_agg(g.ort_name     order by g.rang))[1],
    (array_agg(g.top_id       order by g.rang))[1],
    (array_agg(g.top_title    order by g.rang))[1],
    (array_agg(g.top_category order by g.rang))[1]
  from gruppiert g
  group by g.gy, g.gx, g.gruppe
  order by sum(g.artikel) desc
  limit p_limit;
$function$;

-- ---------------------------------------------------------------------
-- Beide Fassungen, dieselben Daten, sieben Zoomstufen.
--
-- ERWARTUNG: `nur_neu` und `nur_alt` sind auf **jeder** Zeile 0.
--
-- `except all` statt `except`: zählt auch Vielfachheiten. Entstünde durch
-- den Box-Join eine Zeile doppelt, bliebe sie bei `except` unsichtbar —
-- und genau die Dublette wäre der interessante Fehler.
-- ---------------------------------------------------------------------
select
  z.zoom,
  (select count(*) from (
     select * from event_bubbles(
              now() - interval '24 hours', now(), null, z.zoom,
              -180, -90, 180, 90, null, null, 1000000)
     except all
     select * from event_bubbles_vor_0030(
              now() - interval '24 hours', now(), null, z.zoom,
              -180, -90, 180, 90, null, null, 1000000)) d)  as nur_neu,
  (select count(*) from (
     select * from event_bubbles_vor_0030(
              now() - interval '24 hours', now(), null, z.zoom,
              -180, -90, 180, 90, null, null, 1000000)
     except all
     select * from event_bubbles(
              now() - interval '24 hours', now(), null, z.zoom,
              -180, -90, 180, 90, null, null, 1000000)) d)  as nur_alt,
  (select count(*) from event_bubbles(
              now() - interval '24 hours', now(), null, z.zoom,
              -180, -90, 180, 90, null, null, 1000000))     as zeilen_gesamt
from (select unnest(array[1, 2, 4, 6, 8, 9, 12]) as zoom) z
order by z.zoom;

-- Nimmt die Hilfsfunktion wieder weg. Nichts von hier bleibt in der
-- Datenbank stehen.
rollback;
