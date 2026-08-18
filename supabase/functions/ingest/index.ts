// Globe News – Ingest Edge Function
//
// Wird von pg_cron alle 15 Minuten aufgerufen (siehe supabase/migrations/0002_cron.sql).
// Ablauf:  GDELT GEO abfragen (pro Rubrik)  ->  Orte + Quellen + Artikel upserten
//          -> Quote pro (Land x Rubrik) einhalten  -> Lauf protokollieren
//
// Lokal testen:  supabase functions serve ingest --no-verify-jwt
//                curl -X POST http://localhost:54321/functions/v1/ingest

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import categoryMap from "./category-map.json" with { type: "json" };
import { fetchGeoPoints, GeoPoint, parseSeendate } from "./gdelt.ts";
import { encodeGeohash } from "./geohash.ts";
import { splitPlaceName, toIso2 } from "./countries.ts";

// ------------------------------------------------------------------ Konfiguration
const CONFIG = {
  /** Zeitfenster je Lauf. Etwas Überlappung zum 15-Min-Takt ist gewollt (Dedupe fängt es ab). */
  timespan: Deno.env.get("GN_TIMESPAN") ?? "30min",
  /** Punkte je Rubrik-Abfrage */
  maxPointsPerCategory: Number(Deno.env.get("GN_MAX_POINTS") ?? 250),
  /** Artikel je Ortspunkt */
  maxArticlesPerPoint: Number(Deno.env.get("GN_MAX_PER_POINT") ?? 3),
  /** Harte Obergrenze je (Land x Rubrik) und Lauf – hält den Datenberg klein */
  quotaPerCountryCategory: Number(Deno.env.get("GN_QUOTA") ?? 10),
  teaserLength: 300,
};

interface CategoryDef {
  id: string;
  label: string;
  color: string;
  themes: string[];
  query: string;
}
const CATEGORIES = (categoryMap as { categories: CategoryDef[] }).categories
  .filter((c) => c.query && c.id !== "other");

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

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function makeTeaser(title: string, placeName: string, category: string): string {
  // GDELT liefert keinen Anrisstext. Wir bauen einen kurzen, ehrlichen Kontextsatz;
  // der eigentliche Inhalt bleibt beim Verlag (Klick auf "Zum Artikel").
  const t = `${title} — ${placeName}`;
  return t.length > CONFIG.teaserLength ? t.slice(0, CONFIG.teaserLength - 1) + "…" : t;
}

// ------------------------------------------------------------------ Datensammlung
interface PendingArticle {
  url_hash: string;
  url: string;
  title: string;
  teaser: string;
  image_url: string | null;
  category: string;
  prominence: number;
  published_at: string;
  language: string | null;
  geohash: string;
  loc: {
    geohash: string;
    name: string;
    admin1: string | null;
    country: string | null;
    lat: number;
    lon: number;
    feature_class: string;
  };
  domain: string | null;
}

function collect(points: GeoPoint[], category: string, now: Date): PendingArticle[] {
  const out: PendingArticle[] = [];
  const quota = new Map<string, number>();

  // Prominente Punkte zuerst – wenn die Quote greift, überleben die relevanten Meldungen.
  const sorted = [...points].sort((a, b) => b.count - a.count);

  for (const p of sorted) {
    const { name, admin1, country } = splitPlaceName(p.placeName);
    const iso2 = toIso2(country);
    const key = `${iso2 ?? "ZZ"}|${category}`;
    const used = quota.get(key) ?? 0;
    if (used >= CONFIG.quotaPerCountryCategory) continue;

    const geohash = encodeGeohash(p.lat, p.lon, 9);
    const featureClass = name === country ? "country_fallback" : "city";

    let taken = 0;
    for (const art of p.articles) {
      if (taken >= CONFIG.maxArticlesPerPoint) break;
      if (used + taken >= CONFIG.quotaPerCountryCategory) break;
      const url = normaliseUrl(art.url);
      if (!url) continue;

      out.push({
        url_hash: "",
        url,
        title: art.title,
        teaser: makeTeaser(art.title, p.placeName, category),
        image_url: p.image,
        category,
        prominence: p.count,
        published_at: now.toISOString(),
        language: null,
        geohash,
        loc: {
          geohash,
          name,
          admin1,
          country: iso2,
          lat: p.lat,
          lon: p.lon,
          feature_class: featureClass,
        },
        domain: domainOf(url),
      });
      taken++;
    }
    if (taken > 0) quota.set(key, used + taken);
  }
  return out;
}

// ------------------------------------------------------------------ Persistenz
async function upsertLocations(db: SupabaseClient, items: PendingArticle[]) {
  const byHash = new Map<string, PendingArticle["loc"]>();
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
    const chunk = rows.slice(i, i + 500);
    const { data, error } = await db
      .from("locations")
      .upsert(chunk, { onConflict: "geohash", ignoreDuplicates: false })
      .select("id, geohash");
    if (error) throw new Error(`locations upsert: ${error.message}`);
    for (const r of data ?? []) ids.set(r.geohash as string, r.id as number);
  }
  return ids;
}

async function upsertSources(db: SupabaseClient, items: PendingArticle[]) {
  const domains = [...new Set(items.map((i) => i.domain).filter((d): d is string => !!d))];
  const ids = new Map<string, number>();
  if (domains.length === 0) return ids;

  // Neue Domains werden ohne Bias-Einstufung angelegt – die Pflege passiert
  // bewusst von Hand in data/sources.seed.json bzw. im Admin-UI.
  const rows = domains.map((d) => ({ domain: d }));
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { data, error } = await db
      .from("sources")
      .upsert(chunk, { onConflict: "domain", ignoreDuplicates: true })
      .select("id, domain");
    if (error) throw new Error(`sources upsert: ${error.message}`);
    for (const r of data ?? []) ids.set(r.domain as string, r.id as number);
  }
  // ignoreDuplicates liefert bestehende Zeilen nicht zurück – die holen wir nach.
  const missing = domains.filter((d) => !ids.has(d));
  for (let i = 0; i < missing.length; i += 500) {
    const { data, error } = await db
      .from("sources")
      .select("id, domain")
      .in("domain", missing.slice(i, i + 500));
    if (error) throw new Error(`sources select: ${error.message}`);
    for (const r of data ?? []) ids.set(r.domain as string, r.id as number);
  }
  return ids;
}

async function insertArticles(
  db: SupabaseClient,
  items: PendingArticle[],
  locIds: Map<string, number>,
  srcIds: Map<string, number>,
) {
  const rows = [];
  for (const it of items) {
    const location_id = locIds.get(it.geohash);
    if (!location_id) continue;
    rows.push({
      url_hash: it.url_hash,
      url: it.url,
      title: it.title,
      teaser: it.teaser,
      image_url: it.image_url,
      source_id: it.domain ? srcIds.get(it.domain) ?? null : null,
      location_id,
      category: it.category,
      language: it.language,
      prominence: it.prominence,
      published_at: it.published_at,
    });
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { data, error } = await db
      .from("articles")
      .upsert(chunk, { onConflict: "url_hash", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`articles upsert: ${error.message}`);
    inserted += data?.length ?? 0;
  }
  return { inserted, attempted: rows.length };
}

// ------------------------------------------------------------------ Handler
Deno.serve(async (req: Request) => {
  const startedAt = new Date();
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen" }, 500);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: runRow } = await db
    .from("ingest_runs")
    .insert({ connector: "gdelt-geo" })
    .select("id")
    .single();
  const runId = runRow?.id as number | undefined;

  let fetched = 0;
  const errors: string[] = [];
  let all: PendingArticle[] = [];

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const timespan = (body as { timespan?: string }).timespan ?? CONFIG.timespan;

    for (const cat of CATEGORIES) {
      try {
        const points = await fetchGeoPoints({
          query: cat.query,
          timespan,
          maxpoints: CONFIG.maxPointsPerCategory,
        });
        fetched += points.length;
        all = all.concat(collect(points, cat.id, startedAt));
      } catch (e) {
        errors.push(`${cat.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
      // GDELT freundlich behandeln
      await new Promise((r) => setTimeout(r, 400));
    }

    // Dedupe innerhalb des Laufs
    const seen = new Set<string>();
    const unique: PendingArticle[] = [];
    for (const it of all) {
      it.url_hash = await sha1(it.url);
      if (seen.has(it.url_hash)) continue;
      seen.add(it.url_hash);
      unique.push(it);
    }

    const locIds = await upsertLocations(db, unique);
    const srcIds = await upsertSources(db, unique);
    const { inserted, attempted } = await insertArticles(db, unique, locIds, srcIds);

    if (runId) {
      await db.from("ingest_runs").update({
        finished_at: new Date().toISOString(),
        fetched,
        inserted,
        skipped: attempted - inserted,
        error: errors.length ? errors.join(" | ").slice(0, 2000) : null,
      }).eq("id", runId);
    }

    return json({
      ok: true,
      timespan,
      categories: CATEGORIES.length,
      points_fetched: fetched,
      candidates: unique.length,
      inserted,
      locations: locIds.size,
      sources: srcIds.size,
      errors,
      duration_ms: Date.now() - startedAt.getTime(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (runId) {
      await db.from("ingest_runs").update({
        finished_at: new Date().toISOString(),
        fetched,
        error: msg.slice(0, 2000),
      }).eq("id", runId);
    }
    return json({ ok: false, error: msg, errors }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
