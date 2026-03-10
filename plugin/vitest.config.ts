import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      obsidian: resolve(rootDir, "test/mocks/obsidian.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
