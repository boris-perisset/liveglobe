-- Live Globe – auch die Medien ohne bekannten Sitz gehören ins Replay
--
-- `event_arcs()` liess bisher weg, was es nicht zeichnen kann:
--
--     and s.home_geom is not null
--
-- Für das **Zeichnen** ist das richtig und bleibt richtig — ein Bogen ins Nichts
-- wäre ein erfundener Ort. Für das **Zählen** ist es falsch, und zwar in drei
-- Richtungen auf einmal:
--
--   * Der Medienzähler war zu klein. Ein Ereignis mit neun Häusern zeigte „6",
--     und die drei fehlenden sahen aus, als hätte niemand berichtet.
--   * Länder und Sprachen waren zu klein. `sources.country` und
--     `event_outlets.language` stehen auch dann da, wenn keine Koordinate
--     bekannt ist — ein türkisches Haus ohne Sitz ist trotzdem die Türkei und
--     trotzdem Türkisch. Genau diese Zähler sind die Aussage des Werkzeugs.
--   * Die Lücke war unsichtbar. Wer sechs Bögen sieht, hält sechs für die
--     Antwort. Dass drei Häuser nur deshalb fehlen, weil **wir** ihren Sitz
--     nicht kennen, ist eine Aussage über unser Register und gehört ins Bild.
--
-- Deshalb liefert die Funktion ab hier **alle** Medien eines Ereignisses, in
-- zeitlicher Reihenfolge, und `lat`/`lon` sind null, wo kein Sitz bekannt ist.
-- Was gezeichnet wird, entscheidet das Frontend — es zählt alle und malt die
-- mit Koordinate.
--
-- `top_replays()` bleibt unverändert: Dort geht es um die Frage, welches Replay
-- sich anzusehen lohnt, und dafür zählen nur die zeichenbaren Bögen.

drop function if exists event_arcs(bigint);

create function event_arcs(p_event_id bigint)
returns table (
  source_id     bigint,
  domain        text,
  name          text,
  country       char(2),
  ownership     text,
  -- Null, wenn kein Sitz bekannt ist. Dann zählt das Medium mit, wird aber
  -- nicht gezeichnet.
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
  order by eo.first_seen_at, s.id;
$$;

grant execute on function event_arcs(bigint) to anon, authenticated;

-- Gegenprobe: Die Zeilenzahl muss jetzt `events.outlet_count` entsprechen,
-- und ein Teil davon trägt keine Koordinate.
--
--   select count(*) as medien,
--          count(*) filter (where lat is null) as ohne_sitz
--   from event_arcs((select id from events order by outlet_count desc limit 1));
