import { App, Notice, PluginSettingTab, Setting } from "obsidian";

import { ApiError } from "./api";
import { formatSyncErrorState } from "./sync-errors";
import { describeSyncScope, normalizePatternList, shouldSyncPath } from "./sync-scope";
import { SettingsController } from "./settings-controller";
import type { VaultItem } from "./types";
import type ObsidianSyncPlugin from "./main";

export class SyncSettingTab extends PluginSettingTab {
  private remoteVaults: VaultItem[] | null = null;
  private createVaultDraft = "";
  private loadingRemoteVaults = false;
  private remoteVaultsError: string | null = null;
  private confirmForgetVaultId: string | null = null;

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

    if (!this.remoteVaults && !this.loadingRemoteVaults && this.plugin.settings.serverUrl.trim()) {
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
    const quickActionsStatus = createInlineStatus(containerEl, "Quick actions", "Ready");
    renderQuickActions(containerEl, [
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

    renderSectionHeader(containerEl, "Connection", "Server, auth, background sync and device identity.");

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

    const connectionStatus = createInlineStatus(containerEl, "Connection", "Not checked");
    new Setting(containerEl)
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
            this.controller.restartAutoSync();
          }),
      );

    new Setting(containerEl)
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

    const vaultStatus = createInlineStatus(
      containerEl,
      "Vault registry",
      this.loadingRemoteVaults
        ? "Loading..."
        : this.remoteVaultsError
          ? this.remoteVaultsError
        : this.remoteVaults
          ? `${this.remoteVaults.length} vault(s) loaded`
          : "Not loaded",
    );
    renderQuickActions(containerEl, [
      {
        label: "Load vaults",
        onClick: async () => {
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
        },
      },
    ]);

    const vaultRegistryState = createPanel(containerEl);
    vaultRegistryState.createEl("div", { text: "Vault registry", cls: "obsidian-sync-panel-title" });
    if (this.loadingRemoteVaults) {
      vaultRegistryState.createEl("div", {
        text: "Loading vaults from the server. You will be able to join an existing vault as soon as the list arrives.",
        cls: "setting-item-description",
      });
    } else if (this.remoteVaultsError) {
      vaultRegistryState.createEl("div", {
        text: `Vault list is unavailable: ${this.remoteVaultsError}`,
        cls: "setting-item-description",
      });
      vaultRegistryState.createEl("div", {
        text: "Check server URL and auth token, then use Load vaults again. You can still create a vault if the server is reachable.",
        cls: "setting-item-description",
      });
    } else if (this.remoteVaults && this.remoteVaults.length === 0) {
      vaultRegistryState.createEl("div", {
        text: "No vaults exist on the server yet.",
        cls: "setting-item-description",
      });
      vaultRegistryState.createEl("div", {
        text: "Create a vault below to start syncing this device.",
        cls: "setting-item-description",
      });
    } else if (this.remoteVaults) {
      const currentVaultOnServer = this.remoteVaults.some((vault) => vault.vault_id === currentVaultId);
      vaultRegistryState.createEl("div", {
        text: `Loaded ${this.remoteVaults.length} vault(s) from the server. Join one below or create a new vault.`,
        cls: "setting-item-description",
      });
      if (!currentVaultOnServer) {
        vaultRegistryState.createEl("div", {
          text: `The current vault "${currentVaultId}" is only local so far.`,
          cls: "setting-item-description",
        });
        vaultRegistryState.createEl("div", {
          text: "Create it on the server to start syncing this vault, or join another existing vault below.",
          cls: "setting-item-description",
        });

        const onboardingActions = vaultRegistryState.createDiv();
        onboardingActions.style.display = "flex";
        onboardingActions.style.flexWrap = "wrap";
        onboardingActions.style.gap = "8px";

        const createCurrentVaultButton = onboardingActions.createEl("button", {
          text: "Create current vault on server",
        });
        createCurrentVaultButton.addClass("mod-cta");
        createCurrentVaultButton.addEventListener("click", async () => {
          vaultStatus.setText(`Vault registry: Creating ${currentVaultId}...`);
          try {
            const response = await this.controller.createVault(currentVaultId);
            await this.controller.activateVault(response.vault.vault_id);
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
        });
      }
    } else {
      vaultRegistryState.createEl("div", {
        text: "Vault list has not been loaded yet.",
        cls: "setting-item-description",
      });
      vaultRegistryState.createEl("div", {
        text: "Use Load vaults to discover existing vaults on the server, or create a new vault below.",
        cls: "setting-item-description",
      });
    }

    const currentVaultPanel = createPanel(containerEl);
    currentVaultPanel.createEl("div", { text: "Current vault", cls: "obsidian-sync-panel-title" });
    createKeyValueRow(currentVaultPanel, "Active vault", currentVaultId);
    createKeyValueRow(
      currentVaultPanel,
      "Server registry",
      this.remoteVaults
        ? this.remoteVaults.some((vault) => vault.vault_id === currentVaultId) ? "Loaded" : "Not loaded here"
        : this.loadingRemoteVaults ? "Loading..." : this.remoteVaultsError ? "Unavailable" : "Not loaded",
    );
    const currentVaultActions = currentVaultPanel.createDiv();
    currentVaultActions.style.display = "flex";
    currentVaultActions.style.flexWrap = "wrap";
    currentVaultActions.style.gap = "8px";

    const disconnectButton = currentVaultActions.createEl("button", { text: "Disconnect" });
    disconnectButton.addEventListener("click", async () => {
      vaultStatus.setText(`Vault registry: Disconnecting ${currentVaultId}...`);
      await this.controller.disconnectVault("default", currentVaultId);
      vaultStatus.setText(`Vault registry: Disconnected from ${currentVaultId}. Local state was kept.`);
      this.display();
    });

    const forgetButton = currentVaultActions.createEl("button", { text: "Forget local state" });
    forgetButton.addClass("mod-warning");
    if (this.confirmForgetVaultId === currentVaultId) {
      forgetButton.setText("Confirm forget");
    }
    forgetButton.addEventListener("click", async () => {
      if (this.confirmForgetVaultId !== currentVaultId) {
        this.confirmForgetVaultId = currentVaultId;
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

    new Setting(containerEl)
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

          vaultStatus.setText(`Vault registry: Creating ${nextVaultId}...`);
          try {
            const response = await this.controller.createVault(nextVaultId);
            await this.controller.activateVault(response.vault.vault_id);
            this.createVaultDraft = "";
            if (this.remoteVaults) {
              this.remoteVaults = await this.controller.getRemoteVaults();
            }
            vaultStatus.setText(
              response.created
                ? `Vault registry: Created and joined ${response.vault.vault_id}.`
                : `Vault registry: Joined existing vault ${response.vault.vault_id}.`,
            );
          } catch (error) {
            vaultStatus.setText(`Vault registry: ${formatDeviceError(error)}`);
          }
          this.display();
        }),
      );

    let remoteJoinVaultId =
      this.remoteVaults?.find((vault) => vault.vault_id !== currentVaultId)?.vault_id ?? "";
    new Setting(containerEl)
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
          vaultStatus.setText(`Vault registry: Joining ${remoteJoinVaultId}...`);
          await this.controller.activateVault(remoteJoinVaultId);
          this.display();
        });
      });

    if (this.remoteVaults) {
      const remoteVaultsPanel = createCollapsibleSection(
        containerEl,
        "Available vaults",
        "Vaults loaded from the server. Join one to switch this client.",
        true,
      );
      const remoteVaultsList = createPanel(remoteVaultsPanel);
      remoteVaultsList.createEl("div", { text: "Server vaults", cls: "obsidian-sync-panel-title" });

      if (this.remoteVaults.length === 0) {
        remoteVaultsList.createEl("div", {
          text: "No vaults found on the server yet.",
          cls: "setting-item-description",
        });
      } else {
        for (const vault of this.remoteVaults) {
          const row = remoteVaultsList.createDiv();
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

          const joinButton = row.createEl("button", { text: vault.vault_id === currentVaultId ? "Current" : "Join" });
          if (vault.vault_id === currentVaultId) {
            joinButton.disabled = true;
          } else {
            joinButton.addEventListener("click", async () => {
              vaultStatus.setText(`Vault registry: Joining ${vault.vault_id}...`);
              await this.controller.activateVault(vault.vault_id);
              this.display();
            });
          }
        }
      }
    }

    if (knownVaultIds.length > 1) {
      const localVaultsPanel = createCollapsibleSection(
        containerEl,
        "Recent local vaults",
        "Vaults remembered on this device, even if they were not loaded from the server in this session.",
        false,
      );
      const localVaultsList = createPanel(localVaultsPanel);
      localVaultsList.createEl("div", { text: "Local vault history", cls: "obsidian-sync-panel-title" });
      for (const vaultId of knownVaultIds) {
        createKeyValueRow(
          localVaultsList,
          vaultId,
          vaultId === currentVaultId ? "Current vault" : "Available locally",
        );
      }
    }

    const advancedVaultPanel = createCollapsibleSection(
      containerEl,
      "Advanced vault actions",
      "Manual vault controls for recovery and edge cases.",
      false,
    );
    new Setting(advancedVaultPanel)
      .setName("Manual vault ID")
      .setDesc("Fallback for advanced cases when you need to enter a vault ID directly.")
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

    renderSectionHeader(containerEl, "Sync Scope", "Control which files are eligible for sync in this vault.");

    new Setting(containerEl)
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

    new Setting(containerEl)
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
          await this.controller.copyCurrentVaultScopeToVault(presetTargetVaultId);
          new Notice(`Copied sync scope preset to ${presetTargetVaultId}`, 3000);
        });
      });

    const syncHealthSection = createPanel(containerEl);
    syncHealthSection.createEl("div", { text: "Sync health", cls: "obsidian-sync-panel-title" });
    createKeyValueRow(syncHealthSection, "Vault", currentVaultId);
    createKeyValueRow(syncHealthSection, "Change cursor", String(this.plugin.state.lastSeq));
    createKeyValueRow(syncHealthSection, "Files tracked", String(trackedFilesCount));
    createKeyValueRow(syncHealthSection, "Deletes tracked", String(deletedFilesCount));
    createKeyValueRow(syncHealthSection, "Last successful sync", formatLastSyncAt(this.plugin.state.lastSyncAt));
    createKeyValueRow(syncHealthSection, "Last issue", formatSyncErrorState(this.plugin.state.lastSyncError));

    const currentScopeSection = createCollapsibleSection(
      containerEl,
      "Current sync scope",
      "Preview which files are included or skipped by the current rules.",
      false,
    );
    currentScopeSection.createEl("div", { text: "Current sync scope", cls: "obsidian-sync-panel-title" });
    const scopeList = currentScopeSection.createEl("div");
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
      currentScopeSection,
      "Preview",
      `${preview.syncedCount} included, ${preview.skippedCount} skipped`,
    );
    if (preview.sampleLines.length > 0) {
      const previewList = currentScopeSection.createEl("div");
      previewList.style.display = "grid";
      previewList.style.gap = "6px";
      for (const line of preview.sampleLines) {
        previewList.createEl("div", { text: line, cls: "setting-item-description" });
      }
    }

    renderSectionHeader(containerEl, "Devices", "Inspect the current device registry for this vault.");
    const devicesSection = createCollapsibleSection(
      containerEl,
      "Registered devices",
      "Open to inspect known devices for this vault.",
      false,
    );
    const devicesStatus = createPanel(devicesSection);
    devicesStatus.createEl("div", { text: "Loading devices...", cls: "obsidian-sync-panel-title" });

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
    const e2eeSection = createCollapsibleSection(
      containerEl,
      "E2EE controls",
      "Open to manage the session passphrase and this vault fingerprint.",
      false,
    );

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

    const e2eeStatus = createInlineStatus(
      e2eeSection,
      "E2EE",
      buildE2eeStatusText(
        this.controller.getE2eeFingerprint(),
        this.controller.getE2eePassphrase(),
      ),
    );

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
}

function renderSectionHeader(container: HTMLElement, title: string, description: string): void {
  container.createEl("h3", { text: title });
  container.createEl("p", { text: description, cls: "setting-item-description" });
}

function createPanel(container: HTMLElement): HTMLElement {
  const panel = container.createDiv();
  panel.style.border = "1px solid var(--background-modifier-border)";
  panel.style.borderRadius = "10px";
  panel.style.padding = "14px";
  panel.style.background = "var(--background-secondary)";
  panel.style.display = "grid";
  panel.style.gap = "10px";
  panel.style.marginBottom = "16px";
  return panel;
}

function createCollapsibleSection(
  container: HTMLElement,
  title: string,
  summaryText: string,
  open: boolean,
): HTMLElement {
  const details = container.createEl("details");
  details.open = open;
  details.style.marginBottom = "16px";

  const summary = details.createEl("summary");
  summary.style.cursor = "pointer";
  summary.style.marginBottom = "10px";
  summary.style.fontWeight = "600";
  summary.createSpan({ text: title });

  const help = details.createEl("div", {
    text: summaryText,
    cls: "setting-item-description",
  });
  help.style.marginTop = "8px";
  help.style.marginBottom = "12px";

  return details;
}

function createInlineStatus(container: HTMLElement, label: string, value: string): HTMLElement {
  const statusEl = container.createDiv({
    text: `${label}: ${value}`,
    cls: "setting-item-description",
  });
  statusEl.style.marginTop = "-8px";
  statusEl.style.marginBottom = "12px";
  return statusEl;
}

function renderQuickActions(
  container: HTMLElement,
  actions: Array<{
    label: string;
    onClick: () => Promise<void>;
    cta?: boolean;
  }>,
): void {
  const row = container.createDiv();
  row.style.display = "flex";
  row.style.flexWrap = "wrap";
  row.style.gap = "8px";
  row.style.marginTop = "-2px";
  row.style.marginBottom = "14px";

  for (const action of actions) {
    const button = row.createEl("button", { text: action.label });
    if (action.cta) {
      button.addClass("mod-cta");
    }

    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await action.onClick();
      } finally {
        button.disabled = false;
      }
    });
  }
}

function createKeyValueRow(container: HTMLElement, label: string, value: string): void {
  const row = container.createDiv();
  row.style.display = "grid";
  row.style.gridTemplateColumns = "160px 1fr";
  row.style.gap = "12px";
  row.style.alignItems = "start";
  row.style.fontSize = "13px";

  const labelEl = row.createSpan({ text: label });
  labelEl.style.color = "var(--text-muted)";
  labelEl.style.fontWeight = "600";

  const valueEl = row.createSpan({ text: value });
  valueEl.style.wordBreak = "break-word";
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
  const panel = createPanel(container);
  const topRow = panel.createDiv();
  topRow.style.display = "flex";
  topRow.style.justifyContent = "space-between";
  topRow.style.alignItems = "flex-start";
  topRow.style.gap = "12px";
  topRow.style.flexWrap = "wrap";

  const copy = topRow.createDiv();
  copy.style.display = "grid";
  copy.style.gap = "6px";
  copy.style.flex = "1 1 280px";
  copy.createEl("div", { text: "Sync status", cls: "obsidian-sync-panel-title" });
  copy.createEl("div", {
    text: buildOverviewSummary(status),
    cls: "setting-item-description",
  });

  const badges = topRow.createDiv();
  badges.style.display = "flex";
  badges.style.gap = "8px";
  badges.style.flexWrap = "wrap";
  createBadge(
    badges,
    status.lastSyncError === "No recent errors" ? "Healthy" : "Needs attention",
    status.lastSyncError === "No recent errors" ? "ok" : "error",
  );
  createBadge(
    badges,
    status.e2eeFingerprint
      ? status.hasSessionPassphrase ? "E2EE loaded" : "E2EE locked"
      : status.hasSessionPassphrase ? "E2EE pending" : "E2EE off",
    status.e2eeFingerprint
      ? status.hasSessionPassphrase ? "ok" : "warn"
      : status.hasSessionPassphrase ? "warn" : "muted",
  );

  createKeyValueRow(panel, "Vault", status.vaultId);
  createKeyValueRow(panel, "Server", status.serverUrl || "Not configured");
  createKeyValueRow(panel, "Files tracked", String(status.trackedFilesCount));
  createKeyValueRow(panel, "Deletes tracked", String(status.deletedFilesCount));
  createKeyValueRow(panel, "Last sync", formatLastSyncAt(status.lastSyncAt));
  createKeyValueRow(panel, "Last issue", status.lastSyncError);
}

function createBadge(
  container: HTMLElement,
  text: string,
  tone: "ok" | "warn" | "error" | "muted",
): void {
  const badge = container.createSpan({ text });
  badge.style.display = "inline-flex";
  badge.style.alignItems = "center";
  badge.style.padding = "4px 10px";
  badge.style.borderRadius = "999px";
  badge.style.fontSize = "12px";
  badge.style.fontWeight = "600";
  badge.style.border = "1px solid var(--background-modifier-border)";

  if (tone === "ok") {
    badge.style.background = "color-mix(in srgb, var(--background-secondary) 78%, var(--color-green) 22%)";
  } else if (tone === "warn") {
    badge.style.background = "color-mix(in srgb, var(--background-secondary) 78%, var(--color-orange) 22%)";
  } else if (tone === "error") {
    badge.style.background = "color-mix(in srgb, var(--background-secondary) 74%, var(--color-red) 26%)";
  } else {
    badge.style.background = "var(--background-primary-alt)";
  }
}

function buildOverviewSummary(status: {
  trackedFilesCount: number;
  lastSyncAt: number | null;
  lastSyncError: string;
}): string {
  if (status.lastSyncError !== "No recent errors") {
    return `Attention required. ${status.lastSyncError}`;
  }

  return `Tracking ${status.trackedFilesCount} file(s). Last successful sync: ${formatLastSyncAt(status.lastSyncAt)}.`;
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
