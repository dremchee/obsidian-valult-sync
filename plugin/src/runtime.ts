import type { App } from "obsidian";

import { E2eeState } from "./e2ee/state";
import { SettingsController } from "./settings/controller";
import { PluginStateStore } from "./state/store";
import { SyncCoordinator } from "./sync/coordinator";
import { SyncEngine } from "./sync/engine";
import type { SyncSettings, SyncState } from "./types";

export const DEFAULT_SETTINGS: SyncSettings = {
  serverUrl: "http://127.0.0.1:3000",
  vaultId: "",
  includePatterns: [],
  ignorePatterns: [],
  deviceId: "",
  authToken: "",
  pollIntervalSecs: 2,
  autoSync: true,
};

export const DEFAULT_STATE: SyncState = {
  vaultId: "",
  files: {},
  lastSeq: 0,
  lastSyncAt: null,
  lastSyncError: null,
};

export interface PluginRuntime {
  engine: SyncEngine;
  coordinator: SyncCoordinator;
  settingsController: SettingsController;
}

export function createPluginRuntime(options: {
  app: App;
  getSettings: () => SyncSettings;
  setSettings: (settings: SyncSettings) => void;
  getState: () => SyncState;
  setState: (state: SyncState) => Promise<void>;
  persistData: () => Promise<void>;
  getE2eePassphrase: () => string;
  rememberCurrentE2eePassphrase: () => Promise<void>;
  e2eeState: E2eeState;
  stateStore: PluginStateStore;
}): PluginRuntime {
  const engine = new SyncEngine(
    options.app,
    options.getSettings,
    options.getE2eePassphrase,
    options.rememberCurrentE2eePassphrase,
    options.getState,
    options.setState,
  );

  const coordinator = new SyncCoordinator(
    options.getSettings,
    options.getState,
    options.setState,
    async () => engine.syncOnce(),
  );

  const settingsController = new SettingsController(
    options.getSettings,
    options.setSettings,
    options.getState,
    (state) => {
      void options.setState(state);
    },
    options.persistData,
    options.stateStore,
    options.e2eeState,
    coordinator,
  );

  return {
    engine,
    coordinator,
    settingsController,
  };
}
