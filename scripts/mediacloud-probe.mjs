#!/usr/bin/env node
/**
 * Media Cloud abtasten — welche Felder gibt es überhaupt?
 *
 *   node scripts/mediacloud-probe.mjs
 *   node scripts/mediacloud-probe.mjs Schweiz
 *   node scripts/mediacloud-probe.mjs Switzerland --alle
 *
 * Das legt nichts an und ändert nichts. Es sucht eine Ländersammlung, holt ein
 * paar Outlets daraus und schreibt auf, welche Felder zurückkommen.
 *
 * Warum überhaupt abtasten: Die Feldstruktur der Directory-API ist öffentlich
 * nur halb dokumentiert. Dagegen blind zu programmieren hiesse raten — und
 * geraten haben wir in diesem Projekt schon genug.
 *
 * Der Schlüssel gehört in `.env.local` im Wurzelverzeichnis:
 *
 *     MEDIACLOUD_API_KEY=dein-schluessel
 *
 * Nicht auf die Kommandozeile: Dort landet er in der Shell-Historie und damit
 * dauerhaft in einer Datei, an die man später nicht mehr denkt. `.env.local`
 * ist bereits von der Versionsverwaltung ausgenommen.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const BASIS = "https://search.mediacloud.org/api";

// ------------------------------------------------------------------ Schlüssel
async function schluessel() {
  if (process.env.MEDIACLOUD_API_KEY) return process.env.MEDIACLOUD_API_KEY;

  const pfad = path.join(WURZEL, ".env.local");
  if (existsSync(pfad)) {
    const roh = await readFile(pfad, "utf8");
    for (const zeile of roh.split("\n")) {
      const t = zeile.trim().replace(/^export\s+/, "");
      if (t.startsWith("MEDIACLOUD_API_KEY=")) {
        return t.slice("MEDIACLOUD_API_KEY=".length).replace(/^["']|["']$/g, "").trim();
      }
    }
  }
  console.error(`
Kein Schlüssel gefunden.

Trag ihn in .env.local ein (im Ordner ${WURZEL}):

    MEDIACLOUD_API_KEY=dein-schluessel

Die Datei ist von Git ausgenommen. Danach nochmal starten.
`);
  process.exit(1);
}

const KEY = await schluessel();

async function api(pfad) {
  const url = `${BASIS}${pfad}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Token ${KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 400);
    throw new Error(`${res.status} ${res.statusText}\n  ${url}\n  ${text}`);
  }
  return res.json();
}

// ------------------------------------------------------------------ Ablauf
const suche = process.argv.find((a) => !a.startsWith("--") && !a.endsWith(".mjs") && !a.includes("node")) ?? "Switzerland";
const ALLE = process.argv.includes("--alle");

console.log(`\nSuche Sammlungen zu „${suche}" …\n`);

let sammlungen;
try {
  const daten = await api(`/sources/collections/?limit=5000`);
  const liste = daten.results ?? daten;
  sammlungen = liste.filter((c) =>
    String(c.name ?? "").toLowerCase().includes(suche.toLowerCase())
  );
} catch (e) {
  console.error("Sammlungen nicht abrufbar:\n  " + e.message);
  console.error("\nWenn hier 401 steht, stimmt der Schlüssel nicht.");
  console.error("Wenn 404 steht, hat sich die Adresse der API geändert —");
  console.error("dann schick mir diese Meldung, ich passe das Skript an.\n");
  process.exit(1);
}

if (!sammlungen.length) {
  console.log(`Keine Sammlung enthält „${suche}".`);
  console.log("Versuch es mit einem englischen Ländernamen, z. B. Switzerland.\n");
  process.exit(0);
}

console.log("Gefundene Sammlungen:");
for (const c of sammlungen.slice(0, 12)) {
  console.log(`  ${String(c.id).padStart(10)}  ${c.name}`);
}

// Die „National"-Sammlung ist die aussagekräftigste; sonst die erste.
const gewaehlt = sammlungen.find((c) => /national/i.test(c.name)) ?? sammlungen[0];
console.log(`\nHole Outlets aus: ${gewaehlt.name} (${gewaehlt.id})\n`);

let quellen;
try {
  const daten = await api(`/sources/sources/?collection_id=${gewaehlt.id}&limit=${ALLE ? 1000 : 5}`);
  quellen = daten.results ?? daten;
} catch (e) {
  console.error("Outlets nicht abrufbar:\n  " + e.message + "\n");
  process.exit(1);
}

if (!quellen.length) {
  console.log("Sammlung ist leer.\n");
  process.exit(0);
}

// ------------------------------------------------------------------ Das Eigentliche
console.log("── FELDER eines Outlets ──────────────────────────────────\n");
const erstes = quellen[0];
for (const [k, v] of Object.entries(erstes)) {
  const wert = v === null ? "—" : typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60);
  console.log(`  ${k.padEnd(26)} ${wert}`);
}

console.log("\n── Belegung über die Stichprobe ──────────────────────────\n");
const felder = new Set(quellen.flatMap((q) => Object.keys(q)));
for (const f of [...felder].sort()) {
  const belegt = quellen.filter((q) => q[f] !== null && q[f] !== undefined && q[f] !== "").length;
  console.log(`  ${f.padEnd(26)} ${String(belegt).padStart(4)}/${quellen.length}`);
}

// Die eine Frage, auf die es ankommt.
const ortsfelder = [...felder].filter((f) =>
  /lat|lon|coord|city|place|geo|address|region|state/i.test(f)
);
console.log("\n── Ortsangaben ───────────────────────────────────────────\n");
console.log(ortsfelder.length
  ? `  Mögliche Ortsfelder: ${ortsfelder.join(", ")}`
  : "  Keine. Wie erwartet — der Redaktionssitz kommt aus Wikidata.");

console.log(`\n${quellen.length} Outlets geladen. Mit --alle sind es bis zu 1000.\n`);
