import { Notice, Plugin, TFile } from "obsidian";

import { SyncApi } from "./api";
import { E2eeState } from "./e2ee/state";
import { SettingsController } from "./settings/controller";
import { SyncSettingTab } from "./settings/tab";
import { PluginStateStore } from "./state/store";
import { SyncCoordinator } from "./sync/coordinator";
import { SyncEngine } from "./sync/engine";
import { FileHistoryModal } from "./ui/file-history-modal";
import { PluginStatusBar } from "./ui/status-bar";
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
  private statusBar!: PluginStatusBar;
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
    this.statusBar = new PluginStatusBar(
      this.addStatusBarItem(),
      () => this.getStatusBarSnapshot(),
      () => this.openSettingsTab(),
    );
    this.statusBar.start();

    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: async () => {
        await this.coordinator.runManualSync();
      },
    });

    this.addCommand({
      id: "show-active-file-server-history",
      name: "Show active file server history",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        const trackedState = activeFile ? this.state.files[activeFile.path] : undefined;
        const available =
          activeFile instanceof TFile &&
          !trackedState?.deleted &&
          typeof trackedState?.version === "number";
        if (checking) {
          return available;
        }

        if (!available || !activeFile || !trackedState) {
          new Notice("The active file is not tracked by sync yet.", 4000);
          return false;
        }

        new FileHistoryModal(
          this.app,
          activeFile.path,
          trackedState.version,
          async () => (await this.settingsController.getFileHistory(activeFile.path)).versions,
          async (targetVersion) => {
            await this.restoreActiveFileToServerVersion(
              activeFile,
              trackedState.version,
              targetVersion,
            );
          },
        ).open();
        return true;
      },
    });

    this.addCommand({
      id: "restore-active-file-to-previous-server-version",
      name: "Restore active file to previous server version",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        const trackedState = activeFile ? this.state.files[activeFile.path] : undefined;
        const available =
          activeFile instanceof TFile &&
          !trackedState?.deleted &&
          typeof trackedState?.version === "number" &&
          trackedState.version > 1;
        if (checking) {
          return available;
        }

        if (!available || !activeFile) {
          new Notice("No previous synced server version is available for the active file.", 4000);
          return false;
        }

        void this.restoreActiveFileToPreviousServerVersion(activeFile, trackedState.version);
        return true;
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
    this.statusBar?.stop();
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
        statusText: "Auto sync off",
        lastSyncAt: this.state.lastSyncAt,
        vaultId: this.settings.vaultId,
        lastError: this.state.lastSyncError?.message ?? null,
      };
    }

    if (this.coordinator.isSyncing()) {
      return {
        state: "syncing",
        statusText: "Syncing",
        lastSyncAt: this.state.lastSyncAt,
        vaultId: this.settings.vaultId,
        lastError: this.state.lastSyncError?.message ?? null,
      };
    }

    if (this.state.lastSyncError) {
      return {
        state: "error",
        statusText: "Needs attention",
        lastSyncAt: this.state.lastSyncAt,
        vaultId: this.settings.vaultId,
        lastError: this.state.lastSyncError.message,
      };
    }

    if (this.coordinator.hasPendingWork()) {
      return {
        state: "pending",
        statusText: "Pending changes",
        lastSyncAt: this.state.lastSyncAt,
        vaultId: this.settings.vaultId,
        lastError: null,
      };
    }

    return {
      state: "ok",
      statusText: "Up to date",
      lastSyncAt: this.state.lastSyncAt,
      vaultId: this.settings.vaultId,
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
        new Notice("No previous server version is available for this file.", 4000);
        return;
      }

      await this.restoreActiveFileToServerVersion(
        activeFile,
        currentVersion,
        previousVersion.version,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Restore failed: ${message}`, 5000);
    }
  }

  private async restoreActiveFileToServerVersion(
    activeFile: TFile,
    currentVersion: number,
    targetVersion: number,
  ): Promise<void> {
    const response = await this.settingsController.restoreFile({
      vault_id: this.settings.vaultId,
      device_id: this.settings.deviceId,
      path: activeFile.path,
      target_version: targetVersion,
      base_version: currentVersion,
    });

    if (!response.ok) {
      new Notice("Restore conflicted with a newer server version. Run sync and try again.", 5000);
      return;
    }

    this.coordinator.markDirty();
    await this.coordinator.runManualSync();
    new Notice(`Restored ${activeFile.path} from server version ${targetVersion}.`, 5000);
  }

}

function stripLegacySecrets(settings: Partial<SyncSettings> & { e2eePassphrase?: string }): Partial<SyncSettings> {
  const { e2eePassphrase: _ignored, ...safeSettings } = settings;
  return safeSettings;
}
