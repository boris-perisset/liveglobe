#!/usr/bin/env node
/**
 * Schreibt die lokalen Konfigurationsdateien, damit die Supabase-Schlüssel nur
 * einmal eingegeben werden müssen. Nichts davon verlässt den Rechner.
 *
 * Zwei Wege:
 *
 *   node scripts/configure.mjs
 *       fragt die Werte nacheinander ab
 *
 *   node scripts/configure.mjs <project-ref> <anon-key> [service-key]
 *       nimmt sie direkt entgegen (praktisch, wenn die Eingabeaufforderung zickt)
 *
 * Erzeugt:
 *   frontend/.env.local            anon-Key fürs Frontend (öffentlich, RLS schützt die Daten)
 *   hostpoint/snapshot.config.php  anon-Key für den Snapshot-Cron
 *   .env.local                     service_role-Key für Seed und Deploy (bleibt lokal)
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

process.stdout.write("\nGlobe News – Konfiguration\n──────────────────────────\n");

async function ask(frage) {
  const { createInterface } = await import("node:readline");
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(frage, (antwort) => {
      rl.close();
      resolve(antwort.trim());
    });
  });
}

try {
  const [argRef, argAnon, argService] = process.argv.slice(2);

  let ref = argRef;
  let anon = argAnon;
  let service = argService;

  if (!ref || !anon) {
    process.stdout.write(
      "Die Werte stehen im Supabase-Dashboard unter Settings → API.\n\n",
    );
    ref = ref || (await ask("Project Ref (z. B. abcdefghijklmnop): "));
    anon = anon || (await ask("anon public key: "));
    service = service || (await ask("service_role / secret key (Enter zum Überspringen): "));
  }

  ref = (ref || "").trim();
  anon = (anon || "").trim();
  service = (service || "").trim();

  if (!ref) throw new Error("Keine Project Ref angegeben.");
  if (!anon) throw new Error("Kein anon-Key angegeben.");

  // Falls jemand die ganze URL einsetzt statt nur der Ref
  const refMatch = /^https?:\/\/([a-z0-9]+)\.supabase\.co\/?$/i.exec(ref);
  if (refMatch) ref = refMatch[1];

  if (!/^[a-z0-9]{15,25}$/.test(ref)) {
    process.stdout.write(
      `\nHinweis: "${ref}" sieht ungewöhnlich aus für eine Project Ref. Es wird trotzdem geschrieben.\n`,
    );
  }

  const url = `https://${ref}.supabase.co`;
  const geschrieben = [];

  await writeFile(
    join(root, "frontend", ".env.local"),
    `# Automatisch erzeugt von scripts/configure.mjs
VITE_SUPABASE_URL=${url}
VITE_SUPABASE_ANON_KEY=${anon}
VITE_SNAPSHOT_URL=./data/latest.json
`,
  );
  geschrieben.push("frontend/.env.local");

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
  geschrieben.push("hostpoint/snapshot.config.php");

  if (service) {
    await writeFile(
      join(root, ".env.local"),
      `# Automatisch erzeugt von scripts/configure.mjs – nicht committen.
export SUPABASE_URL=${url}
export SUPABASE_SERVICE_ROLE_KEY=${service}
`,
    );
    geschrieben.push(".env.local");
  }

  process.stdout.write(`\nGeschrieben:\n${geschrieben.map((f) => "  " + f).join("\n")}\n`);
  process.stdout.write(
    service
      ? "\nWeiter mit:\n  source .env.local && npm run seed:sources\n\n"
      : "\nOhne service_role-Key kein Seed. Nochmal aufrufen und den Key mitgeben, wenn du ihn hast.\n\n",
  );
} catch (fehler) {
  process.stderr.write(`\nFehlgeschlagen: ${fehler.message}\n\n`);
  process.exitCode = 1;
}
