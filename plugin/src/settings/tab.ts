import { App, PluginSettingTab } from "obsidian";

import { normalizePatternList } from "../sync/scope";
import { formatSyncErrorState } from "../sync/errors";
import { SettingsController } from "./controller";
import { CreateVaultModal, type CreateVaultModalResult } from "../ui/create-vault-modal";
import { destroyComponent, mountComponent, type MountedSvelteComponent } from "../ui/svelte";
import { formatDeviceError } from "./ui";
import SettingsTabView from "./components/SettingsTab.svelte";
import type { SettingsActions, SettingsViewModel } from "./view-model";
import type { VaultItem } from "../types";
import type ObsidianSyncPlugin from "../main";

export class SyncSettingTab extends PluginSettingTab {
  private component: MountedSvelteComponent | null = null;
  private remoteVaults: VaultItem[] | null = null;
  private authTokenDraft: string | null = null;
  private editingAuthToken = false;
  private loadingRemoteVaults = false;
  private remoteVaultsError: string | null = null;
  private confirmForgetVaultId: string | null = null;
  private confirmDisconnectVaultId: string | null = null;
  private connectionStatusText = "Not checked";
  private quickActionsStatusText = "Ready";
  private vaultStatusText = "Not loaded";

  constructor(
    app: App,
    private readonly plugin: ObsidianSyncPlugin,
    private readonly controller: SettingsController,
  ) {
    super(app, plugin);
  }

  display(): void {
    void destroyComponent(this.component);
    this.component = null;

    const { containerEl } = this;
    containerEl.empty();

    this.ensureDrafts();
    this.maybeLoadRemoteVaults();
    this.component = mountComponent(SettingsTabView, containerEl, {
      model: this.buildViewModel(),
      actions: this.buildActions(),
    });
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
    this.vaultStatusText = "Loading...";
    void this.controller
      .getRemoteVaults()
      .then((vaults) => {
        this.remoteVaults = vaults;
        this.remoteVaultsError = null;
        this.vaultStatusText = `${vaults.length} vault(s) loaded.`;
      })
      .catch((error) => {
        this.remoteVaults = null;
        this.remoteVaultsError = formatDeviceError(error);
        this.vaultStatusText = this.remoteVaultsError;
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

  private getAuthGateMessage(): string {
    if (!this.plugin.settings.authToken.trim()) {
      return "Enter a valid Auth token to unlock vault, sync scope, device and E2EE settings.";
    }

    if (this.remoteVaultsError === "auth failed" || this.plugin.state.lastSyncError?.code === "unauthorized") {
      return "The current Auth token was rejected by the server. Update the token and run Check again.";
    }

    return "Authorize this plugin to unlock the rest of the sync settings.";
  }

  private async createAndJoinVault(vaultId: string, passphrase: string): Promise<void> {
    this.confirmDisconnectVaultId = null;
    this.confirmForgetVaultId = null;
    this.vaultStatusText = `Creating ${vaultId}...`;
    try {
      this.controller.setE2eePassphrase(passphrase, vaultId);
      const response = await this.controller.createVault(vaultId);
      await this.controller.bindVault(response.vault.vault_id);
      await this.controller.rememberCurrentE2eePassphrase();
      this.remoteVaults = await this.controller.getRemoteVaults();
      this.remoteVaultsError = null;
      this.vaultStatusText =
        response.created
          ? `Vault registry: Created and joined ${response.vault.vault_id}.`
          : `Vault registry: Joined existing vault ${response.vault.vault_id}.`;
    } catch (error) {
      this.controller.setE2eePassphrase("", vaultId);
      this.remoteVaults = null;
      this.remoteVaultsError = formatDeviceError(error);
      this.vaultStatusText = this.remoteVaultsError;
    }
    this.display();
  }

  private requestCreateVault(initialVaultId: string): Promise<CreateVaultModalResult | null> {
    return new Promise((resolve) => {
      new CreateVaultModal(this.app, initialVaultId, resolve).open();
    });
  }

  private async authorizeToken(): Promise<void> {
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

    this.connectionStatusText = "Checking...";
    try {
      const message = await this.controller.checkConnection();
      this.editingAuthToken = false;
      this.authTokenDraft = this.plugin.settings.authToken;
      this.connectionStatusText = message;
    } catch (error) {
      this.connectionStatusText = formatDeviceError(error);
    }

    this.display();
  }

  private async reloadRemoteVaults(): Promise<void> {
    this.vaultStatusText = "Loading...";
    try {
      this.remoteVaults = await this.controller.getRemoteVaults();
      this.remoteVaultsError = null;
      this.vaultStatusText = `${this.remoteVaults.length} vault(s) loaded.`;
    } catch (error) {
      this.remoteVaults = null;
      this.remoteVaultsError = formatDeviceError(error);
      this.vaultStatusText = this.remoteVaultsError;
    }
    this.display();
  }

  private buildViewModel(): SettingsViewModel {
    return {
      unlocked: this.isSettingsUnlocked(),
      authGateMessage: this.getAuthGateMessage(),
      serverUrl: this.plugin.settings.serverUrl,
      authTokenDraft: this.editingAuthToken ? "" : (this.authTokenDraft ?? ""),
      editingAuthToken: this.editingAuthToken,
      connectionStatusText: this.connectionStatusText,
      deviceId: this.plugin.settings.deviceId,
      pollIntervalSecs: this.plugin.settings.pollIntervalSecs,
      autoSync: this.plugin.settings.autoSync,
      currentVaultId: this.plugin.settings.vaultId,
      trackedFilesCount: this.getTrackedFilesCount(),
      deletedFilesCount: this.getDeletedFilesCount(),
      lastSyncAt: this.plugin.state.lastSyncAt,
      lastSyncErrorText: formatSyncErrorState(this.plugin.state.lastSyncError),
      e2eeFingerprint: this.controller.getE2eeFingerprint(),
      e2eePassphrase: this.controller.getE2eePassphrase(),
      quickActionsStatusText: this.quickActionsStatusText,
      remoteVaults: this.remoteVaults,
      loadingRemoteVaults: this.loadingRemoteVaults,
      remoteVaultsError: this.remoteVaultsError,
      vaultStatusText: this.vaultStatusText,
      confirmDisconnect: this.confirmDisconnectVaultId === this.plugin.settings.vaultId,
      confirmForget: this.confirmForgetVaultId === this.plugin.settings.vaultId,
      includePatterns: this.plugin.settings.includePatterns,
      ignorePatterns: this.plugin.settings.ignorePatterns,
    };
  }

  private buildActions(): SettingsActions {
    return {
      onServerUrlChange: async (value) => {
        this.plugin.settings.serverUrl = value.trim();
        this.remoteVaults = null;
        this.remoteVaultsError = null;
        this.vaultStatusText = "Not loaded";
        this.connectionStatusText = "Not checked";
        if (this.plugin.state.lastSyncError?.code === "unauthorized") {
          this.plugin.state.lastSyncError = null;
        }
        await this.plugin.persistData();
        this.controller.restartAutoSync();
        this.display();
      },
      onCheckConnection: async () => {
        this.connectionStatusText = "Checking...";
        this.display();
        try {
          this.connectionStatusText = await this.controller.checkConnection();
        } catch (error) {
          this.connectionStatusText = formatDeviceError(error);
        }
        this.display();
      },
      onAuthTokenDraftChange: (value) => {
        this.authTokenDraft = value.trim();
      },
      onAuthorize: async () => {
        await this.authorizeToken();
      },
      onCancelAuthEdit: () => {
        this.editingAuthToken = false;
        this.authTokenDraft = this.plugin.settings.authToken;
        this.display();
      },
      onStartAuthEdit: () => {
        this.editingAuthToken = true;
        this.authTokenDraft = "";
        this.display();
      },
      onSignOut: async () => {
        this.editingAuthToken = false;
        this.authTokenDraft = "";
        this.plugin.settings.authToken = "";
        this.remoteVaults = null;
        this.remoteVaultsError = null;
        this.vaultStatusText = "Not loaded";
        if (
          this.plugin.state.lastSyncError?.code === "unauthorized"
          || this.plugin.state.lastSyncError?.code === "invalid_settings"
        ) {
          this.plugin.state.lastSyncError = null;
        }
        await this.plugin.persistData();
        this.controller.restartAutoSync();
        this.connectionStatusText = "Not authorized";
        this.display();
      },
      onPollIntervalChange: async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (Number.isNaN(parsed) || parsed <= 0) {
          return;
        }
        this.plugin.settings.pollIntervalSecs = parsed;
        await this.plugin.persistData();
        this.controller.restartAutoSync();
        this.display();
      },
      onAutoSyncChange: async (value) => {
        this.plugin.settings.autoSync = value;
        await this.plugin.persistData();
        this.controller.restartAutoSync();
        this.display();
      },
      onSyncNow: async () => {
        this.quickActionsStatusText = "Running sync...";
        this.display();
        try {
          await this.controller.runManualSync();
          this.quickActionsStatusText = "Sync completed.";
        } catch (error) {
          this.quickActionsStatusText = formatDeviceError(error);
        }
        this.display();
      },
      onRefreshDevices: async () => {
        this.quickActionsStatusText = "Refreshing devices...";
        this.display();
        try {
          const devices = await this.controller.getRegisteredDevices();
          this.quickActionsStatusText = `${devices.length} device(s) loaded.`;
        } catch (error) {
          this.quickActionsStatusText = formatDeviceError(error);
        }
        this.display();
      },
      onDisconnectVault: async () => {
        const currentVaultId = this.plugin.settings.vaultId;
        if (!currentVaultId) {
          return;
        }

        const needsConfirm = this.controller.hasPendingSyncWork() || this.plugin.state.lastSyncError !== null;
        if (needsConfirm && this.confirmDisconnectVaultId !== currentVaultId) {
          this.confirmDisconnectVaultId = currentVaultId;
          this.vaultStatusText = `Click "Confirm disconnect" to leave ${currentVaultId}. Pending work or sync issues may still exist locally.`;
          this.display();
          return;
        }

        this.confirmDisconnectVaultId = null;
        this.confirmForgetVaultId = null;
        this.vaultStatusText = `Disconnecting ${currentVaultId}...`;
        await this.controller.disconnectVault();
        this.vaultStatusText = `This folder is no longer connected to ${currentVaultId}.`;
        this.display();
      },
      onForgetLocalState: async () => {
        const currentVaultId = this.plugin.settings.vaultId;
        if (!currentVaultId) {
          return;
        }

        if (this.confirmForgetVaultId !== currentVaultId) {
          this.confirmForgetVaultId = currentVaultId;
          this.confirmDisconnectVaultId = null;
          this.vaultStatusText = `Click "Confirm forget" to remove local state for ${currentVaultId}.`;
          this.display();
          return;
        }

        this.confirmForgetVaultId = null;
        this.vaultStatusText = `Removing local state for ${currentVaultId}...`;
        await this.controller.forgetLocalState();
        this.vaultStatusText = `Removed local state for ${currentVaultId}.`;
        this.display();
      },
      onLoadVaults: async () => {
        await this.reloadRemoteVaults();
      },
      onCreateCurrentVault: async () => {
        const currentVaultId = this.plugin.settings.vaultId;
        if (!currentVaultId) {
          return;
        }
        const createVault = await this.requestCreateVault(currentVaultId);
        if (!createVault) {
          return;
        }
        await this.createAndJoinVault(createVault.vaultId, createVault.passphrase);
      },
      onCreateVault: async () => {
        const createVault = await this.requestCreateVault("");
        if (!createVault) {
          return;
        }
        await this.createAndJoinVault(createVault.vaultId, createVault.passphrase);
      },
      onJoinVault: async (vaultId) => {
        if (!vaultId) {
          return;
        }
        this.confirmDisconnectVaultId = null;
        this.confirmForgetVaultId = null;
        this.vaultStatusText = this.plugin.settings.vaultId
          ? `Reconnecting this folder to ${vaultId}...`
          : `Joining ${vaultId}...`;
        await this.controller.bindVault(vaultId);
        this.display();
      },
      onIncludePatternsChange: async (value) => {
        this.controller.updateCurrentVaultScope({
          includePatterns: normalizePatternList(value),
          ignorePatterns: this.plugin.settings.ignorePatterns,
        });
        await this.plugin.persistData();
        this.display();
      },
      onIgnorePatternsChange: async (value) => {
        this.controller.updateCurrentVaultScope({
          includePatterns: this.plugin.settings.includePatterns,
          ignorePatterns: normalizePatternList(value),
        });
        await this.plugin.persistData();
        this.display();
      },
    };
  }

  private getTrackedFilesCount(): number {
    return Object.values(this.plugin.state.files).filter((file) => !file.deleted).length;
  }

  private getDeletedFilesCount(): number {
    return Object.values(this.plugin.state.files).filter((file) => file.deleted).length;
  }
}
