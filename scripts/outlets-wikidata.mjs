#!/usr/bin/env node
/**
 * Outlet-Register aus GDELT und Wikidata bauen.
 *
 *   node scripts/outlets-wikidata.mjs            # messen und schreiben
 *   node scripts/outlets-wikidata.mjs --nur-messen
 *   node scripts/outlets-wikidata.mjs --cache    # nichts neu holen
 *
 * Drei Stufen:
 *
 *   1. GDELT liefert Identität: Domain, Land, formaler Name. Rund 13'000
 *      Domains, zwei Dateien, keine Ratengrenze.
 *   2. Wikidata liefert den Redaktionssitz mit Koordinate — das Einzige, was
 *      GDELT nicht hat und ohne das es keine Bögen gibt.
 *   3. Zusammenführen über die registrierbare Domain, dann Bericht.
 *
 * **Wichtig zur zweiten Stufe:** Nicht 13'000 Einzelabfragen. Wikidata wird
 * *einmal je Medienklasse* nach allen Outlets mit Webseite gefragt; verglichen
 * wird danach hier. Das sind gut ein Dutzend Abfragen statt dreizehntausend,
 * und die Namensangleichung passiert im Code, wo sie sich prüfen lässt.
 *
 * Nichts davon läuft im Ingest. Siehe Kommentar bei STUFE 2.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const CACHE = path.join(WURZEL, ".cache", "outlets");
const ZIEL = path.join(WURZEL, "data");

const NUR_MESSEN = process.argv.includes("--nur-messen");
const NUR_CACHE = process.argv.includes("--cache");

// Wikidata verlangt eine sprechende Kennung. Ohne sie wird gedrosselt oder
// abgewiesen — und zwar zu Recht.
const KENNUNG =
  "GlobeNews/0.1 (https://liveglobe.site; Outlet-Register) node-fetch";

const GDELT = {
  laender: "http://data.gdeltproject.org/supportingdatasets/DOMAINSBYCOUNTRY-ENGLISH.TXT",
  namen: "http://data.gdeltproject.org/blog/2018-news-outlets-domain-info-may2018/MASTER-GDELTDOMAINSINFO-MAY2018.TXT",
};

/**
 * Medienklassen in Wikidata.
 *
 * Getrennt abgefragt, nicht in einem Rutsch: Eine einzige Abfrage über alle
 * Unterklassen läuft regelmässig in die 60-Sekunden-Grenze des Dienstes.
 */
const KLASSEN = [
  ["Q11032", "Zeitung"],
  ["Q1110794", "Tageszeitung"],
  ["Q17232649", "Online-Zeitung"],
  ["Q1002697", "Periodikum"],
  ["Q192283", "Nachrichtenagentur"],
  ["Q1616075", "Fernsehsender"],
  ["Q14350", "Radiosender"],
  ["Q1193236", "Nachrichtenmedium"],
];

// ------------------------------------------------------------------ Werkzeug

const MEHRTEILIG = new Set(
  ("co.uk com.au co.za com.br co.jp co.in com.ng co.ke com.mx co.nz com.tr " +
    "com.ar co.il com.sg com.pk com.ph net.au org.uk com.cn co.id com.my " +
    "co.th com.tw com.hk co.kr com.ua com.pe com.co com.ve com.eg com.sa " +
    "com.vn co.ug co.tz com.gh com.bd com.np com.lb com.tn com.uy com.ec")
    .split(" "),
);

/** Domain auf ihren registrierbaren Teil bringen — der Schlüssel für alles. */
function domain(roh) {
  if (!roh) return "";
  let d = String(roh).trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, "").split("/")[0].split(":")[0];
  d = d.replace(/^www\d?\./, "");
  const teile = d.split(".");
  if (teile.length >= 3 && MEHRTEILIG.has(teile.slice(-2).join("."))) {
    return teile.slice(-3).join(".");
  }
  return teile.length >= 2 ? teile.slice(-2).join(".") : d;
}

async function holen(url, datei, { json = false } = {}) {
  const pfad = path.join(CACHE, datei);
  if (existsSync(pfad)) {
    const inhalt = await readFile(pfad, "utf8");
    return json ? JSON.parse(inhalt) : inhalt;
  }
  if (NUR_CACHE) throw new Error(`--cache gesetzt, aber ${datei} fehlt.`);

  process.stderr.write(`  hole ${datei} …`);
  const res = await fetch(url, { headers: { "User-Agent": KENNUNG } });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  const text = await res.text();
  await mkdir(CACHE, { recursive: true });
  await writeFile(pfad, text);
  process.stderr.write(` ${(text.length / 1024 / 1024).toFixed(1)} MB\n`);
  return json ? JSON.parse(text) : text;
}

const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ STUFE 1

async function gdeltRegister() {
  console.log("\nSTUFE 1 — GDELT");

  const laenderRoh = await holen(GDELT.laender, "domainsbycountry.txt");
  const namenRoh = await holen(GDELT.namen, "domainsinfo.txt");

  const register = new Map();

  // Aufbau: Domain <tab> FIPS <tab> Ländername
  for (const zeile of laenderRoh.split("\n")) {
    const [dom, fips, name] = zeile.split("\t");
    const d = domain(dom);
    if (!d) continue;
    register.set(d, { domain: d, fips: fips?.trim() || null, land_name: name?.trim() || null });
  }

  // Aufbau: Domain <tab> formaler Name <tab> Bild
  let mitNamen = 0;
  for (const zeile of namenRoh.split("\n")) {
    const [dom, name] = zeile.split("\t");
    const d = domain(dom);
    if (!d || !name?.trim()) continue;
    const e = register.get(d) ?? { domain: d, fips: null, land_name: null };
    e.name = name.trim();
    register.set(d, e);
    mitNamen++;
  }

  console.log(`  ${register.size} Domains, davon ${mitNamen} mit formalem Namen`);
  return register;
}

// ------------------------------------------------------------------ STUFE 2

/**
 * Wikidata je Medienklasse abfragen.
 *
 * **Das läuft bewusst hier und nicht im Ingest.** Der Ingest arbeitet alle 15
 * Minuten und muss langweilig bleiben: Fällt Wikidata aus oder drosselt, darf
 * das keine einzige Meldung kosten. Der Ingest schreibt unbekannte Domains nur
 * auf die Warteliste; angereichert wird getrennt und wiederholbar.
 */
async function wikidata() {
  console.log("\nSTUFE 2 — Wikidata");
  const treffer = new Map();

  for (const [qid, bezeichnung] of KLASSEN) {
    const sparql = `
SELECT ?item ?itemLabel ?site ?coord ?iso ?langLabel ?ownerLabel WHERE {
  ?item wdt:P31/wdt:P279* wd:${qid} .
  ?item wdt:P856 ?site .
  OPTIONAL { ?item wdt:P159 ?hq . ?hq wdt:P625 ?coord . }
  OPTIONAL { ?item wdt:P17 ?land . ?land wdt:P297 ?iso . }
  OPTIONAL { ?item wdt:P407 ?lang . }
  OPTIONAL { ?item wdt:P127|wdt:P749 ?owner . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,de,fr,es". }
}`;
    const url = "https://query.wikidata.org/sparql?format=json&query=" +
      encodeURIComponent(sparql);

    let daten;
    try {
      daten = await holen(url, `wd-${qid}.json`, { json: true });
    } catch (e) {
      console.log(`  ${bezeichnung.padEnd(20)} FEHLER: ${e.message}`);
      continue;
    }

    let neu = 0;
    for (const b of daten.results.bindings) {
      const d = domain(b.site?.value);
      if (!d) continue;
      // Erster Treffer gewinnt: Die Klassen sind nach Aussagekraft geordnet,
      // „Zeitung" ist eine bessere Auskunft als „Nachrichtenmedium".
      if (treffer.has(d)) continue;

      let lat = null, lon = null;
      const punkt = b.coord?.value?.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
      if (punkt) { lon = Number(punkt[1]); lat = Number(punkt[2]); }

      treffer.set(d, {
        qid: b.item.value.split("/").pop(),
        wd_name: b.itemLabel?.value ?? null,
        iso: b.iso?.value ?? null,
        sprache: b.langLabel?.value ?? null,
        eigentuemer: b.ownerLabel?.value ?? null,
        lat, lon,
        klasse: bezeichnung,
      });
      neu++;
    }
    console.log(`  ${bezeichnung.padEnd(20)} ${String(daten.results.bindings.length).padStart(6)} Zeilen → ${neu} neue Domains`);
    await schlafen(1500); // höflich bleiben
  }

  const mitOrt = [...treffer.values()].filter((t) => t.lat !== null).length;
  console.log(`  ${treffer.size} Domains gefunden, ${mitOrt} davon mit Koordinate`);
  return treffer;
}

// ------------------------------------------------------------------ STUFE 3

function bericht(gdelt, wd, eigene) {
  console.log("\nSTUFE 3 — Abgleich\n");

  const zeilen = [];
  for (const [d, g] of gdelt) {
    const w = wd.get(d);
    zeilen.push({
      domain: d,
      name: w?.wd_name || g.name || null,
      land_iso: w?.iso ?? null,
      land_gdelt: g.land_name ?? null,
      sprache: w?.sprache ?? null,
      eigentuemer: w?.eigentuemer ?? null,
      lat: w?.lat ?? null,
      lon: w?.lon ?? null,
      wikidata: w?.qid ?? null,
      klasse: w?.klasse ?? null,
      // Woher jede Angabe stammt — das verlangt §13 des Konzeptpapiers.
      herkunft: {
        name: w?.wd_name ? "wikidata" : g.name ? "gdelt" : null,
        land: w?.iso ? "wikidata" : g.land_name ? "gdelt" : null,
        ort: w?.lat != null ? "wikidata" : null,
      },
    });
  }

  const n = zeilen.length;
  const zaehl = (f) => zeilen.filter(f).length;
  const p = (x) => `${String(x).padStart(6)}  ${((x / n) * 100).toFixed(1).padStart(5)} %`;

  console.log(`  Domains aus GDELT gesamt      ${String(n).padStart(6)}`);
  console.log(`  … mit formalem Namen          ${p(zaehl((z) => z.name))}`);
  console.log(`  … mit Land                    ${p(zaehl((z) => z.land_iso || z.land_gdelt))}`);
  console.log(`  … in Wikidata gefunden        ${p(zaehl((z) => z.wikidata))}`);
  console.log(`  … MIT KOORDINATE              ${p(zaehl((z) => z.lat !== null))}   ← trägt die Bögen`);
  console.log(`  … mit Eigentümer              ${p(zaehl((z) => z.eigentuemer))}`);

  if (eigene?.size) {
    const drin = [...eigene].filter((d) => gdelt.has(d)).length;
    const mitOrt = [...eigene].filter((d) => wd.get(d)?.lat != null).length;
    console.log(`\n  Deine Excel: ${eigene.size} Domains`);
    console.log(`  … von GDELT gekannt           ${String(drin).padStart(6)}  ${((drin / eigene.size) * 100).toFixed(1)} %`);
    console.log(`  … mit Koordinate              ${String(mitOrt).padStart(6)}  ${((mitOrt / eigene.size) * 100).toFixed(1)} %`);
  }

  const ohneOrt = zeilen.filter((z) => z.wikidata && z.lat === null).slice(0, 12);
  if (ohneOrt.length) {
    console.log("\n  In Wikidata, aber ohne Sitz — Kandidaten für Handarbeit:");
    for (const z of ohneOrt) console.log(`    ${z.domain.padEnd(28)} ${z.name ?? ""}`);
  }

  return zeilen;
}

// ------------------------------------------------------------------ Ablauf

async function eigeneDomains() {
  const pfad = path.join(ZIEL, "sources.seed.json");
  if (!existsSync(pfad)) return new Set();
  try {
    const roh = JSON.parse(await readFile(pfad, "utf8"));
    const liste = Array.isArray(roh) ? roh : roh.sources ?? [];
    return new Set(liste.map((s) => domain(s.domain)).filter(Boolean));
  } catch {
    return new Set();
  }
}

const gdelt = await gdeltRegister();
const wd = await wikidata();
const zeilen = bericht(gdelt, wd, await eigeneDomains());

if (!NUR_MESSEN) {
  await mkdir(ZIEL, { recursive: true });
  const ziel = path.join(ZIEL, "outlets.enriched.json");
  // Nur was einen Namen hat: Eine Domain ohne jede Auskunft ist kein Outlet,
  // sondern eine Zeile.
  const brauchbar = zeilen.filter((z) => z.name || z.wikidata);
  await writeFile(ziel, JSON.stringify(brauchbar, null, 2));
  console.log(`\n  → ${brauchbar.length} Einträge nach data/outlets.enriched.json`);
  console.log("     Vor dem Einspielen durchsehen. Die Länderzuordnung von GDELT");
  console.log("     ist erschlossen, nicht erhoben — who.int landete dort in Guinea.");
}
