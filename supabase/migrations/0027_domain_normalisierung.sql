-- Live Globe – eine Regel statt einer Liste
--
-- Gemessen am 23.08. an den 40 meistberichtenden Domains ohne Sitz:
--
--   * **8 Domains, 836 Meldungen** verlieren ihren Sitz allein daran, dass der
--     Ingest Subdomains behält (`timesofindia.indiatimes.com`) und das Register
--     auf die registrierbare Domain reduziert (`indiatimes.com`). Zwei
--     Zeichenketten, kein Treffer — und statt einer Verbindung entsteht eine
--     leere Zeile ohne Namen, Land und Koordinate.
--   * **150 Registereinträge sind gar keine Domains**, sondern abgeschnittene
--     öffentliche Suffixe: `com.py`, `gov.br`, `org.za`, `co.zw`. Sie stammen
--     aus derselben Ursache von der anderen Seite — die Liste mehrteiliger
--     Endungen in `outlets-build.mjs` kennt vierzig Fälle, und die Welt hat
--     mehrere hundert. Was nicht drinsteht, wird auf zwei Bestandteile gekürzt,
--     und aus `abc.com.py` wird `com.py`. Über die Hälfte davon trägt sogar
--     einen Wikidata-Sitz.
--
-- ---------------------------------------------------------------------------
-- Die Regel
-- ---------------------------------------------------------------------------
--
-- Eine Liste, die vollständig sein muss, ist die falsche Bauart. Die Struktur
-- ist regelhaft:
--
--   **Zweistellige Länderendung + davor ein Verwaltungspräfix → drei Teile.**
--   Sonst zwei.
--
--   abc.com.py   → py ist zweistellig, com ist Präfix   → abc.com.py
--   bbc.co.uk    → uk ist zweistellig, co ist Präfix    → bbc.co.uk
--   diena.lt     → nur zwei Teile                       → diena.lt
--   example.com  → com ist nicht zweistellig            → example.com
--
-- Die Präfixe sind endlich und stabil: com co net org gov edu ac or ne go mil
-- int. Damit fallen alle 150 Phantomeinträge weg, ohne dass jemand eine Liste
-- pflegt.
--
-- Das ist nicht die Public Suffix List — die wäre genauer und brächte eine
-- Abhängigkeit samt Pflege mit. Für Nachrichtendomains trägt die Regel; wo sie
-- danebenliegt (`co.com` und Ähnliches), sind keine Medienhäuser.
--
-- ---------------------------------------------------------------------------
-- Dieselbe Regel steht an drei Stellen
-- ---------------------------------------------------------------------------
--
--   * hier, als `gn_basisdomain()`
--   * `supabase/functions/ingest/index.ts`  → `basisDomain()`
--   * `scripts/outlets-build.mjs`           → `domain()`
--
-- Drei Kopien sind eine Zumutung, aber die drei Laufzeiten teilen keinen Code
-- (Postgres, Deno, Node). Wer eine ändert, ändert alle drei — der Verweis steht
-- an jeder Stelle im Kommentar.

create or replace function gn_basisdomain(d text)
returns text language sql immutable as $$
  with t as (select string_to_array(lower(btrim(coalesce(d, ''))), '.') as p)
  select case
    when array_length(p, 1) is null or array_length(p, 1) < 2
      then lower(btrim(coalesce(d, '')))
    when array_length(p, 1) >= 3
     and length(p[array_length(p, 1)]) = 2
     and p[array_length(p, 1) - 1] in
         ('com','co','net','org','gov','edu','ac','or','ne','go','mil','int')
      then array_to_string(p[array_length(p, 1) - 2 : array_length(p, 1)], '.')
    else array_to_string(p[array_length(p, 1) - 1 : array_length(p, 1)], '.')
  end
  from t;
$$;

-- ------------------------------------------------------------ Phantomeinträge
-- Eine Zeile, deren Domain *selbst* ein öffentliches Suffix ist, kann kein
-- Medienhaus sein. Trotzdem vorsichtig: nur löschen, was nie eine Meldung
-- geliefert hat. Eine Zeile mit Artikeln wäre ein Hinweis, dass die Annahme
-- falsch ist — dann soll sie stehenbleiben und auffallen.
delete from sources s
where array_length(string_to_array(s.domain, '.'), 1) = 2
  and split_part(s.domain, '.', 1) in
      ('com','co','net','org','gov','edu','ac','or','ne','go','mil','int')
  and length(split_part(s.domain, '.', 2)) = 2
  and not exists (select 1 from articles a where a.source_id = s.id)
  and not exists (select 1 from event_outlets eo where eo.source_id = s.id);

-- ------------------------------------------------------------ Zusammenführen
--
-- Zwei Schritte, und die Reihenfolge ist der ganze Witz.
--
-- Der erste Anlauf machte das Umbenennen als **eine** mengenbasierte Anweisung
-- mit der Bedingung „nur, wenn es die Zieldomain noch nicht gibt". Sie brach ab:
--
--     duplicate key value violates unique constraint "sources_domain_key"
--     Key (domain)=(wp.pl) already exists.
--
-- `wiadomosci.wp.pl` und `sportowefakty.wp.pl` zeigen beide auf `wp.pl`, das es
-- noch nicht gab. Die Bedingung liest den Zustand **vor** der Anweisung, gilt
-- also für beide — und dann schreibt dieselbe Anweisung zweimal denselben Namen.
--
-- Die Lehre ist allgemein: Eine Bedingung, die Eindeutigkeit sichern soll, kann
-- das in einer mengenbasierten Änderung nicht, wenn die Kollision erst durch
-- die Änderung selbst entsteht. Sie muss je Zielwert **einmal** entscheiden.
--
-- Also: erst je Zieldomain genau eine überlebende Zeile bestimmen, dann alles
-- Übrige darauf umhängen.

do $$
declare
  r            record;
  umbenannt    integer := 0;
  verschmolzen integer := 0;
begin
  ------------------------------------------------------------------ Schritt 1
  -- Fehlt die Zeile für die registrierbare Domain, wird **eine** Kandidatin
  -- dazu befördert — und zwar die mit dem belastbarsten Sitz. Eine
  -- Wikidata-Koordinate ist mehr wert als eine leere Ingest-Zeile, und was hier
  -- gewinnt, trägt danach den ganzen Namensraum.
  for r in
    select gn_basisdomain(s.domain) as ziel,
           (array_agg(s.id order by
              case coalesce(s.geo_quelle::text, 'unbekannt')
                when 'handarbeit'       then 0
                when 'wikidata_sitz'    then 1
                when 'region_iso3166_2' then 2
                when 'land'             then 3
                else 4
              end,
              s.id))[1] as beste
    from sources s
    where gn_basisdomain(s.domain) <> s.domain
      and not exists (select 1 from sources z where z.domain = gn_basisdomain(s.domain))
    group by 1
  loop
    update sources set domain = r.ziel where id = r.beste;
    umbenannt := umbenannt + 1;
  end loop;

  ------------------------------------------------------------------ Schritt 2
  -- Jetzt hat jede registrierbare Domain eine Zeile. Der Rest hängt um.
  for r in
    select s.id as alt, z.id as neu
    from sources s
    join sources z on z.domain = gn_basisdomain(s.domain)
    where gn_basisdomain(s.domain) <> s.domain
    order by s.id
  loop
    -- Berichten beide über dasselbe Ereignis, gewinnt der **frühere**
    -- Erstbericht: Für die Diffusion zählt, wann die Meldung zuerst da war,
    -- nicht welche Zeile sie trug.
    update event_outlets neu
       set first_seen_at = least(neu.first_seen_at, alt.first_seen_at)
      from event_outlets alt
     where neu.source_id = r.neu
       and alt.source_id = r.alt
       and alt.event_id = neu.event_id;

    delete from event_outlets alt
     where alt.source_id = r.alt
       and exists (select 1 from event_outlets neu
                    where neu.source_id = r.neu and neu.event_id = alt.event_id);

    update event_outlets set source_id = r.neu where source_id = r.alt;
    update articles       set source_id = r.neu where source_id = r.alt;
    delete from sources where id = r.alt;
    verschmolzen := verschmolzen + 1;
  end loop;

  raise notice 'umbenannt: %, verschmolzen: %', umbenannt, verschmolzen;
end $$;

-- Outlet-Zahlen der betroffenen Ereignisse nachziehen: Wo zwei Zeilen zu einer
-- wurden, ist die Zahl jetzt kleiner — und sie muss stimmen, weil das Panel und
-- `top_replays` sie zeigen.
update events e
   set outlet_count = (select count(*) from event_outlets eo where eo.event_id = e.id)
 where e.outlet_count <> (select count(*) from event_outlets eo where eo.event_id = e.id);

-- Gegenprobe:
--   select count(*) from sources where gn_basisdomain(domain) <> domain;   -- 0
--   select count(*) from sources
--    where array_length(string_to_array(domain,'.'),1) = 2
--      and split_part(domain,'.',1) in ('com','co','net','org','gov','edu')
--      and length(split_part(domain,'.',2)) = 2;                           -- 0
