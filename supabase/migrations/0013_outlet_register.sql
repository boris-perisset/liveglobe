-- Globe News – das Outlet-Register in der Datenbank
--
-- `sources` war bisher ein Nebenprodukt: Der Ingest legte für jede gesehene
-- Domain eine Zeile an, mehr nicht. Ab hier ist es das Register, aus dem die
-- Bögen entstehen.
--
-- Zwei Dinge kommen dazu:
--
--   1. Die Felder aus `data/outlets.json` — Koordinate, Region, Sprache,
--      Aufkommen, und vor allem der **Herkunftsvermerk** der Koordinate.
--   2. Eine Sicht auf die Outlets, die tatsächlich Meldungen liefern, aber
--      keinen Punkt haben. Das ist die Arbeitsliste, und sie entsteht von
--      selbst — keine Änderung an der Edge Function nötig, weil der Ingest
--      ohnehin für jede Domain eine Zeile anlegt.

-- ---------------------------------------------------------------- Register
alter table sources add column if not exists region_iso   text;
alter table sources add column if not exists city         text;
alter table sources add column if not exists language     text;
alter table sources add column if not exists media_type   text;
alter table sources add column if not exists homepage     text;
alter table sources add column if not exists alt_domains  text[];
alter table sources add column if not exists wikidata_qid text;
alter table sources add column if not exists stories_per_week integer;
alter table sources add column if not exists last_story   text;
alter table sources add column if not exists imported_at  timestamptz;

/*
 * Woher die Koordinate stammt.
 *
 * Das ist kein Beiwerk, sondern die Bedingung dafür, dass man den Bögen
 * trauen kann. Ein Punkt aus einem Wikidata-Hauptsitz ist eine Tatsache; ein
 * Kantonsmittelpunkt ist eine Näherung; ein Landesmittelpunkt ist ein
 * Platzhalter, der so tut, als wüsste man etwas.
 *
 * §13 des Konzeptpapiers verlangt für jedes abgeleitete Feld Wert, Methode
 * und Herkunft. Hier ist es eine einzige Spalte — und sie entscheidet später,
 * welche Bögen man überhaupt zeichnen darf.
 */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'geo_quelle') then
    create type geo_quelle as enum (
      'wikidata_sitz',      -- Hauptsitz aus Wikidata, stadtgenau
      'handarbeit',         -- von Hand nachgetragen und geprüft
      'region_iso3166_2',   -- Mittelpunkt der Verwaltungseinheit
      'land',               -- Landesmittelpunkt, Platzhalter
      'unbekannt'
    );
  end if;
end $$;

alter table sources add column if not exists geo_quelle geo_quelle;

-- Der Index trägt die Bogenabfrage: Sie fragt immer „hat dieses Outlet einen
-- Punkt", nie „welches Outlet liegt hier".
create index if not exists sources_geo_idx on sources (id) where home_geom is not null;
create index if not exists sources_region_idx on sources (region_iso);

-- ---------------------------------------------------------------- Einspielen
/*
 * Register aus `data/outlets.json` einspielen.
 *
 * Als Funktion statt als Reihe von Einzelbefehlen, damit das Skript **einen**
 * Aufruf mit einem JSON-Block macht, statt vierzehntausend Zeilen einzeln
 * durch PostgREST zu schicken.
 *
 * Grundregel: **füllen, nicht überschreiben.** Was der Ingest oder ein Mensch
 * schon eingetragen hat, bleibt. Nur wenn die neue Koordinate aus einer
 * besseren Quelle kommt als die vorhandene, wird sie ersetzt — die Rangfolge
 * steckt in `guete`.
 */
create or replace function outlets_einspielen(p_daten jsonb)
returns table (angelegt integer, ergaenzt integer, unveraendert integer)
language plpgsql as $$
declare
  z          jsonb;
  vorhanden  sources%rowtype;
  neu_geo    geo_quelle;
  n_neu      integer := 0;
  n_erg      integer := 0;
  n_gleich   integer := 0;

  -- Je höher, desto verlässlicher. Nur aufwärts wird ersetzt.
  function_guete constant jsonb := '{"wikidata_sitz":4,"handarbeit":4,"region_iso3166_2":2,"land":1,"unbekannt":0}';
begin
  for z in select * from jsonb_array_elements(p_daten) loop
    select * into vorhanden from sources where domain = z->>'domain';
    neu_geo := coalesce((z->>'ort_herkunft')::geo_quelle, 'unbekannt');

    if vorhanden.id is null then
      insert into sources (
        domain, name, country, region_iso, city, language, media_type,
        homepage, alt_domains, wikidata_qid, stories_per_week, last_story,
        geo_quelle, home_geom, imported_at
      ) values (
        z->>'domain',
        nullif(z->>'name', ''),
        nullif(z->>'land', ''),
        nullif(z->>'region_iso', ''),
        nullif(z->>'stadt', ''),
        nullif(z->>'sprache', ''),
        nullif(z->>'medientyp', ''),
        nullif(z->>'homepage', ''),
        coalesce((select array_agg(w) from jsonb_array_elements_text(z->'weitere_domains') w), '{}'),
        nullif(z->>'wikidata', ''),
        (z->>'pro_woche')::integer,
        nullif(z->>'letzte_meldung', ''),
        neu_geo,
        case when z->>'lat' is not null
             then st_makepoint((z->>'lon')::float, (z->>'lat')::float)::geography end,
        now()
      );
      n_neu := n_neu + 1;

    else
      -- Fehlendes ergänzen; Vorhandenes bleibt stehen.
      update sources set
        name             = coalesce(name, nullif(z->>'name', '')),
        country          = coalesce(country, nullif(z->>'land', '')),
        region_iso       = coalesce(region_iso, nullif(z->>'region_iso', '')),
        city             = coalesce(city, nullif(z->>'stadt', '')),
        language         = coalesce(language, nullif(z->>'sprache', '')),
        media_type       = coalesce(media_type, nullif(z->>'medientyp', '')),
        homepage         = coalesce(homepage, nullif(z->>'homepage', '')),
        wikidata_qid     = coalesce(wikidata_qid, nullif(z->>'wikidata', '')),
        stories_per_week = coalesce((z->>'pro_woche')::integer, stories_per_week),
        last_story       = coalesce(nullif(z->>'letzte_meldung', ''), last_story),
        alt_domains      = case when coalesce(array_length(alt_domains, 1), 0) = 0
                                then coalesce((select array_agg(w) from jsonb_array_elements_text(z->'weitere_domains') w), '{}')
                                else alt_domains end,
        -- Die Koordinate nur bei besserer Herkunft. Sonst überschriebe ein
        -- erneuter Lauf mit Landesmittelpunkten die Handarbeit von gestern.
        home_geom  = case
          when z->>'lat' is not null
           and (function_guete->>neu_geo::text)::int
             > (function_guete->>coalesce(geo_quelle, 'unbekannt')::text)::int
          then st_makepoint((z->>'lon')::float, (z->>'lat')::float)::geography
          else home_geom end,
        geo_quelle = case
          when z->>'lat' is not null
           and (function_guete->>neu_geo::text)::int
             > (function_guete->>coalesce(geo_quelle, 'unbekannt')::text)::int
          then neu_geo else geo_quelle end,
        imported_at = now()
      where id = vorhanden.id;

      if found then n_erg := n_erg + 1; else n_gleich := n_gleich + 1; end if;
    end if;
  end loop;

  angelegt := n_neu; ergaenzt := n_erg; unveraendert := n_gleich;
  return next;
end $$;

-- ---------------------------------------------------------------- Warteliste
/*
 * Die ehrliche Arbeitsliste.
 *
 * Nicht „alle Outlets ohne Punkt" — das sind achttausend, und die meisten
 * tauchen bei uns nie auf. Sondern: **Outlets, die tatsächlich Meldungen
 * geliefert haben und trotzdem keinen brauchbaren Punkt tragen.**
 *
 * Media Clouds `stories_per_week` misst, was Media Cloud einsammelt. Diese
 * Sicht misst, was bei uns ankommt — und nur das entscheidet, ob je ein Bogen
 * gezeichnet wird.
 */
create or replace view v_outlets_offen as
select
  s.id,
  s.domain,
  s.name,
  s.country,
  s.region_iso,
  s.geo_quelle,
  count(a.id)              as meldungen,
  max(a.published_at)      as neueste,
  count(distinct a.event_id) as ereignisse
from sources s
join articles a on a.source_id = s.id
where s.home_geom is null
   or s.geo_quelle in ('land', 'unbekannt')
group by s.id, s.domain, s.name, s.country, s.region_iso, s.geo_quelle
order by count(a.id) desc;

grant select on v_outlets_offen to anon, authenticated;
alter view v_outlets_offen set (security_invoker = on);

-- ---------------------------------------------------------------- Bögen
/*
 * Nur Outlets mit Punkt bekommen einen Bogen.
 *
 * Die übrigen verschwinden nicht — sie zählen in `events.outlet_count` weiter
 * mit. Die Differenz ist die Zeile „und N weitere Quellen" im Panel: ehrlich
 * gezählt, aber nicht auf die Karte gemalt, wo sie nur ein erfundener Ort
 * wäre.
 */
-- `create or replace` kann den Rückgabetyp nicht ändern, und `geo_quelle` kommt
-- neu dazu. Also erst weg, dann neu — die Funktion hält keinen Zustand.
drop function if exists event_arcs(bigint);

create function event_arcs(p_event_id bigint)
returns table (
  source_id     bigint,
  domain        text,
  name          text,
  country       char(2),
  ownership     text,
  lat           double precision,
  lon           double precision,
  geo_quelle    text,
  first_seen_at timestamptz,
  minutes_after integer
)
language sql stable as $$
  select s.id, s.domain, coalesce(s.name, s.domain), s.country, s.ownership,
         st_y(s.home_geom::geometry), st_x(s.home_geom::geometry),
         coalesce(s.geo_quelle::text, 'unbekannt'),
         eo.first_seen_at,
         (extract(epoch from (eo.first_seen_at - e.first_published_at)) / 60)::integer
  from event_outlets eo
  join events  e on e.id = eo.event_id
  join sources s on s.id = eo.source_id
  where eo.event_id = p_event_id
    and s.home_geom is not null
  order by eo.first_seen_at;
$$;

grant execute on function event_arcs(bigint) to anon, authenticated;
