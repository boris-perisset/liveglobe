#!/usr/bin/env node
// Spielt data/sources.seed.json in die Supabase-Tabelle `sources` ein.
//
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/seed-sources.mjs

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.");
  process.exit(1);
}

const raw = JSON.parse(await readFile(join(root, "data", "sources.seed.json"), "utf8"));
const rows = raw.sources.map((s) => ({
  domain: s.domain,
  name: s.name ?? null,
  country: s.country ?? null,
  home_geom:
    typeof s.lat === "number" && typeof s.lon === "number"
      ? `SRID=4326;POINT(${s.lon} ${s.lat})`
      : null,
  bias: s.bias ?? null,
  bias_source: s.bias_source ?? null,
  factuality: s.factuality ?? null,
  ownership: s.ownership ?? "unknown",
  is_active: s.is_active !== false,
}));

const res = await fetch(`${url}/rest/v1/sources?on_conflict=domain`, {
  method: "POST",
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=representation",
  },
  body: JSON.stringify(rows),
});

if (!res.ok) {
  console.error(`Fehler ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const data = await res.json();
console.log(`${data.length} Quellen eingespielt.`);
