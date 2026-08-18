-- Globe News – Basisschema
-- Postgres 15 + PostGIS (Supabase)

create extension if not exists postgis;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------- Rubriken
do $$ begin
  create type category as enum (
    'natural_disasters','conflicts','peace_talks','politics','diplomacy',
    'accidents','sports','culture','art','weather','nature','other'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- Quellen
create table if not exists sources (
  id           bigserial primary key,
  domain       text not null unique,
  name         text,
  country      char(2),
  home_geom    geography(Point,4326),
  -- Ground-News-artige Skala: -3 far left … 0 center … +3 far right
  bias         smallint check (bias between -3 and 3),
  bias_source  text,
  factuality   smallint check (factuality between 0 and 5),
  ownership    text check (ownership in ('public','private','state','unknown')),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists sources_country_idx on sources (country);

-- ---------------------------------------------------------------- Orte
create table if not exists locations (
  id            bigserial primary key,
  geohash       char(9) not null unique,
  name          text not null,
  admin1        text,
  country       char(2),
  geom          geography(Point,4326) not null,
  feature_class text not null default 'city'
                check (feature_class in ('city','landmark','region','country_fallback')),
  created_at    timestamptz not null default now()
);

create index if not exists locations_geom_idx    on locations using gist (geom);
create index if not exists locations_country_idx on locations (country);

-- ---------------------------------------------------------------- Artikel
create table if not exists articles (
  id           bigserial primary key,
  url_hash     char(40) not null unique,
  url          text not null,
  title        text not null,
  teaser       text,
  image_url    text,
  source_id    bigint references sources(id)   on delete set null,
  location_id  bigint references locations(id) on delete cascade,
  category     category not null default 'other',
  language     char(3),
  tone         real,
  prominence   integer not null default 1,   -- GDELT: Zahl der berichtenden Quellen
  published_at timestamptz not null,
  ingested_at  timestamptz not null default now()
);

create index if not exists articles_published_idx on articles using brin (published_at);
create index if not exists articles_cat_pub_idx   on articles (category, published_at desc);
create index if not exists articles_location_idx  on articles (location_id);

-- ---------------------------------------------------------------- Aggregate
create table if not exists daily_stats (
  day             date    not null,
  country         char(2) not null,
  category        category not null,
  article_count   integer not null,
  avg_tone        real,
  top_article_url text,
  top_title       text,
  primary key (day, country, category)
);

-- ---------------------------------------------------------------- Ingest-Log
create table if not exists ingest_runs (
  id           bigserial primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  connector    text not null,
  fetched      integer not null default 0,
  inserted     integer not null default 0,
  skipped      integer not null default 0,
  error        text
);

-- ---------------------------------------------------------------- Views
-- Was das Frontend im Normalfall braucht: letzte 24 h, fertig verknüpft.
create or replace view v_articles_24h as
select
  a.id,
  a.url,
  a.title,
  a.teaser,
  a.image_url,
  a.category,
  a.language,
  a.tone,
  a.prominence,
  a.published_at,
  l.name    as location_name,
  l.country as country,
  st_y(l.geom::geometry) as lat,
  st_x(l.geom::geometry) as lon,
  s.domain  as source_domain,
  s.name    as source_name,
  s.bias    as source_bias,
  s.ownership as source_ownership
from articles a
join locations l on l.id = a.location_id
left join sources s on s.id = a.source_id
where a.published_at > now() - interval '24 hours';

-- ---------------------------------------------------------------- RPC
-- Serverseitiges Clustering: fasst Pins zusammen, solange weit herausgezoomt.
-- zoom 0..8 -> Rasterweite in Grad
create or replace function articles_clustered(
  p_from       timestamptz,
  p_to         timestamptz,
  p_categories text[] default null,
  p_bias_min   smallint default null,
  p_bias_max   smallint default null,
  p_zoom       integer  default 2
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
    avg(b.lat)::double precision as lat,
    avg(b.lon)::double precision as lon,
    count(*)::integer            as n,
    (array_agg(b.country      order by b.rn))[1] as country,
    (array_agg(b.location_name order by b.rn))[1] as location_name,
    (array_agg(b.id           order by b.rn))[1] as top_id,
    (array_agg(b.title        order by b.rn))[1] as top_title,
    (array_agg(b.category     order by b.rn))[1] as top_category
  from bucketed b
  group by b.gy, b.gx;
$$;

-- Alle Artikel eines Ortes (für das Teaser-Panel)
create or replace function articles_at(
  p_lat double precision,
  p_lon double precision,
  p_radius_m integer default 25000,
  p_from timestamptz default now() - interval '24 hours',
  p_to   timestamptz default now()
)
returns setof v_articles_24h
language sql stable as $$
  select v.* from v_articles_24h v
  where v.published_at between p_from and p_to
    and st_dwithin(
          st_makepoint(v.lon, v.lat)::geography,
          st_makepoint(p_lon, p_lat)::geography,
          p_radius_m)
  order by v.prominence desc, v.published_at desc
  limit 50;
$$;

-- ---------------------------------------------------------------- Retention
-- Rollup in daily_stats, danach Detaildaten älter als 8 Tage löschen.
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

  delete from ingest_runs where started_at < now() - interval '30 days';
end $$;

-- ---------------------------------------------------------------- RLS
alter table sources     enable row level security;
alter table locations   enable row level security;
alter table articles    enable row level security;
alter table daily_stats enable row level security;
alter table ingest_runs enable row level security;

drop policy if exists p_read_sources     on sources;
drop policy if exists p_read_locations   on locations;
drop policy if exists p_read_articles    on articles;
drop policy if exists p_read_daily_stats on daily_stats;

create policy p_read_sources     on sources     for select to anon, authenticated using (true);
create policy p_read_locations   on locations   for select to anon, authenticated using (true);
create policy p_read_articles    on articles    for select to anon, authenticated using (true);
create policy p_read_daily_stats on daily_stats for select to anon, authenticated using (true);
-- ingest_runs bleibt ohne Policy => nur service_role sieht es.
-- Schreibrechte hat ausschliesslich die Edge Function (service_role umgeht RLS).
