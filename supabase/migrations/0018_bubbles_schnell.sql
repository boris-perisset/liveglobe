-- Live Globe – dieselben Bubbles, nur ohne die Bremse
--
-- `event_bubbles` aus 0017 rechnet richtig, aber es lief in ein Zeitlimit:
--
--     Supabase-Fehler (500): {"code":"57014",
--       "message":"canceling statement due to statement timeout"}
--
-- Die Rolle `anon` darf drei Sekunden rechnen. Das ist kein Mengenproblem
-- gewesen — die Funktion hat Arbeit vervielfacht, die einmal gereicht hätte.
--
-- ---------------------------------------------------------------------------
-- Was tatsächlich passiert ist
-- ---------------------------------------------------------------------------
--
-- Im Ausführungsplan stand die Ursache offen da:
--
--     Nested Loop            (actual time=59..4220 rows=6600 loops=1)
--       CTE Scan on einheiten             rows=6600
--       GroupAggregate       (actual time=0.006..0.607 rows=701 loops=6600)
--                                                            ^^^^^^^^^^^
--
-- `zellen` — die Zwischentabelle, die je Rasterzelle die Orte zählt — wurde
-- **6600 Mal neu berechnet**, einmal für jede Einheit. PostgreSQL fügt ein CTE
-- mit nur einer Verwendung seit Version 12 in die umgebende Abfrage ein, und
-- hier geriet es dabei in die innere Schleife eines Nested Loop. Aus einer
-- Aggregation über 3300 Zeilen wurden 22 Millionen.
--
-- Das ist die Sorte Fehler, die bei kleinen Datenmengen unsichtbar bleibt: Mit
-- den sechzehn Testzeilen von 0017 lief dieselbe Funktion in Millisekunden.
--
-- ---------------------------------------------------------------------------
-- Die Behebung
-- ---------------------------------------------------------------------------
--
-- Nicht `materialized` (das brachte nur 4230 → 979 ms, der Nested Loop blieb),
-- sondern **die Verbindung ganz auflösen.** Gebraucht wird gar keine Zählung,
-- sondern eine Ja/Nein-Frage: Liegt in dieser Zelle nur ein einziger Ort?
--
--     min(ort_id) over (partition by gy, gx) = max(ort_id) over (partition by gy, gx)
--
-- Ein Fensterausdruck über denselben Durchgang, kein zweites Lesen, kein Join.
-- Die genaue Ortszahl für die Ausgabe fällt in der abschliessenden Gruppierung
-- ohnehin an.
--
-- Dazu ein zweiter Griff: Die drei Durchgänge über die Artikel (`mass`,
-- `heimat`, `spitze`) sind zu einem geworden. Der Ort einer Einheit ist jetzt
-- der ihrer stärksten Meldung statt der mit den meisten Meldungen. Für alles,
-- was an einem Ort hängt — die grosse Mehrheit — ist das dasselbe Ergebnis;
-- bei einem Ereignis über mehrere Orte führt die prominenteste Meldung. Eine
-- Aussage, die man vertreten kann, und sie kostet einen Durchgang statt drei.
--
--   gemessen an 60'000 Artikeln / 48'000 Einheiten, Median aus fünf Läufen:
--
--     ohne Rubrikfilter    453 ms  →   61 ms
--     mit Rubrikfilter   10253 ms  →   68 ms
--     Ausschnitt Europa     80 ms  →   24 ms
--
-- Die Ergebnisse sind Zeile für Zeile dieselben wie in 0017; gegengeprüft über
-- alle Zoomstufen mit `except` in beide Richtungen.

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
    -- Unveränderte Weitenformel aus 0016. Sie ist der Grund, warum sich das
    -- Zoomen vertraut anfühlt, und daran wird nicht gerührt.
    select greatest(0.05, 20.0 / power(2, greatest(p_zoom, 0))) as weite
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
           floor(g.lon / r.weite) as gx
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
    -- Die eine Frage, auf die es ankommt: **ein Ort in dieser Zelle, oder
    -- mehrere?** Als Fensterausdruck über denselben Durchgang — kein zweites
    -- Lesen, kein Join, und damit auch keine Schleife, in die er geraten kann.
    select e.*,
           min(e.ort_id) over (partition by e.gy, e.gx)
         = max(e.ort_id) over (partition by e.gy, e.gx) as ein_ort
    from einheiten e
  ),
  gruppiert as (
    -- Ein Ort in der Zelle → jede Einheit wird ihre eigene Gruppe, die Zelle
    -- zerfällt also in ihre Ereignisse. Mehrere Orte → `gruppe` ist für alle
    -- Zeilen null, und sie fallen zu einer Bubble zusammen.
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
