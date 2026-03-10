import { App, PluginSettingTab, Setting } from "obsidian";

import { ApiError } from "./api";
import { describeSyncScope, normalizePatternList, shouldSyncPath } from "./sync-scope";
import type ObsidianSyncPlugin from "./main";

export class SyncSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ObsidianSyncPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const knownVaultIds = this.plugin.getKnownVaultIds();

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("Vault ID")
      .setDesc("Logical vault identifier used by the sync server.")
      .addText((text) =>
        text
          .setPlaceholder("default")
          .setValue(this.plugin.settings.vaultId)
          .onChange(async (value) => {
            const nextVaultId = value.trim() || "default";
            await this.plugin.activateVault(nextVaultId);
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName("Switch vault")
      .setDesc("Load sync state for another known vault ID.")
      .addDropdown((dropdown) => {
        for (const vaultId of knownVaultIds) {
          dropdown.addOption(vaultId, vaultId);
        }

        dropdown
          .setValue(this.plugin.settings.vaultId)
          .onChange(async (value) => {
            await this.plugin.activateVault(value);
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Forget current vault")
      .setDesc("Remove persisted sync state for the current vault ID on this device.")
      .addButton((button) =>
        button.setButtonText("Forget").onClick(async () => {
          const currentVaultId = this.plugin.settings.vaultId;
          await this.plugin.forgetVault(currentVaultId);
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("Include patterns")
      .setDesc("Optional allow-list. If set, only matching paths are synced. Same pattern syntax as ignore rules.")
      .addTextArea((text) =>
        text
          .setPlaceholder("Notes/\n*.md")
          .setValue(this.plugin.settings.includePatterns.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.includePatterns = normalizePatternList(value);
            await this.plugin.persistData();
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName("Ignore patterns")
      .setDesc("One pattern per line. Supports '*', '?', and folder prefixes ending with '/'.")
      .addTextArea((text) =>
        text
          .setPlaceholder(".obsidian/\nTemplates/\n*.canvas")
          .setValue(this.plugin.settings.ignorePatterns.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.ignorePatterns = normalizePatternList(value);
            await this.plugin.persistData();
            this.display();
          }),
      );

    const scopeSection = containerEl.createDiv();
    scopeSection.createEl("h3", { text: "Current sync scope" });
    const scopeList = scopeSection.createEl("ul");
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
    scopeSection.createEl("p", {
      text: `Preview: ${preview.syncedCount} synced, ${preview.skippedCount} skipped`,
    });
    if (preview.sampleLines.length > 0) {
      const previewList = scopeSection.createEl("ul");
      for (const line of preview.sampleLines) {
        previewList.createEl("li", { text: line });
      }
    }

    const devicesSection = containerEl.createDiv();
    devicesSection.createEl("h3", { text: "Registered devices" });
    const devicesStatus = devicesSection.createDiv({
      text: "Loading devices...",
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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
            this.plugin.restartAutoSync();
          }),
      );

    new Setting(containerEl)
      .setName("Auto sync")
      .setDesc("Run the sync loop in the background.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoSync).onChange(async (value) => {
          this.plugin.settings.autoSync = value;
          await this.plugin.persistData();
          this.plugin.restartAutoSync();
        }),
      );
  }

  private async renderDevices(container: HTMLElement): Promise<void> {
    container.empty();
    container.setText("Loading devices...");

    try {
      const devices = await this.plugin.getRegisteredDevices();
      container.empty();

      if (devices.length === 0) {
        container.setText("No devices registered for this vault yet.");
        return;
      }

      const list = container.createEl("ul");
      for (const device of devices) {
        const item = list.createEl("li");
        const lastSeen = formatTimestamp(device.last_seen_at);
        const firstSeen = formatTimestamp(device.first_seen_at);
        item.setText(`${device.device_id} — last seen ${lastSeen}, first seen ${firstSeen}`);
      }
    } catch (error) {
      container.empty();
      container.setText(`Failed to load devices: ${formatDeviceError(error)}`);
    }
  }
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function formatDeviceError(error: unknown): string {
  if (error instanceof ApiError) {
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
