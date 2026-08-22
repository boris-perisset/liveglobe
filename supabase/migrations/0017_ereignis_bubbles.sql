-- Live Globe – nur noch Ereignisse auf der Karte
--
-- Die Karte kannte bisher zwei Gegenstände: Ortscluster beim Zoomen (0016) und
-- Ereigniscluster nach einem Klick. Das ergab einen Moduswechsel, den man der
-- Karte ansieht — plötzlich verschwindet die Umgebung, und beim Schliessen des
-- Panels kommt sie nicht von selbst zurück.
--
-- Ab hier gibt es **einen einzigen Gegenstand: das Ereignis.** Zoomen verhält
-- sich wie vorher, weil Ereignisse zuerst je Ort verdichtet und dann gerastert
-- werden — die räumliche Hierarchie Kontinent → Land → Region → Ort trägt also
-- weiterhin. Der Unterschied zu 0015, das genau daran scheiterte:
--
--   0015 setzte die Bubble auf den **Mittelwert** der Koordinaten. Ein Ereignis
--        auf Korsika und eines in Rom ergaben eine Bubble im Tyrrhenischen Meer.
--   Hier sitzt sie auf dem **stärksten echten Ort** der Zelle, so wie 0016 es
--        für Orte tut. Wer hinklickt, landet dort, wo etwas passiert ist.
--
-- ---------------------------------------------------------------------------
-- Wann eine Zelle aufgeht
-- ---------------------------------------------------------------------------
--
-- Es braucht dafür keine neue Zoomkonstante, und keinen Klick, der die Ebene
-- wechselt. Die Regel ist eine Eigenschaft der Zelle selbst:
--
--   **Sobald in einer Rasterzelle nur noch ein Ort liegt, zerfällt sie in ihre
--   Ereignisse.** Darüber bleibt sie eine Bubble.
--
-- Auf Stadtebene liegen mehrere Ereignisse dann auf exakt derselben Koordinate
-- — GDELT verortet auf Städte. Das Auffächern zu einem Ring besorgt die Karte;
-- die Datenbank liefert bewusst mehrere Zeilen mit gleicher Koordinate.
--
-- ---------------------------------------------------------------------------
-- Was mit unzugeordneten Meldungen geschieht
-- ---------------------------------------------------------------------------
--
-- Nicht jeder Artikel hängt an einem Ereignis; die Zuordnung braucht einen
-- Textbeleg, und den gibt es nicht immer. Würde die Karte nur Ereignisse
-- zeigen, verschwänden diese Meldungen — und niemand sähe, dass sie fehlen.
--
-- Deshalb gilt hier: **eine unzugeordnete Meldung ist ein Ereignis von eins.**
-- Technisch über `coalesce(a.event_id, -a.id)`; negative Kennungen sind
-- Einzelmeldungen, positive echte Ereignisse. Die Zahl in der Bubble bleibt
-- damit die Zahl der Meldungen, und die Summen stimmen wie vorher.

-- `create or replace` kann den Rückgabetyp nicht ändern; die Funktion ist neu,
-- aber ein früherer Anlauf könnte schon dastehen.
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
  mass as (
    select einheit,
           count(*)::int                 as artikel,
           count(distinct source_id)::int as medien
    from gefiltert
    group by einheit
  ),
  heimat as (
    -- Ein Ereignis kann Meldungen an mehreren Orten haben — der Ort steht am
    -- Artikel, nicht am Ereignis. Es sitzt dort, wo die meisten davon liegen;
    -- sonst erschiene dasselbe Ereignis an zwei Stellen der Karte.
    select distinct on (einheit) einheit, ort_id, ort_name, country, lat, lon
    from (
      select einheit, ort_id, ort_name, country, lat, lon, count(*) as k
      from gefiltert
      group by einheit, ort_id, ort_name, country, lat, lon
    ) q
    order by einheit, k desc, ort_id
  ),
  spitze as (
    select distinct on (einheit)
           einheit, id as top_id, title as top_title, category as top_category
    from gefiltert
    order by einheit, prominence desc nulls last, id desc
  ),
  einheiten as (
    select h.einheit, h.ort_id, h.ort_name, h.country, h.lat, h.lon,
           m.artikel, m.medien,
           s.top_id, s.top_title, s.top_category,
           floor(h.lat / r.weite) as gy,
           floor(h.lon / r.weite) as gx
    from heimat h
    join mass   m on m.einheit = h.einheit
    join spitze s on s.einheit = h.einheit
    cross join raster r
  ),
  zellen as (
    select gy, gx, count(distinct ort_id) as orte
    from einheiten
    group by gy, gx
  ),
  gruppiert as (
    -- Der Kern in einer Zeile: `gruppe` ist die Ereigniskennung, solange die
    -- Zelle nur einen Ort umfasst — dann ergibt jede Einheit ihre eigene
    -- Gruppe. Umfasst sie mehrere Orte, ist `gruppe` für alle Zeilen null, und
    -- sie fallen zu einer einzigen Bubble zusammen.
    select e.*,
           case when z.orte = 1 then e.einheit end as gruppe,
           row_number() over (
             partition by e.gy, e.gx, (case when z.orte = 1 then e.einheit end)
             order by e.artikel desc, e.einheit desc
           ) as rang
    from einheiten e
    join zellen z on z.gy = e.gy and z.gx = e.gx
  )
  select
    -- Eine einzige Einheit in der Gruppe: Die Bubble **ist** dieses Ereignis.
    -- Positive Kennung heisst echtes Ereignis, negative eine Einzelmeldung.
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

-- ------------------------------------------------------------ Einzelmeldung
/*
 * Eine einzelne Meldung im Panel.
 *
 * Gegenstück zu `articles_of_event` für den Fall ohne Ereignis. Gleiche
 * Spalten in gleicher Reihenfolge, damit das Panel nicht zwei Formen kennen
 * muss — der einzige Unterschied ist der `left join` auf `events`.
 */
create or replace function article_by_id(p_id bigint)
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
  join locations l on l.id = a.location_id
  left join sources s on s.id = a.source_id
  left join events  e on e.id = a.event_id
  where a.id = p_id;
$$;

grant execute on function article_by_id(bigint) to anon, authenticated;
