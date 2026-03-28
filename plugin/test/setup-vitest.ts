import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

globalThis.__obsidian_plugin_require__ = (id: string) => {
  if (id === "obsidian") {
    return require("./mocks/obsidian.ts");
  }

  return require(id);
};
