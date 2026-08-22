import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * MapLibre lädt seinen Web Worker als eigene Datei nach – und bildet den
 * Dateinamen zur Laufzeit:
 *
 *   const name = import.meta.url.endsWith("-dev.mjs")
 *     ? "maplibre-gl-worker-dev.mjs" : "maplibre-gl-worker.mjs";
 *   return new URL(`./${name}`, import.meta.url).href;
 *
 * Weil der Name erst zur Laufzeit entsteht, kann Rollup ihn nicht erkennen und
 * legt die Datei folglich nicht ins Bündel. Im Browser zeigt die URL dann neben
 * den gebauten Chunk – auf eine Datei, die es dort nicht gibt. Der Worker
 * startet nicht, die Kacheln werden nie ausgepackt, das `load`-Ereignis der
 * Karte bleibt aus: eine leere Kugel ohne Länder und ohne Pins.
 *
 * Im Entwicklungsbetrieb fällt das nicht auf, weil Vite die Originaldatei
 * ausliefert und der Worker direkt daneben liegt.
 *
 * Also legen wir Worker und gemeinsamen Unterbau unverändert dorthin, wo
 * MapLibre sie sucht: neben den Chunk.
 */
function maplibreWorker(): Plugin {
  const dateien = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

  return {
    name: "globenews:maplibre-worker",
    apply: "build",
    generateBundle() {
      // Über package.json auflösen: maplibre-gl ist reines ESM und hat keinen
      // require-Einstieg, den `resolve("maplibre-gl")` finden könnte.
      const require = createRequire(import.meta.url);
      const ordner = join(dirname(require.resolve("maplibre-gl/package.json")), "dist");

      for (const name of dateien) {
        this.emitFile({
          type: "asset",
          // Fester Name, kein Hash: MapLibre setzt genau diesen Pfad zusammen.
          fileName: `assets/${name}`,
          source: readFileSync(join(ordner, name), "utf8"),
        });
      }
    },
  };
}

export default defineConfig({
  // Auf Hostpoint liegt die App im Web-Root. Für ein Unterverzeichnis hier anpassen.
  base: "./",
  plugins: [maplibreWorker()],
  // Ohne diese Zeile schreibt Vites Abhängigkeits-Optimierer im Entwicklungs-
  // betrieb dieselbe Worker-URL um. Erkennbar am Log:
  // "The file does not exist at .../deps/maplibre-gl-worker.mjs".
  optimizeDeps: { exclude: ["maplibre-gl"] },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2022",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // MapLibre ändert sich selten – als eigener Chunk bleibt er im Browser-Cache.
        manualChunks(id) {
          if (id.includes("node_modules/maplibre-gl")) return "map-vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true,
    // data/category-map.json liegt eine Ebene über dem Vite-Root
    fs: { allow: [".."] },
  },
});
