import { App, PluginSettingTab, Setting } from "obsidian";

import type ObsidianSyncPlugin from "./main";

export class SyncSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ObsidianSyncPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

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
            this.plugin.settings.vaultId = nextVaultId;
            this.plugin.state = {
              vaultId: nextVaultId,
              files: {},
              lastSeq: 0,
            };
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
}
