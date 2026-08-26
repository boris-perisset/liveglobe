-- Live Globe – Warum zerfällt der Erdrutsch von Conakry in viele Ereignisse?
--
-- Diese Datei ändert nichts. Sie misst.
--
-- Der Reihe nach ausführen und die Ergebnisse zurückmelden. Erst danach wird an
-- `match_config` oder `match_events()` gedreht — jede Stellschraube, die ohne
-- diese Zahlen bewegt wird, ist geraten.
--
-- Ersetze bei Bedarf den Mittelpunkt: Conakry liegt bei 9.5092 N / 13.7122 W.

-- ---------------------------------------------------------------------------
-- 1 · Die Bruchstücke
-- ---------------------------------------------------------------------------
-- Frage: Staffeln sich die Ereignisse nach Ort (dann ist der Ort der Täter)
-- oder liegen sie alle übereinander (dann ist es Rubrik und Text)?
--
-- `meter_vom_zentrum` und `rubrik` sind die beiden Spalten, auf die es ankommt.

with mitte as (select st_point(-13.7122, 9.5092)::geography as g)
select e.id,
       e.category                                   as rubrik,
       left(e.title, 72)                            as titel,
       e.article_count                              as artikel,
       e.outlet_count                               as medien,
       to_char(e.first_published_at, 'DD.MM HH24:MI') as erste,
       to_char(e.last_published_at,  'DD.MM HH24:MI') as letzte,
       round(st_distance(e.geom, m.g))              as meter_vom_zentrum,
       cardinality(e.tokens)                        as n_tokens,
       cardinality(e.names)                         as n_namen
from events e, mitte m
where st_dwithin(e.geom, m.g, 60000)
  and e.last_published_at > now() - interval '72 hours'
order by e.article_count desc, e.first_published_at;

-- ---------------------------------------------------------------------------
-- 2 · Woran ist es gescheitert?
-- ---------------------------------------------------------------------------
-- Nimmt das grösste Bruchstück als Anker und rechnet für jedes andere genau
-- das aus, was `match_events()` gerechnet hätte. Die letzte Spalte nennt das
-- Tor, an dem die Zuordnung hängengeblieben ist.
--
-- Das ist die entscheidende Abfrage. Sie beweist die Ursache, statt sie zu
-- vermuten.

with k as (select * from match_config where id),
     mitte as (select st_point(-13.7122, 9.5092)::geography as g),
     kern as (
       select e.* from events e, mitte m
       where st_dwithin(e.geom, m.g, 60000)
         and e.last_published_at > now() - interval '72 hours'
     ),
     anker as (
       select * from kern order by article_count desc, outlet_count desc, id limit 1
     ),
     paar as (
       select b.id, b.category, left(b.title, 60) as titel, b.article_count,
              a.category as anker_rubrik,
              abs(extract(epoch from (b.first_published_at - a.last_published_at))) / 3600.0 as std,
              st_distance(a.geom, b.geom) as meter,
              gn_overlap(b.tokens, a.tokens) as tok,
              gn_overlap(b.names,  a.names)  as nam,
              gn_shared (b.names,  a.names)  as namen_gemeinsam,
              cardinality(a.names) as namen_anker,
              cardinality(b.names) as namen_b,
              k.gewicht_zeit, k.gewicht_ort, k.gewicht_token, k.gewicht_name,
              k.max_stunden, k.max_meter, k.voll_meter,
              k.mindest_token, k.mindest_namen, k.stark_namen, k.schwelle
       from anker a cross join kern b cross join k
       where b.id <> a.id
     )
select id, category as rubrik, titel, article_count as artikel,
       round(std::numeric, 1)   as delta_std,
       round(meter)             as meter,
       round(tok::numeric, 2)   as tok,
       namen_gemeinsam,
       namen_anker, namen_b,
       round(nam::numeric, 2)   as nam,
       round(( gewicht_zeit  * greatest(0, 1 - std / max_stunden)
             + gewicht_ort   * greatest(0, least(1, 1 - (meter - voll_meter) / nullif(max_meter - voll_meter, 0)))
             + gewicht_token * tok
             + gewicht_name  * nam )::numeric, 3) as score,
       schwelle,
       case
         when rubrik_verschieden          then '1 Rubrik'
         when std > max_stunden           then '2 Zeitfenster'
         when meter > max_meter           then '3 Umkreis'
         when kein_textbeleg              then '4 Textbeleg'
         when score_roh < schwelle
          and not stark                   then '5 Schwelle'
         else                                  '– hätte gepasst'
       end as gescheitert_an
from (
  select paar.*,
         (category is distinct from anker_rubrik) as rubrik_verschieden,
         (tok < mindest_token and namen_gemeinsam < mindest_namen) as kein_textbeleg,
         (namen_gemeinsam >= stark_namen and meter <= voll_meter)  as stark,
         ( gewicht_zeit  * greatest(0, 1 - std / max_stunden)
         + gewicht_ort   * greatest(0, least(1, 1 - (meter - voll_meter) / nullif(max_meter - voll_meter, 0)))
         + gewicht_token * tok
         + gewicht_name  * nam ) as score_roh
  from paar
) x
order by score desc;

-- ---------------------------------------------------------------------------
-- 3 · Wie viele Rubriken sind im Spiel?
-- ---------------------------------------------------------------------------
-- `e.category = a.category` ist ein hartes Tor. Stehen hier mehrere Zeilen, ist
-- bewiesen: diese Bruchstücke können nie zusammenfinden, ganz gleich wie ähnlich
-- ihre Texte sind.
--
-- Nebenbei die Gegenprobe auf den Rollout: Erscheinen alte Rubriknamen
-- (`natural_disasters`, `accidents`, …), läuft die Edge Function noch mit dem
-- Stand vor 0024/0025.

with mitte as (select st_point(-13.7122, 9.5092)::geography as g)
select e.category as rubrik, count(*) as ereignisse, sum(e.article_count) as artikel
from events e, mitte m
where st_dwithin(e.geom, m.g, 60000)
  and e.last_published_at > now() - interval '72 hours'
group by 1 order by 3 desc;

-- ---------------------------------------------------------------------------
-- 4 · Wie dicht sind die Namenslisten?
-- ---------------------------------------------------------------------------
-- `gn_overlap` teilt die Zahl gemeinsamer Namen durch die *kürzere* Liste.
-- Je mehr Eigennamen GDELT liefert, desto kleiner der Wert bei gleicher Zahl
-- von Treffern. Diese Abfrage zeigt, in welchem Bereich sich das abspielt.

select cardinality(names) as n_namen, count(*) as ereignisse
from events
where last_published_at > now() - interval '72 hours'
group by 1 order by 1;
