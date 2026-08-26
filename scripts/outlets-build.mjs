#!/usr/bin/env node
/**
 * Outlet-Register bauen: Media Cloud + Wikidata.
 *
 *   node scripts/outlets-build.mjs --nur-messen     # nichts schreiben
 *   node scripts/outlets-build.mjs                  # data/outlets.json
 *   node scripts/outlets-build.mjs --laender CH,DE,AT,FR
 *   node scripts/outlets-build.mjs --cache          # nichts neu holen
 *
 * Löst `outlets-wikidata.mjs` ab. Der Unterschied: Media Cloud ist die Basis,
 * nicht GDELT. GDELTs Länderzuordnung ist aus Erwähnungsmustern erschlossen
 * (ihr eigenes Beispiel: who.int landete in Guinea), Media Clouds Sammlungen
 * sind von Menschen gepflegt.
 *
 * ---------------------------------------------------------------------------
 * Der Ort — drei Stufen, jede mit vermerkter Herkunft
 * ---------------------------------------------------------------------------
 *
 *   1. Wikidata-Hauptsitz  → echte Stadtkoordinate, das Beste was es gibt
 *   2. `pub_state`         → ISO 3166-2, Kanton/Bundesland — Zürich gegen Bern
 *                            wird unterscheidbar, Stadtteile nicht
 *   3. `pub_country`       → Landeszentrum, letzter Ausweg
 *
 * Stufe 2 ist der eigentliche Fund: Sie kostet nichts und trägt die Bögen
 * bereits brauchbar. Ohne sie stünden alle französischen Medien in Paris.
 *
 * Jede Koordinate trägt `ort_herkunft`, damit später niemand eine
 * Kantonsmitte für einen Redaktionssitz hält.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const CACHE = path.join(WURZEL, ".cache", "outlets");
const ZIEL = path.join(WURZEL, "data");
const MC = "https://search.mediacloud.org/api";

const NUR_MESSEN = process.argv.includes("--nur-messen");
const NUR_CACHE = process.argv.includes("--cache");
const LAENDER_FILTER = (() => {
  const i = process.argv.indexOf("--laender");
  return i > 0 && process.argv[i + 1]
    ? new Set(process.argv[i + 1].toUpperCase().split(","))
    : null;
})();

const KENNUNG = "GlobeNews/0.1 (https://liveglobe.site; Outlet-Register)";

// ------------------------------------------------------------------ Werkzeug

/**
 * Registrierbare Domain — dieselbe Regel wie in `gn_basisdomain()` (Migration
 * 0027) und in `supabase/functions/ingest/index.ts`.
 *
 * **Zweistellige Länderendung + davor ein Verwaltungspräfix → drei Teile.**
 * Sonst zwei.
 *
 * Hier stand eine von Hand gepflegte Liste mit vierzig mehrteiligen Endungen.
 * Sie war unvollständig — die Welt hat mehrere hundert —, und was nicht
 * drinstand, wurde auf zwei Bestandteile gekürzt: aus `abc.com.py` wurde
 * `com.py`. Ergebnis waren **150 Registereinträge, die gar keine Domains sind**,
 * sondern abgeschnittene öffentliche Suffixe. Über die Hälfte trug sogar einen
 * Wikidata-Sitz, und jedes `*.com.py` des Bau-Laufs fiel auf dieselbe Zeile
 * zusammen — es war nicht nur Müll, es waren Kollisionen.
 *
 * Eine Liste, die vollständig sein muss, ist die falsche Bauart. Die Präfixe
 * dagegen sind endlich und stabil.
 *
 * Das ist nicht die Public Suffix List — die wäre genauer und brächte eine
 * Abhängigkeit samt Pflege mit. Für Nachrichtendomains trägt die Regel.
 */
const VERWALTUNGSPRAEFIX = new Set(
  ["com", "co", "net", "org", "gov", "edu", "ac", "or", "ne", "go", "mil", "int"],
);

function domain(roh) {
  if (!roh) return "";
  let d = String(roh).trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, "").split("/")[0].split(":")[0].replace(/\.$/, "");
  const t = d.split(".");
  if (t.length < 2) return d;
  if (t.length >= 3 && t[t.length - 1].length === 2 && VERWALTUNGSPRAEFIX.has(t[t.length - 2])) {
    return t.slice(-3).join(".");
  }
  return t.slice(-2).join(".");
}

const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));

const START = Date.now();
/** Verstrichene Zeit als mm:ss – damit man sieht, dass etwas vorangeht. */
function dauer() {
  const s = Math.round((Date.now() - START) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Eine Zeile, die sich selbst überschreibt.
 *
 * Ohne sie schweigt das Skript minutenlang und sieht dabei aus, als hänge es.
 * Ein Terminal zeigt Arbeit nur dadurch an, dass der Prompt fehlt — das ist
 * für jemanden, der selten im Terminal ist, kein brauchbares Signal.
 */
function laufend(text) {
  if (!process.stdout.isTTY) return;
  const platz = (process.stdout.columns ?? 80) - 1;
  process.stdout.write("\r" + text.slice(0, platz).padEnd(platz));
}
function fertigZeile(text) {
  if (process.stdout.isTTY) process.stdout.write("\r" + " ".repeat((process.stdout.columns ?? 80) - 1) + "\r");
  console.log(text);
}

let ausCache = false;
async function cache(datei, erzeugen) {
  const pfad = path.join(CACHE, datei);
  if (existsSync(pfad)) { ausCache = true; return JSON.parse(await readFile(pfad, "utf8")); }
  ausCache = false;
  if (NUR_CACHE) throw new Error(`--cache gesetzt, ${datei} fehlt.`);
  const daten = await erzeugen();
  await mkdir(CACHE, { recursive: true });
  await writeFile(pfad, JSON.stringify(daten));
  return daten;
}

async function mcSchluessel() {
  if (process.env.MEDIACLOUD_API_KEY) return process.env.MEDIACLOUD_API_KEY;
  const pfad = path.join(WURZEL, ".env.local");
  if (existsSync(pfad)) {
    for (const zeile of (await readFile(pfad, "utf8")).split("\n")) {
      const t = zeile.trim().replace(/^export\s+/, "");
      if (t.startsWith("MEDIACLOUD_API_KEY=")) {
        return t.slice(19).replace(/^["']|["']$/g, "").trim();
      }
    }
  }
  console.error("\nMEDIACLOUD_API_KEY fehlt in .env.local.\n");
  process.exit(1);
}
const KEY = await mcSchluessel();

async function mcApi(pfad) {
  const res = await fetch(`${MC}${pfad}`, {
    headers: { Authorization: `Token ${KEY}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${MC}${pfad}`);
  return res.json();
}

/** SPARQL gegen Wikidata. Eine Abfrage, nicht tausend Einzelanfragen. */
async function sparql(frage, datei) {
  return cache(datei, async () => {
    const url = "https://query.wikidata.org/sparql?format=json&query=" +
      encodeURIComponent(frage);
    const res = await fetch(url, {
      headers: { "User-Agent": KENNUNG, Accept: "application/sparql-results+json" },
    });
    if (!res.ok) throw new Error(`Wikidata ${res.status} ${res.statusText}`);
    return res.json();
  });
}

// ------------------------------------------------------------------ STUFE 1

async function mediaCloud() {
  console.log("\nSTUFE 1 — Media Cloud");
  laufend("  hole Sammlungsverzeichnis … (beim ersten Mal ein paar Sekunden)");

  const sammlungen = await cache("mc-collections.json", async () => {
    const d = await mcApi("/sources/collections/?limit=5000");
    return d.results ?? d;
  });

  // Konvention: „Switzerland - National". Nur die nationalen Sammlungen —
  // die regionalen enthalten dieselben Outlets nochmal.
  const national = sammlungen.filter((c) => / - National$/i.test(c.name ?? ""));
  fertigZeile(`  ${sammlungen.length} Sammlungen, davon ${national.length} nationale`);
  console.log(`  Jetzt Land für Land. Beim ersten Lauf dauert das einige Minuten.\n`);

  const outlets = new Map();
  let n = 0;

  for (const c of national) {
    const land = c.name.replace(/ - National$/i, "");
    n++;
    laufend(`  [${dauer()}] ${String(n).padStart(3)}/${national.length}  ${land} …  (${outlets.size} Outlets bisher)`);
    let quellen;
    try {
      quellen = await cache(`mc-${c.id}.json`, async () => {
        const alle = [];
        for (let offset = 0; offset < 5000; offset += 1000) {
          const d = await mcApi(`/sources/sources/?collection_id=${c.id}&limit=1000&offset=${offset}`);
          const teil = d.results ?? d;
          alle.push(...teil);
          if (teil.length < 1000) break;
          await schlafen(300);
        }
        return alle;
      });
    } catch (e) {
      console.log(`  ${String(n).padStart(3)}. ${land.padEnd(28)} FEHLER ${e.message.slice(0, 40)}`);
      continue;
    }

    for (const q of quellen) {
      const d = domain(q.name || q.homepage);
      if (!d || outlets.has(d)) continue;
      outlets.set(d, {
        domain: d,
        name: q.label || q.name || null,
        homepage: q.homepage ?? null,
        land_a3: q.pub_country ?? null,
        region_iso: q.pub_state ?? null,
        sprache: q.primary_language ?? null,
        medientyp: q.media_type ?? null,
        plattform: q.platform ?? null,
        pro_woche: q.stories_per_week ?? null,
        letzte_meldung: q.last_story ?? null,
        weitere_domains: (q.alternative_domains ?? []).map(domain).filter(Boolean),
        mc_id: q.id,
        mc_land: land,
      });
    }
    if (!ausCache) await schlafen(250); // nur beim echten Holen höflich warten
  }

  fertigZeile(`  [${dauer()}] fertig — ${outlets.size} Outlets aus ${national.length} Ländern`);
  return outlets;
}

// ------------------------------------------------------------------ STUFE 2

/** ISO-3166-2-Untereinheiten mit Koordinate — die regionale Auffanglinie. */
async function regionen() {
  console.log("\nSTUFE 2 — Regionen (ISO 3166-2)");
  laufend("  frage Wikidata nach allen Untereinheiten mit Koordinate …");
  const daten = await sparql(`
SELECT ?code ?coord WHERE {
  ?r wdt:P300 ?code .
  ?r wdt:P625 ?coord .
}`, "wd-regionen.json");

  const karte = new Map();
  for (const b of daten.results.bindings) {
    const m = b.coord.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    if (m) karte.set(b.code.value.toUpperCase(), { lat: +m[2], lon: +m[1] });
  }
  fertigZeile(`  [${dauer()}] ${karte.size} Untereinheiten mit Koordinate`);
  return karte;
}

/** Länder: alpha-3 → alpha-2 plus Landeszentrum. */
async function laender() {
  console.log("\nSTUFE 2b — Länder");
  laufend("  frage Wikidata nach Ländercodes …");
  const daten = await sparql(`
SELECT ?a2 ?a3 ?coord WHERE {
  ?c wdt:P297 ?a2 ; wdt:P298 ?a3 .
  OPTIONAL { ?c wdt:P625 ?coord . }
}`, "wd-laender.json");

  const karte = new Map();
  for (const b of daten.results.bindings) {
    const m = b.coord?.value?.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    karte.set(b.a3.value.toUpperCase(), {
      a2: b.a2.value.toUpperCase(),
      lat: m ? +m[2] : null,
      lon: m ? +m[1] : null,
    });
  }
  fertigZeile(`  [${dauer()}] ${karte.size} Länder`);
  return karte;
}

// ------------------------------------------------------------------ STUFE 3

const KLASSEN = [
  ["Q11032", "Zeitung"], ["Q1110794", "Tageszeitung"], ["Q17232649", "Online-Zeitung"],
  ["Q1002697", "Periodikum"], ["Q192283", "Nachrichtenagentur"],
  ["Q1616075", "Fernsehsender"], ["Q14350", "Radiosender"], ["Q1193236", "Nachrichtenmedium"],
];

async function wikidataOutlets() {
  console.log("\nSTUFE 3 — Wikidata: Redaktionssitze");
  const treffer = new Map();

  for (const [qid, bez] of KLASSEN) {
    let daten;
    laufend(`  [${dauer()}] frage Wikidata: ${bez} … (kann bis zu einer Minute dauern)`);
    try {
      daten = await sparql(`
SELECT ?item ?itemLabel ?site ?coord ?ownerLabel WHERE {
  ?item wdt:P31/wdt:P279* wd:${qid} ; wdt:P856 ?site ; wdt:P159 ?hq .
  ?hq wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P127|wdt:P749 ?owner . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,de,fr,es". }
}`, `wd-out-${qid}.json`);
    } catch (e) {
      console.log(`  ${bez.padEnd(20)} FEHLER: ${e.message}`);
      continue;
    }

    let neu = 0;
    for (const b of daten.results.bindings) {
      const d = domain(b.site?.value);
      if (!d || treffer.has(d)) continue;
      const m = b.coord.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
      if (!m) continue;
      treffer.set(d, {
        qid: b.item.value.split("/").pop(),
        wd_name: b.itemLabel?.value ?? null,
        eigentuemer: b.ownerLabel?.value ?? null,
        lat: +m[2], lon: +m[1],
      });
      neu++;
    }
    fertigZeile(`  ${bez.padEnd(20)} ${String(daten.results.bindings.length).padStart(6)} Zeilen → ${neu} neu`);
    if (!ausCache) await schlafen(1500);
  }
  fertigZeile(`  [${dauer()}] ${treffer.size} Domains mit Redaktionssitz`);
  return treffer;
}

// ------------------------------------------------------------------ Zusammen

console.log(`
──────────────────────────────────────────────────────────────
  Outlet-Register bauen${NUR_MESSEN ? "  (nur messen, nichts schreiben)" : ""}
  Abbrechen mit Ctrl+C. Geholtes landet in .cache/outlets/,
  ein zweiter Lauf ist dann sofort da.
──────────────────────────────────────────────────────────────`);

const mc = await mediaCloud();
const reg = await regionen();
const lnd = await laender();
const wd = await wikidataOutlets();

console.log("\nSTUFE 4 — Zusammenführen\n");

const zeilen = [];
for (const o of mc.values()) {
  const land = o.land_a3 ? lnd.get(o.land_a3.toUpperCase()) : null;
  const a2 = land?.a2 ?? null;
  if (LAENDER_FILTER && (!a2 || !LAENDER_FILTER.has(a2))) continue;

  // Der Sitz, absteigend nach Güte. Wikidata kennt die Stadt; pub_state die
  // Region; das Land bleibt als Notnagel. Was es war, steht daneben.
  const w = wd.get(o.domain) ?? o.weitere_domains.map((d) => wd.get(d)).find(Boolean);
  const region = o.region_iso ? reg.get(o.region_iso.toUpperCase()) : null;

  let lat = null, lon = null, herkunft = null;
  if (w) { lat = w.lat; lon = w.lon; herkunft = "wikidata_sitz"; }
  else if (region) { lat = region.lat; lon = region.lon; herkunft = "region_iso3166_2"; }
  else if (land?.lat != null) { lat = land.lat; lon = land.lon; herkunft = "land"; }

  zeilen.push({
    domain: o.domain,
    weitere_domains: o.weitere_domains,
    name: w?.wd_name || o.name,
    homepage: o.homepage,
    land: a2,
    region_iso: o.region_iso,
    sprache: o.sprache,
    medientyp: o.medientyp,
    eigentuemer: w?.eigentuemer ?? null,
    pro_woche: o.pro_woche,
    letzte_meldung: o.letzte_meldung,
    lat, lon,
    ort_herkunft: herkunft,
    wikidata: w?.qid ?? null,
    mc_id: o.mc_id,
  });
}

const n = zeilen.length;
const z = (f) => zeilen.filter(f).length;
const p = (x) => `${String(x).padStart(6)}  ${((x / n) * 100).toFixed(1).padStart(5)} %`;

console.log(`  Outlets gesamt                ${String(n).padStart(6)}`);
console.log(`  … mit Land                    ${p(z((r) => r.land))}`);
console.log(`  … mit Sprache                 ${p(z((r) => r.sprache))}`);
console.log(`  … mit Region (ISO 3166-2)     ${p(z((r) => r.region_iso))}`);
console.log(`  … mit Eigentümer              ${p(z((r) => r.eigentuemer))}`);
console.log("");
console.log(`  KOORDINATE gesamt             ${p(z((r) => r.lat !== null))}   ← trägt die Bögen`);
console.log(`    davon echter Sitz           ${p(z((r) => r.ort_herkunft === "wikidata_sitz"))}`);
console.log(`    davon Region                ${p(z((r) => r.ort_herkunft === "region_iso3166_2"))}`);
console.log(`    davon nur Land              ${p(z((r) => r.ort_herkunft === "land"))}`);

const aktiv = zeilen.filter((r) => (r.pro_woche ?? 0) >= 5);
if (aktiv.length) {
  const mitOrt = aktiv.filter((r) => r.lat !== null).length;
  console.log(`\n  Nur aktive Outlets (≥5 Meldungen/Woche): ${aktiv.length}`);
  console.log(`  … mit Koordinate              ${String(mitOrt).padStart(6)}  ${((mitOrt / aktiv.length) * 100).toFixed(1)} %`);
}

if (!NUR_MESSEN) {
  await mkdir(ZIEL, { recursive: true });
  const ziel = path.join(ZIEL, "outlets.json");
  zeilen.sort((a, b) => (b.pro_woche ?? 0) - (a.pro_woche ?? 0));
  await writeFile(ziel, JSON.stringify(zeilen, null, 2));
  console.log(`\n  → ${n} Einträge nach data/outlets.json (nach Aktivität sortiert)`);
  console.log(`  [${dauer()}] fertig. Weiter mit: node scripts/outlets-kurator.mjs\n`);
}
