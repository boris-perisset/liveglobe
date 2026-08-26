-- Live Globe – auf der untersten Stufe zerfällt die Zelle immer
--
-- Beobachtet am 22.08. über Deir al-Balah, Zoom 12: eine einzige Bubble mit
-- 151 Meldungen und 86 Ereignissen, und jeder Klick zoomte weiter, ohne dass
-- sich etwas löste. Man kam nie an ein einzelnes Ereignis heran — also auch
-- nie ans Panel und nie ans Replay.
--
-- ---------------------------------------------------------------------------
-- Warum
-- ---------------------------------------------------------------------------
--
-- 0020 verlangte **zwei** Bedingungen fürs Zerfallen:
--
--   1. unterste Stufe erreicht  (Rasterweite am Anschlag, ab Zoom 9)
--   2. nur ein Ort in der Zelle (die Bedingung aus 0018)
--
-- Bedingung 2 wird über Deir al-Balah nie wahr: In 5,5 km liegen Deir al-Balah
-- Camp, Deir el-Balah und Az-Zawayda als eigene `locations`. Und weil die
-- Weitenformel `greatest(0.05, …)` nach unten begrenzt ist, wird die Zelle bei
-- weiterem Zoomen **nicht kleiner**. Die Bedingung kann also nicht mehr wahr
-- werden, egal wie nah man herangeht.
--
-- Ein Klick, der ins Leere führt. Dieselbe Falle wie seinerzeit
-- `flyTo(max(zoom, 5))`: Die Karte reagiert, aber es passiert nichts.
--
-- ---------------------------------------------------------------------------
-- Die Einsicht
-- ---------------------------------------------------------------------------
--
-- Bedingung 2 war der Rest eines Stellvertreters, den 0020 eigentlich schon
-- ersetzt hat. „Ein Ort in der Zelle" sollte einmal heissen „wir sind ganz
-- unten angekommen". Seit 0020 steht das direkt in Bedingung 1 — und **wenn
-- man unten ist, braucht es keinen Stellvertreter mehr dafür.**
--
-- Also fällt Bedingung 2 ersatzlos weg:
--
--     Auf der untersten Stufe zerfällt jede Zelle in ihre Ereignisse.
--     Darüber bleibt sie eine gezählte Bubble.
--
-- Das Raster ist ab dort ohne Wirkung, und das ist richtig so: Es hat nur die
-- Aufgabe, weit draussen zusammenzufassen. Unten sitzt jedes Ereignis auf
-- seinem eigenen Ort, und mehrere am selben Ort fächert die Karte auf.
--
-- Nebenbei fällt die Fensterfunktion aus 0018 ganz weg — kein
-- `min(ort_id) over … = max(ort_id) over …` mehr. Die Abfrage wird dadurch
-- eher schneller; ihre Zeilenzahl steigt nur dort, wo man wirklich nah dran
-- ist, und dort ist der Ausschnitt klein.
--
-- ---------------------------------------------------------------------------
-- Gegenprobe
-- ---------------------------------------------------------------------------
--
--     select v.z, count(*) as bubbles, max(ereignisse) as groesste
--     from (values (1),(3),(6),(8),(9),(12)) v(z),
--     lateral event_bubbles(now() - interval '24 hours', now(), null, v.z)
--     group by 1 order by 1;
--
-- Erwartung: Bis Stufe 8 Zeile für Zeile dasselbe wie 0020. Ab Stufe 9 ist
-- `groesste` genau 1 — jede Bubble ist ein Ereignis.

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
    -- Weitenformel unverändert aus 0016. Daneben die Frage, ob sie am Anschlag
    -- steht — das ist die unterste Stufe, und dort und nur dort zerfallen die
    -- Zellen. Als Ausdruck über die Weite geschrieben und nicht als
    -- Zoomkonstante: Ändert jemand die Formel, wandert das Tor von selbst mit.
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
  gruppiert as (
    -- Der ganze Kern, in einer Zeile: Unten ist `gruppe` die Ereigniskennung,
    -- also bekommt jedes Ereignis seine eigene Bubble. Darüber ist sie für
    -- alle Zeilen null, und die Zelle fällt zu einer gezählten Bubble
    -- zusammen. Keine Fensterfunktion mehr, kein zweites Lesen.
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
    -- Kein Mittelwert: die Koordinate der stärksten Einheit der Gruppe. Sie
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
