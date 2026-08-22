#!/usr/bin/env node
/**
 * Baut das Frontend und legt daneben einen Ordner `upload/` an, dessen Inhalt
 * eins zu eins ins Web-Root von Hostpoint gehört. Damit muss niemand raten,
 * welche Datei wohin gehört – hochladen, was drin ist, fertig.
 *
 *   npm run package:hostpoint
 */

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ziel = join(wurzel, "upload");

// 1 ---------------------------------------------------------------- bauen
console.log("→ Frontend bauen …");
execSync("npm run build", { cwd: wurzel, stdio: "inherit" });

const dist = join(wurzel, "frontend", "dist");
if (!existsSync(join(dist, "index.html"))) {
  console.error("Build fehlgeschlagen: frontend/dist/index.html fehlt.");
  process.exit(1);
}

// 2 ---------------------------------------------------------------- sammeln
rmSync(ziel, { recursive: true, force: true });
mkdirSync(ziel, { recursive: true });

cpSync(dist, ziel, { recursive: true });
for (const datei of [".htaccess", "snapshot.php", "snapshot.config.example.php"]) {
  cpSync(join(wurzel, "hostpoint", datei), join(ziel, datei));
}

// Der Snapshot-Cron schreibt hierhin. Leer anlegen, damit die Rechte stimmen
// und die Seite auch vor dem ersten Cronlauf nicht ins Leere greift.
mkdirSync(join(ziel, "data"), { recursive: true });
writeFileSync(join(ziel, "data", ".gitkeep"), "");

// 3 ---------------------------------------------------------------- auflisten
const dateien = [];
const gehe = (ordner) => {
  for (const name of readdirSync(ordner)) {
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) gehe(pfad);
    else dateien.push([relative(ziel, pfad), statSync(pfad).size]);
  }
};
gehe(ziel);
dateien.sort((a, b) => a[0].localeCompare(b[0]));

const gesamt = dateien.reduce((s, [, n]) => s + n, 0);
console.log(`\n→ ${ziel}\n`);
for (const [pfad, n] of dateien) {
  console.log(`  ${pfad.padEnd(46)} ${(n / 1024).toFixed(1).padStart(8)} kB`);
}
console.log(`\n  ${dateien.length} Dateien, ${(gesamt / 1024 / 1024).toFixed(2)} MB gesamt`);
console.log(`
Nächste Schritte auf dem Server:
  1. Inhalt von upload/ ins Web-Root laden (nicht den Ordner selbst).
  2. snapshot.config.example.php → snapshot.config.php kopieren und ausfüllen.
  3. chmod 755 data
  4. Cronjob: */5 * * * *  /usr/local/bin/php <web-root>/snapshot.php
`);
