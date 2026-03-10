import { Notice, Plugin } from "obsidian";

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
  deviceId: "",
  authToken: "",
  pollIntervalSecs: 2,
  autoSync: true,
};

const DEFAULT_STATE: SyncState = {
  vaultId: "default",
  files: {},
  lastSeq: 0,
};

export default class ObsidianSyncPlugin extends Plugin {
  settings: SyncSettings = structuredClone(DEFAULT_SETTINGS);
  state: SyncState = structuredClone(DEFAULT_STATE);
  statesByVaultId: Record<string, SyncState> = {};

  private engine!: SyncEngine;
  private intervalId: number | null = null;
  private dirty = false;

  async onload(): Promise<void> {
    await this.loadPluginData();
    this.dirty = true;

    this.engine = new SyncEngine(
      this.app,
      () => this.settings,
      () => this.state,
      async (state) => {
        this.state = state;
        await this.persistData();
      },
    );

    this.addSettingTab(new SyncSettingTab(this.app, this));

    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: async () => {
        await this.runManualSync();
      },
    });

    this.registerEvent(
      this.app.vault.on("create", () => {
        this.dirty = true;
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", () => {
        this.dirty = true;
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", () => {
        this.dirty = true;
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", () => {
        this.dirty = true;
      }),
    );

    this.restartAutoSync();
    void this.safeSync();
  }

  onunload(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async persistData(): Promise<void> {
    this.state.vaultId = this.settings.vaultId;
    this.statesByVaultId[this.settings.vaultId] = structuredClone(this.state);
    const data: PluginDataShape = {
      settings: this.settings,
      statesByVaultId: this.statesByVaultId,
    };
    await this.saveData(data);
  }

  async activateVault(vaultId: string): Promise<void> {
    this.settings.vaultId = vaultId;
    this.state = this.getStateForVaultId(vaultId);
    this.dirty = true;
    await this.persistData();
  }

  restartAutoSync(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (!this.settings.autoSync) {
      return;
    }

    const intervalMs = Math.max(this.settings.pollIntervalSecs, 1) * 1000;
    this.intervalId = window.setInterval(async () => {
      if (!this.dirty && this.state.lastSeq > 0) {
        await this.safeSync();
        return;
      }

      this.dirty = false;
      await this.safeSync();
    }, intervalMs);
  }

  private async runManualSync(): Promise<void> {
    try {
      await this.engine.syncOnce();
      new Notice("Sync completed", 3000);
    } catch {
      // Notice is shown inside SyncEngine
    }
  }

  private async safeSync(): Promise<void> {
    try {
      await this.engine.syncOnce();
    } catch {
      // Notice is shown inside SyncEngine
    }
  }

  private async loadPluginData(): Promise<void> {
    const raw = (await this.loadData()) as LegacyPluginDataShape | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...raw?.settings,
    };
    if (!this.settings.deviceId) {
      this.settings.deviceId = this.generateDeviceId();
    }
    this.statesByVaultId = this.normalizePersistedStates(raw);
    this.state = this.getStateForVaultId(this.settings.vaultId);
  }

  private generateDeviceId(): string {
    return `device_${crypto.randomUUID().replace(/-/g, "_")}`;
  }

  private getStateForVaultId(vaultId: string): SyncState {
    const existing = this.statesByVaultId[vaultId];
    if (existing) {
      return {
        ...DEFAULT_STATE,
        ...existing,
        vaultId,
        files: {
          ...DEFAULT_STATE.files,
          ...existing.files,
        },
      };
    }

    const freshState: SyncState = {
      vaultId,
      files: {},
      lastSeq: 0,
    };
    this.statesByVaultId[vaultId] = structuredClone(freshState);
    return freshState;
  }

  private normalizePersistedStates(raw: LegacyPluginDataShape | null): Record<string, SyncState> {
    const statesByVaultId: Record<string, SyncState> = {};

    for (const [vaultId, state] of Object.entries(raw?.statesByVaultId ?? {})) {
      statesByVaultId[vaultId] = {
        ...DEFAULT_STATE,
        ...state,
        vaultId,
        files: {
          ...DEFAULT_STATE.files,
          ...state.files,
        },
      };
    }

    const legacyVaultId = raw?.state?.vaultId || this.settings.vaultId;
    if (raw?.state && !statesByVaultId[legacyVaultId]) {
      statesByVaultId[legacyVaultId] = {
        ...DEFAULT_STATE,
        ...raw.state,
        vaultId: legacyVaultId,
        files: {
          ...DEFAULT_STATE.files,
          ...raw.state.files,
        },
      };
    }

    return statesByVaultId;
  }
}
