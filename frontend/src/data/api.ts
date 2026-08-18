import type { Article, Cluster, Filters, Snapshot } from "../types";

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
export function isDefaultView(f: Filters): boolean {
  const isNow = Math.abs(f.until.getTime() - Date.now()) < 20 * 60 * 1000;
  return isNow && f.windowHours === 24 && f.biasMin === null && f.biasMax === null;
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

let snapshotCache: { at: number; data: Snapshot } | null = null;

async function loadSnapshot(): Promise<Snapshot> {
  if (snapshotCache && Date.now() - snapshotCache.at < 60_000) return snapshotCache.data;

  // Im Betrieb liegt latest.json da (vom Hostpoint-Cron). Lokal fällt es auf die
  // mitgelieferten Demodaten zurück, damit `npm run dev` sofort etwas zeigt.
  const candidates = [SNAPSHOT_URL, "./data/latest.demo.json"];
  for (const src of candidates) {
    const res = await fetch(src, { cache: "no-cache" }).catch(() => null);
    if (!res?.ok) continue;
    const data = (await res.json()) as Snapshot;
    snapshotCache = { at: Date.now(), data };
    return data;
  }
  throw new Error("Kein Snapshot verfügbar.");
}

export async function fetchClusters(f: Filters, zoom: number): Promise<Cluster[]> {
  const from = new Date(f.until.getTime() - f.windowHours * 3600_000);

  if (isDefaultView(f)) {
    try {
      const snap = await loadSnapshot();
      return filterClustersLocally(snap.clusters, f);
    } catch {
      // Snapshot fehlt (z. B. im Dev-Betrieb) – dann direkt an Supabase.
    }
  }

  return supabaseRpc<Cluster[]>("articles_clustered", {
    p_from: from.toISOString(),
    p_to: f.until.toISOString(),
    p_categories: f.categories.size ? [...f.categories] : null,
    p_bias_min: f.biasMin,
    p_bias_max: f.biasMax,
    p_zoom: Math.round(zoom),
  });
}

/** Der Snapshot enthält alle Rubriken; die Rubrikauswahl filtern wir im Browser. */
function filterClustersLocally(clusters: Cluster[], f: Filters): Cluster[] {
  if (!f.categories.size) return clusters;
  return clusters.filter((c) => f.categories.has(c.top_category));
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
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return demoArticlesAt(lat, lon);
  }

  return supabaseRpc<Article[]>("articles_at", {
    p_lat: lat,
    p_lon: lon,
    p_radius_m: radiusM,
    p_from: from.toISOString(),
    p_to: f.until.toISOString(),
  });
}

/** Nur für die Demodaten: baut plausible Meldungen aus dem Snapshot-Cluster. */
async function demoArticlesAt(lat: number, lon: number): Promise<Article[]> {
  const snap = await loadSnapshot();
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
    };
  });
}
