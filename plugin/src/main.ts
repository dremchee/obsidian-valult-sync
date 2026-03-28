import { Notice, Plugin, TFile } from "obsidian";

import { registerPluginTranslations, t } from "./i18n";
import { registerPluginCommands, registerVaultDirtyTracking } from "./plugin-registration";
import {
  createPluginRuntime,
  DEFAULT_SETTINGS,
  DEFAULT_STATE,
  type PluginRuntime,
} from "./runtime";
import { SyncSettingTab } from "./settings/tab";
import { PluginStateStore } from "./state/store";
import { PluginStatusBar } from "./ui/status-bar";
import type {
  PluginDataShape,
  RestoreDocumentRequest,
  SyncSettings,
  SyncState,
} from "./types";

export default class ObsidianSyncPlugin extends Plugin {
  settings: SyncSettings = structuredClone(DEFAULT_SETTINGS);
  state: SyncState = structuredClone(DEFAULT_STATE);

  private engine!: PluginRuntime["engine"];
  private coordinator!: PluginRuntime["coordinator"];
  private settingsController!: PluginRuntime["settingsController"];
  private statusBar!: PluginStatusBar;
  private readonly stateStore = new PluginStateStore();

  async onload(): Promise<void> {
    registerPluginTranslations();
    await this.loadPluginData();
    this.initializePluginRuntimeGlobals();

    const runtime = createPluginRuntime({
      app: this.app,
      getSettings: () => this.settings,
      setSettings: (settings) => {
        this.settings = settings;
      },
      getState: () => this.state,
      setState: async (state) => {
        this.state = state;
        await this.persistData();
      },
      persistData: async () => this.persistData(),
      stateStore: this.stateStore,
    });
    this.engine = runtime.engine;
    this.coordinator = runtime.coordinator;
    this.coordinator.markDirty();
    this.settingsController = runtime.settingsController;

    this.addSettingTab(new SyncSettingTab(this.app, this, this.settingsController));
    this.statusBar = new PluginStatusBar(
      this.addStatusBarItem(),
      () => this.getStatusBarSnapshot(),
      () => this.openSettingsTab(),
    );
    this.statusBar.start();

    registerPluginCommands({
      app: this.app,
      plugin: this,
      getSettings: () => this.settings,
      getState: () => this.state,
      coordinator: this.coordinator,
      settingsController: this.settingsController,
      restoreActiveFileToPreviousServerVersion: async (activeFile, currentVersion) => {
        await this.restoreActiveFileToPreviousServerVersion(activeFile, currentVersion);
      },
      restoreActiveFileToServerVersion: async (activeFile, currentVersion, targetVersion) => {
        await this.restoreActiveFileToServerVersion(activeFile, currentVersion, targetVersion);
      },
    });
    registerVaultDirtyTracking(this, this.app, this.coordinator);

    this.coordinator.restartAutoSync();
    void this.coordinator.runBackgroundSync();
  }

  onunload(): void {
    this.statusBar?.stop();
    this.coordinator?.stop();
  }

  async persistData(): Promise<void> {
    this.stateStore.snapshotState(this.settings.vaultId, this.state);
    this.stateStore.saveCurrentScope(this.settings);
    const data: PluginDataShape = {
      settings: this.settings,
      state: this.stateStore.getState(),
      scope: this.stateStore.scope,
    };
    await this.saveData(data);
  }

  private async loadPluginData(): Promise<void> {
    const raw = (await this.loadData()) as PluginDataShape | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...raw?.settings,
    };
    if (!this.settings.deviceId) {
      this.settings.deviceId = this.generateDeviceId();
    }
    this.state = this.stateStore.load(raw, this.settings.vaultId);
    this.stateStore.applyScope(this.settings);
  }

  private generateDeviceId(): string {
    return `device_${crypto.randomUUID().replace(/-/g, "_")}`;
  }

  private initializePluginRuntimeGlobals(): void {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    const basePath = typeof adapter.getBasePath === "function" ? adapter.getBasePath() : null;

    globalThis.__obsidian_plugin_dir__ = this.manifest.dir && basePath
      ? this.manifest.dir.startsWith("/")
        ? this.manifest.dir
        : `${basePath}/${this.manifest.dir}`
      : undefined;
  }

  private getStatusBarSnapshot(): {
    state: "ok" | "pending" | "syncing" | "error" | "disabled";
    statusText: string;
    lastSyncAt: number | null;
    vaultId: string;
    lastError: string | null;
  } {
    if (!this.settings.autoSync) {
      return {
        state: "disabled",
        statusText: this.settings.vaultId.trim()
          ? t("status.autoSyncOff")
          : t("status.noVaultConnected"),
        lastSyncAt: this.state.lastSyncAt,
        vaultId: this.settings.vaultId || t("settings.common.notConnected"),
        lastError: this.state.lastSyncError?.message ?? null,
      };
    }

    if (this.coordinator.isSyncing()) {
      return {
        state: "syncing",
        statusText: t("status.syncing"),
        lastSyncAt: this.state.lastSyncAt,
        vaultId: this.settings.vaultId || t("settings.common.notConnected"),
        lastError: this.state.lastSyncError?.message ?? null,
      };
    }

    if (this.state.lastSyncError) {
      return {
        state: "error",
        statusText: t("status.needsAttention"),
        lastSyncAt: this.state.lastSyncAt,
        vaultId: this.settings.vaultId || t("settings.common.notConnected"),
        lastError: this.state.lastSyncError.message,
      };
    }

    if (this.coordinator.hasPendingWork()) {
      return {
        state: "pending",
        statusText: t("status.pendingChanges"),
        lastSyncAt: this.state.lastSyncAt,
        vaultId: this.settings.vaultId || t("settings.common.notConnected"),
        lastError: null,
      };
    }

    return {
      state: "ok",
      statusText: t("status.upToDate"),
      lastSyncAt: this.state.lastSyncAt,
      vaultId: this.settings.vaultId || t("settings.common.notConnected"),
      lastError: null,
    };
  }

  private openSettingsTab(): void {
    const appWithSettings = this.app as typeof this.app & {
      setting?: {
        open: () => void;
        openTabById?: (id: string) => void;
      };
    };
    appWithSettings.setting?.open();
    appWithSettings.setting?.openTabById?.(this.manifest.id);
  }

  private async restoreActiveFileToPreviousServerVersion(
    activeFile: TFile,
    currentVersion: number,
  ): Promise<void> {
    try {
      const history = await this.settingsController.getFileHistory(activeFile.path);
      const previousVersion = history.versions.find(
        (version) => version.version < currentVersion,
      );

      if (!previousVersion) {
        new Notice(t("notices.noPreviousServerVersion"), 4000);
        return;
      }

      await this.restoreActiveFileToServerVersion(
        activeFile,
        currentVersion,
        previousVersion.version,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t("notices.restoreFailed", {
        message,
      }), 5000);
    }
  }

  private async restoreActiveFileToServerVersion(
    activeFile: TFile,
    currentVersion: number,
    targetVersion: number,
  ): Promise<void> {
    const request: RestoreDocumentRequest = {
      vault_id: this.settings.vaultId,
      device_id: this.settings.deviceId,
      path: activeFile.path,
      target_version: targetVersion,
    };
    const response = await this.settingsController.restoreDocument(request);

    if (!response.ok) {
      new Notice(t("notices.restoreConflict"), 5000);
      return;
    }

    this.coordinator.markDirty();
    await this.coordinator.runManualSync();
    new Notice(t("notices.restored", {
      path: activeFile.path,
      version: targetVersion,
    }), 5000);
  }

}
