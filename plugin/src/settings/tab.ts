import { App, PluginSettingTab, Setting } from "obsidian";

import { normalizePatternList } from "../sync/scope";
import { formatSyncErrorState } from "../sync/errors";
import { SettingsController } from "./controller";
import { CreateVaultModal, type CreateVaultModalResult } from "../ui/create-vault-modal";
import {
  createInlineStatus,
  createSettingGroup,
  formatDeviceError,
  formatLastSyncAt,
  renderQuickActions,
  renderStatusHeader,
} from "./ui";
import type { VaultItem } from "../types";
import type ObsidianSyncPlugin from "../main";

export class SyncSettingTab extends PluginSettingTab {
  private remoteVaults: VaultItem[] | null = null;
  private authTokenDraft: string | null = null;
  private editingAuthToken = false;
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

    this.ensureDrafts();
    this.maybeLoadRemoteVaults();
    this.renderConnectionSection(containerEl);
    if (!this.isSettingsUnlocked()) {
      return;
    }

    this.renderOverviewSection(containerEl);
    this.renderVaultSection(containerEl);
    this.renderSyncScopeSection(containerEl);
  }

  private maybeLoadRemoteVaults(): void {
    if (
      this.remoteVaults
      || this.loadingRemoteVaults
      || !this.plugin.settings.serverUrl.trim()
      || !this.plugin.settings.authToken.trim()
      || this.remoteVaultsError === "auth failed"
      || this.plugin.state.lastSyncError?.code === "unauthorized"
    ) {
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

  private ensureDrafts(): void {
    if (this.authTokenDraft === null) {
      this.authTokenDraft = this.plugin.settings.authToken;
    }
  }

  private isSettingsUnlocked(): boolean {
    if (!this.plugin.settings.authToken.trim()) {
      return false;
    }

    if (this.remoteVaultsError === "auth failed") {
      return false;
    }

    return this.plugin.state.lastSyncError?.code !== "unauthorized";
  }

  private renderConnectionLockState(container: HTMLElement): void {
    const hint = container.createDiv({
      text: this.getAuthGateMessage(),
      cls: "setting-item-description",
    });
  }

  private getAuthGateMessage(): string {
    if (!this.plugin.settings.authToken.trim()) {
      return "Enter a valid Auth token to unlock vault, sync scope, device and E2EE settings.";
    }

    if (this.remoteVaultsError === "auth failed" || this.plugin.state.lastSyncError?.code === "unauthorized") {
      return "The current Auth token was rejected by the server. Update the token and run Check again.";
    }

    return "Authorize this plugin to unlock the rest of the sync settings.";
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
    const section = createSettingGroup(
      container,
      "Connection",
      "Server, auth, background sync and device identity.",
    );

    let connectionStatus!: HTMLElement;
    const unlocked = this.isSettingsUnlocked();

    const serverSetting = new Setting(section)
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
            if (this.plugin.state.lastSyncError?.code === "unauthorized") {
              this.plugin.state.lastSyncError = null;
            }
            await this.plugin.persistData();
            this.controller.restartAutoSync();
            this.display();
          }),
      )
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
    connectionStatus = serverSetting.descEl.createDiv({
      text: "Connection: Not checked",
      cls: "setting-item-description",
    });

    if (!unlocked || this.editingAuthToken) {
      const authSetting = new Setting(section)
        .setName("Auth token")
        .setDesc("Bearer token required by the sync server.")
        .addText((text) =>
          text
            .setPlaceholder("secret-token")
            .setValue(this.editingAuthToken ? "" : (this.authTokenDraft ?? ""))
            .onChange((value) => {
              this.authTokenDraft = value.trim();
            }),
        )
        .addButton((button) =>
          button.setButtonText("Authorize").setCta().onClick(async () => {
            await this.authorizeToken(connectionStatus);
          }),
        );

      if (this.editingAuthToken) {
        authSetting.addButton((button) =>
          button.setButtonText("Cancel").onClick(() => {
            this.editingAuthToken = false;
            this.authTokenDraft = this.plugin.settings.authToken;
            this.display();
          }),
        );
      }

      if (!unlocked) {
        this.renderConnectionLockState(authSetting.descEl);
        return;
      }
    } else {
      new Setting(section)
        .setName("Authorization")
        .setDesc("Authorized with the current server token.")
        .addButton((button) =>
          button.setButtonText("Change token").onClick(() => {
            this.editingAuthToken = true;
            this.authTokenDraft = "";
            this.display();
          }),
        )
        .addButton((button) =>
          button.setButtonText("Sign out").onClick(async () => {
            this.editingAuthToken = false;
            this.authTokenDraft = "";
            this.plugin.settings.authToken = "";
            this.remoteVaults = null;
            this.remoteVaultsError = null;
            if (
              this.plugin.state.lastSyncError?.code === "unauthorized"
              || this.plugin.state.lastSyncError?.code === "invalid_settings"
            ) {
              this.plugin.state.lastSyncError = null;
            }
            await this.plugin.persistData();
            this.controller.restartAutoSync();
            connectionStatus.setText("Connection: Not authorized");
            this.display();
          }),
        );
    }

    new Setting(section)
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

    new Setting(section)
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
    this.renderCurrentVaultPanel(group, currentVaultId, vaultStatus);
    this.renderVaultRegistryControl(group, currentVaultId, vaultStatus);
    this.renderCreateVaultControl(group, vaultStatus);
    this.renderJoinServerVaultControl(group, currentVaultId, vaultStatus);
  }

  private renderCurrentVaultPanel(
    container: HTMLElement,
    currentVaultId: string,
    vaultStatus: HTMLElement,
  ): void {
    const serverRegistryStatus =
      !currentVaultId
        ? "Not connected"
        : this.remoteVaults
        ? this.remoteVaults.some((vault) => vault.vault_id === currentVaultId) ? "Loaded" : "Not loaded here"
        : this.loadingRemoteVaults ? "Loading..." : this.remoteVaultsError ? "Unavailable" : "Not loaded";

    new Setting(container)
      .setName("Current vault")
      .setDesc(`Connected vault: ${currentVaultId || "Not connected"}. Server registry: ${serverRegistryStatus}.`)
      .addButton((button) => {
        button.setButtonText(
          this.confirmDisconnectVaultId === currentVaultId ? "Confirm disconnect" : "Disconnect",
        );
        button.setDisabled(!currentVaultId);
        button.onClick(async () => {
          if (!currentVaultId) {
            return;
          }

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
          await this.controller.disconnectVault();
          vaultStatus.setText(`Vault registry: This folder is no longer connected to ${currentVaultId}.`);
          this.display();
        });
      })
      .addButton((button) => {
        button.setButtonText(
          this.confirmForgetVaultId === currentVaultId ? "Confirm forget" : "Forget local state",
        );
        button.setWarning();
        button.setDisabled(!currentVaultId);
        button.onClick(async () => {
          if (!currentVaultId) {
            return;
          }

          if (this.confirmForgetVaultId !== currentVaultId) {
            this.confirmForgetVaultId = currentVaultId;
            this.confirmDisconnectVaultId = null;
            vaultStatus.setText(`Vault registry: Click "Confirm forget" to remove local state for ${currentVaultId}.`);
            this.display();
            return;
          }

          this.confirmForgetVaultId = null;
          vaultStatus.setText(`Vault registry: Removing local state for ${currentVaultId}...`);
          await this.controller.forgetLocalState();
          vaultStatus.setText(`Vault registry: Removed local state for ${currentVaultId}.`);
          this.display();
        });
      });
  }

  private renderVaultRegistryControl(
    container: HTMLElement,
    currentVaultId: string,
    vaultStatus: HTMLElement,
  ): void {
    const description = this.loadingRemoteVaults
      ? "Loading vaults from the server..."
      : this.remoteVaultsError
        ? `Vault list is unavailable: ${this.remoteVaultsError}`
        : this.remoteVaults
          ? this.remoteVaults.length === 0
            ? "No vaults exist on the server yet."
            : currentVaultId && !this.remoteVaults.some((vault) => vault.vault_id === currentVaultId)
              ? `Loaded ${this.remoteVaults.length} vault(s). The current vault is not in the server registry.`
              : `Loaded ${this.remoteVaults.length} vault(s) from the server.`
          : "Load vaults from the server to join an existing one.";

    new Setting(container)
      .setName("Server vaults")
      .setDesc(description)
      .addButton((button) =>
        button
          .setButtonText("Load vaults")
          .setDisabled(this.loadingRemoteVaults)
          .onClick(async () => {
            await this.reloadRemoteVaults(vaultStatus);
          }),
      )
      .addButton((button) => {
        if (!currentVaultId || !this.remoteVaults || this.remoteVaults.some((vault) => vault.vault_id === currentVaultId)) {
          button.setButtonText("Create current").setDisabled(true);
          return;
        }

        button.setButtonText("Create current").setCta().onClick(async () => {
          const createVault = await this.requestCreateVault(currentVaultId);
          if (!createVault) {
            return;
          }
          await this.createAndJoinVault(createVault.vaultId, createVault.passphrase, vaultStatus);
        });
      });
  }

  private renderCreateVaultControl(container: HTMLElement, vaultStatus: HTMLElement): void {
    const currentVaultId = this.plugin.settings.vaultId;
    new Setting(container)
      .setName("Create vault")
      .setDesc(currentVaultId ? "Create a new vault on the server and reconnect this folder to it." : "Create a new vault on the server and connect this folder to it.")
      .addButton((button) =>
        button.setButtonText("Create vault").setCta().onClick(async () => {
          const createVault = await this.requestCreateVault("");
          if (!createVault) {
            return;
          }
          await this.createAndJoinVault(createVault.vaultId, createVault.passphrase, vaultStatus);
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
      .setName(currentVaultId ? "Reconnect this folder" : "Join server vault")
      .setDesc(
        this.remoteVaults
          ? currentVaultId
            ? "Reconnect this folder to a vault discovered on the server."
            : "Connect this folder to a vault discovered on the server."
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
          vaultStatus.setText(
            currentVaultId
              ? `Vault registry: Reconnecting this folder to ${remoteJoinVaultId}...`
              : `Vault registry: Joining ${remoteJoinVaultId}...`,
          );
          await this.controller.bindVault(remoteJoinVaultId);
          this.display();
        });
      });
  }

  private renderSyncScopeSection(container: HTMLElement): void {
    const group = createSettingGroup(container, "Sync Scope", "Control which files are eligible for sync in this vault.");

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
  }

  private async createAndJoinVault(vaultId: string, passphrase: string, vaultStatus: HTMLElement): Promise<void> {
    this.confirmDisconnectVaultId = null;
    this.confirmForgetVaultId = null;
    vaultStatus.setText(`Vault registry: Creating ${vaultId}...`);
    try {
      this.controller.setE2eePassphrase(passphrase, vaultId);
      const response = await this.controller.createVault(vaultId);
      await this.controller.bindVault(response.vault.vault_id);
      await this.controller.rememberCurrentE2eePassphrase();
      this.remoteVaults = await this.controller.getRemoteVaults();
      this.remoteVaultsError = null;
      vaultStatus.setText(
        response.created
          ? `Vault registry: Created and joined ${response.vault.vault_id}.`
          : `Vault registry: Joined existing vault ${response.vault.vault_id}.`,
      );
    } catch (error) {
      this.controller.setE2eePassphrase("", vaultId);
      this.remoteVaults = null;
      this.remoteVaultsError = formatDeviceError(error);
      vaultStatus.setText(`Vault registry: ${this.remoteVaultsError}`);
    }
    this.display();
  }

  private requestCreateVault(initialVaultId: string): Promise<CreateVaultModalResult | null> {
    return new Promise((resolve) => {
      new CreateVaultModal(this.app, initialVaultId, resolve).open();
    });
  }

  private async authorizeToken(connectionStatus: HTMLElement): Promise<void> {
    this.plugin.settings.authToken = (this.authTokenDraft ?? "").trim();
    this.remoteVaults = null;
    this.remoteVaultsError = null;
    if (
      this.plugin.state.lastSyncError?.code === "unauthorized"
      || this.plugin.state.lastSyncError?.code === "invalid_settings"
    ) {
      this.plugin.state.lastSyncError = null;
    }
    await this.plugin.persistData();
    this.controller.restartAutoSync();

    connectionStatus.setText("Connection: Checking...");
    try {
      const message = await this.controller.checkConnection();
      this.editingAuthToken = false;
      this.authTokenDraft = this.plugin.settings.authToken;
      connectionStatus.setText(`Connection: ${message}`);
    } catch (error) {
      connectionStatus.setText(`Connection: ${formatDeviceError(error)}`);
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

  private getTrackedFilesCount(): number {
    return Object.values(this.plugin.state.files).filter((file) => !file.deleted).length;
  }

  private getDeletedFilesCount(): number {
    return Object.values(this.plugin.state.files).filter((file) => file.deleted).length;
  }
}
