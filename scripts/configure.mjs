#!/usr/bin/env node
/**
 * Richtet die lokalen Konfigurationsdateien ein, ohne dass Schlüssel per Hand
 * in mehrere Dateien kopiert werden müssen.
 *
 *   node scripts/configure.mjs
 *
 * Schreibt:
 *   frontend/.env.local              (anon-Key – landet im Browser, das ist so vorgesehen)
 *   hostpoint/snapshot.config.php    (anon-Key für den Snapshot-Cron)
 *   .env.local                       (service_role-Key für Seed und Deploy – bleibt lokal)
 *
 * Alle drei Dateien stehen in .gitignore und werden nie committet.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rl = createInterface({ input: stdin, output: stdout });

console.log(`
Globe News – Konfiguration
──────────────────────────
Die Werte findest du im Supabase-Dashboard unter Settings → API.
Nichts davon verlässt deinen Rechner.
`);

const ref = (await rl.question("Project Ref (z. B. abcdefghijklmnop): ")).trim();
if (!/^[a-z0-9]{15,25}$/.test(ref)) {
  console.error("\nDas sieht nicht nach einer Project Ref aus. Abbruch.");
  process.exit(1);
}

const anon = (await rl.question("anon public key: ")).trim();
const service = (await rl.question("service_role key (für Seed/Deploy, Enter zum Überspringen): ")).trim();
rl.close();

if (!anon.startsWith("ey") && !anon.startsWith("sb_")) {
  console.error("\nDer anon-Key sieht ungewöhnlich aus – bitte prüfen. Es wird trotzdem geschrieben.");
}

const url = `https://${ref}.supabase.co`;

await writeFile(
  join(root, "frontend", ".env.local"),
  `# Automatisch erzeugt von scripts/configure.mjs
VITE_SUPABASE_URL=${url}
VITE_SUPABASE_ANON_KEY=${anon}
VITE_SNAPSHOT_URL=./data/latest.json
`,
);

await mkdir(join(root, "hostpoint"), { recursive: true });
await writeFile(
  join(root, "hostpoint", "snapshot.config.php"),
  `<?php
// Automatisch erzeugt von scripts/configure.mjs – nicht committen.

declare(strict_types=1);

return [
    'supabase_url' => '${url}',
    'anon_key'     => '${anon}',
    'out_dir'      => __DIR__ . '/data',
    'zoom'         => 3,
];
`,
);

if (service) {
  await writeFile(
    join(root, ".env.local"),
    `# Automatisch erzeugt von scripts/configure.mjs – nicht committen.
export SUPABASE_URL=${url}
export SUPABASE_SERVICE_ROLE_KEY=${service}
`,
  );
}

console.log(`
Geschrieben:
  frontend/.env.local
  hostpoint/snapshot.config.php${service ? "\n  .env.local" : ""}

Weiter mit:
  ${service ? "source .env.local && npm run seed:sources" : "service_role-Key nachtragen, dann npm run seed:sources"}
`);
