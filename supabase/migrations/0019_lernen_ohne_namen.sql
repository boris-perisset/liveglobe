-- Live Globe – `match_events` bricht nicht mehr an namenlosen Meldungen ab
--
-- In `ingest_runs` stand, unregelmässig und schon länger:
--
--     match_events: null value in column "names" of relation "events"
--     violates not-null constraint            skipped: 4
--
-- Das ist kein Schönheitsfehler. `match_events` läuft als **eine** Transaktion:
-- Bricht es an einem Artikel ab, bleibt der ganze Lauf ohne Zuordnung. Alle
-- Meldungen dieses Durchgangs werden dann auf der Karte zu Einzelereignissen —
-- neben den Ingest-Reglern die zweite Ursache dafür, dass die Karte körniger
-- aussieht, als sie sein müsste.
--
-- ---------------------------------------------------------------------------
-- Der Weg dorthin
-- ---------------------------------------------------------------------------
--
-- Die Auswahl der Kandidaten verlangt ein **Oder**:
--
--     and ( gn_overlap(a.tokens, e.tokens) >= k.mindest_token
--        or gn_shared(a.names,  e.names)   >= k.mindest_namen )
--
-- Ein Treffer über die Tokens allein genügt also. Beide Namenslisten dürfen
-- dabei leer sein — GDELT erkennt nicht in jeder Meldung Eigennamen. Genau
-- dann trifft das Lernen ins Leere:
--
--     names = (select array_agg(distinct t) from unnest(e.names || a.names) t)
--
-- `unnest` über zwei leere Listen liefert keine Zeile, und `array_agg` über
-- eine leere Menge ergibt **NULL**, nicht `'{}'`. `events.names` ist NOT NULL.
--
-- Nachgestellt und bestätigt: ein Ereignis und ein Artikel mit denselben drei
-- Tokens und leeren Namenslisten, und der Abbruch kommt zuverlässig.
--
-- Dieselbe Falle steckt in `tokens`, spiegelbildlich: Ein Artikel ohne Tokens,
-- der über die Namen trifft, würde `tokens` auf NULL setzen. Bisher nie
-- aufgetreten, aber es ist derselbe Ausdruck — also wird er mitbehandelt.
--
-- Die Behebung sind zwei `coalesce`. Der Rest steht wortgleich in 0012 und ist
-- dort begründet.

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

      -- Die beiden `coalesce` sind der ganze Unterschied zu 0012: Lernt ein
      -- Ereignis aus zwei leeren Listen, bleibt es bei der leeren Liste,
      -- statt auf NULL zu fallen und den Lauf mitzureissen.
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

    if a.source_id is not null then
      insert into event_outlets (event_id, source_id, first_seen_at, article_url_hash, confidence)
      values (ev_id, a.source_id, a.published_at, a.url_hash,
              case when ist_neu then 1.0 else treffer.score end)
      on conflict (event_id, source_id) do update
        set first_seen_at    = excluded.first_seen_at,
            article_url_hash = excluded.article_url_hash
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

-- Aufräumen: Ereignisse, die durch frühere Abbrüche mit NULL stehengeblieben
-- sein könnten. Sollte keine Zeile treffen — der Abbruch hat die Transaktion ja
-- zurückgerollt —, kostet aber nichts und schliesst die Lücke sicher.
update events set names  = '{}' where names  is null;
update events set tokens = '{}' where tokens is null;
