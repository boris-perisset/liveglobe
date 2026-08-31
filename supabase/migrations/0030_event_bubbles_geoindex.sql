-- =====================================================================
-- 0030 · event_bubbles: Ortsfilter über einen Index statt als Nachfilter
--
-- Ablage:  supabase/migrations/0030_event_bubbles_geoindex.sql
-- Läuft:   allein. Geschrieben wurde sie als 0028; die Nummer war beim
--          Ablegen schon vergeben (0028_zuordnung_schnell, 0029_buendelung),
--          deshalb 0030.
-- Setzt voraus: 0022 — dort steht die Fassung von event_bubbles, die diese
--          hier ersetzt. Zu 0028 und 0029 besteht keine
--          Reihenfolgebedingung: Beide fassen event_bubbles nicht an.
--
-- ---------------------------------------------------------------------
-- Befund (31.08.2026, gemessen an der Gaza-Box, Zoom 9)
--
--   Filter: st_intersects((geom)::geometry, …)
--   → Seq Scan on locations, 16'441 Zeilen verworfen für 17 Treffer, 243 ms.
--
-- Der Cast nach geometry macht locations_geom_idx (GIST auf geography)
-- unbenutzbar: Ein Index auf einer Spalte bedient keinen Ausdruck über
-- dieser Spalte. Damit blieb dem Planer nur der Einstieg über
-- published_at — 19'061 Artikel des 24-Stunden-Fensters gelesen und
-- 36'356 Blockzugriffe, um 189 Zeilen zu behalten.
--
-- Die Bounding-Box war also nie wirkungslos, sie kam nur zu spät: Sie hat
-- das Ergebnis eingeschränkt, nicht die Arbeit.
--
-- ---------------------------------------------------------------------
-- WARUM NICHT DIE ANDERE RICHTUNG
--
-- Der erste Entwurf drehte den Ausdruck um: Box nach geography casten und
-- den vorhandenen locations_geom_idx benutzen. Das ist beim ersten Aufruf
-- der Startansicht durchgefallen:
--
--     XX000: Antipodal (180 degrees long) edge detected!
--
-- Ein Rechteck von -90 bis 90 Grad Breite hat eine Kante vom Südpol zum
-- Nordpol. Auf der Kugel sind das zwei **antipodale** Punkte, und zwischen
-- antipodalen Punkten gibt es keinen kürzesten Weg, sondern unendlich
-- viele — PostGIS bricht deshalb ab, und zwar zu Recht. Die Weltbox ist
-- kein Sonderfall, den man umgehen kann: Sie ist die Startansicht.
--
-- Die Lehre: Eine Bounding-Box ist ein **flaches** Rechteck in Längen- und
-- Breitengraden. Sie in einen Typ zu zwingen, der Flächen auf der Kugel
-- meint, macht aus einer Rechteckfrage eine Kugelfrage — und die hat an
-- den Polen keine Antwort. Also bleibt die Box in geometry, und der Index
-- kommt zu ihr statt sie zum Index.
--
-- ---------------------------------------------------------------------
-- Drei Änderungen
--
--   1. Ein GIST-Index auf dem **Ausdruck** (geom::geometry). Genau der
--      Ausdruck, der in der Abfrage steht — damit bedient er sie. Der
--      Cast geography→geometry ist immutable, sonst ginge das nicht.
--      locations_geom_idx bleibt unangetastet: match_events rechnet mit
--      Entfernungen und braucht weiterhin geography.
--
--   2. Ortsfilter mit && statt st_intersects. Für ein achsenparalleles
--      Rechteck genügt der Vergleich der Hüllrechtecke; ein volles
--      st_intersects wäre teurer bei gleichem Ergebnis.
--
--   3. Die Box entsteht in einem eigenen CTE und zerfällt an der
--      Datumsgrenze in zwei sich nicht überschneidende Rechtecke.
--      Bisher ergab p_west > p_east ein Rechteck, das **andersherum** um
--      die Welt läuft: über dem Pazifik erschien der Rest der Welt statt
--      des Pazifiks. Das Frontend schickt die Box mit (main.ts →
--      data/api.ts), der Fehler war also aktiv, nicht latent.
--
-- Alles andere bleibt unverändert, insbesondere „einheiten as
-- materialized" (Absicht aus 0016), die Weitenformel und das Zoom-Tor
-- aus 0022.
-- =====================================================================

-- Kein „concurrently": Der SQL-Editor führt alles in einer Transaktion aus,
-- dort ist es verboten. locations hat rund 16'000 Zeilen — die Sperre dauert
-- den Bruchteil einer Sekunde.
create index if not exists locations_geom_geometry_idx
  on locations using gist ((geom::geometry));

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
    -- Weitenformel unverändert aus 0016. Daneben die Frage, ob sie am Anschlag
    -- steht — das ist die unterste Stufe, und dort und nur dort zerfallen die
    -- Zellen. Als Ausdruck über die Weite geschrieben und nicht als
    -- Zoomkonstante: Ändert jemand die Formel, wandert das Tor von selbst mit.
    select w.weite, w.weite <= 0.05 as ortsstufe
    from (select greatest(0.05, 20.0 / power(2, greatest(p_zoom, 0))) as weite) w
  ),
  grenzen as (
    -- Längengrade auf [-180, 180) zurückholen, bevor irgendetwas damit
    -- gerechnet wird. Ein Aufrufer, der beim Schwenken über die Datumsgrenze
    -- -190 oder 200 schickt, ist der Normalfall und nicht die Ausnahme; die
    -- Funktion verlässt sich deshalb auf keine Zusage des Aufrufers.
    --
    -- Die Breitengrade werden nur gekappt. Sie brauchen keine Normalisierung
    -- — es gibt nichts jenseits der Pole — aber sie brauchen die Kappung:
    -- st_makeenvelope lässt 95 Grad Breite anstandslos zu und liefert dann
    -- ein Rechteck, das es nicht gibt.
    select
      greatest(p_south, -90.0) as s,
      least(p_north,     90.0) as n,
      (p_east - p_west) >= 360 as ganze_welt,
      p_west - 360.0 * floor((p_west + 180.0) / 360.0) as w,
      p_east - 360.0 * floor((p_east + 180.0) / 360.0) as e
  ),
  boxen as (
    -- Ein Rechteck im Normalfall, zwei über der Datumsgrenze. Beides in
    -- **geometry** — ein flaches Rechteck in Grad, keine Fläche auf der Kugel.
    -- Genau deshalb ist die Weltbox hier unproblematisch.
    --
    -- Die beiden Rechtecke der Datumsgrenze überschneiden sich nicht: Nach der
    -- Normalisierung liegt e in [-180, 180) und im Zweig w > e ist w > -180.
    -- Ein Ort kann also nie in beiden liegen und nie doppelt gezählt werden.
    select st_makeenvelope(-180.0, g.s, 180.0, g.n, 4326) as g
    from grenzen g where g.ganze_welt
    union all
    select st_makeenvelope(g.w, g.s, g.e, g.n, 4326)
    from grenzen g where not g.ganze_welt and g.w <= g.e
    union all
    select st_makeenvelope(g.w, g.s, 180.0, g.n, 4326)
    from grenzen g where not g.ganze_welt and g.w > g.e
    union all
    select st_makeenvelope(-180.0, g.s, g.e, g.n, 4326)
    from grenzen g where not g.ganze_welt and g.w > g.e
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
    -- Reihenfolge nur der Lesbarkeit halber; der Planer sortiert selbst um.
    -- Bei kleiner Box steigt er über locations ein (locations_geom_geometry_idx,
    -- dann articles_location_idx), bei der Weltbox des Snapshots weiter über
    -- published_at. Genau das ist gewollt.
    from boxen b
    join locations l on l.geom::geometry && b.g
    join articles  a on a.location_id = l.id
    left join sources s on s.id = a.source_id
    where a.published_at between p_from and p_to
      and (p_categories is null or a.category::text = any(p_categories))
      and (p_connectors is null or coalesce(a.connector, 'gdelt-en') = any(p_connectors))
      and (p_ownership  is null or coalesce(s.ownership, 'unknown') = any(p_ownership))
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
$function$;

-- create or replace lässt die Rechte stehen. Hier trotzdem gesetzt: In 0007
-- ist genau das einmal verlorengegangen, und es fiel erst später auf.
grant execute on function public.event_bubbles(
  timestamptz, timestamptz, text[], integer,
  double precision, double precision, double precision, double precision,
  text[], text[], integer
) to anon, authenticated;

-- Der Planer soll mit aktuellen Zahlen entscheiden, welchen Weg er nimmt.
-- Ohne das wählt er womöglich weiter den alten, obwohl der neue offensteht.
analyze locations;
analyze articles;
