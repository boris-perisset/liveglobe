// GDELT-Konnektor.
//
// GEO 2.0 (mode=PointData) ist unsere Hauptquelle: Sie liefert Punkte auf Stadt-/Landmark-Ebene
// samt Artikel-Links im html-Feld. DOC 2.0 dient nur zur Anreicherung.
//
// Doku: https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/
//       https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/

const GEO_URL = "https://api.gdeltproject.org/api/v2/geo/geo";
const DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const UA = "GlobeNews/0.1 (+https://github.com/) educational news map";

export interface GeoArticleRef {
  url: string;
  title: string;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Roher Ortsname, z. B. "Nairobi, Nairobi Area, Kenya" */
  placeName: string;
  /** Wie viele Quellen über diesen Punkt berichten – unser Prominenz-Signal */
  count: number;
  image: string | null;
  articles: GeoArticleRef[];
}

const IGNORED_LINK_HOSTS = [
  "gdeltproject.org",
  "google.com/maps",
  "maps.google",
  "api.gdeltproject.org",
];

/** Zieht die Artikel-Links aus dem HTML-Blob, den die GEO-API pro Punkt mitliefert. */
export function parseArticleLinks(html: string | null | undefined): GeoArticleRef[] {
  if (!html) return [];
  const out: GeoArticleRef[] = [];
  const seen = new Set<string>();
  const re = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = m[1].trim();
    const title = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!url.startsWith("http")) continue;
    if (IGNORED_LINK_HOSTS.some((h) => url.includes(h))) continue;
    if (title.length < 12) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: decodeEntities(title) });
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Normalisiert die Feature-Properties – GDELT ist in der Benennung nicht ganz konsistent. */
export function normaliseFeature(f: Record<string, unknown>): GeoPoint | null {
  const geometry = f.geometry as { coordinates?: [number, number] } | undefined;
  const coords = geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  // GDELT liefert für nicht auflösbare Orte gelegentlich exakt 0/0 im Golf von Guinea.
  if (lat === 0 && lon === 0) return null;

  const p = (f.properties ?? {}) as Record<string, unknown>;
  const placeName = String(p.name ?? p.location ?? p.title ?? "").trim();
  if (!placeName) return null;

  const html = (p.html ?? p.description ?? p.popup) as string | undefined;

  return {
    lat,
    lon,
    placeName,
    count: Math.max(1, Number(p.count ?? p.value ?? 1) || 1),
    image: (p.shareimage as string) || (p.image as string) || null,
    articles: parseArticleLinks(html),
  };
}

export interface FetchOptions {
  query: string;
  /** GDELT akzeptiert z. B. "60min", "24h", "3d" */
  timespan?: string;
  maxpoints?: number;
  signal?: AbortSignal;
}

export async function fetchGeoPoints(opts: FetchOptions): Promise<GeoPoint[]> {
  const params = new URLSearchParams({
    query: opts.query,
    mode: "PointData",
    format: "GeoJSON",
    timespan: opts.timespan ?? "60min",
    maxpoints: String(Math.min(opts.maxpoints ?? 200, 1000)),
  });

  const res = await fetch(`${GEO_URL}?${params}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: opts.signal,
  });

  if (!res.ok) {
    throw new Error(`GDELT GEO ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const text = await res.text();
  // GDELT antwortet bei Fehlern gelegentlich mit Klartext statt JSON.
  if (!text.trimStart().startsWith("{")) {
    throw new Error(`GDELT GEO lieferte kein JSON: ${text.slice(0, 200)}`);
  }

  const json = JSON.parse(text) as { features?: Record<string, unknown>[] };
  const features = json.features ?? [];
  return features
    .map(normaliseFeature)
    .filter((p): p is GeoPoint => p !== null);
}

export interface DocArticle {
  url: string;
  title: string;
  seendate: string;
  socialimage: string | null;
  domain: string;
  language: string;
  sourcecountry: string;
}

/** Anreicherung: liefert saubere Metadaten (Bild, Sprache, Domain) zu einer Suchanfrage. */
export async function fetchDocArticles(opts: FetchOptions): Promise<DocArticle[]> {
  const params = new URLSearchParams({
    query: opts.query,
    mode: "ArtList",
    format: "json",
    timespan: opts.timespan ?? "60min",
    maxrecords: String(Math.min(opts.maxpoints ?? 75, 250)),
    sort: "datedesc",
  });

  const res = await fetch(`${DOC_URL}?${params}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: opts.signal,
  });
  if (!res.ok) return [];

  const text = await res.text();
  if (!text.trimStart().startsWith("{")) return [];

  try {
    const json = JSON.parse(text) as { articles?: Record<string, string>[] };
    return (json.articles ?? []).map((a) => ({
      url: a.url,
      title: a.title ?? "",
      seendate: a.seendate ?? "",
      socialimage: a.socialimage || null,
      domain: a.domain ?? "",
      language: a.language ?? "",
      sourcecountry: a.sourcecountry ?? "",
    }));
  } catch {
    return [];
  }
}

/** "20260818T124500Z" -> ISO-String */
export function parseSeendate(seendate: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/.exec(seendate);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}
