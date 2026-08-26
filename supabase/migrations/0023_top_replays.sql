-- Live Globe – die drei Ereignisse, deren Replay etwas zeigt
--
-- Bis hier musste man ein sehenswertes Replay durch Zufall finden: hineinzoomen,
-- ein Ereignis anklicken, hoffen, dass genug Medien verortet sind. Die meisten
-- sind es nicht — `event_arcs()` malt nur Outlets mit Koordinate, und das ist
-- richtig so (ein Bogen ins Nichts wäre ein erfundener Ort), macht die Suche
-- aber zur Glückssache.
--
-- Diese Funktion beantwortet die Frage direkt: **Welche Ereignisse dieses
-- Zeitfensters haben die weiteste belegbare Verbreitung?**
--
-- ---------------------------------------------------------------------------
-- Gezählt wird, was gezeichnet werden kann
-- ---------------------------------------------------------------------------
--
-- Nicht `events.outlet_count` — der zählt alle berichtenden Medien, auch die
-- ohne Sitz. Ein Ereignis mit „9 Medien" kann zwei Bögen ergeben. Gezählt wird
-- deshalb dieselbe Menge, die `event_arcs()` später zeichnet:
--
--     join sources s on s.id = eo.source_id  and  s.home_geom is not null
--
-- Damit stimmt die Zahl in der Leiste mit dem überein, was danach zu sehen ist.
-- Beides auseinanderlaufen zu lassen wäre genau die Sorte kleiner Unwahrheit,
-- die dieses Werkzeug nicht vertragen kann.
--
-- Untergrenze drei: Zwei Bögen sind ein Strich mit Abzweigung, keine
-- Verbreitung. Wer weniger hat, gehört nicht in eine Liste, die „das lohnt
-- sich" behauptet.
--
-- ---------------------------------------------------------------------------
-- Zeitfenster
-- ---------------------------------------------------------------------------
--
-- Ein Ereignis liegt im Fenster, wenn es sich mit ihm **überschneidet**, nicht
-- wenn es darin begonnen hat. Ein Ereignis von gestern Abend, über das heute
-- früh noch berichtet wurde, gehört dazu — seine Diffusion ist ja gerade das,
-- was das Replay zeigt.
--
-- Rubriken werden gefiltert, Quellen und Trägerschaft nicht: Die sitzen an
-- Artikeln, ein Ereignis spannt über viele Medien, und „zeige nur
-- öffentlich-rechtliche Ereignisse" hat keine eindeutige Bedeutung. Bewusst
-- offen gelassen statt eine Antwort erfunden.

create or replace function top_replays(
  p_from       timestamptz,
  p_to         timestamptz,
  p_categories text[]  default null,
  p_min_arcs   integer default 3,
  p_limit      integer default 3
)
returns table (
  event_id           bigint,
  title              text,
  location_name      text,
  category           category,
  lat                double precision,
  lon                double precision,
  -- Zahl der Medien **mit Koordinate** — also der Bögen, die das Replay
  -- tatsächlich zeichnen wird.
  arc_count          integer,
  -- Zahl aller berichtenden Medien. Die Differenz ist ehrlich gezählt, aber
  -- nicht zeichenbar; das Replay nennt sie in seiner Fusszeile.
  outlet_count       integer,
  first_published_at timestamptz,
  last_published_at  timestamptz
)
language sql stable as $$
  select e.id, e.title, e.location_name, e.category,
         st_y(e.geom::geometry), st_x(e.geom::geometry),
         count(*)::integer,
         e.outlet_count,
         e.first_published_at, e.last_published_at
  from events e
  join event_outlets eo on eo.event_id = e.id
  join sources      s  on s.id = eo.source_id
  where e.last_published_at  >= p_from
    and e.first_published_at <= p_to
    and (p_categories is null or e.category::text = any(p_categories))
    and s.home_geom is not null
  group by e.id
  having count(*) >= greatest(p_min_arcs, 2)
  -- Bei gleicher Bogenzahl gewinnt das jüngere: Die Leiste soll zeigen, was
  -- gerade läuft, nicht was gestern am weitesten kam.
  order by count(*) desc, e.last_published_at desc
  limit p_limit;
$$;

grant execute on function top_replays(
  timestamptz, timestamptz, text[], integer, integer
) to anon, authenticated;
