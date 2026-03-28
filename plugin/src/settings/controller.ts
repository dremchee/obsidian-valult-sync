import { SyncApi } from "../api";
import { t } from "../i18n";
import { PluginStateStore } from "../state/store";
import { SyncCoordinator } from "../sync/coordinator";
import { createSyncError } from "../sync/errors";
import type {
  CreateVaultResponse,
  DocumentHistoryResponse,
  DeviceItem,
  LocalFileSnapshot,
  MutationResponse,
  RestoreDocumentRequest,
  SyncSettings,
  SyncState,
  VaultItem,
  VaultScopeConfig,
} from "../types";

type SettingsApi = Pick<
  SyncApi,
  | "health"
  | "getDevices"
  | "getVaults"
  | "createVault"
  | "pushDocument"
  | "getDocumentSnapshot"
  | "getDocumentChanges"
  | "getDocumentHistory"
  | "restoreDocument"
>;

export class SettingsController {
  constructor(
    private readonly getSettings: () => SyncSettings,
    private readonly setSettings: (settings: SyncSettings) => void,
    private readonly getState: () => SyncState,
    private readonly setState: (state: SyncState) => void,
    private readonly persistData: () => Promise<void>,
    private readonly stateStore: PluginStateStore,
    private readonly coordinator: SyncCoordinator,
    private readonly apiFactory: (serverUrl: string, authToken: string) => SettingsApi = (
      serverUrl,
      authToken,
    ) => new SyncApi(serverUrl, authToken),
  ) {}

  async bindVault(
    vaultId: string,
    options?: {
      startAutoSync?: boolean;
      markDirty?: boolean;
    },
  ): Promise<void> {
    const nextVaultId = vaultId.trim();
    if (!nextVaultId) {
      return;
    }
    const startAutoSync = options?.startAutoSync ?? true;
    const markDirty = options?.markDirty ?? true;

    const settings = this.getSettings();
    const previousVaultId = settings.vaultId;
    if (previousVaultId && previousVaultId !== nextVaultId) {
      this.stateStore.resetScope(settings);
    }

    settings.vaultId = nextVaultId;
    this.setState(this.stateStore.resetState(nextVaultId));
    this.stateStore.applyScope(settings);
    if (markDirty) {
      this.coordinator.markDirty();
    }
    await this.persistData();
    if (startAutoSync) {
      this.coordinator.restartAutoSync();
    } else {
      this.coordinator.pauseAutoSync();
    }
  }

  async forgetLocalState(): Promise<void> {
    const settings = this.getSettings();
    this.stateStore.resetScope(settings);
    this.setState(this.stateStore.resetState(settings.vaultId));
    this.coordinator.markDirty();
    await this.persistData();
    this.coordinator.restartAutoSync();
  }

  async disconnectVault(): Promise<void> {
    const settings = this.getSettings();
    settings.vaultId = "";
    this.stateStore.resetScope(settings);
    this.setState(this.stateStore.resetState(""));
    this.coordinator.markDirty();
    await this.persistData();
    this.coordinator.restartAutoSync();
  }

  updateCurrentVaultScope(scope: VaultScopeConfig): void {
    this.stateStore.updateCurrentScope(this.getSettings(), scope);
  }

  async getRegisteredDevices(vaultId = this.getSettings().vaultId): Promise<DeviceItem[]> {
    const response = await this.api().getDevices(vaultId);
    return response.devices;
  }

  async checkConnection(): Promise<string> {
    await this.baseApi().health();
    return t("settings.connection.serverUrl.statusReady");
  }

  async getRemoteVaults(): Promise<VaultItem[]> {
    const response = await this.api().getVaults();
    return response.vaults;
  }

  getDocumentSnapshot(vaultId: string, path: string) {
    return this.api().getDocumentSnapshot(vaultId, path);
  }

  async bootstrapJoinedVaultState(
    vaultId: string,
    localFiles: Array<Pick<LocalFileSnapshot, "path" | "hash" | "mtime">>,
  ): Promise<void> {
    const normalizedVaultId = vaultId.trim();
    if (!normalizedVaultId) {
      return;
    }
    const nextState = this.stateStore.resetState(normalizedVaultId);

    this.setState(nextState);
    await this.persistData();
  }

  getFileHistory(path: string, vaultId = this.getSettings().vaultId): Promise<DocumentHistoryResponse> {
    return this.api().getDocumentHistory(vaultId, path);
  }

  restoreDocument(request: RestoreDocumentRequest): Promise<MutationResponse> {
    return this.api().restoreDocument(request);
  }

  async createVault(vaultId: string, _passphrase: string): Promise<CreateVaultResponse> {
    const normalizedVaultId = vaultId.trim();
    const response = await this.api().createVault(normalizedVaultId);
    return response;
  }

  async hasRemoteVaultContent(vaultId: string): Promise<boolean> {
    const sampleFile = await this.getLatestLiveRemoteFile(vaultId.trim());
    return sampleFile !== null;
  }

  runManualSync(): Promise<void> {
    return this.coordinator.runManualSync();
  }

  hasPendingSyncWork(): boolean {
    return this.coordinator.hasPendingWork();
  }

  restartAutoSync(): void {
    this.coordinator.restartAutoSync();
  }

  private api(): SettingsApi {
    const settings = this.getSettings();
    if (!settings.authToken.trim()) {
      throw createSyncError(
        "invalid_settings",
        t("sync.errors.invalidSettingsAuthToken"),
      );
    }
    return this.apiFactory(settings.serverUrl.replace(/\/+$/, ""), settings.authToken);
  }

  private baseApi(): SettingsApi {
    return this.apiFactory(this.getSettings().serverUrl.replace(/\/+$/, ""), "");
  }
  private async getLatestLiveRemoteFile(vaultId: string) {
    const changes = await this.api().getDocumentChanges(vaultId, 0);
    const deletedPaths = new Set<string>();

    for (const change of [...changes.changes].reverse()) {
      if (change.deleted) {
        deletedPaths.add(change.path);
        continue;
      }

      if (deletedPaths.has(change.path)) {
        continue;
      }

      const file = await this.api().getDocumentSnapshot(vaultId, change.path);
      if (!file.deleted && file.content_b64) {
        return file;
      }
    }

    return null;
  }
}
