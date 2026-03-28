import { Notice, TFile, type App, type Plugin } from "obsidian";

import { t } from "./i18n";
import { FileHistoryModal } from "./ui/file-history-modal";
import type { SettingsController } from "./settings/controller";
import type { SyncCoordinator } from "./sync/coordinator";
import type { SyncSettings, SyncState } from "./types";

export interface CommandRegistrationOptions {
  app: App;
  plugin: Plugin;
  getSettings: () => SyncSettings;
  getState: () => SyncState;
  coordinator: SyncCoordinator;
  settingsController: SettingsController;
  restoreActiveFileToPreviousServerVersion: (activeFile: TFile, currentVersion: number) => Promise<void>;
  restoreActiveFileToServerVersion: (
    activeFile: TFile,
    currentVersion: number,
    targetVersion: number,
  ) => Promise<void>;
}

export function registerPluginCommands(options: CommandRegistrationOptions): void {
  options.plugin.addCommand({
    id: "sync-now",
    name: t("commands.syncNow"),
    callback: async () => {
      await options.coordinator.runManualSync();
    },
  });

  options.plugin.addCommand({
    id: "show-active-file-server-history",
    name: t("commands.showFileHistory"),
    checkCallback: (checking) => {
      const state = options.getState();
      const activeFile = options.app.workspace.getActiveFile();
      const trackedState = activeFile ? state.documents[activeFile.path] : undefined;
      const available =
        activeFile instanceof TFile &&
        !trackedState?.deleted &&
        typeof trackedState?.version === "number";
      if (checking) {
        return available;
      }

      if (!available || !activeFile || !trackedState) {
        new Notice(t("notices.activeFileNotTracked"), 4000);
        return false;
      }

      new FileHistoryModal(
        options.app,
        activeFile.path,
        trackedState.version,
        async () => (await options.settingsController.getFileHistory(activeFile.path)).versions,
        async (targetVersion) => {
          await options.restoreActiveFileToServerVersion(
            activeFile,
            trackedState.version,
            targetVersion,
          );
        },
      ).open();
      return true;
    },
  });

  options.plugin.addCommand({
    id: "restore-active-file-to-previous-server-version",
    name: t("commands.restorePreviousVersion"),
    checkCallback: (checking) => {
      const state = options.getState();
      const activeFile = options.app.workspace.getActiveFile();
      const trackedState = activeFile ? state.documents[activeFile.path] : undefined;
      const available =
        activeFile instanceof TFile &&
        !trackedState?.deleted &&
        typeof trackedState?.version === "number" &&
        trackedState.version > 1;
      if (checking) {
        return available;
      }

      if (!available || !activeFile) {
        new Notice(t("notices.noPreviousSyncedVersion"), 4000);
        return false;
      }

      void options.restoreActiveFileToPreviousServerVersion(activeFile, trackedState.version);
      return true;
    },
  });
}

export function registerVaultDirtyTracking(
  plugin: Plugin,
  app: App,
  coordinator: SyncCoordinator,
): void {
  plugin.registerEvent(app.vault.on("create", () => {
    coordinator.markDirty();
  }));
  plugin.registerEvent(app.vault.on("modify", () => {
    coordinator.markDirty();
  }));
  plugin.registerEvent(app.vault.on("delete", () => {
    coordinator.markDirty();
  }));
  plugin.registerEvent(app.vault.on("rename", () => {
    coordinator.markDirty();
  }));
}
