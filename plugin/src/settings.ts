import { App, Notice, PluginSettingTab, Setting } from "obsidian";

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
    const currentVaultId = this.plugin.settings.vaultId;
    const otherVaultIds = knownVaultIds.filter((vaultId) => vaultId !== currentVaultId);

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
            this.plugin.updateCurrentVaultScope({
              includePatterns: normalizePatternList(value),
              ignorePatterns: this.plugin.settings.ignorePatterns,
            });
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
            this.plugin.updateCurrentVaultScope({
              includePatterns: this.plugin.settings.includePatterns,
              ignorePatterns: normalizePatternList(value),
            });
            await this.plugin.persistData();
            this.display();
          }),
      );

    let presetTargetVaultId = otherVaultIds[0] ?? "";
    new Setting(containerEl)
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
          await this.plugin.copyCurrentVaultScopeToVault(presetTargetVaultId);
          new Notice(`Copied sync scope preset to ${presetTargetVaultId}`, 3000);
        });
      });

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

    const connectionStatus = containerEl.createDiv({
      text: "Connection status: not checked yet.",
    });
    new Setting(containerEl)
      .setName("Check connection")
      .setDesc("Verify the current server URL, auth token, and vault ID against the server.")
      .addButton((button) =>
        button.setButtonText("Check").onClick(async () => {
          connectionStatus.setText("Connection status: checking...");

          try {
            const message = await this.plugin.checkConnection();
            connectionStatus.setText(`Connection status: ${message}`);
          } catch (error) {
            connectionStatus.setText(`Connection status: ${formatDeviceError(error)}`);
          }
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
      const currentDeviceId = this.plugin.settings.deviceId.trim();
      const devices = await this.plugin.getRegisteredDevices();
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
        item.setText(`${label} — last seen ${lastSeen}, first seen ${firstSeen}`);
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
