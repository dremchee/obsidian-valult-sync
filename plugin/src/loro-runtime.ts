import type * as LoroModule from "loro-crdt/nodejs";

declare const require: ((id: string) => unknown) | undefined;

declare global {
  var __obsidian_plugin_dir__: string | undefined;
}

interface ModuleApi {
  createRequire: (filename: string) => (id: string) => unknown;
}

interface PathApi {
  join: (...parts: string[]) => string;
}

function getRequire(): (id: string) => unknown {
  if (typeof require === "function") {
    return require;
  }

  return Function("return require")() as (id: string) => unknown;
}

function loadLoroRuntime(): typeof LoroModule {
  const runtimeRequire = getRequire();

  try {
    return runtimeRequire("loro-crdt/nodejs") as typeof LoroModule;
  } catch {
    const moduleApi = runtimeRequire("module") as ModuleApi;
    const pathApi = runtimeRequire("path") as PathApi;
    const pluginDir = globalThis.__obsidian_plugin_dir__;

    if (!pluginDir) {
      throw new Error("Obsidian plugin directory is not initialized");
    }

    const pluginEntryPath = pathApi.join(pluginDir, "main.js");
    const pluginRequire = moduleApi.createRequire(pluginEntryPath);
    return pluginRequire("./node_modules/loro-crdt/nodejs") as typeof LoroModule;
  }
}

let cachedRuntime: typeof LoroModule | null = null;

function getRuntime(): typeof LoroModule {
  if (cachedRuntime) {
    return cachedRuntime;
  }

  cachedRuntime = loadLoroRuntime();
  return cachedRuntime;
}

export function getLoroDoc(): typeof LoroModule.LoroDoc {
  return getRuntime().LoroDoc;
}
