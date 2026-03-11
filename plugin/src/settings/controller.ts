import { SyncApi } from "../api";
import { E2eeState } from "../e2ee/state";
import { PluginStateStore } from "../state/store";
import { SyncCoordinator } from "../sync/coordinator";
import { createSyncError } from "../sync/errors";
import type {
  CreateVaultResponse,
  DeviceItem,
  FileHistoryResponse,
  MutationResponse,
  RestoreFileRequest,
  SyncSettings,
  SyncState,
  VaultItem,
  VaultScopeConfig,
} from "../types";

export class SettingsController {
  constructor(
    private readonly getSettings: () => SyncSettings,
    private readonly setSettings: (settings: SyncSettings) => void,
    private readonly getState: () => SyncState,
    private readonly setState: (state: SyncState) => void,
    private readonly persistData: () => Promise<void>,
    private readonly stateStore: PluginStateStore,
    private readonly e2eeState: E2eeState,
    private readonly coordinator: SyncCoordinator,
  ) {}

  async bindVault(vaultId: string): Promise<void> {
    const nextVaultId = vaultId.trim();
    if (!nextVaultId) {
      return;
    }

    const settings = this.getSettings();
    const previousVaultId = settings.vaultId;
    if (previousVaultId && previousVaultId !== nextVaultId) {
      this.e2eeState.forgetVault(previousVaultId);
      this.stateStore.resetScope(settings);
    }

    settings.vaultId = nextVaultId;
    this.setState(this.stateStore.resetState(nextVaultId));
    this.stateStore.applyScope(settings);
    this.coordinator.markDirty();
    await this.persistData();
    this.coordinator.restartAutoSync();
  }

  async forgetLocalState(): Promise<void> {
    const settings = this.getSettings();
    this.e2eeState.forgetVault(settings.vaultId);
    this.stateStore.resetScope(settings);
    this.setState(this.stateStore.resetState(settings.vaultId));
    this.coordinator.markDirty();
    await this.persistData();
    this.coordinator.restartAutoSync();
  }

  async disconnectVault(): Promise<void> {
    const settings = this.getSettings();
    if (settings.vaultId) {
      this.e2eeState.forgetVault(settings.vaultId);
    }
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

  getE2eePassphrase(vaultId = this.getSettings().vaultId): string {
    return this.e2eeState.getPassphrase(vaultId);
  }

  setE2eePassphrase(passphrase: string, vaultId = this.getSettings().vaultId): void {
    this.e2eeState.setPassphrase(vaultId, passphrase);
  }

  getE2eeFingerprint(vaultId = this.getSettings().vaultId): string | null {
    return this.e2eeState.getFingerprint(vaultId);
  }

  validateCurrentE2eePassphrase(): Promise<string> {
    return this.e2eeState.validatePassphrase(this.getSettings().vaultId);
  }

  async clearCurrentE2eeFingerprint(): Promise<void> {
    if (this.e2eeState.clearFingerprint(this.getSettings().vaultId)) {
      await this.persistData();
    }
  }

  rememberCurrentE2eePassphrase(): Promise<void> {
    return this.rememberCurrentE2eePassphraseInner();
  }

  async getRegisteredDevices(vaultId = this.getSettings().vaultId): Promise<DeviceItem[]> {
    const response = await this.api().getDevices(vaultId);
    return response.devices;
  }

  async checkConnection(): Promise<string> {
    await this.baseApi().health();
    return "Server is reachable.";
  }

  async getRemoteVaults(): Promise<VaultItem[]> {
    const response = await this.api().getVaults();
    return response.vaults;
  }

  getFileHistory(path: string, vaultId = this.getSettings().vaultId): Promise<FileHistoryResponse> {
    return this.api().getHistory(vaultId, path);
  }

  restoreFile(payload: RestoreFileRequest): Promise<MutationResponse> {
    return this.api().restoreFile(payload);
  }

  async createVault(vaultId: string): Promise<CreateVaultResponse> {
    const response = await this.api().createVault(vaultId);
    return response;
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

  private async rememberCurrentE2eePassphraseInner(): Promise<void> {
    if (await this.e2eeState.rememberPassphrase(this.getSettings().vaultId)) {
      await this.persistData();
    }
  }

  private api(): SyncApi {
    const settings = this.getSettings();
    if (!settings.authToken.trim()) {
      throw createSyncError("invalid_settings", "Auth token is required");
    }
    return new SyncApi(settings.serverUrl.replace(/\/+$/, ""), settings.authToken);
  }

  private baseApi(): SyncApi {
    return new SyncApi(this.getSettings().serverUrl.replace(/\/+$/, ""), "");
  }
}
