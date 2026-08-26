-- Live Globe – auffächern erst auf der untersten Stufe
--
-- Auf dem Globus, Zoom 1,4, standen Ringe aus zwei Dutzend Pins um Kiew, um
-- Michigan, um die Golfregion. Gemeint war das nie: Auffächern gehört auf die
-- Stadtebene, dorthin, wo mehrere Ereignisse tatsächlich auf derselben
-- Koordinate sitzen.
--
-- ---------------------------------------------------------------------------
-- Warum die Regel aus 0017/0018 das zulässt
-- ---------------------------------------------------------------------------
--
-- Die Bedingung lautete:
--
--     min(ort_id) over (partition by gy, gx) = max(ort_id) over (partition by gy, gx)
--
-- „Ein Ort in dieser Zelle" — gedacht als Stellvertreter für „wir sind ganz
-- unten angekommen, die Zelle ist nur noch so gross wie ein Ort". Das ist ein
-- Schluss über die **Ortsdichte**, kein Schluss über den Zoom. Er hält nur,
-- solange Orte dicht genug liegen, dass eine grosse Zelle mehrere erwischt.
--
-- Genau das tun sie nicht. Die Verortung ist grob: GDELT setzt auf Städte, das
-- Outlet-Register fällt auf die Hauptstadt zurück. Alles aus der Ukraine sitzt
-- damit auf Kiew — und eine 10°-Zelle über der Ukraine enthält **einen** Ort.
-- Sie zerfiel also, bei Zoom 1.
--
-- Was danach geschieht, macht es schlimmer: Das Frontend legt gleiche
-- Koordinaten auf einen Pixelring. Auf Globusstufe sind 70 px mehrere hundert
-- Kilometer, der Pin landet in Belarus. Dieselbe Klasse Fehler wie „Klick auf
-- Korsika landete im Vatikan" — ein Punkt auf der Karte muss einem Ort
-- entsprechen, den es gibt.
--
-- ---------------------------------------------------------------------------
-- Die Behebung: ein zweites Tor, und es ist hergeleitet
-- ---------------------------------------------------------------------------
--
-- Aufgefächert wird ab jetzt nur noch, wenn **beides** gilt: ein Ort in der
-- Zelle *und* die unterste Stufe erreicht.
--
-- Was „unterste Stufe" heisst, steht bereits in der Weitenformel und muss
-- nicht erfunden werden:
--
--     weite = greatest(0.05, 20 / 2^zoom)
--
-- Ab Zoom 8,64 greift die untere Schranke — die Zelle schrumpft nicht mehr,
-- egal wie weit man hineinzoomt. Für ganzzahlige Zoomstufen heisst das: ab 9.
-- 0,05° sind rund 5,5 km, also Stadtmass. Die Bedingung wird deshalb nicht als
-- Zoomkonstante geschrieben, sondern als das, was sie ist:
--
--     weite <= 0.05   →   der Raster steht am Anschlag
--
-- Ändert jemand später die Weitenformel, wandert das Tor von selbst mit.
--
-- ---------------------------------------------------------------------------
-- Nebenwirkungen, absichtlich
-- ---------------------------------------------------------------------------
--
-- * **Weniger Zeilen.** Wo vorher 40 Einzelmeldungen 40 Bubbles ergaben, ist
--   es jetzt eine mit `ereignisse = 40`. Das ist billiger, nicht teurer — 0017
--   hatte bereits vermerkt, dass körnige Karten die Abfrage verteuern.
-- * **Der Klick bleibt eindeutig.** Mehrere Ereignisse → näher heran; ein
--   Ereignis → Panel. Neu gilt der erste Fall auf den oberen Stufen wieder
--   durchgehend, so wie beschrieben.
-- * **Unverändert:** Koordinate, Auswahl der stärksten Einheit, Zählweise,
--   `outlets` als Maximum. Ab Zoom 9 sind die Ergebnisse Zeile für Zeile
--   dieselben wie in 0018.
--
-- Gegenprobe, die den Fall nachstellt statt eine Teilbedingung zu prüfen:
--
--     select p_zoom, count(*), max(ereignisse)
--     from (values (1),(3),(6),(8),(9),(12)) v(p_zoom),
--     lateral event_bubbles(now() - interval '24 hours', now(), null, v.p_zoom)
--     group by 1 order by 1;
--
-- Erwartung: bis Stufe 8 ist `count(*)` deutlich kleiner als heute und
-- `max(ereignisse)` deutlich grösser; ab 9 ändert sich gegenüber 0018 nichts.

drop function if exists event_bubbles(
  timestamptz, timestamptz, text[], integer,
  double precision, double precision, double precision, double precision,
  text[], text[], integer
);

create function event_bubbles(
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
  -- Gesetzt, sobald die Bubble **ein** Ereignis ist. Sonst null — dann ist sie
  -- eine Gruppe, und ein Klick heisst „näher heran".
  event_id      bigint,
  -- Gesetzt, wenn die Bubble eine einzelne unzugeordnete Meldung ist. Genau
  -- eines von beiden trägt einen Wert, nie beide.
  article_id    bigint,
  lat           double precision,
  lon           double precision,
  n             integer,
  orte          integer,
  ereignisse    integer,
  outlets       integer,
  country       char(2),
  location_name text,
  top_id        bigint,
  top_title     text,
  top_category  category
)
language sql stable as $$
  with raster as (
    -- Weitenformel unverändert aus 0016. Neu daneben: die Frage, ob sie am
    -- Anschlag steht — das ist die unterste Stufe, und nur dort wird
    -- aufgefächert. Die Weite wird einmal gerechnet und zweimal gelesen.
    select w.weite, w.weite <= 0.05 as ortsstufe
    from (select greatest(0.05, 20.0 / power(2, greatest(p_zoom, 0))) as weite) w
  ),
  gefiltert as (
    select a.id, a.title, a.category, a.prominence, a.source_id,
           -- Eine unzugeordnete Meldung ist ein Ereignis von eins. Negative
           -- Kennungen sind Einzelmeldungen, positive echte Ereignisse.
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
    -- **Ein** Durchgang über die Artikel. Alles, was eine Einheit ausmacht,
    -- entsteht hier; danach wird nur noch mit Einheiten gerechnet, und davon
    -- gibt es eine Grössenordnung weniger als Artikel.
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
  markiert as (
    -- Zwei Bedingungen, und die zweite ist die neue: unterste Stufe erreicht,
    -- **und** nur ein Ort in dieser Zelle. Der Fensterausdruck bleibt, wie er
    -- war — kein zweites Lesen, kein Join, keine Schleife.
    select e.*,
           e.ortsstufe
           and min(e.ort_id) over (partition by e.gy, e.gx)
             = max(e.ort_id) over (partition by e.gy, e.gx) as ein_ort
    from einheiten e
  ),
  gruppiert as (
    -- Tor offen → jede Einheit wird ihre eigene Gruppe, die Zelle zerfällt in
    -- ihre Ereignisse. Tor zu → `gruppe` ist für alle Zeilen null, und sie
    -- fallen zu einer gezählten Bubble zusammen.
    select m.*,
           case when m.ein_ort then m.einheit end as gruppe,
           row_number() over (
             partition by m.gy, m.gx, (case when m.ein_ort then m.einheit end)
             order by m.artikel desc, m.einheit desc
           ) as rang
    from markiert m
  )
  select
    case when count(*) = 1 and min(g.einheit) > 0 then  min(g.einheit) end,
    case when count(*) = 1 and min(g.einheit) < 0 then -min(g.einheit) end,
    -- Kein Mittelwert: die Koordinate der stärksten Einheit der Zelle. Sie
    -- gehört einem Ort, den es gibt und der einen Namen hat.
    (array_agg(g.lat          order by g.rang))[1],
    (array_agg(g.lon          order by g.rang))[1],
    sum(g.artikel)::integer                   as n,
    count(distinct g.ort_id)::integer         as orte,
    count(*)::integer                         as ereignisse,
    -- Bei einer Gruppe die weiteste Verbreitung darin, bei einem Ereignis
    -- dessen eigene. Eine Summe wäre falsch: Dieselbe Redaktion kann über
    -- mehrere Ereignisse der Zelle berichtet haben.
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
$$;

grant execute on function event_bubbles(
  timestamptz, timestamptz, text[], integer,
  double precision, double precision, double precision, double precision,
  text[], text[], integer
) to anon, authenticated;
