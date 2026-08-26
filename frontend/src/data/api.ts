import type { Arc, Article, Cluster, EventGroup, Filters, ReplayVorschlag, Snapshot } from "../types";

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
 * Die Karte zeigt auf **jeder** Zoomstufe Ereignisse.
 *
 * Vorher gab es zwei Gegenstände: Ortscluster beim Zoomen und Ereigniscluster
 * nach einem Klick. Damit wechselte die Karte den Modus, und beim Schliessen
 * des Panels kam die Umgebung nicht von selbst zurück.
 *
 * `event_bubbles` verdichtet Ereignisse zuerst je Ort und rastert dann — die
 * räumliche Hierarchie trägt also weiter, obwohl nur noch Ereignisse gezählt
 * werden. Was sich beim Zoomen ändert, ist die Zellgrösse, nicht die Bedeutung
 * eines Punktes.
 */
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

  if (hasSupabase && bounds) {
    try {
      const rows = await supabaseRpc<BubbleZeile[]>("event_bubbles", {
        p_from: from.toISOString(),
        p_to: f.until.toISOString(),
        p_categories: f.categories.size ? [...f.categories] : null,
        p_zoom: Math.round(zoom),
        p_west: bounds.west,
        p_south: bounds.south,
        p_east: bounds.east,
        p_north: bounds.north,
        p_ownership: f.ownership.size >= alleTraeger ? null : [...f.ownership],
        p_connectors: f.connectors.size >= alleQuellen ? null : [...f.connectors],
        p_limit: 1500,
      });
      return rows.map((o) => ({
        event_id: o.event_id ?? undefined,
        article_id: o.article_id ?? undefined,
        lat: o.lat,
        lon: o.lon,
        n: o.n,
        orte: o.orte,
        ereignisse: o.ereignisse,
        outlets: o.outlets ?? undefined,
        country: o.country,
        location_name: o.location_name,
        top_id: o.top_id,
        top_title: o.top_title,
        top_category: o.top_category,
      }));
    } catch (err) {
      // Fehlt die Funktion (Migration 0017 noch nicht eingespielt), greift
      // unten der Snapshot oder die alte Gruppierung. Lieber gröber als leer.
      console.warn("event_bubbles nicht verfügbar:", err);
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

interface BubbleZeile {
  event_id: number | null;
  article_id: number | null;
  lat: number;
  lon: number;
  n: number;
  orte: number;
  ereignisse: number;
  outlets: number | null;
  country: string | null;
  location_name: string;
  top_id: number;
  top_title: string;
  top_category: Cluster["top_category"];
}

/** Alle Meldungen genau eines Ereignisses — für den Klick auf eine Ereignis-Bubble. */
export async function fetchArticlesOfEvent(eventId: number): Promise<Article[]> {
  return supabaseRpc<Article[]>("articles_of_event", { p_event_id: eventId });
}

/**
 * Eine einzelne Meldung ohne Ereigniszuordnung.
 *
 * Nicht jede Meldung findet ein Ereignis — die Zuordnung braucht einen
 * Textbeleg. Auf der Karte ist sie trotzdem ein Punkt, sonst verschwände sie
 * lautlos. Beim Klick kommt sie allein ins Panel, statt ihre Nachbarschaft
 * mitzubringen.
 */
export async function fetchArticle(id: number): Promise<Article[]> {
  return supabaseRpc<Article[]>("article_by_id", { p_id: id });
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

/**
 * Die Bögen eines Ereignisses, in zeitlicher Reihenfolge.
 *
 * Bewusst ohne Snapshot- und ohne Demopfad. Das Replay hängt an
 * `event_outlets`, und die gibt es nur live — ein erfundener Verlauf wäre bei
 * einem Werkzeug, dessen Kernaussage aus Zeitpunkten besteht, keine
 * Notlösung, sondern eine Falschaussage. Ohne Supabase wird der Knopf gar
 * nicht erst angeboten.
 *
 * Sortiert wird trotz `order by` in der Funktion noch einmal hier: Die
 * gesamte Zeitrechnung des Replays hängt daran, dass der erste Bogen wirklich
 * der erste ist.
 */
export async function fetchEventArcs(eventId: number): Promise<Arc[]> {
  const rows = await supabaseRpc<Arc[]>("event_arcs", { p_event_id: eventId });
  // **Nicht** nach Koordinaten filtern: Medien ohne bekannten Sitz gehören in
  // die Zeitleiste und in die Zähler, nur nicht auf die Karte. Wer sie hier
  // wegwirft, macht aus einer Lücke im Register eine Aussage über die Welt.
  return rows.sort((a, b) => Date.parse(a.first_seen_at) - Date.parse(b.first_seen_at));
}

/**
 * Die Ereignisse dieses Zeitfensters mit der weitesten belegbaren Verbreitung.
 *
 * Gezählt werden nur Medien mit Koordinate — dieselbe Menge, die `event_arcs`
 * später zeichnet. Die Zahl in der Leiste stimmt damit mit dem überein, was zu
 * sehen ist.
 *
 * Fehler werden geschluckt und als leere Liste zurückgegeben: Die Leiste ist
 * ein Angebot, kein Bestandteil der Karte. Fehlt sie, fehlt nichts.
 */
export async function fetchTopReplays(
  f: Filters,
  anzahl = 3,
): Promise<ReplayVorschlag[]> {
  if (!hasSupabase) return [];
  const from = new Date(f.until.getTime() - f.windowHours * 3600_000);
  try {
    return await supabaseRpc<ReplayVorschlag[]>("top_replays", {
      p_from: from.toISOString(),
      p_to: f.until.toISOString(),
      p_categories: f.categories.size ? [...f.categories] : null,
      p_min_arcs: 3,
      p_limit: anzahl,
    });
  } catch (err) {
    console.warn("top_replays nicht verfügbar:", err);
    return [];
  }
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
