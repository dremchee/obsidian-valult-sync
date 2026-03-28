import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(rootDir, "src"),
      obsidian: resolve(rootDir, "test/mocks/obsidian.ts"),
    },
  },
  test: {
    environment: "node",
    setupFiles: [resolve(rootDir, "test/setup-vitest.ts")],
  },
});
