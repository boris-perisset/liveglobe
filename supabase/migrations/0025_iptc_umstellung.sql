-- Live Globe – IPTC Media Topics, Schritt 2 von 2: die Umstellung
--
-- **Erst ausführen, wenn 0024 durchgelaufen ist.** Sonst bricht es an
-- „unsafe use of new value" ab, und die Transaktion rollt alles zurück.
--
-- ---------------------------------------------------------------------------
-- Was sich fachlich ändert
-- ---------------------------------------------------------------------------
--
-- Die zwölf selbst erfundenen Rubriken werden durch die **oberste Ebene der
-- IPTC Media Topics** ersetzt — den Standard, mit dem Medienhäuser tatsächlich
-- arbeiten (CC BY 4.0, 17 Oberbegriffe).
--
-- Drei Zusammenlegungen fallen dabei an, und alle drei folgen dem Standard,
-- nicht dem Gefühl:
--
--   * **Friedensgespräche → Konflikt & Frieden.** IPTC führt Konflikt, Krieg
--     und Frieden unter *einem* Oberbegriff. Das ist auch sachlich richtig:
--     Ein Waffenstillstand ist kein anderes Thema als der Krieg, über den
--     verhandelt wird — er ist dessen Verlauf.
--   * **Diplomatie → Politik.** Internationale Beziehungen sind bei IPTC ein
--     Unterbegriff von Politik.
--   * **Naturkatastrophen + Unfälle → Katastrophen & Unfälle.** IPTC trennt
--     nicht nach Ursache, sondern fasst das Ereignis.
--
-- Neu hinzu kommen die sieben Begriffe, die bisher fehlten und deren Meldungen
-- vermutlich einen grossen Teil von `other` ausmachten: Wirtschaft,
-- Kriminalität/Justiz, Gesundheit, Bildung, Wissenschaft, Arbeit, Religion.
-- Dazu Gesellschaft, Lifestyle und Menschliches.
--
-- `other` bleibt — kein IPTC-Begriff, sondern das Auffangbecken unterhalb der
-- Mindestpunktzahl. Bewusst behalten, damit eine nicht zugeordnete Meldung
-- nicht verschwindet, sondern als solche sichtbar bleibt.
--
-- ---------------------------------------------------------------------------
-- Die Bestandsdaten
-- ---------------------------------------------------------------------------
--
-- Artikel leben 72 Stunden, Ereignisse acht Tage — der Bestand wäre also von
-- selbst durchgelaufen. Umgeschrieben wird trotzdem, aus einem Grund: Bis
-- dahin stünden auf der Karte Punkte mit einer Rubrik, die das Frontend nicht
-- mehr kennt, und die fielen still auf Grau. Ein paar Sekunden Arbeit gegen
-- zwei Tage stiller Fehldarstellung.

update articles set category = 'disaster_accident'  where category in ('natural_disasters','accidents');
update articles set category = 'conflict_war_peace' where category in ('conflicts','peace_talks');
update articles set category = 'politics'           where category = 'diplomacy';
update articles set category = 'environment'        where category = 'nature';
update articles set category = 'sport'              where category = 'sports';
update articles set category = 'arts_culture'       where category in ('culture','art');

update events   set category = 'disaster_accident'  where category in ('natural_disasters','accidents');
update events   set category = 'conflict_war_peace' where category in ('conflicts','peace_talks');
update events   set category = 'politics'           where category = 'diplomacy';
update events   set category = 'environment'        where category = 'nature';
update events   set category = 'sport'              where category = 'sports';
update events   set category = 'arts_culture'       where category in ('culture','art');

-- Gegenprobe: Danach darf keine dieser Rubriken mehr vorkommen.
--
--   select category, count(*) from articles group by 1 order by 2 desc;
--   select category, count(*) from events   group by 1 order by 2 desc;
--
-- Erwartung: nur noch IPTC-Begriffe und `other`. Taucht `other` deutlich
-- häufiger auf als vorher, fehlen Muster — welche Themen unzugeordnet blieben,
-- steht in `ingest_runs.unmapped_themes`.
