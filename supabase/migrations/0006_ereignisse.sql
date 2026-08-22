-- Globe News – Ereignisse, Zuordnung und Bögen
--
-- Kern: Artikel werden nicht mehr nur nach Ort gruppiert, sondern nach
-- Ereignis. Der Ort wird Eigenschaft des Ereignisses, nicht der
-- Gruppierungsschlüssel.
--
-- Der zweite Zweck: `event_outlets` überlebt die Artikellöschung. Nach der
-- Aufbewahrungsfrist verschwinden Titel, Teaser und Links – Ereignis, Outlets
-- und Zeitstempel bleiben. Damit lässt sich ein Ereignis Monate später noch
-- als Replay abspielen, ohne einen einzigen Artikel gespeichert zu haben.

-- ---------------------------------------------------------------- Ereignisse
create table if not exists events (
  id                 bigserial primary key,
  category           category not null,
  country            char(2),
  -- Position des ersten Artikels. Bewusst unveränderlich: Ein wanderndes
  -- Ereignis liesse den Pin zwischen zwei Aufrufen springen.
  geom               geography(Point,4326) not null,
  title              text not null,          -- Titel des ersten Artikels, als Anzeigename
  first_published_at timestamptz not null,
  last_published_at  timestamptz not null,
  article_count      integer not null default 0,
  outlet_count       integer not null default 0,
  -- Vergleichsmaterial für die Zuordnung. Wächst nur über die ersten Artikel
  -- mit (siehe match_events) – sonst zieht ein Ereignis mit der Zeit ein immer
  -- grösseres Netz und beginnt, alles einzusammeln.
  tokens             text[] not null default '{}',
  names              text[] not null default '{}',
  created_at         timestamptz not null default now()
);

create index if not exists events_geom_idx    on events using gist (geom);
create index if not exists events_cat_zeit_idx on events (category, last_published_at desc);
create index if not exists events_zeit_idx    on events using brin (first_published_at);

-- ---------------------------------------------------------------- Bögen
-- Eine Zeile je Outlet und Ereignis: wer hat wann darüber berichtet.
-- Das ist der eigentliche dauerhafte Bestand des Projekts.
create table if not exists event_outlets (
  event_id         bigint not null references events(id) on delete cascade,
  source_id        bigint not null references sources(id) on delete cascade,
  -- Veröffentlichungszeit des *ersten* Artikels dieses Outlets zum Ereignis
  first_seen_at    timestamptz not null,
  article_url_hash char(40),
  confidence       real,
  primary key (event_id, source_id)
);

create index if not exists event_outlets_event_idx on event_outlets (event_id, first_seen_at);
create index if not exists event_outlets_source_idx on event_outlets (source_id, first_seen_at desc);

-- ---------------------------------------------------------------- Artikel
alter table articles add column if not exists event_id     bigint references events(id) on delete set null;
alter table articles add column if not exists event_match_confidence real;
-- Vergleichsmaterial, damit sich die Zuordnung ohne erneuten GDELT-Abruf
-- wiederholen lässt, wenn sich die Regeln ändern.
alter table articles add column if not exists title_tokens text[];
alter table articles add column if not exists names        text[];

create index if not exists articles_event_idx on articles (event_id);

-- ---------------------------------------------------------------- Stellschrauben
-- Als Tabelle statt als Konstanten im Code: Die Schwelle muss sich nachziehen
-- lassen, ohne die Edge Function neu auszurollen.
create table if not exists match_config (
  id              boolean primary key default true check (id),
  max_stunden     real not null default 12,     -- Abstand zum jüngsten Artikel
  -- Gesamtlebensdauer. Ohne diese Grenze schiebt jeder neue Artikel das Fenster
  -- weiter und ein Ereignis könnte sich wochenlang fortschreiben.
  max_gesamt_std  real not null default 72,
  max_meter       integer not null default 300000,
  voll_meter      integer not null default 25000, -- bis hier gilt Ortsnähe als perfekt
  -- Die Zeit ist bewusst schwach gewichtet. Sie ist ein Tor (siehe max_stunden),
  -- kein Mass für Wahrscheinlichkeit: Dass ein Medium acht Stunden später
  -- berichtet, macht es nicht zu einem anderen Ereignis — es ist genau die
  -- Verzögerung, die dieses Projekt messen will. Ein starkes Zeitgewicht würde
  -- die späte, internationale Berichterstattung systematisch abschneiden und
  -- damit blind machen für den eigentlichen Gegenstand.
  gewicht_zeit    real not null default 0.15,
  gewicht_ort     real not null default 0.20,
  gewicht_token   real not null default 0.30,
  gewicht_name    real not null default 0.35,
  -- Ohne textliche Übereinstimmung wird nie zugeordnet. Gleicher Ort zur
  -- gleichen Zeit in der gleichen Rubrik ist *kein* hinreichender Beleg –
  -- genau so entsteht sonst die Falschaussage „18 Medien berichteten über den
  -- Zürichsee", während neun über ein Fussballspiel schrieben.
  --
  -- Zwei Wege zum Beleg, weil sie verschiedene Schwächen haben: Titelwörter
  -- versagen über Sprachgrenzen, Eigennamen überstehen sie meist. Bei den Namen
  -- zählt die absolute Zahl, nicht der Anteil – ein einzelnes gemeinsames
  -- „United States" ist kein Beleg, zwei zusammentreffende Namen schon.
  mindest_token   real not null default 0.20,
  mindest_namen   integer not null default 2,
  -- Abkürzung für den sprachübergreifenden Fall. Wenn zwei Artikel am selben
  -- Ort fünf und mehr Eigennamen teilen, ist das für sich genommen ein starker
  -- Beleg — auch ohne ein einziges gemeinsames Titelwort. Ohne diese Regel
  -- fällt griechische Berichterstattung über ein Schweizer Ereignis durch, weil
  -- die Titelwörter naturgemäss nichts gemeinsam haben und der Anteilswert
  -- allein die Schwelle nicht trägt.
  stark_namen     integer not null default 5,
  schwelle        real not null default 0.55,
  -- Bis zu welcher Artikelzahl ein Ereignis noch Vergleichsmaterial aufnimmt
  lern_bis        integer not null default 5
);

insert into match_config (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------- Ähnlichkeit
-- Überlappung zweier Mengen, bezogen auf die kleinere. Containment statt
-- Jaccard: Eine kurze Schlagzeile soll gegen eine lange nicht dafür bestraft
-- werden, dass sie kurz ist.
--
-- Der Nenner hat einen Boden von 3. Ohne ihn ergäbe ein Artikel mit zwei
-- Eigennamen, von denen einer zufällig passt, eine Überlappung von 0.5 — und
-- mit zwei Treffern die perfekte 1.0. Dünne Mengen dürfen keine starke Aussage
-- erzeugen; sie sind schlicht schwache Belege.
create or replace function gn_overlap(a text[], b text[])
returns real language sql immutable as $$
  select case
    when a is null or b is null or cardinality(a) = 0 or cardinality(b) = 0 then 0::real
    else (
      select count(*)::real / greatest(3, least(cardinality(a), cardinality(b)))
      from (select unnest(a) intersect select unnest(b)) t
    )
  end;
$$;

-- Wie viele Einträge zwei Mengen teilen.
create or replace function gn_shared(a text[], b text[])
returns integer language sql immutable as $$
  select case
    when a is null or b is null then 0
    else (select count(*)::integer from (select unnest(a) intersect select unnest(b)) t)
  end;
$$;

-- ---------------------------------------------------------------- Zuordnung
--
-- Arbeitet einen Stapel frisch eingefügter Artikel ab, in zeitlicher Reihenfolge.
-- Sequenziell und nicht mengenbasiert, weil Artikel B einem Ereignis zufallen
-- kann, das Artikel A im selben Stapel gerade erst erzeugt hat.
create or replace function match_events(p_url_hashes text[])
returns table (zugeordnet integer, neu integer)
language plpgsql as $$
declare
  k        match_config%rowtype;
  a        record;
  treffer  record;
  ev_id    bigint;
  ist_neu  boolean;
  n_zu     integer := 0;
  n_neu    integer := 0;
begin
  select * into k from match_config where id;

  for a in
    select ar.id, ar.url_hash, ar.category, ar.published_at,
           ar.title, ar.source_id,
           coalesce(ar.title_tokens, '{}') as tokens,
           coalesce(ar.names, '{}')        as names,
           l.geom, l.country
    from articles ar
    join locations l on l.id = ar.location_id
    where ar.url_hash = any(p_url_hashes)
      and ar.event_id is null
    order by ar.published_at, ar.id
  loop
    -- Bester Kandidat. Die harten Tore (Rubrik, Zeit, Umkreis, Textbeleg)
    -- stehen in der WHERE-Klausel, damit der Index greift und Aussichtsloses
    -- gar nicht erst bewertet wird.
    select e.id,
           -- Starker Namensbeleg am selben Ort – trägt auch ohne Titelwörter
           ( gn_shared(a.names, e.names) >= k.stark_namen
             and st_distance(a.geom, e.geom) <= k.voll_meter ) as stark,
           ( k.gewicht_zeit  * greatest(0, 1 - abs(extract(epoch from (a.published_at - e.last_published_at))) / (k.max_stunden * 3600))
           + k.gewicht_ort   * greatest(0, least(1, 1 - (st_distance(a.geom, e.geom) - k.voll_meter) / nullif(k.max_meter - k.voll_meter, 0)))
           + k.gewicht_token * gn_overlap(a.tokens, e.tokens)
           + k.gewicht_name  * gn_overlap(a.names,  e.names)
           )::real as score
      into treffer
    from events e
    where e.category = a.category
      and e.last_published_at between a.published_at - make_interval(hours => k.max_stunden::int)
                                  and a.published_at + make_interval(hours => k.max_stunden::int)
      and a.published_at <= e.first_published_at + make_interval(hours => k.max_gesamt_std::int)
      and st_dwithin(a.geom, e.geom, k.max_meter)
      and ( gn_overlap(a.tokens, e.tokens) >= k.mindest_token
         or gn_shared(a.names, e.names)      >= k.mindest_namen )
    order by score desc
    limit 1;

    if treffer.id is not null and (treffer.score >= k.schwelle or treffer.stark) then
      ev_id := treffer.id;
      ist_neu := false;
      n_zu := n_zu + 1;

      update events e
         set last_published_at = greatest(e.last_published_at, a.published_at),
             article_count     = e.article_count + 1,
             -- Vergleichsmaterial nur in der Frühphase erweitern
             tokens = case when e.article_count < k.lern_bis
                           then (select array_agg(distinct t) from unnest(e.tokens || a.tokens) t)
                           else e.tokens end,
             names  = case when e.article_count < k.lern_bis
                           then (select array_agg(distinct t) from unnest(e.names || a.names) t)
                           else e.names end
       where e.id = ev_id;
    else
      insert into events (category, country, geom, title,
                          first_published_at, last_published_at,
                          article_count, tokens, names)
      values (a.category, a.country, a.geom, a.title,
              a.published_at, a.published_at, 1, a.tokens, a.names)
      returning id into ev_id;
      ist_neu := true;
      n_neu := n_neu + 1;
    end if;

    update articles
       set event_id = ev_id,
           event_match_confidence = case when ist_neu then null else treffer.score end
     where id = a.id;

    -- Der Bogen. Bleibt bestehen, wenn der Artikel längst gelöscht ist.
    if a.source_id is not null then
      insert into event_outlets (event_id, source_id, first_seen_at, article_url_hash, confidence)
      values (ev_id, a.source_id, a.published_at, a.url_hash,
              case when ist_neu then 1.0 else treffer.score end)
      on conflict (event_id, source_id) do update
        -- Ein früherer Artikel desselben Mediums gewinnt: Für die Diffusion
        -- zählt der Erstbericht, nicht der jüngste.
        set first_seen_at    = excluded.first_seen_at,
            article_url_hash = excluded.article_url_hash
        where excluded.first_seen_at < event_outlets.first_seen_at;
    end if;
  end loop;

  -- Outlet-Zahl einmal am Ende nachziehen statt bei jedem Einfügen
  update events e
     set outlet_count = (select count(*) from event_outlets eo where eo.event_id = e.id)
   where e.id in (select ar.event_id from articles ar where ar.url_hash = any(p_url_hashes));

  zugeordnet := n_zu;
  neu := n_neu;
  return next;
end $$;

-- ---------------------------------------------------------------- Lesen
-- Ereignisse eines Zeitfensters. Ersetzt mittelfristig articles_clustered;
-- bis dahin laufen beide nebeneinander.
create or replace function events_in_window(
  p_from        timestamptz,
  p_to          timestamptz,
  p_categories  text[] default null,
  p_min_outlets integer default 1,
  p_limit       integer default 2000
)
returns table (
  id            bigint,
  lat           double precision,
  lon           double precision,
  category      category,
  country       char(2),
  title         text,
  article_count integer,
  outlet_count  integer,
  first_published_at timestamptz,
  last_published_at  timestamptz
)
language sql stable as $$
  select e.id,
         st_y(e.geom::geometry), st_x(e.geom::geometry),
         e.category, e.country, e.title,
         e.article_count, e.outlet_count,
         e.first_published_at, e.last_published_at
  from events e
  where e.first_published_at <= p_to
    and e.last_published_at  >= p_from
    and (p_categories is null or e.category::text = any(p_categories))
    and e.outlet_count >= p_min_outlets
  order by e.outlet_count desc, e.article_count desc
  limit p_limit;
$$;

-- Die Bögen eines Ereignisses – genau die Nutzlast, die das Replay braucht.
-- Outlets ohne hinterlegten Redaktionssitz kommen mit lat/lon = null zurück:
-- Sie zählen mit, bekommen aber keinen Bogen.
create or replace function event_arcs(p_event_id bigint)
returns table (
  source_id     bigint,
  domain        text,
  name          text,
  country       char(2),
  ownership     text,
  lat           double precision,
  lon           double precision,
  first_seen_at timestamptz,
  minutes_after integer
)
language sql stable as $$
  select s.id, s.domain, coalesce(s.name, s.domain), s.country, s.ownership,
         st_y(s.home_geom::geometry), st_x(s.home_geom::geometry),
         eo.first_seen_at,
         (extract(epoch from (eo.first_seen_at - e.first_published_at)) / 60)::integer
  from event_outlets eo
  join events  e on e.id = eo.event_id
  join sources s on s.id = eo.source_id
  where eo.event_id = p_event_id
  order by eo.first_seen_at;
$$;

-- ---------------------------------------------------------------- Rechte
alter table events        enable row level security;
alter table event_outlets enable row level security;
alter table match_config  enable row level security;

drop policy if exists p_read_events        on events;
drop policy if exists p_read_event_outlets on event_outlets;

create policy p_read_events        on events        for select to anon, authenticated using (true);
create policy p_read_event_outlets on event_outlets for select to anon, authenticated using (true);
-- match_config bleibt ohne Policy => nur service_role.

-- ---------------------------------------------------------------- Aufbewahrung
-- Ergänzt run_retention: Ereignisse ohne jeden Bogen sind wertlos und dürfen
-- mit den Artikeln gehen. Alle anderen bleiben – sie sind der Bestand.
create or replace function run_event_retention() returns void
language sql as $$
  delete from events e
  where not exists (select 1 from event_outlets eo where eo.event_id = e.id)
    and e.created_at < now() - interval '8 days';
$$;
