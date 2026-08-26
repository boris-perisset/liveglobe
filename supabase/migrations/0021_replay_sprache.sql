-- Live Globe – die Sprache überlebt die Artikellöschung
--
-- Das Replay soll vier Kennzahlen mitwachsen lassen: Medien, Länder, Sprachen,
-- Weltregionen (`EREIGNISMODELL.md` §4). Drei davon stehen schon da — `sources`
-- führt `country`, die Weltregion folgt daraus über eine feste Tabelle im
-- Frontend.
--
-- Die Sprache nicht. `sources` hat keine Sprachspalte, und `articles.language`
-- ist nach 72 Stunden weg. Genau dagegen ist §3 gebaut: Was bleiben soll, muss
-- am **Bogen** hängen, nicht am Artikel.
--
-- ---------------------------------------------------------------------------
-- Warum an `event_outlets` und nicht an `sources`
-- ---------------------------------------------------------------------------
--
-- Eine Spalte `sources.language` wäre billiger — einmal je Medium statt einmal
-- je Paar. Sie wäre aber bei genau den Häusern falsch, die für die Frage nach
-- Sprachgrenzen die interessanten sind: swissinfo.ch erscheint in zehn
-- Sprachen, RT in sechs, die BBC in über vierzig. „Die Sprache der BBC" gibt es
-- nicht.
--
-- Am Bogen ist es die Sprache **dieser** Meldung zu **diesem** Ereignis. Das
-- ist die Aussage, die das Replay macht, wenn der Zähler von 3 auf 4 springt —
-- und sie kostet drei Byte je Paar, dieselbe Grössenordnung wie
-- `first_seen_at` in §3.
--
-- ---------------------------------------------------------------------------
-- Was hier geändert wird
-- ---------------------------------------------------------------------------
--
-- 1. Spalte `event_outlets.language`
-- 2. `match_events()` schreibt sie mit — **auf dem Stand von 0019**, nicht von
--    0012. Die beiden `coalesce` gegen den NULL-Abbruch bleiben also erhalten;
--    sonst nähme diese Migration den Fix von 0019 wieder zurück.
-- 3. `event_arcs()` gibt sie aus
-- 4. Einmalige Nachfüllung aus den Artikeln, die noch da sind
--
-- Reihenfolge beachtet: 0021 muss **nach** 0019 laufen. Läuft es davor,
-- gewinnt 0019 mit seiner älteren Fassung und die Sprache bleibt leer, ohne
-- dass etwas dabei scheitert — der stille Fehler, vor dem `STAND.md` warnt.

-- ---------------------------------------------------------------- Spalte
alter table event_outlets add column if not exists language char(3);

comment on column event_outlets.language is
  'Sprache der ersten Meldung dieses Mediums zu diesem Ereignis. Am Bogen und '
  'nicht an der Quelle, weil mehrsprachige Häuser sonst falsch gezählt würden.';

-- ---------------------------------------------------------------- Zuordnung
-- Wortgleich mit 0019, bis auf drei Stellen: `ar.language` in der Schleife,
-- `language` in der Einfügung, und `language` in der Konfliktbehandlung.
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
           ar.title, ar.source_id, ar.language,
           coalesce(ar.title_tokens, '{}') as tokens,
           coalesce(ar.names, '{}')        as names,
           l.geom, l.country, l.name as ortsname
    from articles ar
    join locations l on l.id = ar.location_id
    where ar.url_hash = any(p_url_hashes)
      and ar.event_id is null
    order by ar.published_at, ar.id
  loop
    select e.id,
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

      -- Die beiden `coalesce` stammen aus 0019 und bleiben: Lernt ein Ereignis
      -- aus zwei leeren Listen, bleibt es bei der leeren Liste, statt auf NULL
      -- zu fallen und den ganzen Lauf mitzureissen.
      update events e
         set last_published_at = greatest(e.last_published_at, a.published_at),
             article_count     = e.article_count + 1,
             tokens = case when e.article_count < k.lern_bis
                           then coalesce(
                                  (select array_agg(distinct t) from unnest(e.tokens || a.tokens) t),
                                  '{}')
                           else e.tokens end,
             names  = case when e.article_count < k.lern_bis
                           then coalesce(
                                  (select array_agg(distinct t) from unnest(e.names || a.names) t),
                                  '{}')
                           else e.names end
       where e.id = ev_id;
    else
      insert into events (category, country, geom, title, location_name,
                          first_published_at, last_published_at,
                          article_count, tokens, names)
      values (a.category, a.country, a.geom, a.title, a.ortsname,
              a.published_at, a.published_at, 1, a.tokens, a.names)
      returning id into ev_id;
      ist_neu := true;
      n_neu := n_neu + 1;
    end if;

    update articles
       set event_id = ev_id,
           event_match_confidence = case when ist_neu then null else treffer.score end
     where id = a.id;

    -- Der Bogen. Bleibt bestehen, wenn der Artikel längst gelöscht ist —
    -- und trägt seit hier auch die Sprache, aus demselben Grund.
    if a.source_id is not null then
      insert into event_outlets (event_id, source_id, first_seen_at,
                                 article_url_hash, confidence, language)
      values (ev_id, a.source_id, a.published_at, a.url_hash,
              case when ist_neu then 1.0 else treffer.score end,
              a.language)
      on conflict (event_id, source_id) do update
        -- Ein früherer Artikel desselben Mediums gewinnt: Für die Diffusion
        -- zählt der Erstbericht, nicht der jüngste. Die Sprache zieht mit,
        -- sonst stünde sie zum falschen Artikel.
        set first_seen_at    = excluded.first_seen_at,
            article_url_hash = excluded.article_url_hash,
            language         = excluded.language
        where excluded.first_seen_at < event_outlets.first_seen_at;
    end if;
  end loop;

  update events e
     set outlet_count = (select count(*) from event_outlets eo where eo.event_id = e.id)
   where e.id in (select ar.event_id from articles ar where ar.url_hash = any(p_url_hashes));

  zugeordnet := n_zu;
  neu := n_neu;
  return next;
end $$;

-- ---------------------------------------------------------------- Nachfüllen
-- Was noch da ist, wird mitgenommen. Bögen zu bereits gelöschten Artikeln
-- bleiben ohne Sprache — das ist richtig so und darf im Zähler auch so
-- aussehen: „unbekannt" ist eine Antwort, eine erfundene Sprache wäre keine.
update event_outlets eo
   set language = a.language
  from articles a
 where a.url_hash = eo.article_url_hash
   and eo.language is null
   and a.language is not null;

-- ---------------------------------------------------------------- Bögen lesen
/*
 * Nutzlast des Replays: je Medium ein Bogen, in zeitlicher Reihenfolge.
 *
 * `minutes_after` ist der Abstand zum Ereignisbeginn — das Frontend rechnet
 * daraus die Uhr und braucht keinen zweiten Aufruf für das Ereignis selbst.
 *
 * `geo_quelle` gehört mit ausgegeben und gehört auch gezeigt: Ein Bogen auf
 * einen Landesmittelpunkt ist etwas anderes als einer auf eine Redaktion, und
 * wer das nicht unterscheiden kann, liest Genauigkeit in die Karte hinein, die
 * nicht da ist.
 *
 * `s.home_geom is not null` bleibt die Bedingung: Ein Medium ohne Koordinate
 * wird gezählt, aber nicht gemalt — ein Bogen ins Nichts wäre ein erfundener
 * Ort.
 */
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
  language      char(3),
  first_seen_at timestamptz,
  minutes_after integer
)
language sql stable as $$
  select s.id, s.domain, coalesce(s.name, s.domain), s.country, s.ownership,
         st_y(s.home_geom::geometry), st_x(s.home_geom::geometry),
         coalesce(s.geo_quelle::text, 'unbekannt'),
         eo.language,
         eo.first_seen_at,
         (extract(epoch from (eo.first_seen_at - e.first_published_at)) / 60)::integer
  from event_outlets eo
  join events  e on e.id = eo.event_id
  join sources s on s.id = eo.source_id
  where eo.event_id = p_event_id
    and s.home_geom is not null
  order by eo.first_seen_at, s.id;
$$;

grant execute on function event_arcs(bigint) to anon, authenticated;
