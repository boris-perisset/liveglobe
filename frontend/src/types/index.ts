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
  themes: string[];
  query: string;
}

/** Ein aggregierter Pin auf dem Globus. */
export interface Cluster {
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
  source_ownership: "public" | "private" | "state" | "unknown" | null;
}

export interface Filters {
  categories: Set<CategoryId>;
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
  from: string;
  to: string;
  clusters: Cluster[];
}
