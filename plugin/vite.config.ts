import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
    target: "es2022",
    lib: {
      entry: resolve(rootDir, "main.ts"),
      formats: ["cjs"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      external: ["obsidian"],
      output: {
        exports: "default",
      },
    },
  },
});
