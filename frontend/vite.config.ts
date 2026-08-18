import { defineConfig } from "vite";

export default defineConfig({
  // Auf Hostpoint liegt die App im Web-Root. Für ein Unterverzeichnis hier anpassen.
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2022",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // three.js ändert sich selten – als eigener Chunk bleibt er im Browser-Cache.
        manualChunks(id) {
          if (id.includes("node_modules/three") || id.includes("node_modules/globe.gl")) {
            return "globe-vendor";
          }
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
