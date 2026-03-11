import { App, Notice, PluginSettingTab, Setting } from "obsidian";

import { describeSyncScope, normalizePatternList } from "./sync-scope";
import { formatSyncErrorState } from "./sync-errors";
import { SettingsController } from "./settings-controller";
import {
  buildE2eeStatusText,
  buildScopePreview,
  createCollapsibleSection,
  createInlineStatus,
  createKeyValueRow,
  createPanel,
  createSettingGroup,
  formatDeviceError,
  formatLastSyncAt,
  formatTimestamp,
  renderQuickActions,
  renderStatusHeader,
} from "./settings-ui";
import type { VaultItem } from "./types";
import type ObsidianSyncPlugin from "./main";

export class SyncSettingTab extends PluginSettingTab {
  private remoteVaults: VaultItem[] | null = null;
  private createVaultDraft = "";
  private loadingRemoteVaults = false;
  private remoteVaultsError: string | null = null;
  private confirmForgetVaultId: string | null = null;
  private confirmDisconnectVaultId: string | null = null;

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

    this.maybeLoadRemoteVaults();
    this.renderOverviewSection(containerEl);
    this.renderConnectionSection(containerEl);
    this.renderVaultSection(containerEl);
    this.renderSyncScopeSection(containerEl);
    this.renderDevicesSection(containerEl);
    this.renderE2eeSection(containerEl);
  }

  private maybeLoadRemoteVaults(): void {
    if (this.remoteVaults || this.loadingRemoteVaults || !this.plugin.settings.serverUrl.trim()) {
      return;
    }

    this.loadingRemoteVaults = true;
    void this.controller
      .getRemoteVaults()
      .then((vaults) => {
        this.remoteVaults = vaults;
        this.remoteVaultsError = null;
      })
      .catch((error) => {
        this.remoteVaults = null;
        this.remoteVaultsError = formatDeviceError(error);
      })
      .finally(() => {
        this.loadingRemoteVaults = false;
        this.display();
      });
  }

  private renderOverviewSection(container: HTMLElement): void {
    const group = createSettingGroup(container, "Overview", "Current vault status and quick health summary.");
    const currentVaultId = this.plugin.settings.vaultId;
    const trackedFilesCount = this.getTrackedFilesCount();
    const deletedFilesCount = this.getDeletedFilesCount();

    renderStatusHeader(group, {
      vaultId: currentVaultId,
      serverUrl: this.plugin.settings.serverUrl,
      trackedFilesCount,
      deletedFilesCount,
      lastSyncAt: this.plugin.state.lastSyncAt,
      lastSyncError: formatSyncErrorState(this.plugin.state.lastSyncError),
      e2eeFingerprint: this.controller.getE2eeFingerprint(),
      hasSessionPassphrase: this.controller.getE2eePassphrase().trim().length > 0,
    });

    const quickActionsStatus = createInlineStatus(group, "Quick actions", "Ready");
    renderQuickActions(group, [
      {
        label: "Sync now",
        cta: true,
        onClick: async () => {
          quickActionsStatus.setText("Quick actions: Running sync...");
          try {
            await this.controller.runManualSync();
            quickActionsStatus.setText("Quick actions: Sync completed.");
          } catch (error) {
            quickActionsStatus.setText(`Quick actions: ${formatDeviceError(error)}`);
          }
          this.display();
        },
      },
      {
        label: "Check connection",
        onClick: async () => {
          quickActionsStatus.setText("Quick actions: Checking connection...");
          try {
            const message = await this.controller.checkConnection();
            quickActionsStatus.setText(`Quick actions: ${message}`);
          } catch (error) {
            quickActionsStatus.setText(`Quick actions: ${formatDeviceError(error)}`);
          }
        },
      },
      {
        label: "Refresh devices",
        onClick: async () => {
          quickActionsStatus.setText("Quick actions: Refreshing devices...");
          try {
            const devices = await this.controller.getRegisteredDevices();
            quickActionsStatus.setText(`Quick actions: ${devices.length} device(s) loaded.`);
          } catch (error) {
            quickActionsStatus.setText(`Quick actions: ${formatDeviceError(error)}`);
          }
          this.display();
        },
      },
    ]);
  }

  private renderConnectionSection(container: HTMLElement): void {
    const group = createSettingGroup(container, "Connection", "Server, auth, background sync and device identity.");

    new Setting(group)
      .setName("Server URL")
      .setDesc("Base URL of the Rust sync server.")
      .addText((text) =>
        text
          .setPlaceholder("http://127.0.0.1:3000")
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.trim();
            this.remoteVaults = null;
            this.remoteVaultsError = null;
            await this.plugin.persistData();
            this.display();
          }),
      );

    const connectionStatus = createInlineStatus(group, "Connection", "Not checked");
    new Setting(group)
      .setName("Connection check")
      .setDesc("Verify the current server URL, auth token, and vault ID against the server.")
      .addButton((button) =>
        button.setButtonText("Check").onClick(async () => {
          connectionStatus.setText("Connection: Checking...");

          try {
            const message = await this.controller.checkConnection();
            connectionStatus.setText(`Connection: ${message}`);
          } catch (error) {
            connectionStatus.setText(`Connection: ${formatDeviceError(error)}`);
          }
        }),
      );

    new Setting(group)
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

    new Setting(group)
      .setName("Auth token")
      .setDesc("Optional bearer token expected by the sync server.")
      .addText((text) =>
        text
          .setPlaceholder("secret-token")
          .setValue(this.plugin.settings.authToken)
          .onChange(async (value) => {
            this.plugin.settings.authToken = value.trim();
            this.remoteVaults = null;
            this.remoteVaultsError = null;
            await this.plugin.persistData();
            this.display();
          }),
      );

    new Setting(group)
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

    new Setting(group)
      .setName("Auto sync")
      .setDesc("Run the sync loop in the background.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoSync).onChange(async (value) => {
          this.plugin.settings.autoSync = value;
          await this.plugin.persistData();
          this.controller.restartAutoSync();
        }),
      );
  }

  private renderVaultSection(container: HTMLElement): void {
    const group = createSettingGroup(container, "Vault", "Choose which logical vault this client is syncing.");
    const currentVaultId = this.plugin.settings.vaultId;
    const knownVaultIds = this.controller.getKnownVaultIds();

    const vaultStatus = createInlineStatus(
      group,
      "Vault registry",
      this.loadingRemoteVaults
        ? "Loading..."
        : this.remoteVaultsError
          ? this.remoteVaultsError
          : this.remoteVaults
            ? `${this.remoteVaults.length} vault(s) loaded`
            : "Not loaded",
    );

    renderQuickActions(group, [
      {
        label: "Load vaults",
        onClick: async () => {
          await this.reloadRemoteVaults(vaultStatus);
        },
      },
    ]);

    this.renderVaultRegistryState(group, currentVaultId, vaultStatus);
    const flowPanel = this.renderCurrentVaultPanel(group, currentVaultId, vaultStatus);
    this.renderCreateVaultControl(flowPanel, vaultStatus);
    this.renderJoinServerVaultControl(flowPanel, currentVaultId, vaultStatus);
    this.renderRemoteVaultsPanel(group, currentVaultId, vaultStatus);
    this.renderLocalVaultsPanel(group, currentVaultId, knownVaultIds);
    this.renderAdvancedVaultPanel(group, currentVaultId);
  }

  private renderVaultRegistryState(
    container: HTMLElement,
    currentVaultId: string,
    vaultStatus: HTMLElement,
  ): void {
    const panel = createPanel(container);
    panel.createEl("div", { text: "Vault registry", cls: "obsidian-sync-panel-title" });

    if (this.loadingRemoteVaults) {
      panel.createEl("div", {
        text: "Loading vaults from the server. You will be able to join an existing vault as soon as the list arrives.",
        cls: "setting-item-description",
      });
      return;
    }

    if (this.remoteVaultsError) {
      panel.createEl("div", {
        text: `Vault list is unavailable: ${this.remoteVaultsError}`,
        cls: "setting-item-description",
      });
      panel.createEl("div", {
        text: "Check server URL and auth token, then use Load vaults again. You can still create a vault if the server is reachable.",
        cls: "setting-item-description",
      });
      return;
    }

    if (this.remoteVaults && this.remoteVaults.length === 0) {
      panel.createEl("div", {
        text: "No vaults exist on the server yet.",
        cls: "setting-item-description",
      });
      panel.createEl("div", {
        text: "Create a vault below to start syncing this device.",
        cls: "setting-item-description",
      });
      return;
    }

    if (this.remoteVaults) {
      const currentVaultOnServer = this.remoteVaults.some((vault) => vault.vault_id === currentVaultId);
      panel.createEl("div", {
        text: `Loaded ${this.remoteVaults.length} vault(s) from the server. Join one below or create a new vault.`,
        cls: "setting-item-description",
      });

      if (!currentVaultOnServer) {
        panel.createEl("div", {
          text: `The current vault "${currentVaultId}" is only local so far.`,
          cls: "setting-item-description",
        });
        panel.createEl("div", {
          text: "Create it on the server to start syncing this vault, or join another existing vault below.",
          cls: "setting-item-description",
        });

        const actions = panel.createDiv();
        actions.style.display = "flex";
        actions.style.flexWrap = "wrap";
        actions.style.gap = "8px";

        const button = actions.createEl("button", {
          text: "Create current vault on server",
        });
        button.addClass("mod-cta");
        button.addEventListener("click", async () => {
          await this.createAndJoinVault(currentVaultId, vaultStatus);
        });
      }
      return;
    }

    panel.createEl("div", {
      text: "Vault list has not been loaded yet.",
      cls: "setting-item-description",
    });
    panel.createEl("div", {
      text: "Use Load vaults to discover existing vaults on the server, or create a new vault below.",
      cls: "setting-item-description",
    });
  }

  private renderCurrentVaultPanel(
    container: HTMLElement,
    currentVaultId: string,
    vaultStatus: HTMLElement,
  ): HTMLElement {
    const panel = createPanel(container);
    panel.createEl("div", { text: "Vault flow", cls: "obsidian-sync-panel-title" });

    const currentVaultBlock = panel.createDiv();
    currentVaultBlock.style.display = "grid";
    currentVaultBlock.style.gap = "8px";
    currentVaultBlock.style.paddingBottom = "10px";
    currentVaultBlock.style.borderBottom = "1px solid var(--background-modifier-border)";
    currentVaultBlock.createEl("div", {
      text: "Current vault",
      cls: "setting-item-description",
    });
    createKeyValueRow(currentVaultBlock, "Active vault", currentVaultId);
    createKeyValueRow(
      currentVaultBlock,
      "Server registry",
      this.remoteVaults
        ? this.remoteVaults.some((vault) => vault.vault_id === currentVaultId) ? "Loaded" : "Not loaded here"
        : this.loadingRemoteVaults ? "Loading..." : this.remoteVaultsError ? "Unavailable" : "Not loaded",
    );

    const actions = currentVaultBlock.createDiv();
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.gap = "8px";

    const disconnectButton = actions.createEl("button", {
      text: this.confirmDisconnectVaultId === currentVaultId ? "Confirm disconnect" : "Disconnect",
    });
    disconnectButton.addEventListener("click", async () => {
      const needsConfirm = this.controller.hasPendingSyncWork() || this.plugin.state.lastSyncError !== null;
      if (needsConfirm && this.confirmDisconnectVaultId !== currentVaultId) {
        this.confirmDisconnectVaultId = currentVaultId;
        vaultStatus.setText(`Vault registry: Click "Confirm disconnect" to leave ${currentVaultId}. Pending work or sync issues may still exist locally.`);
        this.display();
        return;
      }

      this.confirmDisconnectVaultId = null;
      this.confirmForgetVaultId = null;
      vaultStatus.setText(`Vault registry: Disconnecting ${currentVaultId}...`);
      await this.controller.disconnectVault("default", currentVaultId);
      vaultStatus.setText(`Vault registry: Disconnected from ${currentVaultId}. Local state was kept.`);
      this.display();
    });

    const forgetButton = actions.createEl("button", {
      text: this.confirmForgetVaultId === currentVaultId ? "Confirm forget" : "Forget local state",
    });
    forgetButton.addClass("mod-warning");
    forgetButton.addEventListener("click", async () => {
      if (this.confirmForgetVaultId !== currentVaultId) {
        this.confirmForgetVaultId = currentVaultId;
        this.confirmDisconnectVaultId = null;
        vaultStatus.setText(`Vault registry: Click "Confirm forget" to remove local state for ${currentVaultId}.`);
        this.display();
        return;
      }

      this.confirmForgetVaultId = null;
      vaultStatus.setText(`Vault registry: Removing local state for ${currentVaultId}...`);
      await this.controller.forgetVault("default", currentVaultId);
      vaultStatus.setText(`Vault registry: Removed local state for ${currentVaultId}.`);
      this.display();
    });

    return panel;
  }

  private renderCreateVaultControl(container: HTMLElement, vaultStatus: HTMLElement): void {
    new Setting(container)
      .setName("Create vault")
      .setDesc("Create a new vault on the server and switch this client to it.")
      .addText((text) =>
        text
          .setPlaceholder("team_notes")
          .setValue(this.createVaultDraft)
          .onChange((value) => {
            this.createVaultDraft = value.trim();
          }),
      )
      .addButton((button) =>
        button.setButtonText("Create & join").setCta().onClick(async () => {
          const nextVaultId = this.createVaultDraft.trim();
          if (!nextVaultId) {
            vaultStatus.setText("Vault registry: Enter a vault ID first.");
            return;
          }
          await this.createAndJoinVault(nextVaultId, vaultStatus);
        }),
      );
  }

  private renderJoinServerVaultControl(
    container: HTMLElement,
    currentVaultId: string,
    vaultStatus: HTMLElement,
  ): void {
    let remoteJoinVaultId =
      this.remoteVaults?.find((vault) => vault.vault_id !== currentVaultId)?.vault_id ?? "";

    new Setting(container)
      .setName("Join server vault")
      .setDesc(
        this.remoteVaults
          ? "Switch to a vault discovered on the server."
          : this.loadingRemoteVaults
            ? "Loading vaults from the server..."
            : "Load vaults from the server first.",
      )
      .addDropdown((dropdown) => {
        if (!this.remoteVaults || this.remoteVaults.length === 0) {
          dropdown.addOption("", this.loadingRemoteVaults ? "Loading..." : "No loaded vaults");
          dropdown.setValue("");
          return;
        }

        for (const vault of this.remoteVaults) {
          dropdown.addOption(vault.vault_id, vault.vault_id);
        }

        dropdown.setValue(remoteJoinVaultId || currentVaultId).onChange((value) => {
          remoteJoinVaultId = value;
        });
      })
      .addButton((button) => {
        if (!this.remoteVaults || this.remoteVaults.length === 0 || !remoteJoinVaultId || remoteJoinVaultId === currentVaultId) {
          button.setButtonText("Join").setDisabled(true);
          return;
        }

        button.setButtonText("Join").onClick(async () => {
          this.confirmDisconnectVaultId = null;
          this.confirmForgetVaultId = null;
          vaultStatus.setText(`Vault registry: Joining ${remoteJoinVaultId}...`);
          await this.controller.activateVault(remoteJoinVaultId);
          this.display();
        });
      });
  }

  private renderRemoteVaultsPanel(
    container: HTMLElement,
    currentVaultId: string,
    vaultStatus: HTMLElement,
  ): void {
    if (!this.remoteVaults) {
      return;
    }

    const panel = createCollapsibleSection(
      container,
      "Available vaults",
      "Vaults loaded from the server. Join one to switch this client.",
      true,
    );
    const list = createPanel(panel);
    list.createEl("div", { text: "Server vaults", cls: "obsidian-sync-panel-title" });

    if (this.remoteVaults.length === 0) {
      list.createEl("div", {
        text: "No vaults found on the server yet.",
        cls: "setting-item-description",
      });
      return;
    }

    for (const vault of this.remoteVaults) {
      const row = list.createDiv();
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "flex-start";
      row.style.gap = "12px";
      row.style.padding = "6px 0";

      const meta = row.createDiv();
      meta.style.display = "grid";
      meta.style.gap = "4px";
      meta.createEl("div", { text: vault.vault_id });
      meta.createEl("div", {
        text: `${vault.device_count} device(s), updated ${formatTimestamp(vault.updated_at)}`,
        cls: "setting-item-description",
      });

      const joinButton = row.createEl("button", {
        text: vault.vault_id === currentVaultId ? "Current" : "Join",
      });
      if (vault.vault_id === currentVaultId) {
        joinButton.disabled = true;
      } else {
        joinButton.addEventListener("click", async () => {
          this.confirmDisconnectVaultId = null;
          this.confirmForgetVaultId = null;
          vaultStatus.setText(`Vault registry: Joining ${vault.vault_id}...`);
          await this.controller.activateVault(vault.vault_id);
          this.display();
        });
      }
    }
  }

  private renderLocalVaultsPanel(
    container: HTMLElement,
    currentVaultId: string,
    knownVaultIds: string[],
  ): void {
    if (knownVaultIds.length <= 1) {
      return;
    }

    const panel = createCollapsibleSection(
      container,
      "Recent local vaults",
      "Vaults remembered on this device, even if they were not loaded from the server in this session.",
      false,
    );
    const list = createPanel(panel);
    list.createEl("div", { text: "Local vault history", cls: "obsidian-sync-panel-title" });

    for (const vaultId of knownVaultIds) {
      createKeyValueRow(
        list,
        vaultId,
        vaultId === currentVaultId ? "Current vault" : "Available locally",
      );
    }
  }

  private renderAdvancedVaultPanel(container: HTMLElement, currentVaultId: string): void {
    const panel = createCollapsibleSection(
      container,
      "Advanced vault actions",
      "Manual vault controls for recovery and edge cases.",
      false,
    );

    new Setting(panel)
      .setName("Manual vault ID")
      .setDesc("Fallback for advanced cases when you need to enter a vault ID directly.")
      .addText((text) =>
        text
          .setPlaceholder("default")
          .setValue(currentVaultId)
          .onChange(async (value) => {
            this.confirmDisconnectVaultId = null;
            this.confirmForgetVaultId = null;
            const nextVaultId = value.trim() || "default";
            await this.controller.activateVault(nextVaultId);
            this.display();
          }),
      );
  }

  private renderSyncScopeSection(container: HTMLElement): void {
    const group = createSettingGroup(container, "Sync Scope", "Control which files are eligible for sync in this vault.");
    const currentVaultId = this.plugin.settings.vaultId;
    const knownVaultIds = this.controller.getKnownVaultIds();
    const otherVaultIds = knownVaultIds.filter((vaultId) => vaultId !== currentVaultId);

    new Setting(group)
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

    new Setting(group)
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
    new Setting(group)
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

    const syncHealth = createPanel(group);
    syncHealth.createEl("div", { text: "Sync health", cls: "obsidian-sync-panel-title" });
    createKeyValueRow(syncHealth, "Vault", currentVaultId);
    createKeyValueRow(syncHealth, "Change cursor", String(this.plugin.state.lastSeq));
    createKeyValueRow(syncHealth, "Files tracked", String(this.getTrackedFilesCount()));
    createKeyValueRow(syncHealth, "Deletes tracked", String(this.getDeletedFilesCount()));
    createKeyValueRow(syncHealth, "Last successful sync", formatLastSyncAt(this.plugin.state.lastSyncAt));
    createKeyValueRow(syncHealth, "Last issue", formatSyncErrorState(this.plugin.state.lastSyncError));

    const currentScope = createCollapsibleSection(
      group,
      "Current sync scope",
      "Preview which files are included or skipped by the current rules.",
      false,
    );
    currentScope.createEl("div", { text: "Current sync scope", cls: "obsidian-sync-panel-title" });
    const scopeList = currentScope.createEl("div");
    scopeList.style.display = "grid";
    scopeList.style.gap = "6px";
    for (const line of describeSyncScope(
      this.plugin.settings.includePatterns,
      this.plugin.settings.ignorePatterns,
    )) {
      scopeList.createEl("div", { text: line });
    }

    const preview = buildScopePreview(
      this.plugin.app.vault.getFiles().map((file) => file.path),
      this.plugin.settings.includePatterns,
      this.plugin.settings.ignorePatterns,
    );
    createKeyValueRow(
      currentScope,
      "Preview",
      `${preview.syncedCount} included, ${preview.skippedCount} skipped`,
    );
    if (preview.sampleLines.length > 0) {
      const previewList = currentScope.createEl("div");
      previewList.style.display = "grid";
      previewList.style.gap = "6px";
      for (const line of preview.sampleLines) {
        previewList.createEl("div", { text: line, cls: "setting-item-description" });
      }
    }
  }

  private renderDevicesSection(container: HTMLElement): void {
    const group = createSettingGroup(container, "Devices", "Inspect the current device registry for this vault.");
    const section = createCollapsibleSection(
      group,
      "Registered devices",
      "Open to inspect known devices for this vault.",
      false,
    );
    const devicesStatus = createPanel(section);
    devicesStatus.createEl("div", { text: "Loading devices...", cls: "obsidian-sync-panel-title" });

    new Setting(section)
      .setName("Refresh devices")
      .setDesc("Fetch the current device registry for this vault from the server.")
      .addButton((button) =>
        button.setButtonText("Refresh").onClick(async () => {
          await this.renderDevices(devicesStatus);
        }),
      );

    void this.renderDevices(devicesStatus);
  }

  private renderE2eeSection(container: HTMLElement): void {
    const group = createSettingGroup(container, "E2EE", "Manage the session passphrase and fingerprint for this vault.");
    const section = createCollapsibleSection(
      group,
      "E2EE controls",
      "Open to manage the session passphrase and this vault fingerprint.",
      false,
    );

    new Setting(section)
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

    const status = createInlineStatus(
      section,
      "E2EE",
      buildE2eeStatusText(
        this.controller.getE2eeFingerprint(),
        this.controller.getE2eePassphrase(),
      ),
    );

    new Setting(section)
      .setName("Passphrase validation")
      .setDesc("Check the session passphrase against the stored fingerprint for this vault.")
      .addButton((button) =>
        button.setButtonText("Validate").onClick(async () => {
          try {
            const message = await this.controller.validateCurrentE2eePassphrase();
            status.setText(`E2EE: ${message}`);
          } catch (error) {
            status.setText(`E2EE: ${formatDeviceError(error)}`);
          }
        }),
      )
      .addButton((button) =>
        button.setButtonText("Forget fingerprint").onClick(async () => {
          await this.controller.clearCurrentE2eeFingerprint();
          status.setText(
            buildE2eeStatusText(
              this.controller.getE2eeFingerprint(),
              this.controller.getE2eePassphrase(),
            ),
          );
        }),
      );
  }

  private async createAndJoinVault(vaultId: string, vaultStatus: HTMLElement): Promise<void> {
    this.confirmDisconnectVaultId = null;
    this.confirmForgetVaultId = null;
    vaultStatus.setText(`Vault registry: Creating ${vaultId}...`);
    try {
      const response = await this.controller.createVault(vaultId);
      await this.controller.activateVault(response.vault.vault_id);
      this.createVaultDraft = "";
      this.remoteVaults = await this.controller.getRemoteVaults();
      this.remoteVaultsError = null;
      vaultStatus.setText(
        response.created
          ? `Vault registry: Created and joined ${response.vault.vault_id}.`
          : `Vault registry: Joined existing vault ${response.vault.vault_id}.`,
      );
    } catch (error) {
      this.remoteVaults = null;
      this.remoteVaultsError = formatDeviceError(error);
      vaultStatus.setText(`Vault registry: ${this.remoteVaultsError}`);
    }
    this.display();
  }

  private async reloadRemoteVaults(vaultStatus: HTMLElement): Promise<void> {
    vaultStatus.setText("Vault registry: Loading...");
    try {
      this.remoteVaults = await this.controller.getRemoteVaults();
      this.remoteVaultsError = null;
      vaultStatus.setText(`Vault registry: ${this.remoteVaults.length} vault(s) loaded.`);
    } catch (error) {
      this.remoteVaults = null;
      this.remoteVaultsError = formatDeviceError(error);
      vaultStatus.setText(`Vault registry: ${this.remoteVaultsError}`);
    }
    this.display();
  }

  private async renderDevices(container: HTMLElement): Promise<void> {
    container.empty();
    container.createEl("div", { text: "Devices", cls: "obsidian-sync-panel-title" });
    container.createEl("div", { text: "Loading devices...", cls: "setting-item-description" });

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
      container.createEl("div", { text: "Devices", cls: "obsidian-sync-panel-title" });

      if (sortedDevices.length === 0) {
        container.createEl("div", {
          text: "No devices registered for this vault yet.",
          cls: "setting-item-description",
        });
        return;
      }

      const currentDevice = sortedDevices.find((device) => device.device_id === currentDeviceId);
      container.createEl("div", {
        text: currentDevice
          ? `This device is registered. Last seen ${formatTimestamp(currentDevice.last_seen_at)}.`
          : "This device is not registered yet. Run sync to add it to the registry.",
        cls: "setting-item-description",
      });

      for (const device of sortedDevices) {
        const lastSeen = formatTimestamp(device.last_seen_at);
        const firstSeen = formatTimestamp(device.first_seen_at);
        const label =
          device.device_id === currentDeviceId
            ? `${device.device_id} (this device)`
            : device.device_id;
        createKeyValueRow(container, label, `Last seen ${lastSeen}. First seen ${firstSeen}.`);
      }
    } catch (error) {
      container.empty();
      container.createEl("div", { text: "Devices", cls: "obsidian-sync-panel-title" });
      container.createEl("div", {
        text: `Failed to load devices: ${formatDeviceError(error)}`,
        cls: "setting-item-description",
      });
    }
  }

  private getTrackedFilesCount(): number {
    return Object.values(this.plugin.state.files).filter((file) => !file.deleted).length;
  }

  private getDeletedFilesCount(): number {
    return Object.values(this.plugin.state.files).filter((file) => file.deleted).length;
  }
}
