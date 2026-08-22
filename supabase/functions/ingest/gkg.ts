/**
 * GDELT-Konnektor auf Basis der GKG-Rohdateien.
 *
 * Hintergrund: Die GEO-2.0-API, die früher fertige Punkte lieferte, antwortet
 * seit August 2026 mit 404. Die DOC-2.0-API lebt zwar, ist aber auf eine Abfrage
 * alle fünf Sekunden begrenzt und liefert keine Koordinaten.
 *
 * Die Rohdateien sind der bessere Weg: alle 15 Minuten eine Datei, kein
 * Ratenlimit, und pro Artikel Titel, Bild, Themen, Tonwert und – entscheidend –
 * die aus dem Text extrahierten Orte mit Breiten- und Längengrad.
 *
 *   http://data.gdeltproject.org/gdeltv2/lastupdate.txt              englisch
 *   http://data.gdeltproject.org/gdeltv2/lastupdate-translation.txt  64 weitere Sprachen
 */

import { unzipLines } from "./zip.ts";
import { namesFrom, titleTokens } from "./tokens.ts";

const BASE = "http://data.gdeltproject.org/gdeltv2";
const UA = "GlobeNews/0.1 (+https://github.com/) educational news map";

/** Spaltenindizes im GKG-2.0-Format (27 Spalten, Tabulator getrennt). */
export const COL = {
  recordId: 0,
  date: 1,
  sourceName: 3,
  url: 4,
  v1Themes: 7,
  v1Locations: 9,
  v2Locations: 10,
  tone: 15,
  sharingImage: 18,
  quotations: 22,
  /** Alle im Text gefundenen Eigennamen – das sprachrobusteste Signal, das GKG hergibt. */
  allNames: 23,
  translationInfo: 25,
  extrasXml: 26,
} as const;

/** Ortstypen laut GDELT: 1 Land, 2 US-Bundesstaat, 3 US-Stadt, 4 Weltstadt, 5 Weltregion. */
export const LOC_TYPE = {
  country: 1,
  usState: 2,
  usCity: 3,
  worldCity: 4,
  worldState: 5,
} as const;

export interface GkgLocation {
  type: number;
  fullName: string;
  /** FIPS-10-4-Code – nicht ISO! Wird nur als Notnagel verwendet. */
  fipsCountry: string;
  adm1: string;
  lat: number;
  lon: number;
  /** Wie oft der Ort im Artikel vorkommt – unser Relevanzsignal */
  mentions: number;
}

export interface GkgRecord {
  url: string;
  title: string;
  domain: string;
  publishedAt: string;
  themes: string[];
  image: string | null;
  tone: number | null;
  quote: string | null;
  /** Titelwörter und Eigennamen, normalisiert – Vergleichsmaterial für die Ereigniszuordnung. */
  tokens: string[];
  names: string[];
  isTranslated: boolean;
  location: GkgLocation | null;
}

// ---------------------------------------------------------------- Dateiliste

export interface GkgFile {
  url: string;
  bytes: number;
}

async function latestFrom(listUrl: string): Promise<GkgFile | null> {
  const res = await fetch(listUrl, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${listUrl}: HTTP ${res.status}`);
  const text = await res.text();
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3 && /\.gkg\.csv\.zip$/i.test(parts[2])) {
      return { url: parts[2], bytes: Number(parts[0]) || 0 };
    }
  }
  return null;
}

/** Die aktuellen GKG-Dateien beider Ströme. */
export async function latestGkgFiles(): Promise<{
  english: GkgFile | null;
  translation: GkgFile | null;
}> {
  const [english, translation] = await Promise.all([
    latestFrom(`${BASE}/lastupdate.txt`).catch(() => null),
    latestFrom(`${BASE}/lastupdate-translation.txt`).catch(() => null),
  ]);
  return { english, translation };
}

// ---------------------------------------------------------------- Zerlegen

/** `<PAGE_TITLE>…</PAGE_TITLE>` aus dem XML-Anhang holen. */
export function extractTitle(extrasXml: string | undefined): string | null {
  if (!extrasXml) return null;
  const m = /<PAGE_TITLE>([\s\S]*?)<\/PAGE_TITLE>/i.exec(extrasXml);
  if (!m) return null;
  const t = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
  return t.length >= 8 ? t : null;
}

/**
 * Die übersetzten Meldungen kommen mit numerischen HTML-Entitäten
 * (`&#x131;` für ı). Ohne deren Auflösung wären alle nicht-englischen
 * Schlagzeilen unlesbar.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function codePoint(n: number): string {
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}

/**
 * Ortsliste zerlegen. V2 hat neun Felder (mit GeoNames-ID und Zeichenposition),
 * V1 nur sieben. Beide Formate werden unterstützt, Mehrfachnennungen gezählt.
 */
export function parseLocations(v2: string, v1: string): GkgLocation[] {
  const raw = v2 || v1;
  if (!raw) return [];
  const isV2 = Boolean(v2);
  const byKey = new Map<string, GkgLocation>();

  for (const item of raw.split(";")) {
    if (!item) continue;
    const p = item.split("#");
    if (p.length < 7) continue;

    const type = Number(p[0]);
    const fullName = p[1]?.trim() ?? "";
    const fipsCountry = p[2]?.trim() ?? "";
    const adm1 = p[3]?.trim() ?? "";
    const lat = Number(isV2 ? p[5] : p[4]);
    const lon = Number(isV2 ? p[6] : p[5]);

    if (!fullName || !isFinite(lat) || !isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (lat === 0 && lon === 0) continue;

    const key = `${type}|${fullName}`;
    const seen = byKey.get(key);
    if (seen) seen.mentions++;
    else byKey.set(key, { type, fullName, fipsCountry, adm1, lat, lon, mentions: 1 });
  }
  return [...byKey.values()];
}

/**
 * Wählt den Ort, an dem der Pin stehen soll: möglichst genau, und unter
 * gleich genauen den am häufigsten genannten. Länder-Treffer gelten nur als
 * Notnagel, weil ein Pin mitten im Land wenig aussagt.
 */
export function pickLocation(locations: GkgLocation[]): GkgLocation | null {
  if (locations.length === 0) return null;
  const rang = (t: number) =>
    t === LOC_TYPE.worldCity || t === LOC_TYPE.usCity
      ? 3
      : t === LOC_TYPE.worldState || t === LOC_TYPE.usState
      ? 2
      : 1;

  return [...locations].sort((a, b) =>
    rang(b.type) - rang(a.type) || b.mentions - a.mentions
  )[0];
}

/** `20260818091500` → ISO-Zeitstempel */
export function parseGkgDate(d: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(d?.trim() ?? "");
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

/** Erstes brauchbares Zitat als Anrisstext – wörtlich aus dem Artikel. */
export function extractQuote(quotations: string | undefined): string | null {
  if (!quotations) return null;
  for (const q of quotations.split("#")) {
    // Format: offset|länge|sprecher|text
    const parts = q.split("|");
    const text = (parts[3] ?? "").replace(/\s+/g, " ").trim();
    if (text.length >= 60 && text.length <= 400) {
      return text.length > 300 ? text.slice(0, 299) + "…" : text;
    }
  }
  return null;
}

/** Eine Zeile in einen Datensatz überführen. Gibt null zurück, wenn unbrauchbar. */
export function parseRow(cols: string[], translated: boolean): GkgRecord | null {
  if (cols.length < 27) return null;

  const url = cols[COL.url]?.trim();
  const title = extractTitle(cols[COL.extrasXml]);
  const publishedAt = parseGkgDate(cols[COL.date]);
  if (!url || !url.startsWith("http") || !title || !publishedAt) return null;

  const location = pickLocation(
    parseLocations(cols[COL.v2Locations] ?? "", cols[COL.v1Locations] ?? ""),
  );
  if (!location) return null;

  const toneRaw = (cols[COL.tone] ?? "").split(",")[0];
  const tone = toneRaw === "" ? null : Number(toneRaw);

  return {
    url,
    title,
    domain: (cols[COL.sourceName] ?? "").trim().toLowerCase(),
    publishedAt,
    themes: (cols[COL.v1Themes] ?? "").split(";").filter(Boolean),
    image: cols[COL.sharingImage]?.trim() || null,
    tone: tone !== null && isFinite(tone) ? tone : null,
    quote: extractQuote(cols[COL.quotations]),
    tokens: titleTokens(title),
    names: namesFrom(cols[COL.allNames]),
    isTranslated: translated || Boolean(cols[COL.translationInfo]),
    location,
  };
}

/** Lädt eine GKG-Datei und liefert die verwertbaren Datensätze. */
export async function* readGkg(
  file: GkgFile,
  translated: boolean,
): AsyncGenerator<GkgRecord> {
  const res = await fetch(file.url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${file.url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();

  for await (const line of unzipLines(buf)) {
    const rec = parseRow(line.split("\t"), translated);
    if (rec) yield rec;
  }
}
