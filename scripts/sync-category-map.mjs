#!/usr/bin/env node
// data/category-map.json ist die einzige Quelle der Wahrheit.
// Die Edge Function braucht eine Kopie in ihrem eigenen Verzeichnis, weil
// `supabase functions deploy` nur diesen Ordner mitnimmt.
//
//   node scripts/sync-category-map.mjs           kopiert
//   node scripts/sync-category-map.mjs --check   prüft nur (für CI)

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "data", "category-map.json");
const dest = join(root, "supabase", "functions", "ingest", "category-map.json");

const source = await readFile(src, "utf8");

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = await readFile(dest, "utf8");
  } catch { /* fehlt */ }
  if (current !== source) {
    console.error(
      "category-map.json in supabase/functions/ingest ist nicht synchron.\n" +
        "Bitte `npm run sync:catmap` ausführen und committen.",
    );
    process.exit(1);
  }
  console.log("category-map.json ist synchron.");
} else {
  await writeFile(dest, source);
  console.log("category-map.json in die Edge Function kopiert.");
}
