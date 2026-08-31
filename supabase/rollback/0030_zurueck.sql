-- =====================================================================
-- 0030 · Rückweg
--
-- Ablage:  supabase/rollback/0030_zurueck.sql
--          AUF KEINEN FALL nach supabase/migrations/ — dort läuft es
--          unmittelbar nach 0030 und nimmt sie wieder zurück.
--
-- Stellt event_bubbles auf den Stand vor 0030 zurück, wortgleich aus
-- pg_get_functiondef vom 31.08.2026. Nur nötig, wenn die Prüfung P1/P2
-- einen schlechteren Plan zeigt als vorher.
--
-- Achtung: Damit kehrt der Datumsgrenzen-Fehler zurück — p_west > p_east
-- ergibt ein Rechteck, das andersherum um die Welt läuft. Das Frontend
-- schickt die Box mit (main.ts → data/api.ts), der Fehler ist also
-- wirksam und nicht bloss angelegt. Wer zurückgeht, geht auch dorthin
-- zurück.
-- =====================================================================

-- Zuerst die Funktion, dann der Index. Andersherum liefe die alte Fassung
-- einen Wimpernschlag lang ohne ihn — belanglos hier, aber die Reihenfolge
-- „erst die Leser, dann das Gelesene" kostet nichts und stimmt immer.

create or replace function public.event_bubbles(
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

grant execute on function public.event_bubbles(
  timestamptz, timestamptz, text[], integer,
  double precision, double precision, double precision, double precision,
  text[], text[], integer
) to anon, authenticated;

-- Der Ausdrucksindex aus 0030. Er stört die alte Fassung nicht — sie fragt ihn
-- nie —, aber ein Rückweg, der etwas stehenlässt, ist kein Rückweg. Er kostet
-- sonst bei jedem Schreiben auf locations Zeit, für die niemand mehr einen
-- Nutzen hat.
drop index if exists locations_geom_geometry_idx;
