// Kopiert die Globus-Texturen aus three-globe nach public/textures/.
// Die Bilder stammen von NASA Visible Earth (gemeinfrei) und werden deshalb
// nicht im Repo mitgeführt, sondern bei jedem Build frisch übernommen.

import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "node_modules", "three-globe", "example", "img");
const dest = join(here, "..", "public", "textures");

const FILES = ["earth-dark.jpg", "earth-night.jpg", "earth-topology.png"];

if (!existsSync(src)) {
  console.error("three-globe nicht gefunden – bitte zuerst `npm install` ausführen.");
  process.exit(1);
}

await mkdir(dest, { recursive: true });
for (const f of FILES) {
  await copyFile(join(src, f), join(dest, f));
}
console.log(`${FILES.length} Texturen nach public/textures kopiert.`);
