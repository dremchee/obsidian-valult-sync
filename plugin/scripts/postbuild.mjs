import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = resolve(rootDir, "dist");
const loroPackageDir = resolve(rootDir, "node_modules", "loro-crdt");

export function runPostbuild() {
  mkdirSync(distDir, { recursive: true });
  copyFileSync(resolve(rootDir, "manifest.json"), resolve(distDir, "manifest.json"));
  copyLoroRuntime();

  const stylesPath = resolve(rootDir, "styles.css");
  if (existsSync(stylesPath)) {
    copyFileSync(stylesPath, resolve(distDir, "styles.css"));
  }
}

function copyLoroRuntime() {
  const loroDistDir = resolve(distDir, "node_modules", "loro-crdt");
  const loroNodeDir = resolve(loroDistDir, "nodejs");

  mkdirSync(loroNodeDir, { recursive: true });
  copyFileSync(resolve(loroPackageDir, "package.json"), resolve(loroDistDir, "package.json"));
  copyFileSync(resolve(loroPackageDir, "nodejs", "index.js"), resolve(loroNodeDir, "index.js"));
  copyFileSync(resolve(loroPackageDir, "nodejs", "loro_wasm.js"), resolve(loroNodeDir, "loro_wasm.js"));
  copyFileSync(resolve(loroPackageDir, "nodejs", "loro_wasm_bg.wasm"), resolve(loroNodeDir, "loro_wasm_bg.wasm"));
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
  runPostbuild();
}
