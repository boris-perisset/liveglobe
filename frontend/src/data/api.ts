import type { Article, Cluster, EventGroup, Filters, Snapshot } from "../types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const SNAPSHOT_URL = (import.meta.env.VITE_SNAPSHOT_URL as string | undefined) ?? "./data/latest.json";

/**
 * Zweistufige Datenbeschaffung:
 *
 *  1. Der Standardfall („letzte 24 h, alle Rubriken") kommt aus einer statischen
 *     Snapshot-Datei auf dem eigenen Server. Kostet Supabase kein Egress und lädt sofort.
 *  2. Alles andere – Zeitreisen, Bias-Filter, Detailabfragen – geht live an PostgREST.
 */
/**
 * Zoomstufe, mit der der Snapshot gruppiert wurde.
 *
 * `snapshot.php` ruft `articles_clustered` mit *einer* festen Stufe auf
 * (Vorgabe 3). Neuere Snapshots schreiben sie selbst mit; bis die überall
 * liegen, gilt dieser Wert.
 */
const SNAPSHOT_ZOOM_VORGABE = Number(import.meta.env.VITE_SNAPSHOT_ZOOM ?? 3);
let snapshotZoom = SNAPSHOT_ZOOM_VORGABE;

/**
 * Taugt der vorgefertigte Snapshot für diese Ansicht?
 *
 * Neben den Filtern entscheidet das die **Zoomstufe** — und daran hat es
 * gefehlt. Der Snapshot ist mit einer einzigen Rasterweite gebaut. Wurde er
 * unabhängig vom Zoom ausgeliefert, blieb die Gruppierung beim Hineinzoomen
 * stehen: Die Bubbles wurden nie feiner, egal wie nah man heranging.
 *
 * `articles_clustered` rundet den Zoom, bevor es die Rasterweite bestimmt.
 * Deshalb wird hier ebenfalls gerundet verglichen: Solange die gerundete Stufe
 * die des Snapshots nicht übersteigt, liefert er exakt dasselbe wie eine
 * Live-Abfrage — darüber nicht mehr, und dann muss live gerechnet werden.
 *
 * Der Handel bleibt damit richtig herum: Die Startansicht, die *jeder* Besuch
 * lädt, kommt weiter vom eigenen Server. Nur wer wirklich hineinzoomt, fragt
 * Supabase — und das sind wenige.
 */
export function isDefaultView(
  f: Filters,
  alleQuellen: number,
  alleTraeger: number,
  zoom: number,
): boolean {
  const isNow = Math.abs(f.until.getTime() - Date.now()) < 20 * 60 * 1000;
  // Sobald Quellen oder Trägerschaft eingeschränkt sind, taugt der vorgefertigte
  // Snapshot nicht mehr – dann muss live gefiltert werden.
  const ungefiltert = f.connectors.size >= alleQuellen && f.ownership.size >= alleTraeger;
  const grobGenug = Math.round(zoom) <= Math.round(snapshotZoom);
  return isNow && grobGenug && f.windowHours === 24 &&
    f.biasMin === null && f.biasMax === null && ungefiltert;
}

async function supabaseRpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Live-Abfragen brauchen VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY (siehe .env.example).",
    );
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase ${fn}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let snapshotCache: { at: number; data: Snapshot } | null = null;

/** Lädt eine Snapshot-Datei. `demo` schaltet auf die mitgelieferten Beispieldaten um. */
async function loadSnapshot(demo = false): Promise<Snapshot> {
  const src = demo ? "./data/latest.demo.json" : SNAPSHOT_URL;
  if (snapshotCache && Date.now() - snapshotCache.at < 60_000) return snapshotCache.data;

  const res = await fetch(src, { cache: "no-cache" }).catch(() => null);
  if (!res?.ok) throw new Error(`Snapshot nicht ladbar (${res?.status ?? "offline"})`);

  const data = (await res.json()) as Snapshot;
  // Der Snapshot sagt selbst, mit welcher Rasterweite er gebaut wurde. Ältere
  // Dateien tun das noch nicht — dann bleibt es bei der Vorgabe.
  if (typeof data.zoom === "number") snapshotZoom = data.zoom;
  snapshotCache = { at: Date.now(), data };
  return data;
}

/**
 * Rangfolge der Quellen:
 *   1. statischer Snapshot vom eigenen Server  – schnell, kostet Supabase nichts
 *   2. Supabase live                            – sobald konfiguriert
 *   3. mitgelieferte Demodaten                  – nur ohne beides, fürs Entwickeln
 */
/**
 * Ab dieser Zoomstufe zeigt die Karte einzelne Ereignisse statt Rasterzellen.
 *
 * Die Stufe ist gerechnet, nicht gewählt. `articles_clustered` bestimmt die
 * Rasterweite als `greatest(0.05, 20 / 2^zoom)` — bei `20/2^z = 0.05` ist
 * `z = log2(400) ≈ 8.64`. **Ab dort schrumpft die Zelle nicht mehr.** Wer
 * weiter hineinzoomt, bekommt dieselbe Gruppierung wie zuvor; das Entclustern
 * ist am Ende angelangt.
 *
 * Genau dort — und keinen Schritt früher — übernehmen die Ereignisse. Darüber
 * bleibt alles bei der bewährten Rastergruppierung: dieselbe Bedienung, dieselbe
 * Stabilität beim Schwenken, und der vorgefertigte Snapshot trägt weiter die
 * Startansicht.
 *
 * Ein früherer Wechsel (der Versuch mit 5) machte die Handhabung schlechter:
 * Jedes Schwenken holte neue Ereignisse aus dem sichtbaren Ausschnitt, die
 * Punkte sprangen, und statt weniger aussagekräftiger Zellen lag ein Teppich
 * aus Einzelmeldungen auf der Karte.
 */
const EREIGNIS_ZOOM = 9;

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export async function fetchClusters(
  f: Filters,
  zoom: number,
  alleQuellen: number,
  alleTraeger: number,
  bounds?: Bounds,
): Promise<Cluster[]> {
  const from = new Date(f.until.getTime() - f.windowHours * 3600_000);

  if (f.connectors.size === 0) return [];

  // Nah dran: ein Punkt je Ereignis. Zwei Ereignisse am selben Ort bleiben zwei
  // Zeilen — das Auffächern besorgt die Karte.
  if (hasSupabase && bounds && Math.round(zoom) >= EREIGNIS_ZOOM) {
    try {
      const rows = await supabaseRpc<EreignisZeile[]>("events_in_bounds", {
        p_from: from.toISOString(),
        p_to: f.until.toISOString(),
        p_categories: f.categories.size ? [...f.categories] : null,
        p_west: bounds.west,
        p_south: bounds.south,
        p_east: bounds.east,
        p_north: bounds.north,
        p_limit: 1200,
      });
      return rows.map((e) => ({
        event_id: e.id,
        lat: e.lat,
        lon: e.lon,
        n: e.n,
        outlets: e.outlets,
        country: e.country,
        location_name: e.location_name || "Unbekannter Ort",
        top_id: e.id,
        top_title: e.title,
        top_category: e.category,
      }));
    } catch (err) {
      // Fehlt die Funktion (Migration 0012 noch nicht eingespielt), geht es
      // unten mit der Artikelgruppierung weiter. Lieber gröber als leer.
      console.warn("events_in_bounds nicht verfügbar:", err);
    }
  }

  if (isDefaultView(f, alleQuellen, alleTraeger, zoom)) {
    try {
      const snap = await loadSnapshot();
      return filterClustersLocally(snap.clusters, f);
    } catch {
      // Kein Snapshot – im Dev-Betrieb der Normalfall. Weiter unten geht es live weiter.
    }
  }

  if (!hasSupabase) {
    const snap = await loadSnapshot(true);
    return filterClustersLocally(snap.clusters, f);
  }

  return supabaseRpc<Cluster[]>("articles_clustered", {
    p_from: from.toISOString(),
    p_to: f.until.toISOString(),
    p_categories: f.categories.size ? [...f.categories] : null,
    p_bias_min: f.biasMin,
    p_bias_max: f.biasMax,
    p_zoom: Math.round(zoom),
    p_ownership: f.ownership.size >= alleTraeger ? null : [...f.ownership],
    p_connectors: f.connectors.size >= alleQuellen ? null : [...f.connectors],
  });
}

interface EreignisZeile {
  id: number;
  lat: number;
  lon: number;
  n: number;
  outlets: number;
  country: string | null;
  location_name: string;
  title: string;
  category: Cluster["top_category"];
}

/** Alle Meldungen genau eines Ereignisses — für den Klick auf eine Ereignis-Bubble. */
export async function fetchArticlesOfEvent(eventId: number): Promise<Article[]> {
  return supabaseRpc<Article[]>("articles_of_event", { p_event_id: eventId });
}

/** Der Snapshot enthält alle Rubriken; die Rubrikauswahl filtern wir im Browser. */
function filterClustersLocally(clusters: Cluster[], f: Filters): Cluster[] {
  if (!f.categories.size) return clusters;
  return clusters.filter((c) => f.categories.has(c.top_category));
}

/**
 * Suchradius für die Detailabfrage, abgeleitet aus der Zoomstufe.
 *
 * Die Cluster-Funktion fasst serverseitig in einem Raster zusammen, dessen
 * Weite mit dem Zoom wächst. Der Pin sitzt im Schwerpunkt seiner Zelle und kann
 * damit hunderte Kilometer von den einzelnen Meldungen entfernt liegen. Ein
 * fester Radius findet aus der Ferne deshalb nichts — er muss demselben Raster
 * folgen wie die Zusammenfassung.
 */
export function radiusForZoom(zoom: number): number {
  const zelleGrad = Math.max(0.05, 20 / Math.pow(2, Math.max(zoom, 0)));
  const meter = zelleGrad * 111_320 * 0.8;
  return Math.round(Math.min(900_000, Math.max(20_000, meter)));
}

export async function fetchArticlesAt(
  lat: number,
  lon: number,
  f: Filters,
  radiusM = 25000,
): Promise<Article[]> {
  const from = new Date(f.until.getTime() - f.windowHours * 3600_000);

  // Ohne Supabase-Zugangsdaten (lokale Entwicklung) zeigen wir Beispielmeldungen,
  // damit die Oberfläche vollständig bedienbar bleibt.
  if (!hasSupabase) {
    return demoArticlesAt(lat, lon);
  }

  // `articles_at_events` liefert dieselben Artikel wie `articles_at`, dazu das
  // Ereignis. Fehlt die Funktion — etwa weil Migration 0010 noch nicht
  // eingespielt ist — greift die alte Abfrage. Ohne diesen Rückfall stünde das
  // Panel bei einer halb aktualisierten Datenbank leer da.
  const rumpf = {
    p_lat: lat,
    p_lon: lon,
    p_radius_m: radiusM,
    p_from: from.toISOString(),
    p_to: f.until.toISOString(),
    p_ownership: [...f.ownership],
    p_connectors: [...f.connectors],
  };
  try {
    return await supabaseRpc<Article[]>("articles_at_events", rumpf);
  } catch (e) {
    console.warn("articles_at_events nicht verfügbar, weiche auf articles_at aus:", e);
    return supabaseRpc<Article[]>("articles_at", rumpf);
  }
}

/**
 * Artikel nach Ereignis bündeln.
 *
 * Die Reihenfolge kommt aus der Datenbank (reichweitenstärkstes Ereignis
 * zuerst, innerhalb davon chronologisch) und wird hier nur beibehalten — eine
 * `Map` merkt sich die Einfügereihenfolge.
 *
 * Artikel ohne Ereignis landen in einer Gruppe mit `id: null`. Das ist kein
 * Sonderfall, sondern der Normalzustand, solange die Zuordnung nicht läuft.
 */
export function gruppiereNachEreignis(articles: Article[]): EventGroup[] {
  const gruppen = new Map<number | string, EventGroup>();
  for (const a of articles) {
    const key = a.event_id ?? "ohne";
    let g = gruppen.get(key);
    if (!g) {
      g = {
        id: a.event_id ?? null,
        title: a.event_title ?? null,
        // Ein Ereignis hat genau einen Ort; der erste Artikel nennt ihn. Die
        // Rasterzelle, in die geklickt wurde, kann ganz woanders liegen.
        locationName: a.location_name ?? null,
        // Der Zählwert des Ereignisses gilt für alle Medien, auch die ausserhalb
        // dieses Umkreises. Fehlt er, zählen wir die geladenen Quellen selbst.
        outletCount: a.event_outlet_count ?? 0,
        firstPublishedAt: a.event_first_published_at ?? null,
        lastPublishedAt: a.event_last_published_at ?? null,
        articles: [],
      };
      gruppen.set(key, g);
    }
    g.articles.push(a);
  }
  for (const g of gruppen.values()) {
    if (!g.outletCount) {
      g.outletCount = new Set(g.articles.map((a) => a.source_domain ?? a.id)).size;
    }
  }
  return [...gruppen.values()];
}

/** Nur für die Demodaten: baut plausible Meldungen aus dem Snapshot-Cluster. */
async function demoArticlesAt(lat: number, lon: number): Promise<Article[]> {
  const snap = await loadSnapshot(true);
  const near = snap.clusters
    .map((c) => ({ c, d: Math.hypot(c.lat - lat, c.lon - lon) }))
    .filter((x) => x.d < 2)
    .sort((a, b) => a.d - b.d)
    .slice(0, 4);

  const demoSources = [
    { name: "Reuters", domain: "reuters.com", bias: 0, ownership: "private" as const },
    { name: "BBC News", domain: "bbc.com", bias: 0, ownership: "public" as const },
    { name: "The Guardian", domain: "theguardian.com", bias: -2, ownership: "private" as const },
    { name: "Lokalzeitung", domain: "example.org", bias: null, ownership: "unknown" as const },
  ];

  return near.map(({ c }, i) => {
    const s = demoSources[i % demoSources.length];
    return {
      id: c.top_id,
      url: "https://www.gdeltproject.org/",
      title: c.top_title,
      teaser:
        "Beispieltext: Sobald Supabase verbunden ist, steht hier der echte Anriss der Meldung " +
        "mit Ort und Zeitpunkt. Der Klick führt immer zur Originalquelle.",
      image_url: null,
      category: c.top_category,
      language: "deu",
      tone: null,
      prominence: c.n,
      published_at: new Date(Date.now() - (i + 1) * 47 * 60_000).toISOString(),
      location_name: c.location_name,
      country: c.country,
      lat: c.lat,
      lon: c.lon,
      source_domain: s.domain,
      source_name: s.name,
      source_bias: s.bias,
      source_ownership: s.ownership,
      gesamt: null,
      // Demodaten kennen keine Ereignisse — das Panel zeigt dann die Ortsform.
      event_id: null,
      event_title: null,
      event_outlet_count: null,
      event_article_count: null,
      event_first_published_at: null,
      event_last_published_at: null,
    };
  });
}
