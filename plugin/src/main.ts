import { Plugin } from "obsidian";

import { SyncApi } from "./api";
import { E2eeState } from "./e2ee-state";
import { PluginStateStore } from "./plugin-state-store";
import { SettingsController } from "./settings-controller";
import { SyncCoordinator } from "./sync-coordinator";
import { SyncSettingTab } from "./settings";
import { SyncEngine } from "./sync-engine";
import type {
  LegacyPluginDataShape,
  PluginDataShape,
  SyncSettings,
  SyncState,
} from "./types";

const DEFAULT_SETTINGS: SyncSettings = {
  serverUrl: "http://127.0.0.1:3000",
  vaultId: "default",
  knownVaultIds: ["default"],
  includePatterns: [],
  ignorePatterns: [],
  deviceId: "",
  authToken: "",
  pollIntervalSecs: 2,
  autoSync: true,
};

const DEFAULT_STATE: SyncState = {
  vaultId: "default",
  files: {},
  lastSeq: 0,
  lastSyncAt: null,
  lastSyncError: null,
};

export default class ObsidianSyncPlugin extends Plugin {
  settings: SyncSettings = structuredClone(DEFAULT_SETTINGS);
  state: SyncState = structuredClone(DEFAULT_STATE);

  private engine!: SyncEngine;
  private coordinator!: SyncCoordinator;
  private settingsController!: SettingsController;
  private readonly e2eeState = new E2eeState();
  private readonly stateStore = new PluginStateStore();

  async onload(): Promise<void> {
    await this.loadPluginData();

    this.engine = new SyncEngine(
      this.app,
      () => this.settings,
      () => this.getE2eePassphrase(),
      async () => this.rememberCurrentE2eePassphrase(),
      () => this.state,
      async (state) => {
        this.state = state;
        await this.persistData();
      },
    );
    this.coordinator = new SyncCoordinator(
      () => this.settings,
      () => this.state,
      async (state) => {
        this.state = state;
        await this.persistData();
      },
      async () => this.engine.syncOnce(),
    );
    this.coordinator.markDirty();
    this.settingsController = new SettingsController(
      () => this.settings,
      (settings) => {
        this.settings = settings;
      },
      () => this.state,
      (state) => {
        this.state = state;
      },
      async () => this.persistData(),
      this.stateStore,
      this.e2eeState,
      this.coordinator,
    );

    this.addSettingTab(new SyncSettingTab(this.app, this, this.settingsController));

    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: async () => {
        await this.coordinator.runManualSync();
      },
    });

    this.registerEvent(
      this.app.vault.on("create", () => {
        this.coordinator.markDirty();
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", () => {
        this.coordinator.markDirty();
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", () => {
        this.coordinator.markDirty();
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", () => {
        this.coordinator.markDirty();
      }),
    );

    this.coordinator.restartAutoSync();
    void this.coordinator.runBackgroundSync();
  }

  onunload(): void {
    this.coordinator?.stop();
  }

  async persistData(): Promise<void> {
    this.stateStore.snapshotState(this.settings.vaultId, this.state);
    this.stateStore.saveCurrentVaultScope(this.settings);
    this.settings.knownVaultIds = this.stateStore.getKnownVaultIds(
      this.settings.knownVaultIds,
      this.settings.vaultId,
    );
    const data: PluginDataShape = {
      settings: this.settings,
      statesByVaultId: this.stateStore.statesByVaultId,
      vaultScopesById: this.stateStore.vaultScopesById,
      e2eeFingerprintsByVaultId: this.e2eeState.exportFingerprints(),
    };
    await this.saveData(data);
  }

  getE2eePassphrase(vaultId = this.settings.vaultId): string {
    return this.e2eeState.getPassphrase(vaultId);
  }

  async rememberCurrentE2eePassphrase(): Promise<void> {
    if (await this.e2eeState.rememberPassphrase(this.settings.vaultId)) {
      await this.persistData();
    }
  }

  private async loadPluginData(): Promise<void> {
    const raw = (await this.loadData()) as LegacyPluginDataShape | null;
    const rawSettings = raw?.settings ? stripLegacySecrets(raw.settings) : undefined;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...rawSettings,
      knownVaultIds: this.stateStore.getKnownVaultIds(
        rawSettings?.knownVaultIds,
        rawSettings?.vaultId || DEFAULT_SETTINGS.vaultId,
      ),
    };
    if (!this.settings.deviceId) {
      this.settings.deviceId = this.generateDeviceId();
    }
    this.e2eeState.replaceFingerprints({ ...(raw?.e2eeFingerprintsByVaultId ?? {}) });
    this.state = this.stateStore.load(raw, this.settings.vaultId);
    this.stateStore.applyVaultScope(this.settings, this.settings.vaultId);
  }

  private generateDeviceId(): string {
    return `device_${crypto.randomUUID().replace(/-/g, "_")}`;
  }

}

function stripLegacySecrets(settings: Partial<SyncSettings> & { e2eePassphrase?: string }): Partial<SyncSettings> {
  const { e2eePassphrase: _ignored, ...safeSettings } = settings;
  return safeSettings;
}
