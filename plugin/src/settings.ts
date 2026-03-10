import { App, Notice, PluginSettingTab, Setting } from "obsidian";

import { ApiError } from "./api";
import { formatSyncErrorState } from "./sync-errors";
import { describeSyncScope, normalizePatternList, shouldSyncPath } from "./sync-scope";
import { SettingsController } from "./settings-controller";
import type ObsidianSyncPlugin from "./main";

export class SyncSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: ObsidianSyncPlugin,
    private readonly controller: SettingsController,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const knownVaultIds = this.controller.getKnownVaultIds();
    const currentVaultId = this.plugin.settings.vaultId;
    const otherVaultIds = knownVaultIds.filter((vaultId) => vaultId !== currentVaultId);
    const trackedFilesCount = Object.values(this.plugin.state.files).filter((file) => !file.deleted).length;
    const deletedFilesCount = Object.values(this.plugin.state.files).filter((file) => file.deleted).length;

    renderSectionHeader(containerEl, "Overview", "Current vault status and quick health summary.");
    renderStatusHeader(containerEl, {
      vaultId: currentVaultId,
      serverUrl: this.plugin.settings.serverUrl,
      trackedFilesCount,
      deletedFilesCount,
      lastSyncAt: this.plugin.state.lastSyncAt,
      lastSyncError: formatSyncErrorState(this.plugin.state.lastSyncError),
      e2eeFingerprint: this.controller.getE2eeFingerprint(),
      hasSessionPassphrase: this.controller.getE2eePassphrase().trim().length > 0,
    });

    renderSectionHeader(containerEl, "Connection", "Server, auth, background sync and device identity.");
    const connectionSection = createSectionBody(containerEl);

    new Setting(connectionSection)
      .setName("Server URL")
      .setDesc("Base URL of the Rust sync server.")
      .addText((text) =>
        text
          .setPlaceholder("http://127.0.0.1:3000")
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.trim();
            await this.plugin.persistData();
          }),
      );

    const connectionStatus = connectionSection.createDiv({
      text: "Connection: not checked yet.",
      cls: "obsidian-sync-settings-note",
    });
    new Setting(connectionSection)
      .setName("Connection check")
      .setDesc("Verify the current server URL, auth token, and vault ID against the server.")
      .addButton((button) =>
        button.setButtonText("Check").onClick(async () => {
          connectionStatus.setText("Connection: checking...");

          try {
            const message = await this.controller.checkConnection();
            connectionStatus.setText(`Connection: ${message}`);
          } catch (error) {
            connectionStatus.setText(`Connection: ${formatDeviceError(error)}`);
          }
        }),
      );

    new Setting(connectionSection)
      .setName("Device ID")
      .setDesc("Stable identifier for this Obsidian installation.")
      .addText((text) =>
        text
          .setPlaceholder("device_local_desktop")
          .setValue(this.plugin.settings.deviceId)
          .onChange(async (value) => {
            this.plugin.settings.deviceId = value.trim();
            await this.plugin.persistData();
          }),
      );

    new Setting(connectionSection)
      .setName("Auth token")
      .setDesc("Optional bearer token expected by the sync server.")
      .addText((text) =>
        text
          .setPlaceholder("secret-token")
          .setValue(this.plugin.settings.authToken)
          .onChange(async (value) => {
            this.plugin.settings.authToken = value.trim();
            await this.plugin.persistData();
          }),
      );

    new Setting(connectionSection)
      .setName("Poll interval")
      .setDesc("How often the plugin polls the server for remote changes.")
      .addText((text) =>
        text
          .setPlaceholder("2")
          .setValue(String(this.plugin.settings.pollIntervalSecs))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isNaN(parsed) || parsed <= 0) {
              return;
            }

            this.plugin.settings.pollIntervalSecs = parsed;
            await this.plugin.persistData();
            this.controller.restartAutoSync();
          }),
      );

    new Setting(connectionSection)
      .setName("Auto sync")
      .setDesc("Run the sync loop in the background.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoSync).onChange(async (value) => {
          this.plugin.settings.autoSync = value;
          await this.plugin.persistData();
          this.controller.restartAutoSync();
        }),
      );

    renderSectionHeader(containerEl, "Vault", "Choose which logical vault this client is syncing.");
    const vaultSection = createSectionBody(containerEl);

    new Setting(vaultSection)
      .setName("Vault ID")
      .setDesc("Logical vault identifier used by the sync server.")
      .addText((text) =>
        text
          .setPlaceholder("default")
          .setValue(currentVaultId)
          .onChange(async (value) => {
            const nextVaultId = value.trim() || "default";
            await this.controller.activateVault(nextVaultId);
            this.display();
          }),
      );

    new Setting(vaultSection)
      .setName("Switch vault")
      .setDesc("Load sync state for another known vault ID.")
      .addDropdown((dropdown) => {
        for (const vaultId of knownVaultIds) {
          dropdown.addOption(vaultId, vaultId);
        }

        dropdown
          .setValue(currentVaultId)
          .onChange(async (value) => {
            await this.controller.activateVault(value);
            this.display();
          });
      });

    new Setting(vaultSection)
      .setName("Forget current vault")
      .setDesc("Remove persisted sync state for the current vault ID on this device.")
      .addButton((button) =>
        button.setButtonText("Forget").onClick(async () => {
          await this.controller.forgetVault("default", this.plugin.settings.vaultId);
          this.display();
        }),
      );

    renderSectionHeader(containerEl, "Sync Scope", "Control which files are eligible for sync in this vault.");
    const scopeSection = createSectionBody(containerEl);

    new Setting(scopeSection)
      .setName("Include patterns")
      .setDesc("Optional allow-list. If set, only matching paths are synced. Same pattern syntax as ignore rules.")
      .addTextArea((text) =>
        text
          .setPlaceholder("Notes/\n*.md")
          .setValue(this.plugin.settings.includePatterns.join("\n"))
          .onChange(async (value) => {
            this.controller.updateCurrentVaultScope({
              includePatterns: normalizePatternList(value),
              ignorePatterns: this.plugin.settings.ignorePatterns,
            });
            await this.plugin.persistData();
            this.display();
          }),
      );

    new Setting(scopeSection)
      .setName("Ignore patterns")
      .setDesc("One pattern per line. Supports '*', '?', and folder prefixes ending with '/'.")
      .addTextArea((text) =>
        text
          .setPlaceholder(".obsidian/\nTemplates/\n*.canvas")
          .setValue(this.plugin.settings.ignorePatterns.join("\n"))
          .onChange(async (value) => {
            this.controller.updateCurrentVaultScope({
              includePatterns: this.plugin.settings.includePatterns,
              ignorePatterns: normalizePatternList(value),
            });
            await this.plugin.persistData();
            this.display();
          }),
      );

    let presetTargetVaultId = otherVaultIds[0] ?? "";
    new Setting(scopeSection)
      .setName("Copy scope preset")
      .setDesc(
        otherVaultIds.length > 0
          ? "Copy the current include/ignore rules into another known vault preset."
          : "No other known vaults yet. Add or switch to another vault ID first.",
      )
      .addDropdown((dropdown) => {
        if (otherVaultIds.length === 0) {
          dropdown.addOption("", "No target vault");
          dropdown.setValue("");
          return;
        }

        for (const vaultId of otherVaultIds) {
          dropdown.addOption(vaultId, vaultId);
        }

        dropdown.setValue(presetTargetVaultId).onChange((value) => {
          presetTargetVaultId = value;
        });
      })
      .addButton((button) => {
        if (otherVaultIds.length === 0) {
          button.setButtonText("Copy").setDisabled(true);
          return;
        }

        button.setButtonText("Copy").onClick(async () => {
          await this.controller.copyCurrentVaultScopeToVault(presetTargetVaultId);
          new Notice(`Copied sync scope preset to ${presetTargetVaultId}`, 3000);
        });
      });

    const syncHealthSection = scopeSection.createDiv();
    syncHealthSection.createEl("h4", { text: "Sync health" });
    const syncHealthList = syncHealthSection.createEl("ul");
    syncHealthList.createEl("li", { text: `Vault: ${currentVaultId}` });
    syncHealthList.createEl("li", { text: `Change cursor: ${this.plugin.state.lastSeq}` });
    syncHealthList.createEl("li", { text: `Files tracked: ${trackedFilesCount}` });
    syncHealthList.createEl("li", { text: `Deletes tracked: ${deletedFilesCount}` });
    syncHealthList.createEl("li", {
      text: `Last successful sync: ${formatLastSyncAt(this.plugin.state.lastSyncAt)}`,
    });
    syncHealthList.createEl("li", {
      text: `Last issue: ${formatSyncErrorState(this.plugin.state.lastSyncError)}`,
    });

    const currentScopeSection = scopeSection.createDiv();
    currentScopeSection.createEl("h4", { text: "Current sync scope" });
    const scopeList = currentScopeSection.createEl("ul");
    for (const line of describeSyncScope(
      this.plugin.settings.includePatterns,
      this.plugin.settings.ignorePatterns,
    )) {
      scopeList.createEl("li", { text: line });
    }

    const preview = buildScopePreview(
      this.plugin.app.vault.getFiles().map((file) => file.path),
      this.plugin.settings.includePatterns,
      this.plugin.settings.ignorePatterns,
    );
    currentScopeSection.createEl("p", {
      text: `Preview: ${preview.syncedCount} included, ${preview.skippedCount} skipped`,
    });
    if (preview.sampleLines.length > 0) {
      const previewList = currentScopeSection.createEl("ul");
      for (const line of preview.sampleLines) {
        previewList.createEl("li", { text: line });
      }
    }

    renderSectionHeader(containerEl, "Devices", "Inspect the current device registry for this vault.");
    const devicesSection = createSectionBody(containerEl);
    const devicesStatus = devicesSection.createDiv({
      text: "Loading devices...",
      cls: "obsidian-sync-settings-note",
    });

    new Setting(devicesSection)
      .setName("Refresh devices")
      .setDesc("Fetch the current device registry for this vault from the server.")
      .addButton((button) =>
        button.setButtonText("Refresh").onClick(async () => {
          await this.renderDevices(devicesStatus);
        }),
      );

    void this.renderDevices(devicesStatus);

    renderSectionHeader(containerEl, "E2EE", "Manage the session passphrase and fingerprint for this vault.");
    const e2eeSection = createSectionBody(containerEl);

    new Setting(e2eeSection)
      .setName("E2EE passphrase")
      .setDesc("Optional passphrase for encrypting file contents locally before upload. Kept only in memory for the current Obsidian session.")
      .addText((text) =>
        text
          .setPlaceholder("correct horse battery staple")
          .setValue(this.controller.getE2eePassphrase())
          .onChange((value) => {
            this.controller.setE2eePassphrase(value);
          }),
      );

    const e2eeStatus = e2eeSection.createDiv({
      text: buildE2eeStatusText(
        this.controller.getE2eeFingerprint(),
        this.controller.getE2eePassphrase(),
      ),
      cls: "obsidian-sync-settings-note",
    });

    new Setting(e2eeSection)
      .setName("Passphrase validation")
      .setDesc("Check the session passphrase against the stored fingerprint for this vault.")
      .addButton((button) =>
        button.setButtonText("Validate").onClick(async () => {
          try {
            const message = await this.controller.validateCurrentE2eePassphrase();
            e2eeStatus.setText(`E2EE: ${message}`);
          } catch (error) {
            e2eeStatus.setText(`E2EE: ${formatDeviceError(error)}`);
          }
        }),
      )
      .addButton((button) =>
        button.setButtonText("Forget fingerprint").onClick(async () => {
          await this.controller.clearCurrentE2eeFingerprint();
          e2eeStatus.setText(
            buildE2eeStatusText(
              this.controller.getE2eeFingerprint(),
              this.controller.getE2eePassphrase(),
            ),
          );
        }),
      );
  }

  private async renderDevices(container: HTMLElement): Promise<void> {
    container.empty();
    container.setText("Loading devices...");

    try {
      const currentDeviceId = this.plugin.settings.deviceId.trim();
      const devices = await this.controller.getRegisteredDevices();
      const sortedDevices = [...devices].sort((left, right) => {
        if (left.device_id === currentDeviceId && right.device_id !== currentDeviceId) {
          return -1;
        }
        if (right.device_id === currentDeviceId && left.device_id !== currentDeviceId) {
          return 1;
        }
        return left.device_id.localeCompare(right.device_id);
      });
      container.empty();

      if (sortedDevices.length === 0) {
        container.setText("No devices registered for this vault yet.");
        return;
      }

      const currentDevice = sortedDevices.find((device) => device.device_id === currentDeviceId);
      container.createEl("p", {
        text: currentDevice
          ? `Current device is registered. Last seen ${formatTimestamp(currentDevice.last_seen_at)}.`
          : "Current device has not registered with this vault yet. Run sync to add it to the registry.",
      });

      const list = container.createEl("ul");
      for (const device of sortedDevices) {
        const item = list.createEl("li");
        const lastSeen = formatTimestamp(device.last_seen_at);
        const firstSeen = formatTimestamp(device.first_seen_at);
        const label =
          device.device_id === currentDeviceId
            ? `${device.device_id} (this device)`
            : device.device_id;
        item.setText(`${label} - last seen ${lastSeen}, first seen ${firstSeen}`);
      }
    } catch (error) {
      container.empty();
      container.setText(`Failed to load devices: ${formatDeviceError(error)}`);
    }
  }
}

function createSectionBody(container: HTMLElement): HTMLElement {
  const section = container.createDiv();
  section.addClass("obsidian-sync-section-body");
  return section;
}

function renderSectionHeader(container: HTMLElement, title: string, description: string): void {
  const section = container.createDiv({ cls: "obsidian-sync-section-header" });
  section.createEl("h3", { text: title });
  section.createEl("p", { text: description });
}

function renderStatusHeader(
  container: HTMLElement,
  status: {
    vaultId: string;
    serverUrl: string;
    trackedFilesCount: number;
    deletedFilesCount: number;
    lastSyncAt: number | null;
    lastSyncError: string;
    e2eeFingerprint: string | null;
    hasSessionPassphrase: boolean;
  },
): void {
  const summary = container.createDiv({ cls: "obsidian-sync-status-header" });
  summary.createEl("h2", { text: "Sync status" });
  const chips = summary.createEl("ul");
  chips.createEl("li", { text: `Vault ${status.vaultId}` });
  chips.createEl("li", { text: status.serverUrl || "Server not configured" });
  chips.createEl("li", { text: `${status.trackedFilesCount} tracked` });
  chips.createEl("li", { text: `${status.deletedFilesCount} tombstones` });
  chips.createEl("li", { text: `Last sync ${formatLastSyncAt(status.lastSyncAt)}` });
  chips.createEl("li", { text: `Error ${status.lastSyncError}` });
  chips.createEl("li", {
    text: status.e2eeFingerprint
      ? `E2EE ${status.e2eeFingerprint.slice(0, 12)}${status.hasSessionPassphrase ? " loaded" : " locked"}`
      : status.hasSessionPassphrase
        ? "E2EE pending"
        : "E2EE off",
  });
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function formatLastSyncAt(value: number | null): string {
  if (value === null) {
    return "Never";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleString();
}

function buildE2eeStatusText(fingerprint: string | null, passphrase: string): string {
  if (!fingerprint) {
    return passphrase.trim()
      ? "E2EE: passphrase loaded. A fingerprint will be saved after the first encrypted sync."
      : "E2EE: off for this vault.";
  }

  if (!passphrase.trim()) {
    return `E2EE: fingerprint ${fingerprint.slice(0, 12)} is saved, but no passphrase is loaded in this session.`;
  }

  return `E2EE: fingerprint ${fingerprint.slice(0, 12)} is saved and the session passphrase is loaded.`;
}

function formatDeviceError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "auth failed";
    }
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function buildScopePreview(
  paths: string[],
  includePatterns: string[],
  ignorePatterns: string[],
): {
  syncedCount: number;
  skippedCount: number;
  sampleLines: string[];
} {
  const sortedPaths = [...paths].sort((left, right) => left.localeCompare(right));
  let syncedCount = 0;
  let skippedCount = 0;

  const sampleLines = sortedPaths.slice(0, 12).map((path) => {
    const synced = shouldSyncPath(path, includePatterns, ignorePatterns);
    if (synced) {
      syncedCount += 1;
    } else {
      skippedCount += 1;
    }
    return `${synced ? "synced" : "skipped"}: ${path}`;
  });

  for (const path of sortedPaths.slice(12)) {
    if (shouldSyncPath(path, includePatterns, ignorePatterns)) {
      syncedCount += 1;
    } else {
      skippedCount += 1;
    }
  }

  if (sortedPaths.length === 0) {
    return {
      syncedCount: 0,
      skippedCount: 0,
      sampleLines: ["Vault is currently empty."],
    };
  }

  if (sortedPaths.length > 12) {
    sampleLines.push(`... and ${sortedPaths.length - 12} more path(s)`);
  }

  return {
    syncedCount,
    skippedCount,
    sampleLines,
  };
}
