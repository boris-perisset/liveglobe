-- =====================================================================
-- 0030 · Was kostet die Weltbox? — die Messung, die P2 hätte sein müssen
--
-- Ablage:  supabase/checks/0030_kosten_weltbox.sql
--
-- P2 verlangte: „Einstieg weiterhin über published_at." Gemessen wurde es
-- nie. Am 31.08. zeigte der Plan bei der Weltbox stattdessen den Einstieg
-- über locations — 16842 Orte abgelaufen, für jeden einzeln in articles
-- nachgeschlagen, 214895 Blockzugriffe, 7418 ms.
--
-- Ursache ist eine Schätzung, kein Denkfehler im SQL: Der Planer setzt für
-- den Ortsfilter `rows=2` an, tatsächlich sind es 16842. Er kann die Grösse
-- der Box nicht kennen — sie entsteht erst zur Laufzeit aus den Parametern.
-- Bei einer kleinen Box ist die Annahme richtig und der ganze Gewinn; bei
-- der Weltbox ist sie genau verkehrt.
--
-- ---------------------------------------------------------------------
-- WIE DIESE DATEI ZU BENUTZEN IST
--
-- **Fünf Schritte, jeder ein eigener Lauf im SQL-Editor.** Keine
-- Transaktion: Der Editor öffnet je Lauf eine eigene Sitzung, eine
-- Transaktion kann sich darüber nicht erstrecken — eine in Schritt 1
-- angelegte und sofort zurückgenommene Funktion wäre in Schritt 2 weg.
-- (Genau daran ist die erste Fassung dieser Datei gescheitert.)
--
-- Die Hilfsfunktion bleibt deshalb ein paar Minuten stehen. **Schritt 5
-- nimmt sie wieder weg — nicht vergessen.**
--
-- Jede explain-Abfrage ZWEIMAL laufen lassen, den ersten Lauf verwerfen
-- (kalter Cache). Gebraucht werden je zwei Zahlen: die oberste
-- Buffers-Zeile und die Execution Time.
-- =====================================================================


-- ###################################################################
-- SCHRITT 1 · Die Fassung vor 0030 unter anderem Namen anlegen.
--             Wortgleich aus rollback/0030_zurueck.sql erzeugt.
-- ###################################################################

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

-- ###################################################################
-- SCHRITT 2 · M1 — die Fassung VOR 0030, Weltbox, Zoom 1.
--
-- Erwartet: Einstieg über published_at.
-- Vergleichswert vom 23.08.: rund 36'356 Blockzugriffe.
-- ###################################################################
explain (analyze, buffers)
select * from event_bubbles_vor_0030(now() - interval '24 hours', now(), null, 1);


-- ###################################################################
-- SCHRITT 3 · M2 — die Fassung MIT 0030, dieselbe Box, dieselbe Stufe.
--
-- Gemessen am 31.08.: 214'895 Blockzugriffe, 7418 ms. Hier noch einmal,
-- damit beide Zahlen unter denselben Bedingungen entstehen.
-- ###################################################################
explain (analyze, buffers)
select * from event_bubbles(now() - interval '24 hours', now(), null, 1);


-- ###################################################################
-- SCHRITT 4 · M3 — die Halbkugel, also das, was der Browser beim Start
--             tatsächlich schickt.
--
-- DIESE ZEILE ENTSCHEIDET ÜBER DIE DRINGLICHKEIT. Ist auch sie langsam,
-- ist nicht nur der Snapshot betroffen, sondern die Startansicht.
-- ###################################################################
explain (analyze, buffers)
select * from event_bubbles(now() - interval '24 hours', now(), null, 1,
                            -90, -60, 90, 60);


-- ###################################################################
-- SCHRITT 5 · Aufräumen. Nicht vergessen.
-- ###################################################################
drop function if exists public.event_bubbles_vor_0030(
  timestamptz, timestamptz, text[], integer,
  double precision, double precision, double precision, double precision,
  text[], text[], integer
);
