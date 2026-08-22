-- Anpassungen für den Wechsel von der GEO-API auf die GKG-Rohdateien.
-- Im SQL Editor ausführen; wiederholbar.

-- Welche Themencodes häufig unzugeordnet bleiben – Grundlage zum Nachjustieren
-- von data/category-map.json.
alter table ingest_runs
  add column if not exists unmapped_themes text[];

-- Die GEO-API lieferte als Prominenz die Zahl der berichtenden Quellen,
-- die GKG-Datei die Zahl der Ortsnennungen im Artikel. Beides ist ein
-- Relevanzsignal, aber die Grössenordnung ist kleiner.
comment on column articles.prominence is
  'Wie oft der gewählte Ort im Artikel genannt wird (GKG). Höher = zentraler für die Meldung.';

-- Sprache darf jetzt leer bleiben: der übersetzte Strom nennt sie nicht einheitlich.
alter table articles
  alter column language drop not null;

-- Häufige Abfrage im Abdeckungs-Monitor: Artikel je Land in den letzten 24 h.
create index if not exists articles_ingested_idx on articles (ingested_at desc);

-- Überblick über die Abdeckung – nützlich für das spätere Admin-UI.
create or replace view v_coverage_24h as
select
  coalesce(l.country, 'ZZ') as country,
  count(*)                  as articles,
  count(distinct l.id)      as locations,
  count(distinct a.category) as categories,
  max(a.published_at)       as newest
from articles a
join locations l on l.id = a.location_id
where a.published_at > now() - interval '24 hours'
group by 1
order by 2 desc;
