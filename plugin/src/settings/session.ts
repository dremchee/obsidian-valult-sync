import { type App } from "obsidian";
import { computed, reactive } from "vue";

import { t } from "../i18n";
import { normalizePatternList } from "../sync/scope";
import { formatSyncErrorState } from "../sync/errors";
import type {
  CreateVaultResponse,
  DeviceItem,
  SyncSettings,
  SyncState,
  VaultItem,
  VaultScopeConfig,
} from "../types";
import { CreateVaultModal, type CreateVaultModalResult } from "../ui/create-vault-modal";
import { formatDeviceError } from "./ui";
import type { SettingsActions, SettingsViewModel } from "./view-model";

interface SettingsSessionState {
  authTokenDraft: string | null;
  editingAuthToken: boolean;
  remoteVaults: VaultItem[] | null;
  loadingRemoteVaults: boolean;
  remoteVaultsError: string | null;
  confirmForgetVaultId: string | null;
  confirmDisconnectVaultId: string | null;
  connectionStatusText: string;
  quickActionsStatusText: string;
  vaultStatusText: string;
}

export interface SettingsSessionHost {
  settings: SyncSettings;
  state: SyncState;
  persistData(): Promise<void>;
}

export interface SettingsSessionController {
  setE2eePassphrase(passphrase: string, vaultId?: string): void;
  createVault(vaultId: string): Promise<CreateVaultResponse>;
  bindVault(vaultId: string): Promise<void>;
  rememberCurrentE2eePassphrase(): Promise<void>;
  getRemoteVaults(): Promise<VaultItem[]>;
  checkConnection(): Promise<string>;
  restartAutoSync(): void;
  runManualSync(): Promise<void>;
  getRegisteredDevices(vaultId?: string): Promise<DeviceItem[]>;
  hasPendingSyncWork(): boolean;
  disconnectVault(): Promise<void>;
  forgetLocalState(): Promise<void>;
  updateCurrentVaultScope(scope: VaultScopeConfig): void;
  getE2eeFingerprint(vaultId?: string): string | null;
  getE2eePassphrase(vaultId?: string): string;
}

export class SettingsSession {
  readonly model = reactive({} as SettingsViewModel);
  readonly actions: SettingsActions;

  private readonly state = reactive<SettingsSessionState>({
    authTokenDraft: null,
    editingAuthToken: false,
    remoteVaults: null,
    loadingRemoteVaults: false,
    remoteVaultsError: null,
    confirmForgetVaultId: null,
    confirmDisconnectVaultId: null,
    connectionStatusText: t("settings.connection.serverUrl.statusNotChecked"),
    quickActionsStatusText: t("settings.overview.quickActionsReady"),
    vaultStatusText: t("settings.vault.state.statusNotLoaded"),
  });

  private readonly unlocked = computed(() => {
    if (!this.host.settings.authToken.trim()) {
      return false;
    }

    if (this.state.remoteVaultsError === t("settings.helpers.authFailed")) {
      return false;
    }

    return this.host.state.lastSyncError?.code !== "unauthorized";
  });

  private readonly authGateMessage = computed(() => {
    if (!this.host.settings.authToken.trim()) {
      return t("settings.connection.authToken.gateMissingToken");
    }

    if (
      this.state.remoteVaultsError === t("settings.helpers.authFailed")
      || this.host.state.lastSyncError?.code === "unauthorized"
    ) {
      return t("settings.connection.authToken.gateUnauthorized");
    }

    return t("settings.connection.authToken.gateLocked");
  });

  private readonly trackedFilesCount = computed(() =>
    Object.values(this.host.state.files).filter((file) => !file.deleted).length,
  );

  private readonly deletedFilesCount = computed(() =>
    Object.values(this.host.state.files).filter((file) => file.deleted).length,
  );

  constructor(
    private readonly app: App,
    private readonly host: SettingsSessionHost,
    private readonly controller: SettingsSessionController,
  ) {
    this.actions = this.createActions();
    this.sync();
  }

  sync(): void {
    this.ensureDrafts();
    this.maybeLoadRemoteVaults();
    Object.assign(this.model, this.buildViewModel());
  }

  private maybeLoadRemoteVaults(): void {
    if (
      this.state.remoteVaults
      || this.state.loadingRemoteVaults
      || !this.host.settings.serverUrl.trim()
      || !this.host.settings.authToken.trim()
      || this.state.remoteVaultsError === t("settings.helpers.authFailed")
      || this.host.state.lastSyncError?.code === "unauthorized"
    ) {
      return;
    }

    this.state.loadingRemoteVaults = true;
    this.state.vaultStatusText = t("settings.vault.state.statusLoading");
    void this.controller
      .getRemoteVaults()
      .then((vaults) => {
        this.state.remoteVaults = vaults;
        this.state.remoteVaultsError = null;
        this.state.vaultStatusText = t("settings.vault.serverVaults.countLoaded", {
          count: vaults.length,
        });
      })
      .catch((error) => {
        this.state.remoteVaults = null;
        this.state.remoteVaultsError = formatDeviceError(error);
        this.state.vaultStatusText = this.state.remoteVaultsError;
      })
      .finally(() => {
        this.state.loadingRemoteVaults = false;
        this.sync();
      });
  }

  private ensureDrafts(): void {
    if (this.state.authTokenDraft === null) {
      this.state.authTokenDraft = this.host.settings.authToken;
    }
  }

  private buildViewModel(): SettingsViewModel {
    return {
      connection: {
        unlocked: this.unlocked.value,
        authGateMessage: this.authGateMessage.value,
        serverUrl: this.host.settings.serverUrl,
        authTokenDraft: this.state.editingAuthToken ? "" : (this.state.authTokenDraft ?? ""),
        editingAuthToken: this.state.editingAuthToken,
        connectionStatusText: this.state.connectionStatusText,
        deviceId: this.host.settings.deviceId,
        pollIntervalSecs: this.host.settings.pollIntervalSecs,
        autoSync: this.host.settings.autoSync,
      },
      overview: {
        currentVaultId: this.host.settings.vaultId,
        trackedFilesCount: this.trackedFilesCount.value,
        deletedFilesCount: this.deletedFilesCount.value,
        lastSyncAt: this.host.state.lastSyncAt,
        lastSyncErrorText: formatSyncErrorState(this.host.state.lastSyncError),
        e2eeFingerprint: this.controller.getE2eeFingerprint(),
        e2eePassphrase: this.controller.getE2eePassphrase(),
        quickActionsStatusText: this.state.quickActionsStatusText,
        serverUrl: this.host.settings.serverUrl,
      },
      vault: {
        currentVaultId: this.host.settings.vaultId,
        remoteVaults: this.state.remoteVaults,
        loadingRemoteVaults: this.state.loadingRemoteVaults,
        remoteVaultsError: this.state.remoteVaultsError,
        vaultStatusText: this.state.vaultStatusText,
        confirmDisconnect: this.state.confirmDisconnectVaultId === this.host.settings.vaultId,
        confirmForget: this.state.confirmForgetVaultId === this.host.settings.vaultId,
      },
      scope: {
        includePatterns: this.host.settings.includePatterns,
        ignorePatterns: this.host.settings.ignorePatterns,
      },
    };
  }

  private requestCreateVault(initialVaultId: string): Promise<CreateVaultModalResult | null> {
    return new Promise((resolve) => {
      new CreateVaultModal(this.app, initialVaultId, resolve).open();
    });
  }

  private async createAndJoinVault(vaultId: string, passphrase: string): Promise<void> {
    this.state.confirmDisconnectVaultId = null;
    this.state.confirmForgetVaultId = null;
    this.state.vaultStatusText = t("settings.vault.createVault.statusCreating", {
      vaultId,
    });
    try {
      this.controller.setE2eePassphrase(passphrase, vaultId);
      const response = await this.controller.createVault(vaultId);
      await this.controller.bindVault(response.vault.vault_id);
      await this.controller.rememberCurrentE2eePassphrase();
      this.state.remoteVaults = await this.controller.getRemoteVaults();
      this.state.remoteVaultsError = null;
      this.state.vaultStatusText =
        response.created
          ? t("settings.vault.createVault.statusCreatedJoined", {
              vaultId: response.vault.vault_id,
            })
          : t("settings.vault.createVault.statusJoinedExisting", {
              vaultId: response.vault.vault_id,
            });
    } catch (error) {
      this.controller.setE2eePassphrase("", vaultId);
      this.state.remoteVaults = null;
      this.state.remoteVaultsError = formatDeviceError(error);
      this.state.vaultStatusText = this.state.remoteVaultsError;
    }
    this.sync();
  }

  private async authorizeToken(): Promise<void> {
    this.host.settings.authToken = (this.state.authTokenDraft ?? "").trim();
    this.state.remoteVaults = null;
    this.state.remoteVaultsError = null;
    if (
      this.host.state.lastSyncError?.code === "unauthorized"
      || this.host.state.lastSyncError?.code === "invalid_settings"
    ) {
      this.host.state.lastSyncError = null;
    }
    await this.host.persistData();
    this.controller.restartAutoSync();

    this.state.connectionStatusText = t("settings.connection.serverUrl.statusChecking");
    try {
      const message = await this.controller.checkConnection();
      this.state.editingAuthToken = false;
      this.state.authTokenDraft = this.host.settings.authToken;
      this.state.connectionStatusText = message;
    } catch (error) {
      this.state.connectionStatusText = formatDeviceError(error);
    }

    this.sync();
  }

  private async reloadRemoteVaults(): Promise<void> {
    this.state.vaultStatusText = t("settings.vault.state.statusLoading");
    try {
      this.state.remoteVaults = await this.controller.getRemoteVaults();
      this.state.remoteVaultsError = null;
      this.state.vaultStatusText = t("settings.vault.serverVaults.countLoaded", {
        count: this.state.remoteVaults.length,
      });
    } catch (error) {
      this.state.remoteVaults = null;
      this.state.remoteVaultsError = formatDeviceError(error);
      this.state.vaultStatusText = this.state.remoteVaultsError;
    }
    this.sync();
  }

  private createActions(): SettingsActions {
    return {
      onServerUrlChange: async (value) => {
        this.host.settings.serverUrl = value.trim();
        this.state.remoteVaults = null;
        this.state.remoteVaultsError = null;
        this.state.vaultStatusText = t("settings.vault.state.statusNotLoaded");
        this.state.connectionStatusText = t("settings.connection.serverUrl.statusNotChecked");
        if (this.host.state.lastSyncError?.code === "unauthorized") {
          this.host.state.lastSyncError = null;
        }
        await this.host.persistData();
        this.controller.restartAutoSync();
        this.sync();
      },
      onCheckConnection: async () => {
        this.state.connectionStatusText = t("settings.connection.serverUrl.statusChecking");
        this.sync();
        try {
          this.state.connectionStatusText = await this.controller.checkConnection();
        } catch (error) {
          this.state.connectionStatusText = formatDeviceError(error);
        }
        this.sync();
      },
      onAuthTokenDraftChange: (value) => {
        this.state.authTokenDraft = value.trim();
        this.sync();
      },
      onAuthorize: async () => {
        await this.authorizeToken();
      },
      onCancelAuthEdit: () => {
        this.state.editingAuthToken = false;
        this.state.authTokenDraft = this.host.settings.authToken;
        this.sync();
      },
      onStartAuthEdit: () => {
        this.state.editingAuthToken = true;
        this.state.authTokenDraft = "";
        this.sync();
      },
      onSignOut: async () => {
        this.state.editingAuthToken = false;
        this.state.authTokenDraft = "";
        this.host.settings.authToken = "";
        this.state.remoteVaults = null;
        this.state.remoteVaultsError = null;
        this.state.vaultStatusText = t("settings.vault.state.statusNotLoaded");
        if (
          this.host.state.lastSyncError?.code === "unauthorized"
          || this.host.state.lastSyncError?.code === "invalid_settings"
        ) {
          this.host.state.lastSyncError = null;
        }
        await this.host.persistData();
        this.controller.restartAutoSync();
        this.state.connectionStatusText = t("settings.connection.serverUrl.statusNotAuthorized");
        this.sync();
      },
      onPollIntervalChange: async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (Number.isNaN(parsed) || parsed <= 0) {
          return;
        }
        this.host.settings.pollIntervalSecs = parsed;
        await this.host.persistData();
        this.controller.restartAutoSync();
        this.sync();
      },
      onAutoSyncChange: async (value) => {
        this.host.settings.autoSync = value;
        await this.host.persistData();
        this.controller.restartAutoSync();
        this.sync();
      },
      onSyncNow: async () => {
        this.state.quickActionsStatusText = t("settings.overview.quickActionsRunningSync");
        this.sync();
        try {
          await this.controller.runManualSync();
          this.state.quickActionsStatusText = t("settings.overview.quickActionsSyncCompleted");
        } catch (error) {
          this.state.quickActionsStatusText = formatDeviceError(error);
        }
        this.sync();
      },
      onRefreshDevices: async () => {
        this.state.quickActionsStatusText = t("settings.overview.quickActionsRefreshingDevices");
        this.sync();
        try {
          const devices = await this.controller.getRegisteredDevices();
          this.state.quickActionsStatusText = t("settings.overview.quickActionsDevicesLoaded", {
            count: devices.length,
          });
        } catch (error) {
          this.state.quickActionsStatusText = formatDeviceError(error);
        }
        this.sync();
      },
      onDisconnectVault: async () => {
        const currentVaultId = this.host.settings.vaultId;
        if (!currentVaultId) {
          return;
        }

        const needsConfirm = this.controller.hasPendingSyncWork() || this.host.state.lastSyncError !== null;
        if (needsConfirm && this.state.confirmDisconnectVaultId !== currentVaultId) {
          this.state.confirmDisconnectVaultId = currentVaultId;
          this.state.vaultStatusText = t("settings.vault.state.disconnectPending", {
            vaultId: currentVaultId,
          });
          this.sync();
          return;
        }

        this.state.confirmDisconnectVaultId = null;
        this.state.confirmForgetVaultId = null;
        this.state.vaultStatusText = t("settings.vault.state.disconnecting", {
          vaultId: currentVaultId,
        });
        await this.controller.disconnectVault();
        this.state.vaultStatusText = t("settings.vault.state.disconnected", {
          vaultId: currentVaultId,
        });
        this.sync();
      },
      onForgetLocalState: async () => {
        const currentVaultId = this.host.settings.vaultId;
        if (!currentVaultId) {
          return;
        }

        if (this.state.confirmForgetVaultId !== currentVaultId) {
          this.state.confirmForgetVaultId = currentVaultId;
          this.state.confirmDisconnectVaultId = null;
          this.state.vaultStatusText = t("settings.vault.state.forgetPending", {
            vaultId: currentVaultId,
          });
          this.sync();
          return;
        }

        this.state.confirmForgetVaultId = null;
        this.state.vaultStatusText = t("settings.vault.state.removing", {
          vaultId: currentVaultId,
        });
        await this.controller.forgetLocalState();
        this.state.vaultStatusText = t("settings.vault.state.removed", {
          vaultId: currentVaultId,
        });
        this.sync();
      },
      onLoadVaults: async () => {
        await this.reloadRemoteVaults();
      },
      onCreateCurrentVault: async () => {
        const currentVaultId = this.host.settings.vaultId;
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
        this.state.confirmDisconnectVaultId = null;
        this.state.confirmForgetVaultId = null;
        this.state.vaultStatusText = this.host.settings.vaultId
          ? t("settings.vault.state.reconnecting", {
              vaultId,
            })
          : t("settings.vault.state.joining", {
              vaultId,
            });
        await this.controller.bindVault(vaultId);
        this.sync();
      },
      onIncludePatternsChange: async (value) => {
        this.controller.updateCurrentVaultScope({
          includePatterns: normalizePatternList(value),
          ignorePatterns: this.host.settings.ignorePatterns,
        });
        await this.host.persistData();
        this.sync();
      },
      onIgnorePatternsChange: async (value) => {
        this.controller.updateCurrentVaultScope({
          includePatterns: this.host.settings.includePatterns,
          ignorePatterns: normalizePatternList(value),
        });
        await this.host.persistData();
        this.sync();
      },
    };
  }
}
