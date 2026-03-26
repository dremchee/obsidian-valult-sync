import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = resolve(rootDir, "dist");

export function runPostbuild() {
  mkdirSync(distDir, { recursive: true });
  copyFileSync(resolve(rootDir, "manifest.json"), resolve(distDir, "manifest.json"));

  const stylesPath = resolve(rootDir, "styles.css");
  if (existsSync(stylesPath)) {
    copyFileSync(stylesPath, resolve(distDir, "styles.css"));
  }
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
  runPostbuild();
}
