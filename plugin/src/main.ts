import { Notice, Plugin } from "obsidian";

import { SyncSettingTab } from "./settings";
import { SyncEngine } from "./sync-engine";
import type { PluginDataShape, SyncSettings, SyncState } from "./types";

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
    const data: PluginDataShape = {
      settings: this.settings,
      state: this.state,
    };
    await this.saveData(data);
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
    const raw = (await this.loadData()) as Partial<PluginDataShape> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...raw?.settings,
    };
    if (!this.settings.deviceId) {
      this.settings.deviceId = this.generateDeviceId();
    }
    this.state = {
      ...DEFAULT_STATE,
      ...raw?.state,
      files: {
        ...DEFAULT_STATE.files,
        ...raw?.state?.files,
      },
    };

    if (this.state.vaultId !== this.settings.vaultId) {
      this.state = {
        vaultId: this.settings.vaultId,
        files: {},
        lastSeq: 0,
      };
    }
  }

  private generateDeviceId(): string {
    return `device_${crypto.randomUUID().replace(/-/g, "_")}`;
  }
}
