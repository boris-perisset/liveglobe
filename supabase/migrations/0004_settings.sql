-- Quellen-Schalter, Trägerschaftsfilter und Übersetzungs-Zwischenspeicher.
-- Im SQL Editor ausführen; wiederholbar.
--
-- Zwei Fallstricke, die hier bewusst behandelt werden:
--
--   1. `create or replace view` kann keine Spalten umbenennen oder umsortieren.
--      Die Sicht muss deshalb weg und neu – mitsamt allem, was auf ihr aufbaut.
--   2. `create or replace function` ersetzt nur bei *identischer* Signatur.
--      Neue Parameter erzeugen sonst eine zweite Überladung, und PostgREST
--      weiss danach nicht mehr, welche gemeint ist. Also vorher gezielt löschen.

-- ---------------------------------------------------------------- Trägerschaft
-- Fünf Stufen statt vier: „gemeinnützig" trennt Stiftungs- und
-- Genossenschaftsmedien von rein privatwirtschaftlichen Verlagen.
alter table sources drop constraint if exists sources_ownership_check;
alter table sources
  add constraint sources_ownership_check
  check (ownership in ('state', 'public', 'private', 'nonprofit', 'unknown'));

alter table sources alter column ownership set default 'unknown';
update sources set ownership = 'unknown' where ownership is null;

create index if not exists sources_ownership_idx on sources (ownership);

-- ---------------------------------------------------------------- Herkunft
-- Aus welchem Strom eine Meldung stammt – Grundlage für die Quellen-Schalter.
alter table articles add column if not exists connector text;
update articles set connector = 'gdelt-en' where connector is null;
alter table articles alter column connector set default 'gdelt-en';

create index if not exists articles_connector_idx on articles (connector);

-- ---------------------------------------------------------------- Übersetzungen
-- Für den serverseitigen DeepL-Weg. Der in Chrome eingebaute Übersetzer
-- braucht diese Tabelle nicht – er arbeitet auf dem Gerät.
create table if not exists translations (
  source_hash char(40) not null,          -- sha1 des Originaltexts
  target_lang char(2)  not null,          -- 'de' | 'en'
  source_lang char(2),
  text        text     not null,
  created_at  timestamptz not null default now(),
  primary key (source_hash, target_lang)
);

alter table translations enable row level security;
drop policy if exists p_read_translations on translations;
create policy p_read_translations on translations
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------- Aufräumen
-- Erst die Funktionen weg, die auf der Sicht stehen, dann die Sicht selbst.
-- Alle bekannten Signaturen einzeln, damit keine Altlast als Überladung übrig
-- bleibt. `cascade` an der Sicht fängt ab, was hier noch nicht aufgezählt ist.
drop function if exists articles_at(
  double precision, double precision, integer, timestamptz, timestamptz);
drop function if exists articles_at(
  double precision, double precision, integer, timestamptz, timestamptz, text[], text[]);

drop function if exists articles_clustered(
  timestamptz, timestamptz, text[], smallint, smallint, integer);
drop function if exists articles_clustered(
  timestamptz, timestamptz, text[], smallint, smallint, integer, text[], text[]);

drop view if exists v_articles_24h cascade;

-- ---------------------------------------------------------------- Sicht
create view v_articles_24h as
select
  a.id, a.url, a.title, a.teaser, a.image_url, a.category, a.language,
  a.tone, a.prominence, a.published_at, a.connector,
  l.name    as location_name,
  l.country as country,
  st_y(l.geom::geometry) as lat,
  st_x(l.geom::geometry) as lon,
  s.domain    as source_domain,
  s.name      as source_name,
  s.bias      as source_bias,
  s.ownership as source_ownership
from articles a
join locations l on l.id = a.location_id
left join sources s on s.id = a.source_id
where a.published_at > now() - interval '24 hours';

-- ---------------------------------------------------------------- RPC
-- Zusätzlich filterbar nach Trägerschaft und Herkunftsstrom.
-- Wichtig: Quellen ohne Einstufung ('unknown') fallen nur weg, wenn sie
-- ausdrücklich abgewählt sind – sonst wäre der Globus sofort leer, weil die
-- allermeisten Domains noch nicht eingestuft sind.
create function articles_clustered(
  p_from       timestamptz,
  p_to         timestamptz,
  p_categories text[] default null,
  p_bias_min   smallint default null,
  p_bias_max   smallint default null,
  p_zoom       integer  default 2,
  p_ownership  text[]   default null,
  p_connectors text[]   default null
)
returns table (
  lat            double precision,
  lon            double precision,
  n              integer,
  country        char(2),
  location_name  text,
  top_id         bigint,
  top_title      text,
  top_category   category
)
language sql stable as $$
  with grid as (
    select greatest(0.05, 20.0 / power(2, greatest(p_zoom,0))) as cell
  ),
  filtered as (
    select a.id, a.title, a.category, a.prominence,
           l.country, l.name as location_name,
           st_y(l.geom::geometry) as lat,
           st_x(l.geom::geometry) as lon
    from articles a
    join locations l on l.id = a.location_id
    left join sources s on s.id = a.source_id
    where a.published_at between p_from and p_to
      and (p_categories is null or a.category::text = any(p_categories))
      and (p_connectors is null or coalesce(a.connector,'gdelt-en') = any(p_connectors))
      and (p_ownership  is null or coalesce(s.ownership,'unknown')  = any(p_ownership))
      and (p_bias_min is null or s.bias is null or s.bias >= p_bias_min)
      and (p_bias_max is null or s.bias is null or s.bias <= p_bias_max)
  ),
  bucketed as (
    select f.*,
           floor(f.lat / g.cell) as gy,
           floor(f.lon / g.cell) as gx,
           row_number() over (
             partition by floor(f.lat / g.cell), floor(f.lon / g.cell)
             order by f.prominence desc, f.id desc
           ) as rn
    from filtered f cross join grid g
  )
  select
    avg(b.lat)::double precision,
    avg(b.lon)::double precision,
    count(*)::integer,
    (array_agg(b.country       order by b.rn))[1],
    (array_agg(b.location_name order by b.rn))[1],
    (array_agg(b.id            order by b.rn))[1],
    (array_agg(b.title         order by b.rn))[1],
    (array_agg(b.category      order by b.rn))[1]
  from bucketed b
  group by b.gy, b.gx;
$$;

create function articles_at(
  p_lat double precision,
  p_lon double precision,
  p_radius_m integer default 25000,
  p_from timestamptz default now() - interval '24 hours',
  p_to   timestamptz default now(),
  p_ownership  text[] default null,
  p_connectors text[] default null
)
returns setof v_articles_24h
language sql stable as $$
  select v.* from v_articles_24h v
  where v.published_at between p_from and p_to
    and (p_connectors is null or coalesce(v.connector,'gdelt-en') = any(p_connectors))
    and (p_ownership  is null or coalesce(v.source_ownership,'unknown') = any(p_ownership))
    and st_dwithin(
          st_makepoint(v.lon, v.lat)::geography,
          st_makepoint(p_lon, p_lat)::geography,
          p_radius_m)
  order by v.prominence desc, v.published_at desc
  limit 50;
$$;

-- ---------------------------------------------------------------- Retention
-- Übersetzungen laufen mit den Artikeln aus.
create or replace function run_retention() returns void
language plpgsql as $$
begin
  insert into daily_stats (day, country, category, article_count, avg_tone, top_article_url, top_title)
  select date_trunc('day', a.published_at)::date,
         coalesce(l.country, 'ZZ'),
         a.category,
         count(*)::int,
         avg(a.tone),
         (array_agg(a.url   order by a.prominence desc))[1],
         (array_agg(a.title order by a.prominence desc))[1]
  from articles a
  join locations l on l.id = a.location_id
  where a.published_at < now() - interval '8 days'
  group by 1,2,3
  on conflict (day, country, category) do update
    set article_count   = excluded.article_count,
        avg_tone        = excluded.avg_tone,
        top_article_url = excluded.top_article_url,
        top_title       = excluded.top_title;

  delete from articles where published_at < now() - interval '8 days';

  delete from locations l
  where not exists (select 1 from articles a where a.location_id = l.id)
    and l.created_at < now() - interval '8 days';

  delete from translations where created_at < now() - interval '30 days';
  delete from ingest_runs  where started_at < now() - interval '30 days';
end $$;

-- ---------------------------------------------------------------- Kontrolle
-- Wie viele Quellen sind überhaupt eingestuft? Ehrliche Fussnote fürs Panel.
create or replace view v_ownership_stats as
select coalesce(ownership, 'unknown') as ownership, count(*)::int as sources
from sources
group by 1;

grant select on v_ownership_stats to anon, authenticated;

-- Kurzkontrolle nach dem Lauf:
--   select * from v_ownership_stats;
--   select connector, count(*) from articles group by 1;
