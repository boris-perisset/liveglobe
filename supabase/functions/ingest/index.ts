// Globe News – Ingest Edge Function
//
// Wird von pg_cron alle 15 Minuten aufgerufen (siehe supabase/migrations/0002_cron.sql).
//
// Ablauf:  die beiden aktuellen GKG-Dateien laden (englisch + übersetzt)
//       -> Zeilen strömend zerlegen, Rubrik bestimmen, Ort wählen
//       -> Auswahl im Reihum-Verfahren über die Länder treffen
//       -> Orte, Quellen und Artikel upserten, Lauf protokollieren
//
// Warum Reihum: Ohne Ausgleich stellen die USA und Grossbritannien die Hälfte
// aller Meldungen. Die Auswahl geht deshalb Land für Land durch, statt einfach
// die global relevantesten zu nehmen – sonst bleibt der halbe Globus leer.
//
// Lokal testen:  supabase functions serve ingest --no-verify-jwt

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { GkgRecord, latestGkgFiles, LOC_TYPE, readGkg } from "./gkg.ts";
import { categorise } from "./categorise.ts";
import { encodeGeohash } from "./geohash.ts";
import { splitPlaceName, toIso2 } from "./countries.ts";

// ------------------------------------------------------------------ Konfiguration
const CONFIG = {
  /** Obergrenze je Lauf. 250 alle 15 Min ≈ 24'000/Tag ≈ 90 MB bei 8 Tagen Aufbewahrung. */
  maxPerRun: Number(Deno.env.get("GN_MAX_PER_RUN") ?? 250),
  /** Höchstens so viele Meldungen je Land und Lauf */
  maxPerCountry: Number(Deno.env.get("GN_MAX_PER_COUNTRY") ?? 4),
  /** Höchstens so viele je Land und Rubrik */
  maxPerCountryCategory: Number(Deno.env.get("GN_MAX_PER_COUNTRY_CAT") ?? 2),
  /** Zeilen, die je Datei höchstens gelesen werden (Schutz vor Ausreissern) */
  maxRowsPerFile: Number(Deno.env.get("GN_MAX_ROWS") ?? 8000),
  /** Nur Ortsangaben auf Stadtebene zulassen? Sonst auch Region/Land. */
  citiesOnly: (Deno.env.get("GN_CITIES_ONLY") ?? "true") !== "false",
  teaserLength: 300,
};

// ------------------------------------------------------------------ Hilfsfunktionen
async function sha1(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Entfernt Tracking-Parameter und vereinheitlicht die URL für das Dedupe. */
function normaliseUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.protocol = "https:";
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|source|cmpid|icid|at_)/i.test(p)) u.searchParams.delete(p);
    }
    u.hostname = u.hostname.replace(/^www\./, "").toLowerCase();
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return null;
  }
}

function domainOf(url: string, fallback: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return fallback || null;
  }
}

// ------------------------------------------------------------------ Kandidaten
interface Candidate {
  url: string;
  connector: string;
  url_hash: string;
  title: string;
  teaser: string | null;
  image_url: string | null;
  category: string;
  language: string | null;
  tone: number | null;
  prominence: number;
  published_at: string;
  domain: string | null;
  country: string | null;
  geohash: string;
  tokens: string[];
  names: string[];
  loc: {
    geohash: string;
    name: string;
    admin1: string | null;
    country: string | null;
    lat: number;
    lon: number;
    feature_class: string;
  };
}

function featureClass(type: number): string {
  if (type === LOC_TYPE.worldCity || type === LOC_TYPE.usCity) return "city";
  if (type === LOC_TYPE.worldState || type === LOC_TYPE.usState) return "region";
  return "country_fallback";
}

function toCandidate(rec: GkgRecord, connector: string): Omit<Candidate, "url_hash"> | null {
  const loc = rec.location!;
  const fc = featureClass(loc.type);
  if (CONFIG.citiesOnly && fc !== "city") return null;

  const url = normaliseUrl(rec.url);
  if (!url) return null;

  const { name, admin1, country } = splitPlaceName(loc.fullName);
  const iso2 = toIso2(country);
  const cat = categorise(rec.themes);

  // Kein Zitat, kein Anrisstext. Den Titel zu wiederholen sieht nach Inhalt aus,
  // ist aber keiner — die Karte zeigt Ort und Quelle ohnehin separat.
  const teaser = rec.quote ? rec.quote.slice(0, CONFIG.teaserLength) : null;

  return {
    url,
    connector,
    title: rec.title,
    teaser,
    image_url: rec.image,
    category: cat.category,
    language: rec.isTranslated ? null : "eng",
    tone: rec.tone,
    prominence: loc.mentions,
    published_at: rec.publishedAt,
    tokens: rec.tokens,
    names: rec.names,
    domain: domainOf(url, rec.domain),
    country: iso2,
    geohash: encodeGeohash(loc.lat, loc.lon, 9),
    loc: {
      geohash: encodeGeohash(loc.lat, loc.lon, 9),
      name,
      admin1,
      country: iso2,
      lat: loc.lat,
      lon: loc.lon,
      feature_class: fc,
    },
  };
}

/**
 * Reihum über die Länder auswählen: erst je ein Beitrag pro Land, dann der
 * zweite, und so fort. So kommt jedes Land zum Zug, bevor ein einzelnes
 * mehrfach berücksichtigt wird.
 */
function selectRoundRobin(pool: Omit<Candidate, "url_hash">[]): Omit<Candidate, "url_hash">[] {
  const byCountry = new Map<string, Omit<Candidate, "url_hash">[]>();
  for (const c of pool) {
    const key = c.country ?? "ZZ";
    const list = byCountry.get(key);
    if (list) list.push(c);
    else byCountry.set(key, [c]);
  }
  for (const list of byCountry.values()) list.sort((a, b) => b.prominence - a.prominence);

  const gewaehlt: Omit<Candidate, "url_hash">[] = [];
  const proLandRubrik = new Map<string, number>();
  const laender = [...byCountry.keys()];

  for (let runde = 0; runde < CONFIG.maxPerCountry; runde++) {
    for (const land of laender) {
      if (gewaehlt.length >= CONFIG.maxPerRun) return gewaehlt;
      const list = byCountry.get(land)!;
      while (list.length > 0) {
        const kandidat = list.shift()!;
        const key = `${land}|${kandidat.category}`;
        const genutzt = proLandRubrik.get(key) ?? 0;
        if (genutzt >= CONFIG.maxPerCountryCategory) continue;
        proLandRubrik.set(key, genutzt + 1);
        gewaehlt.push(kandidat);
        break;
      }
    }
  }
  return gewaehlt;
}

// ------------------------------------------------------------------ Persistenz
async function upsertLocations(db: SupabaseClient, items: Candidate[]) {
  const byHash = new Map<string, Candidate["loc"]>();
  for (const it of items) if (!byHash.has(it.geohash)) byHash.set(it.geohash, it.loc);

  const rows = [...byHash.values()].map((l) => ({
    geohash: l.geohash,
    name: l.name,
    admin1: l.admin1,
    country: l.country,
    geom: `SRID=4326;POINT(${l.lon} ${l.lat})`,
    feature_class: l.feature_class,
  }));

  const ids = new Map<string, number>();
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await db
      .from("locations")
      .upsert(rows.slice(i, i + 500), { onConflict: "geohash" })
      .select("id, geohash");
    if (error) throw new Error(`locations: ${error.message}`);
    for (const r of data ?? []) ids.set(r.geohash as string, r.id as number);
  }
  return ids;
}

async function upsertSources(db: SupabaseClient, items: Candidate[]) {
  const domains = [...new Set(items.map((i) => i.domain).filter((d): d is string => !!d))];
  const ids = new Map<string, number>();
  if (domains.length === 0) return ids;

  for (let i = 0; i < domains.length; i += 500) {
    const chunk = domains.slice(i, i + 500);
    const { error } = await db
      .from("sources")
      .upsert(chunk.map((d) => ({ domain: d })), {
        onConflict: "domain",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`sources upsert: ${error.message}`);

    const { data, error: e2 } = await db
      .from("sources")
      .select("id, domain")
      .in("domain", chunk);
    if (e2) throw new Error(`sources select: ${e2.message}`);
    for (const r of data ?? []) ids.set(r.domain as string, r.id as number);
  }
  return ids;
}

async function insertArticles(
  db: SupabaseClient,
  items: Candidate[],
  locIds: Map<string, number>,
  srcIds: Map<string, number>,
) {
  const rows = items
    .map((it) => {
      const location_id = locIds.get(it.geohash);
      if (!location_id) return null;
      return {
        url_hash: it.url_hash,
        url: it.url,
        title: it.title,
        teaser: it.teaser,
        image_url: it.image_url,
        source_id: it.domain ? srcIds.get(it.domain) ?? null : null,
        location_id,
        category: it.category,
        language: it.language,
        tone: it.tone,
        connector: it.connector,
        prominence: it.prominence,
        published_at: it.published_at,
        title_tokens: it.tokens,
        names: it.names,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await db
      .from("articles")
      .upsert(rows.slice(i, i + 500), { onConflict: "url_hash", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`articles: ${error.message}`);
    inserted += data?.length ?? 0;
  }
  return { inserted, attempted: rows.length, urlHashes: rows.map((r) => r.url_hash) };
}

/**
 * Ereigniszuordnung anstossen.
 *
 * Läuft bewusst als eine einzige Prozedur in der Datenbank statt als Schleife
 * hier: Der Vergleich braucht den Geo-Index und muss sequenziell laufen, weil
 * ein Artikel einem Ereignis zufallen kann, das ein früherer Artikel desselben
 * Stapels gerade erst erzeugt hat. 250 Einzelabfragen über HTTP wären dafür der
 * falsche Weg.
 *
 * Ein Fehler hier darf den Lauf nicht scheitern lassen — die Artikel sind
 * gespeichert, die Zuordnung kann jederzeit nachgeholt werden.
 */
async function ereignisseZuordnen(db: SupabaseClient, urlHashes: string[]) {
  if (urlHashes.length === 0) return { zugeordnet: 0, neu: 0, fehler: null as string | null };
  const { data, error } = await db.rpc("match_events", { p_url_hashes: urlHashes });
  if (error) return { zugeordnet: 0, neu: 0, fehler: error.message };
  const z = Array.isArray(data) ? data[0] : data;
  return { zugeordnet: z?.zugeordnet ?? 0, neu: z?.neu ?? 0, fehler: null };
}

// ------------------------------------------------------------------ Handler
Deno.serve(async (req: Request) => {
  const start = Date.now();
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "SUPABASE_URL / SERVICE_ROLE_KEY fehlen" }, 500);

  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: runRow } = await db
    .from("ingest_runs")
    .insert({ connector: "gdelt-gkg" })
    .select("id")
    .single();
  const runId = runRow?.id as number | undefined;

  const errors: string[] = [];
  const themenOhneRubrik = new Map<string, number>();
  let gelesen = 0;
  let mitOrt = 0;

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const nurEnglisch = Boolean((body as { englishOnly?: boolean }).englishOnly);

    const files = await latestGkgFiles();
    if (!files.english && !files.translation) {
      throw new Error("Keine aktuelle GKG-Datei gefunden");
    }

    const pool: Omit<Candidate, "url_hash">[] = [];
    const quellen: { name: string; url: string; rows: number; used: number }[] = [];

    for (const [file, uebersetzt] of [
      [files.english, false] as const,
      [nurEnglisch ? null : files.translation, true] as const,
    ]) {
      if (!file) continue;
      let rows = 0;
      let used = 0;
      try {
        for await (const rec of readGkg(file, uebersetzt)) {
          if (++rows > CONFIG.maxRowsPerFile) break;
          gelesen++;
          if (rec.location) mitOrt++;
          const cand = toCandidate(rec, uebersetzt ? "gdelt-tr" : "gdelt-en");
          if (!cand) continue;
          if (cand.category === "other") {
            for (const t of categorise(rec.themes).unmatched.slice(0, 5)) {
              themenOhneRubrik.set(t, (themenOhneRubrik.get(t) ?? 0) + 1);
            }
          }
          pool.push(cand);
          used++;
        }
      } catch (e) {
        errors.push(`${uebersetzt ? "translation" : "english"}: ${msg(e)}`);
      }
      quellen.push({ name: uebersetzt ? "translation" : "english", url: file.url, rows, used });
    }

    // Innerhalb des Laufs entdoppeln, dann reihum auswählen
    const gesehen = new Set<string>();
    const eindeutig: Omit<Candidate, "url_hash">[] = [];
    for (const c of pool) {
      if (gesehen.has(c.url)) continue;
      gesehen.add(c.url);
      eindeutig.push(c);
    }

    const gewaehlt = selectRoundRobin(eindeutig);
    const mitHash: Candidate[] = [];
    for (const c of gewaehlt) mitHash.push({ ...c, url_hash: await sha1(c.url) });

    const locIds = await upsertLocations(db, mitHash);
    const srcIds = await upsertSources(db, mitHash);
    const { inserted, attempted, urlHashes } = await insertArticles(db, mitHash, locIds, srcIds);
    const ereignisse = await ereignisseZuordnen(db, urlHashes);
    if (ereignisse.fehler) errors.push(`match_events: ${ereignisse.fehler}`);

    const laender = new Set(gewaehlt.map((c) => c.country ?? "ZZ"));
    const topUnmapped = [...themenOhneRubrik.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([t, n]) => `${t}:${n}`);

    if (runId) {
      await db.from("ingest_runs").update({
        finished_at: new Date().toISOString(),
        fetched: gelesen,
        inserted,
        skipped: attempted - inserted,
        error: errors.length ? errors.join(" | ").slice(0, 2000) : null,
        unmapped_themes: topUnmapped,
      }).eq("id", runId);
    }

    return json({
      ok: true,
      dateien: quellen,
      zeilen_gelesen: gelesen,
      mit_ort: mitOrt,
      kandidaten: eindeutig.length,
      ausgewaehlt: gewaehlt.length,
      laender: laender.size,
      neu_eingefuegt: inserted,
      bereits_bekannt: attempted - inserted,
      ereignisse_neu: ereignisse.neu,
      ereignisse_zugeordnet: ereignisse.zugeordnet,
      orte: locIds.size,
      quellen: srcIds.size,
      themen_ohne_rubrik: topUnmapped.slice(0, 10),
      errors,
      dauer_ms: Date.now() - start,
    });
  } catch (e) {
    if (runId) {
      await db.from("ingest_runs").update({
        finished_at: new Date().toISOString(),
        fetched: gelesen,
        error: msg(e).slice(0, 2000),
      }).eq("id", runId);
    }
    return json({ ok: false, error: msg(e), errors, dauer_ms: Date.now() - start }, 500);
  }
});

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
