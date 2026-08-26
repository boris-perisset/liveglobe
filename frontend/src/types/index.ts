/**
 * Die 17 Oberbegriffe der IPTC Media Topics, plus ein Auffangbecken.
 *
 * Vorher standen hier zwölf selbst erfundene Rubriken. IPTC ist der Standard,
 * mit dem Medienhäuser tatsächlich arbeiten (CC BY 4.0); die offizielle Kennung
 * je Begriff steht als `qcode` in `data/category-map.json`.
 *
 * `other` ist **kein** IPTC-Begriff, sondern das, was unter der Mindestpunktzahl
 * bleibt. Es gehört dazu, damit eine nicht zugeordnete Meldung nicht
 * verschwindet, sondern als solche sichtbar bleibt.
 */
export type CategoryId =
  | "conflict_war_peace"
  | "disaster_accident"
  | "weather"
  | "environment"
  | "crime_law"
  | "health"
  | "science_technology"
  | "education"
  | "economy_business"
  | "labour"
  | "politics"
  | "society"
  | "religion"
  | "arts_culture"
  | "sport"
  | "lifestyle_leisure"
  | "human_interest"
  | "other";

export interface CategoryDef {
  id: CategoryId;
  label: string;
  /**
   * Die **Farbfamilie**, nicht die Rubrik.
   *
   * Siebzehn unterscheidbare Farben gibt es nicht: Gegen den Massstab
   * „beliebige zwei Punkte liegen nebeneinander" bestehen auf dunklem Grund
   * nur vier Farben alle Prüfungen, acht fallen durch. Die Farbe nennt deshalb
   * die Familie, das Etikett die Rubrik — Identität hängt nie an der Farbe
   * allein.
   */
  family?: string;
  /** Offizielle IPTC-Kennung, z. B. `medtop:16000000`. Null bei `other`. */
  qcode?: string | null;
  color: string;
  /** Nur der Ingest wertet die Themenregeln aus; das Frontend braucht sie nicht. */
  strong?: string[];
  weak?: string[];
  boost?: number;
}

/**
 * Ein Punkt auf dem Globus.
 *
 * Eine Herkunft, eine Bedeutung: `event_bubbles` liefert **immer Ereignisse**,
 * auf jeder Zoomstufe — mal zu einer Zelle zusammengefasst, mal einzeln. Was
 * sich beim Zoomen ändert, ist die Zellgrösse, nicht der Gegenstand.
 *
 * `ereignisse` entscheidet, was ein Klick bedeutet: mehr als eines heisst
 * „näher heran", genau eines heisst „Panel auf".
 */
export interface Cluster {
  /** Gesetzt, wenn dieser Punkt genau ein Ereignis ist. */
  event_id?: number;
  /**
   * Gesetzt, wenn dieser Punkt eine einzelne Meldung ohne Ereigniszuordnung
   * ist. Genau eines von beiden trägt einen Wert, nie beide.
   */
  article_id?: number;
  /** Zahl der berichtenden Medien; bei einer Gruppe die weiteste darin. */
  outlets?: number;
  /** Wie viele **Orte** in diesem Punkt stecken — zur Beschriftung. */
  orte?: number;
  /** Wie viele Ereignisse in diesem Punkt stecken — das steuert den Klick. */
  ereignisse?: number;
  lat: number;
  lon: number;
  /** Anzahl Artikel in diesem Pin */
  n: number;
  country: string | null;
  location_name: string;
  top_id: number;
  top_title: string;
  top_category: CategoryId;
}

/** Ein einzelner Artikel im Teaser-Panel. */
export interface Article {
  id: number;
  url: string;
  title: string;
  teaser: string | null;
  image_url: string | null;
  category: CategoryId;
  language: string | null;
  tone: number | null;
  prominence: number;
  published_at: string;
  location_name: string;
  country: string | null;
  lat: number;
  lon: number;
  source_domain: string | null;
  source_name: string | null;
  /** -3 (far left) … 0 (center) … +3 (far right); null = nicht eingestuft */
  source_bias: number | null;
  source_ownership: OwnershipId | null;

  /**
   * Das Ereignis, an dem dieser Artikel hängt.
   *
   * Null, solange die Zuordnung nicht gelaufen ist — das Panel fällt dann auf
   * die Ortsdarstellung zurück. Die Zählwerte gelten für das ganze Ereignis,
   * nicht nur für die geladenen Artikel: Ein Ereignis kann mehr Medien haben,
   * als in diesem Umkreis und Zeitfenster sichtbar sind.
   */
  event_id: number | null;
  event_title: string | null;
  event_outlet_count: number | null;
  event_article_count: number | null;
  event_first_published_at: string | null;
  event_last_published_at: string | null;

  /**
   * Wie viele Meldungen an diesem Ort im Zeitfenster wirklich vorliegen —
   * vor der Obergrenze der Abfrage gezählt. Ohne diesen Wert würde das Panel
   * seine eigene Deckelung als Menge ausgeben.
   */
  gesamt: number | null;
}

/**
 * Ein Bogen: ein Medium, das zu einem Zeitpunkt über ein Ereignis berichtete.
 *
 * Das ist das Artefakt aus `EREIGNISMODELL.md` §3 — drei Felder, die die
 * Löschung der Artikel nach 72 Stunden überleben. Titel, Anriss und Link sind
 * dann weg; wer wann dazukam, bleibt. Deshalb lässt sich ein Ereignis vom
 * August im November noch abspielen.
 *
 * `minutes_after` ist der Abstand zum Ereignisbeginn. Damit braucht das Replay
 * keinen zweiten Aufruf für das Ereignis selbst: Der Nullpunkt der Uhr ergibt
 * sich aus dem ersten Bogen.
 */
export interface Arc {
  source_id: number;
  domain: string;
  name: string;
  country: string | null;
  ownership: OwnershipId | null;
  /**
   * Null, wenn wir den Redaktionssitz nicht kennen.
   *
   * Solche Medien werden **gezählt, aber nicht gezeichnet** — ein Bogen ins
   * Nichts wäre ein erfundener Ort. Land und Sprache stehen trotzdem da und
   * zählen mit; die Lücke selbst ist eine Aussage über unser Register und
   * gehört sichtbar ins Bild.
   */
  lat: number | null;
  lon: number | null;
  /**
   * Woher die Koordinate stammt. Ein Bogen auf einen Landesmittelpunkt ist
   * etwas anderes als einer auf eine Redaktion — wer das nicht unterscheiden
   * kann, liest Genauigkeit in die Karte hinein, die nicht da ist.
   */
  geo_quelle: string;
  /** Sprache **dieser** Meldung, nicht des Hauses (Migration 0021). */
  language: string | null;
  first_seen_at: string;
  minutes_after: number;
}

/**
 * Ein Ereignis, dessen Replay etwas zeigt.
 *
 * `arc_count` zählt die Medien **mit Koordinate** — also genau die Bögen, die
 * gezeichnet werden. `outlet_count` zählt alle. Die Differenz ist ehrlich
 * gezählt, aber nicht zeichenbar; sie steht in der Fusszeile des Replays.
 */
export interface ReplayVorschlag {
  event_id: number;
  title: string;
  location_name: string | null;
  category: CategoryId;
  lat: number;
  lon: number;
  arc_count: number;
  outlet_count: number | null;
  first_published_at: string;
  last_published_at: string;
}

/** Artikel eines Ortes, nach Ereignis gebündelt — die Form, die das Panel zeigt. */
export interface EventGroup {
  id: number | null;
  title: string | null;
  /** Ort des Ereignisses – nicht der Rasterzelle, in die es geklickt wurde. */
  locationName: string | null;
  outletCount: number;
  firstPublishedAt: string | null;
  lastPublishedAt: string | null;
  articles: Article[];
}

export type OwnershipId = "state" | "public" | "private" | "nonprofit" | "unknown";

export type TargetLang = "off" | "de" | "en";
export type UiLang = "en" | "de";

/** Ein Eintrag im Quellen-Abschnitt des Einstellungspanels. */
export interface SourceDef {
  id: string;
  name: string;
  /** active = bedienbar, planned = angekündigt, unavailable = keine Schnittstelle */
  status: "active" | "planned" | "unavailable";
  defaultOn: boolean;
  url?: string;
  note?: string;
}

export interface OwnershipDef {
  id: OwnershipId;
  label: string;
  note?: string;
}

/**
 * Dauerhafte Vorlieben – im Browser gespeichert, nicht Teil der teilbaren URL.
 *
 * `uiLang` steuert Oberfläche **und** Zielsprache der Übersetzung; ob überhaupt
 * übersetzt wird, entscheidet `translateHeadlines`. Vorher gab es dafür einen
 * Wert mit drei Zuständen (`off | de | en`) — das ging nicht mehr, sobald
 * dieselbe Wahl auch die Oberfläche bestimmt: „aus" ist keine Sprache.
 */
export interface Settings {
  connectors: Set<string>;
  ownership: Set<OwnershipId>;
  uiLang: UiLang;
  translateHeadlines: boolean;
}

export interface Filters {
  categories: Set<CategoryId>;
  /** Aktive Herkunftsströme; leer bedeutet „keine" und liefert bewusst nichts. */
  connectors: Set<string>;
  ownership: Set<OwnershipId>;
  /** Ende des Zeitfensters */
  until: Date;
  /** Fensterbreite in Stunden */
  windowHours: number;
  biasMin: number | null;
  biasMax: number | null;
}

/** Aufbau der Snapshot-Datei, die der Hostpoint-Cron erzeugt. */
export interface Snapshot {
  generated_at: string;
  /** Zoomstufe, mit der gruppiert wurde. Fehlt bei Snapshots vor 21.08.2026. */
  zoom?: number;
  from: string;
  to: string;
  clusters: Cluster[];
}
