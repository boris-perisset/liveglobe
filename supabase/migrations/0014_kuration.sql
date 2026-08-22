-- Globe News – Kuration dort, wo sie zählt
--
-- Die Verteilung der offenen Outlets ist ein klassischer langer Schwanz:
--
--     64 Outlets   6'652 Meldungen   20,7 %
--    229 Outlets   6'311 Meldungen   19,6 %
--  1'400 Outlets  12'500 Meldungen   38,9 %
--  1'773 Outlets   4'810 Meldungen   15,0 %
--  1'859 Outlets   1'859 Meldungen    5,8 %
--
-- 293 Outlets tragen 40 % aller Meldungen; die untersten 3'632 zusammen 21 %.
-- Ein Eintrag der obersten Klasse ist hundertmal so viel wert wie einer der
-- untersten.
--
-- Daraus folgt zweierlei: Die Arbeitsliste braucht eine Untergrenze, und der
-- Kurator muss nach *unseren* Meldungszahlen sortieren statt nach Media Clouds
-- Sammelquote. Beides steht hier.

-- ---------------------------------------------------------------- Arbeitsliste
/*
 * Offene Outlets ab einer Mindestzahl Meldungen.
 *
 * Als Funktion statt als Sicht, weil die Schwelle zur Frage gehört: „Was lohnt
 * sich?" hat je nach verfügbarer Zeit eine andere Antwort. Vorgabe 5 — damit
 * bleiben rund 1'700 Einträge, die zusammen vier Fünftel der Berichterstattung
 * abdecken.
 *
 * `nur_mit_ereignis` verschärft weiter: Ein Outlet, das nie zu einem Ereignis
 * beigetragen hat, bekommt auch nie einen Bogen. Das ist die härteste und
 * ehrlichste Eingrenzung — sie zählt nur, was für die Karte tatsächlich zählt.
 */
create or replace function outlets_offen(
  p_min_meldungen  integer default 5,
  p_nur_ereignisse boolean default false,
  p_limit          integer default 800
)
returns table (
  id            bigint,
  domain        text,
  name          text,
  country       char(2),
  region_iso    text,
  homepage      text,
  language      text,
  geo_quelle    text,
  meldungen     bigint,
  ereignisse    bigint,
  neueste       timestamptz
)
language sql stable as $$
  select s.id, s.domain, coalesce(s.name, s.domain), s.country, s.region_iso,
         s.homepage, s.language,
         coalesce(s.geo_quelle::text, 'unbekannt'),
         count(a.id), count(distinct a.event_id), max(a.published_at)
  from sources s
  join articles a on a.source_id = s.id
  where (s.home_geom is null or s.geo_quelle in ('land', 'unbekannt'))
  group by s.id, s.domain, s.name, s.country, s.region_iso, s.homepage,
           s.language, s.geo_quelle
  having count(a.id) >= p_min_meldungen
     and (not p_nur_ereignisse or count(distinct a.event_id) > 0)
  -- Nach dem, was bei uns ankommt. Media Clouds Sammelquote misst etwas
  -- anderes und hat hier nichts zu suchen.
  order by count(a.id) desc
  limit p_limit;
$$;

-- ---------------------------------------------------------------- Verorten
/*
 * Ein Outlet von Hand setzen.
 *
 * Dieselbe Regel wie beim Einspielen: Handarbeit gewinnt gegen alles, was
 * automatisch entstanden ist — aber Land und Region werden nur *gefüllt*, nie
 * überschrieben. Wer eine bestehende Angabe ändern will, tut das bewusst über
 * `p_erzwingen`.
 */
create or replace function outlet_verorten(
  p_domain    text,
  p_lat       double precision default null,
  p_lon       double precision default null,
  p_stadt     text default null,
  p_land      text default null,
  p_region    text default null,
  p_erzwingen boolean default false
)
returns text
language plpgsql as $$
declare
  s sources%rowtype;
begin
  select * into s from sources where domain = p_domain;
  if s.id is null then return 'unbekannt'; end if;

  if p_lat is null then
    -- Übersprungen: Der Punkt bleibt, wie er ist. Vermerkt wird nur, dass
    -- jemand hingeschaut hat — sonst stünde derselbe Zweifelsfall morgen
    -- wieder ganz oben.
    update sources set geo_quelle = coalesce(geo_quelle, 'unbekannt')
     where id = s.id;
    return 'übersprungen';
  end if;

  update sources set
    home_geom  = st_makepoint(p_lon, p_lat)::geography,
    geo_quelle = 'handarbeit',
    city       = case when p_erzwingen then coalesce(p_stadt, city) else coalesce(city, p_stadt) end,
    country    = case when p_erzwingen then coalesce(p_land, country) else coalesce(country, p_land) end,
    region_iso = case when p_erzwingen then coalesce(p_region, region_iso) else coalesce(region_iso, p_region) end
  where id = s.id;

  return 'gesetzt';
end $$;

grant execute on function outlets_offen(integer, boolean, integer) to anon, authenticated;
