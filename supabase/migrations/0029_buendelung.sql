-- 0029 — Bündelung: Ortshierarchie und sprachbewusste Normierung
--
-- Gemessene Ausgangslage nach 0028: **1.15 Artikel je Ereignis**. Die Zuordnung
-- läuft wieder, bündelt aber so schwach wie vor dem Ausfall. Zwei Ursachen,
-- beide am Fall Conakry belegt (EREIGNIS-CLUSTERING.md §7).
--
-- URSACHE 1 — 321 km.
-- Guineas Landesmittelpunkt liegt 321 km von Conakry entfernt, `max_meter`
-- steht auf 300 km. Jede Meldung, die nur mit „Guinea" verortet wurde, fällt
-- aus dem Distanztor, BEVOR ein einziges Wort verglichen wird. Das ist keine
-- Schwelle, das ist ein Ausschluss.
--
-- URSACHE 2 — über die Sprachgrenze zählt ein fehlendes Signal wie ein
-- Gegenbeweis. Zwischen einer französischen und einer englischen Meldung ist
-- die Titelwort-Überlappung notwendigerweise null; die 0.30 fallen weg. Damit
-- bleiben höchstens 0.70 erreichbar, und die Schwelle 0.55 verlangt dort
-- **79 % des Möglichen** statt 55 %. Gerechnet für ein realistisches Paar —
-- gleicher Ort, eine Stunde Abstand, zwei geteilte Eigennamen:
--     0.135 + 0.20 + 0 + 0.14 = 0.475  →  knapp unter 0.55, kein Treffer
-- Mit Normierung: 0.475 / 0.70 = 0.679  →  Treffer.
--
-- URSACHE 3 — dasselbe noch einmal, bei den Namen.
-- Katastrophen nennen selten Personen: „officials say", „government says".
-- Dann ist gewicht_name (0.35) tot, bleibt aber im Nenner. Ein namenloses
-- Ereignis muss damit 85 % seines Erreichbaren schaffen, ein benanntes 55 %.
-- Deshalb faellt auch dieses Gewicht heraus, wenn eine der beiden Seiten gar
-- keine Namen hat. Haben beide welche und teilen trotzdem nichts, ist das
-- echte Gegenwehr und zaehlt weiter.
--
-- BEIDES ERSETZT EINEN AUSDRUCK, statt eine Bedingung danebenzustellen.
-- Hauslehre aus 0020: Einen Stellvertreter ersetzt man, man ergänzt ihn nicht.

begin;

-- ------------------------------------------------------------ 1. Ortsstufe
-- `locations.feature_class` weiss, ob eine Koordinate eine Stadt ist oder nur
-- die Mitte eines Landes. Ereignisse wussten es bisher nicht — sie tragen die
-- Koordinate, nicht ihre Herkunft. Das wird nachgeholt.
alter table events add column if not exists geo_grob boolean not null default false;

comment on column events.geo_grob is
  'Die Koordinate stammt aus einer Landesmitte (locations.feature_class = '
  'country_fallback), nicht aus einem Ort. Zwei grob verortete Meldungen '
  'desselben Landes dürfen sich finden, auch über 300 km hinweg.';

-- ------------------------------------------------------------ 2. Stellschrauben
alter table match_config
  add column if not exists ort_grob real not null default 0.5,
  add column if not exists mindest_namen_ohne_token integer not null default 3;

comment on column match_config.ort_grob is
  'Ortswert bei grober Verortung im selben Land. Bewusst 0.5 und nicht 1.0: '
  '„irgendwo in Guinea" ist ein schwächerer Beleg als „in Conakry", aber ein '
  'weit besserer als der Ausschluss, den 321 km heute erzwingen.';

comment on column match_config.mindest_namen_ohne_token is
  'Ohne gemeinsame Titelwörter verlangte Namen. Höher als mindest_namen, weil '
  'die Normierung den sprachübergreifenden Fall erleichtert — die Gegenwehr '
  'gegen Falschverschmelzung muss dort stärker sein.';

-- ------------------------------------------------------------ 3. Zuordnung
-- Abgeleitet aus 0028 durch fünf gezielte Ersetzungen. Unverändert bleiben:
-- Zeitfenster, Kandidaten-Vorfilter, Zeitbudget, Lernregeln, Bogenschreibung.

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
           l.geom, l.country, l.name as ortsname,
           (l.feature_class = 'country_fallback') as grob
    from articles ar
    join locations l on l.id = ar.location_id
    where ar.url_hash = any(p_url_hashes)
      and ar.event_id is null
    order by ar.published_at, ar.id
  loop
    -- Zeitbudget aufgebraucht: aufhoeren und behalten, was fertig ist.
    exit when clock_timestamp() - t_start > make_interval(secs => p_max_sekunden);

    with kandidat as (
      select e.id, e.tokens, e.names, e.geom, e.last_published_at, e.geo_grob, e.country
        from events e
       where e.category = a.category
         and e.last_published_at between a.published_at - make_interval(hours => k.max_stunden::int)
                                     and a.published_at + make_interval(hours => k.max_stunden::int)
         and a.published_at <= e.first_published_at + make_interval(hours => k.max_gesamt_std::int)
         and (a.tokens && e.tokens or a.names && e.names)
         and ( st_dwithin(a.geom, e.geom, k.max_meter)
            or ((a.grob or e.geo_grob) and a.country = e.country) )
       order by e.last_published_at desc
       limit k.max_kandidaten
    )
    select c.id,
           ( gn_shared(a.names, c.names) >= k.stark_namen
             and st_distance(a.geom, c.geom) <= k.voll_meter ) as stark,
           ( ( k.gewicht_zeit  * greatest(0, 1 - abs(extract(epoch from (a.published_at - c.last_published_at))) / (k.max_stunden * 3600))
             + k.gewicht_ort   * case
                                   when (a.grob or c.geo_grob) and a.country = c.country
                                     then k.ort_grob
                                   else greatest(0, least(1, 1 - (st_distance(a.geom, c.geom) - k.voll_meter) / nullif(k.max_meter - k.voll_meter, 0)))
                                 end
             + k.gewicht_token * gn_overlap(a.tokens, c.tokens)
             + k.gewicht_name  * gn_overlap(a.names,  c.names)
             )
             / ( k.gewicht_zeit + k.gewicht_ort
                 -- Titelwoerter: zaehlen nur, wenn es eine Ueberlappung gibt.
                 -- Ueber die Sprachgrenze ist die Null eine Eigenschaft der
                 -- Sprache, kein Hinweis auf Verschiedenheit.
                 + case when gn_overlap(a.tokens, c.tokens) > 0 then k.gewicht_token else 0 end
                 -- Namen: zaehlen nur, wenn beide Seiten welche haben. Fehlen
                 -- sie ganz (Katastrophen nennen selten Personen), darf ihr
                 -- Gewicht nicht als Gegenbeweis wirken. Sind beide Seiten
                 -- besetzt und teilen trotzdem nichts, ist das echte Gegenwehr
                 -- und zaehlt weiter mit.
                 + case when cardinality(a.names) > 0 and cardinality(c.names) > 0
                        then k.gewicht_name else 0 end )
           )::real as score
      into treffer
    from kandidat c
    where ( gn_overlap(a.tokens, c.tokens) >= k.mindest_token
         or gn_shared(a.names, c.names)    >= k.mindest_namen_ohne_token )
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
                          article_count, tokens, names, geo_grob)
      values (a.category, a.country, a.geom, a.title, a.ortsname,
              a.published_at, a.published_at, 1, a.tokens, a.names, a.grob)
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

-- ------------------------------------------------------------ 4. Bestand
-- Vorhandene Ereignisse tragen `geo_grob = false`. Für die Landesmitten unter
-- ihnen wird das nachgezogen — sonst wirkt die neue Regel nur für Ereignisse,
-- die ab jetzt entstehen, und der Rückstand bliebe zersplittert.
update events e
   set geo_grob = true
 where not e.geo_grob
   and exists (
     select 1 from articles a
       join locations l on l.id = a.location_id
      where a.event_id = e.id
        and l.feature_class = 'country_fallback');

commit;
