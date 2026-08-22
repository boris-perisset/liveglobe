export type CategoryId =
  | "natural_disasters"
  | "conflicts"
  | "peace_talks"
  | "politics"
  | "diplomacy"
  | "accidents"
  | "sports"
  | "culture"
  | "art"
  | "weather"
  | "nature"
  | "other";

export interface CategoryDef {
  id: CategoryId;
  label: string;
  color: string;
  /** Nur der Ingest wertet die Themenregeln aus; das Frontend braucht sie nicht. */
  strong?: string[];
  weak?: string[];
  boost?: number;
}

/**
 * Ein Punkt auf dem Globus.
 *
 * Zwei Herkünfte, dieselbe Form: In der weiten Ansicht eine Rasterzelle aus
 * `articles_clustered`, beim Hineinzoomen ein einzelnes Ereignis aus
 * `events_in_bounds`. Nur im zweiten Fall ist `event_id` gesetzt — daran
 * erkennt der Klick, ob er einem Umkreis oder einem Geschehen gilt.
 */
export interface Cluster {
  /** Gesetzt, wenn dieser Punkt genau ein Ereignis ist. */
  event_id?: number;
  /** Zahl der berichtenden Medien; nur bei Ereignissen bekannt. */
  outlets?: number;
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

/** Dauerhafte Vorlieben – im Browser gespeichert, nicht Teil der teilbaren URL. */
export interface Settings {
  connectors: Set<string>;
  ownership: Set<OwnershipId>;
  language: TargetLang;
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
