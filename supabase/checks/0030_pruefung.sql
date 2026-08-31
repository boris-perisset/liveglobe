-- =====================================================================
-- 0030 · Prüfung
--
-- Ablage:  supabase/checks/0030_pruefung.sql
--          NICHT nach supabase/migrations/ — sonst läuft der Prüfteil
--          als Teil der Migration mit.
--
-- Nach dem Einspielen von 0030 ausführen. Jede explain-Abfrage zweimal,
-- den ersten Lauf verwerfen (kalter Cache), Median nehmen.
-- =====================================================================


-- ---------------------------------------------------------------------
-- P0 · Liegt der Index überhaupt? Ohne ihn ist alles Weitere sinnlos,
--      und P1 würde einen Planer beschuldigen, der nichts dafür kann.
--
-- Erwartet: genau eine Zeile, indexdef enthält „(geom)::geometry".
-- ---------------------------------------------------------------------
select indexname, indexdef
from pg_indexes
where tablename = 'locations'
  and indexname = 'locations_geom_geometry_idx';


-- ---------------------------------------------------------------------
-- P1 · Kleine Box: der Plan muss jetzt über locations einsteigen.
--
-- Erwartet:  Index Scan oder Bitmap Index Scan using
--            locations_geom_geometry_idx
-- Verboten:  "Seq Scan on locations" oder ein Filter mit st_intersects
-- Vergleich: vor 0030 waren es 36'356 Blockzugriffe für 189 Zeilen
-- ---------------------------------------------------------------------
explain (analyze, buffers)
select * from event_bubbles(now() - interval '24 hours', now(), null, 9,
                            34.2, 31.3, 34.6, 31.6);


-- ---------------------------------------------------------------------
-- P2 · Weltbox: die Startansicht darf sich NICHT verändern.
--
-- Der Weg dorthin darf ein anderer sein — das Ergebnis nicht.
-- Hier ist der Einstieg über published_at weiterhin der richtige.
-- ---------------------------------------------------------------------
explain (analyze, buffers)
select * from event_bubbles(now() - interval '24 hours', now(), null, 1);


-- ---------------------------------------------------------------------
-- P3 · Datumsgrenze
--
-- Beide Zahlen müssen gleich sein. Vor 0030 hätte die linke ungefähr
-- die halbe Welt gezählt statt des Pazifiks — wer die Migration schon
-- eingespielt hat, kann das nicht mehr nachstellen.
-- ---------------------------------------------------------------------
select
  (select count(*) from event_bubbles(now() - interval '24 hours', now(), null, 4,
                                      170, -25, -170, 5))   as ueber_der_grenze,
  (select count(*) from event_bubbles(now() - interval '24 hours', now(), null, 4,
                                      170, -25, 180, 5))
+ (select count(*) from event_bubbles(now() - interval '24 hours', now(), null, 4,
                                      -180, -25, -170, 5))  as zweiteilig_von_hand;


-- ---------------------------------------------------------------------
-- P4 · Nicht normalisierte Längengrade, wie MapLibre sie beim Schwenken
--      über die Datumsgrenze liefert. Alle drei müssen gleich sein.
-- ---------------------------------------------------------------------
select
  (select count(*) from event_bubbles(now() - interval '24 hours', now(), null, 4,
                                      170, -25, 190, 5))    as west170_ost190,
  (select count(*) from event_bubbles(now() - interval '24 hours', now(), null, 4,
                                      -190, -25, -170, 5))  as west_minus190,
  (select count(*) from event_bubbles(now() - interval '24 hours', now(), null, 4,
                                      170, -25, -170, 5))   as normalisiert;


-- ---------------------------------------------------------------------
-- P5 · Weltbox in drei Schreibweisen. Alle drei müssen gleich sein.
--      Die dritte prüft, dass eine überdrehte Spanne nicht in der
--      Normalisierung zusammenklappt.
-- ---------------------------------------------------------------------
select
  (select count(*) from event_bubbles(now() - interval '24 hours', now(), null, 2))
    as default_box,
  (select count(*) from event_bubbles(now() - interval '24 hours', now(), null, 2,
                                      -180, -90, 180, 90))  as explizit,
  (select count(*) from event_bubbles(now() - interval '24 hours', now(), null, 2,
                                      -200, -90, 200, 90))  as ueberdreht;


-- ---------------------------------------------------------------------
-- P6 · Zoomstufen — NUR DIE FORM, NICHT DIE ZAHLEN.
--
-- ACHTUNG: Die Werte 1082 / 233 / 231 / 1 / 1 aus STAND.md wurden am
-- 23.08.2026 gemessen. Die Abfrage fragt `now() - interval '24 hours'` —
-- an einem anderen Tag stehen dort andere Artikel, und die Zahlen weichen
-- ab, ohne dass irgendetwas kaputt wäre. Am 31.08. kamen
-- 723 / 150 / 150 / 1 / 1: gleichmässig weniger, gleiche Form.
--
-- Als Regressionstest taugt P6 deshalb NICHT. Dafür ist
-- `0030_ab_vergleich.sql` da: beide Fassungen, dieselben Daten,
-- Erwartung ist eine Null statt einer Zahl aus einem Notizbuch.
--
-- Was P6 weiterhin belegt, und zwar tagesunabhängig:
--   · z = 9 und z = 12 sind **exakt 1** — die Invariante aus 0022,
--     auf der Ortsstufe zerfällt jede Zelle in ihre Ereignisse
--   · z = 6 und z = 8 liegen dicht beieinander
--   · die Reihe fällt monoton
-- ---------------------------------------------------------------------
select 1 as zoom, max(ereignisse) as groesste_bubble
from event_bubbles(now() - interval '24 hours', now(), null, 1)
union all select 6,  max(ereignisse) from event_bubbles(now() - interval '24 hours', now(), null, 6)
union all select 8,  max(ereignisse) from event_bubbles(now() - interval '24 hours', now(), null, 8)
union all select 9,  max(ereignisse) from event_bubbles(now() - interval '24 hours', now(), null, 9)
union all select 12, max(ereignisse) from event_bubbles(now() - interval '24 hours', now(), null, 12)
order by 1;


-- ---------------------------------------------------------------------
-- P7 · Als anon gegenprüfen. In 0007/0008 sind hier schon einmal
--      Rechte verlorengegangen, ohne dass es jemand bemerkt hat.
-- ---------------------------------------------------------------------
set role anon;
select count(*) from event_bubbles(now() - interval '24 hours', now(), null, 1);
reset role;


-- ---------------------------------------------------------------------
-- P8 · Der Pol-Fall. **Das ist die Prüfung, die den ersten Entwurf
--      umgeworfen hat** — sie fehlte, und deshalb fiel der Fehler erst
--      beim Ausführen auf statt beim Lesen.
--
-- Ein Rechteck von -90 bis 90 Grad Breite hat eine Kante vom Südpol zum
-- Nordpol. Als geography sind das zwei antipodale Punkte ohne kürzesten
-- Weg dazwischen:
--
--     XX000: Antipodal (180 degrees long) edge detected!
--
-- Als geometry ist es ein gewöhnliches Rechteck. Alle vier Zahlen müssen
-- kommen, und alle vier müssen gleich sein — die Startansicht der Karte
-- schickt genau solche Werte, geklammert in map.ts auf [-90, 90].
-- ---------------------------------------------------------------------
select
  (select count(*) from event_bubbles(now() - interval '24 hours', now(), null, 2,
                                      -180, -90, 180, 90))  as pol_zu_pol,
  (select count(*) from event_bubbles(now() - interval '24 hours', now(), null, 2,
                                      -180, -89.9, 180, 89.9)) as knapp_darunter,
  (select count(*) from event_bubbles(now() - interval '24 hours', now(), null, 2,
                                      -180, -95, 180, 95))  as ueber_den_pol_hinaus,
  (select count(*) from event_bubbles(now() - interval '24 hours', now(), null, 2))
                                                            as default_box;
