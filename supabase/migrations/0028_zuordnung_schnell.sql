-- 0028 — Die Zuordnung wieder zum Laufen bringen
--
-- BEFUND vom 26.08.2026. In `ingest_runs` steht seit Tagen bei jedem Lauf:
--     match_events: canceling statement due to statement timeout
-- Folge: 15'347 Artikel in 24 Stunden, davon **null** einem Ereignis zugeordnet.
-- Im UI sah das aus wie „13'480 Meldungen · 13'480 Ereignisse", also wie ein
-- Buendelungsproblem. Es war keines — die Zuordnung lief gar nicht.
--
-- Der Ausfall kam schleichend, weil er an der Groesse der Ereignistabelle haengt:
--   20.08.  1.51 Artikel je Ereignis
--   23.08.  1.22
--   25.08.  1.09
-- Je mehr Ereignisse, desto teurer jeder Durchgang, bis der Stapel das Zeitlimit
-- riss. Und dann rollt die ganze Transaktion zurueck: null statt teilweise.
--
-- DIESE MIGRATION AENDERT DIE ZUORDNUNGSREGELN NICHT.
-- Keine Gewichte, keine Schwellen, keine Tore. Nur Geschwindigkeit und
-- Widerstandsfaehigkeit. Die inhaltlichen Fragen (Ortshierarchie, Sprachgrenze)
-- gehoeren in eine eigene Migration — sonst laesst sich die Wirkung nicht messen.
--
-- Abgeleitet aus dem geprueften Stand von 0019, nicht aus 0006. Ein erster
-- Versuch ging von 0006 aus und verlor dabei still die beiden `coalesce` und
-- das Feld `location_name`. Gefunden hat das der Verhaltenstest, nicht das Lesen.

begin;

-- ---------------------------------------------------------------- 1. Indizes
-- Der Engpass sind `gn_overlap` und `gn_shared` in der WHERE-Klausel: zwei
-- Mengenschnitte je Kandidat, fuer jeden einzelnen Artikel. Kein Index greift
-- auf einen Funktionsaufruf.
--
-- Der Ausweg ist der Ueberlappungsoperator `&&`. Er ist mit GIN indizierbar —
-- und er ist eine **verlustfreie** Vorbedingung:
--     gn_overlap(a,b) >= 0.20  verlangt mindestens ein gemeinsames Element
--     gn_shared(a,b)  >= 2     verlangt mindestens zwei
-- Beides setzt `a && b` voraus. Wer durch das alte Tor kam, kommt auch durch
-- das neue. Es faellt kein Treffer weg, nur aussichtslose Kandidaten.

create index if not exists events_tokens_gin on events using gin (tokens);
create index if not exists events_names_gin  on events using gin (names);

-- ---------------------------------------------------------------- 2. Deckel
-- Sicherheitsventil. `names` enthaelt viel Allerwelts-Geografie („united
-- states"), dort trennt `&&` schwach. Ohne Obergrenze koennte ein einzelner
-- Artikel wieder Tausende Kandidaten bewerten.
alter table match_config
  add column if not exists max_kandidaten integer not null default 400;

comment on column match_config.max_kandidaten is
  'Obergrenze der bewerteten Kandidaten je Artikel. Notbremse: mit dem '
  '&&-Vorfilter liegt die reale Zahl weit darunter. Wird sie erreicht, gewinnen '
  'die zeitlich naechsten Ereignisse.';

-- ---------------------------------------------------------------- 3. Zuordnung
-- Zwei Aenderungen gegenueber 0019:
--
--   a) Kandidaten werden zuerst gesammelt (`kandidat`), mit den billigen,
--      indizierten Bedingungen. Erst auf dieser kleinen Menge laufen die
--      Mengenschnitte und die Bewertung.
--
--   b) Ein Zeitbudget. Laeuft es ab, bricht die Schleife ab und gibt zurueck,
--      was fertig ist — statt die Transaktion vom Zeitlimit abwuergen zu lassen
--      und alles zu verlieren. Teilfortschritt schlaegt Totalausfall.
--
-- Die Rueckgabe hat eine dritte Spalte `offen`. Damit steht in `ingest_runs`,
-- ob ein Rueckstand entsteht — der jetzige Ausfall waere so am ersten Tag
-- sichtbar gewesen statt nach einer Woche.

drop function if exists match_events(text[]);

create or replace function match_events(
  p_url_hashes   text[],
  p_max_sekunden real default 20
)
returns table (zugeordnet integer, neu integer, offen integer)
language plpgsql as $$
declare
  k        match_config%rowtype;
  a        record;
  treffer  record;
  ev_id    bigint;
  ist_neu  boolean;
  n_zu     integer := 0;
  n_neu    integer := 0;
  n_ges    integer := 0;
  t_start  timestamptz;
begin
  select * into k from match_config where id;
  t_start := clock_timestamp();

  select count(*) into n_ges
    from articles
   where url_hash = any(p_url_hashes) and event_id is null;

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
    -- Zeitbudget aufgebraucht: aufhoeren und behalten, was fertig ist.
    exit when clock_timestamp() - t_start > make_interval(secs => p_max_sekunden);

    with kandidat as (
      select e.id, e.tokens, e.names, e.geom, e.last_published_at
        from events e
       where e.category = a.category
         and e.last_published_at between a.published_at - make_interval(hours => k.max_stunden::int)
                                     and a.published_at + make_interval(hours => k.max_stunden::int)
         and a.published_at <= e.first_published_at + make_interval(hours => k.max_gesamt_std::int)
         and (a.tokens && e.tokens or a.names && e.names)
         and st_dwithin(a.geom, e.geom, k.max_meter)
       order by e.last_published_at desc
       limit k.max_kandidaten
    )
    select c.id,
           ( gn_shared(a.names, c.names) >= k.stark_namen
             and st_distance(a.geom, c.geom) <= k.voll_meter ) as stark,
           ( k.gewicht_zeit  * greatest(0, 1 - abs(extract(epoch from (a.published_at - c.last_published_at))) / (k.max_stunden * 3600))
           + k.gewicht_ort   * greatest(0, least(1, 1 - (st_distance(a.geom, c.geom) - k.voll_meter) / nullif(k.max_meter - k.voll_meter, 0)))
           + k.gewicht_token * gn_overlap(a.tokens, c.tokens)
           + k.gewicht_name  * gn_overlap(a.names,  c.names)
           )::real as score
      into treffer
    from kandidat c
    where ( gn_overlap(a.tokens, c.tokens) >= k.mindest_token
         or gn_shared(a.names, c.names)    >= k.mindest_namen )
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
  neu        := n_neu;
  offen      := greatest(0, n_ges - n_zu - n_neu);
  return next;
end $$;

-- ---------------------------------------------------------------- 4. Rueckstand
-- Die liegengebliebenen Artikel aufholen. Bewusst **aelteste zuerst**:
-- match_events arbeitet chronologisch, und ein Ereignis muss entstehen, bevor
-- spaetere Meldungen daran andocken koennen.
--
-- Mehrfach aufrufen, bis `offen` nicht mehr sinkt:
--     select * from match_events_nachholen(400, 20);
create or replace function match_events_nachholen(
  p_anzahl       integer default 400,
  p_max_sekunden real    default 20
)
returns table (zugeordnet integer, neu integer, offen integer)
language sql as $$
  select * from match_events(
    array(
      select ar.url_hash
        from articles ar
        join locations l on l.id = ar.location_id
       where ar.event_id is null
       order by ar.published_at
       limit p_anzahl
    ),
    p_max_sekunden
  );
$$;

commit;
