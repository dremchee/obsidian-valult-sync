import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(rootDir, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
    target: "esnext",
    lib: {
      entry: resolve(rootDir, "main.ts"),
      formats: ["cjs"],
      fileName: () => "main.js",
    },
    rolldownOptions: {
      external: [
        "obsidian",
        "crypto",
        "fs",
        "loro-crdt/nodejs",
        "path",
        "util",
      ],
      output: {
        entryFileNames: "main.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
