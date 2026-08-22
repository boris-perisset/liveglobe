#!/usr/bin/env node
/**
 * `data/outlets.json` nach Supabase einspielen.
 *
 *   node scripts/outlets-import.mjs --probe     # nur die ersten 200, zum Ansehen
 *   node scripts/outlets-import.mjs             # alles
 *   node scripts/outlets-import.mjs --nur-mit-punkt
 *
 * Ruft `outlets_einspielen()` in der Datenbank auf — einen Aufruf je Block,
 * nicht vierzehntausend Einzelbefehle. Die Regeln, was überschrieben werden
 * darf, stehen dort und nicht hier: Sie gehören zu den Daten, nicht zum
 * Werkzeug, und sollen auch dann gelten, wenn jemand die Funktion von Hand
 * aufruft.
 *
 * **Die Datei wird nur gelesen.** Du kannst also parallel im Kurator sitzen;
 * ein späterer Lauf holt deine Ergänzungen nach — die Herkunft `handarbeit`
 * gewinnt gegen alles, was das Bauskript erzeugt.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const DATEI = path.join(WURZEL, "data", "outlets.json");
const BLOCK = 400;

const PROBE = process.argv.includes("--probe");
const NUR_MIT_PUNKT = process.argv.includes("--nur-mit-punkt");

// ------------------------------------------------------------------ Zugang
async function ausEnv(...namen) {
  const treffer = {};
  const pfad = path.join(WURZEL, ".env.local");
  if (existsSync(pfad)) {
    for (const zeile of (await readFile(pfad, "utf8")).split("\n")) {
      const t = zeile.trim().replace(/^export\s+/, "");
      const i = t.indexOf("=");
      if (i > 0) treffer[t.slice(0, i)] = t.slice(i + 1).replace(/^["']|["']$/g, "").trim();
    }
  }
  return namen.map((n) => process.env[n] ?? treffer[n] ?? null);
}

const [URL_, SERVICE] = await ausEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");

if (!URL_ || !SERVICE) {
  console.error(`
SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt in .env.local.

Den service_role-Schlüssel findest du im Supabase-Dashboard unter
Project Settings → API. Er ist NICHT derselbe wie der anon-Schlüssel.
`);
  process.exit(1);
}

/**
 * Prüfen, ob wirklich der service_role-Schlüssel eingetragen ist.
 *
 * In .env.local stand bisher zweimal derselbe Wert — beide JWTs trugen
 * `role = anon`. Ein anon-Schlüssel darf wegen der Zeilenrechte nicht
 * schreiben; der Lauf liefe dann bis zum Ende durch und schriebe **nichts**.
 * Ein stiller Fehlschlag ist schlimmer als ein lauter, deshalb hier der Blick
 * in den Schlüssel selbst.
 */
function rolle(jwt) {
  try {
    const teil = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(teil, "base64").toString()).role ?? "?";
  } catch {
    return "?";
  }
}
if (rolle(SERVICE) !== "service_role") {
  console.error(`
Der eingetragene SUPABASE_SERVICE_ROLE_KEY trägt die Rolle "${rolle(SERVICE)}",
nicht "service_role".

Mit einer anon-Rolle blockieren die Zeilenrechte jedes Schreiben — der Lauf
liefe durch und schriebe trotzdem nichts. Deshalb bricht er hier ab.

Richtigen Schlüssel holen: Supabase → Project Settings → API → service_role.
`);
  process.exit(1);
}

async function rpc(fn, koerper) {
  const res = await fetch(`${URL_.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(koerper),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// ------------------------------------------------------------------ Ablauf
if (!existsSync(DATEI)) {
  console.error(`\n${DATEI} fehlt.\nErst: node scripts/outlets-build.mjs\n`);
  process.exit(1);
}

let outlets = JSON.parse(await readFile(DATEI, "utf8"));
const gesamt = outlets.length;

if (NUR_MIT_PUNKT) outlets = outlets.filter((o) => o.lat != null);
if (PROBE) outlets = outlets.slice(0, 200);

const nachHerkunft = new Map();
for (const o of outlets) {
  const k = o.ort_herkunft ?? "ohne Punkt";
  nachHerkunft.set(k, (nachHerkunft.get(k) ?? 0) + 1);
}

console.log(`
──────────────────────────────────────────────────────────────
  ${gesamt} Outlets in der Datei${outlets.length !== gesamt ? `, ${outlets.length} werden eingespielt` : ""}`);
for (const [k, n] of [...nachHerkunft].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(6)}  ${k}`);
}
console.log("──────────────────────────────────────────────────────────────\n");

let neu = 0, erg = 0, gleich = 0;
const start = Date.now();

for (let i = 0; i < outlets.length; i += BLOCK) {
  const teil = outlets.slice(i, i + BLOCK);
  const zeit = Math.round((Date.now() - start) / 1000);
  process.stdout.write(
    `\r  [${String(Math.floor(zeit / 60)).padStart(2, "0")}:${String(zeit % 60).padStart(2, "0")}] ` +
    `${String(Math.min(i + BLOCK, outlets.length)).padStart(6)}/${outlets.length}   `,
  );
  try {
    const [r] = await rpc("outlets_einspielen", { p_daten: teil });
    neu += r.angelegt; erg += r.ergaenzt; gleich += r.unveraendert;
  } catch (e) {
    console.log(`\n  Block ab ${i} fehlgeschlagen: ${e.message}`);
  }
}

console.log(`

  ${String(neu).padStart(6)}  neu angelegt
  ${String(erg).padStart(6)}  ergänzt
  ${String(gleich).padStart(6)}  unverändert

  Nachsehen im SQL-Editor:

    select geo_quelle, count(*) from sources group by 1 order by 2 desc;
    select * from v_outlets_offen limit 30;

  Die zweite Abfrage ist die eigentliche Arbeitsliste: Outlets, die bei uns
  tatsächlich Meldungen geliefert haben und trotzdem keinen brauchbaren Punkt
  tragen. Deutlich kürzer als die 8181 aus der Datei.
`);
