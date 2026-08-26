-- Live Globe – IPTC Media Topics, Schritt 1 von 2: die Werte
--
-- **Dieses Skript muss allein laufen, vor 0025.** Der Grund ist eine Regel von
-- PostgreSQL, die man nur einmal übersieht:
--
--     ERROR: unsafe use of new value "conflict_war_peace" of enum type category
--     HINT:  New enum values must be committed before they can be used.
--
-- Der SQL-Editor führt ein Skript als **eine** Transaktion aus. Ein in derselben
-- Transaktion hinzugefügter Aufzählungswert darf darin noch nicht verwendet
-- werden. Werte hinzufügen und Daten umschreiben geht deshalb nicht in einem
-- Zug — 0024 zuerst, dann 0025.
--
-- ---------------------------------------------------------------------------
-- Warum die alten Werte stehenbleiben
-- ---------------------------------------------------------------------------
--
-- PostgreSQL kann Werte aus einem Aufzählungstyp nicht entfernen. Sauber wäre
-- ein neuer Typ und ein Spaltenwechsel — das hiesse aber, **jede** Funktion mit
-- `category` in der Signatur zu löschen und neu anzulegen: `event_bubbles`,
-- `articles_of_event`, `article_by_id`, `articles_at_events`, `top_replays`,
-- `events_in_window`. Sechs Funktionen umbauen, um fünf tote Werte loszuwerden,
-- die nichts mehr schreibt.
--
-- Also bleiben sie stehen, dokumentiert. Ein Aufräumen kann später kommen, wenn
-- ohnehin an den Signaturen gearbeitet wird.
--
-- Behalten und weiter gültig: `politics`, `weather`, `other`.
-- Tot nach 0025: `natural_disasters`, `conflicts`, `peace_talks`, `diplomacy`,
-- `accidents`, `sports`, `culture`, `art`, `nature`.

alter type category add value if not exists 'conflict_war_peace';
alter type category add value if not exists 'disaster_accident';
alter type category add value if not exists 'environment';
alter type category add value if not exists 'crime_law';
alter type category add value if not exists 'health';
alter type category add value if not exists 'science_technology';
alter type category add value if not exists 'education';
alter type category add value if not exists 'economy_business';
alter type category add value if not exists 'labour';
alter type category add value if not exists 'society';
alter type category add value if not exists 'religion';
alter type category add value if not exists 'arts_culture';
alter type category add value if not exists 'sport';
alter type category add value if not exists 'lifestyle_leisure';
alter type category add value if not exists 'human_interest';

-- Gegenprobe für den nächsten Schritt: Nach diesem Skript müssen 27 Werte
-- dastehen (12 alte + 15 neue).
--
--   select count(*) from pg_enum e
--   join pg_type t on t.oid = e.enumtypid where t.typname = 'category';
