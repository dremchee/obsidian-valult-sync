import { SyncApi } from "../api";
import { E2eeState } from "../e2ee/state";
import { PluginStateStore } from "../state/store";
import { SyncCoordinator } from "../sync/coordinator";
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

  getKnownVaultIds(): string[] {
    return [...this.getSettings().knownVaultIds];
  }

  async activateVault(vaultId: string): Promise<void> {
    const settings = this.getSettings();
    this.stateStore.saveCurrentVaultScope(settings);
    settings.vaultId = vaultId;
    settings.knownVaultIds = this.stateStore.getKnownVaultIds(settings.knownVaultIds, vaultId);
    this.stateStore.applyVaultScope(settings, vaultId);
    this.setState(this.stateStore.getStateForVaultId(vaultId));
    this.coordinator.markDirty();
    await this.persistData();
    this.coordinator.restartAutoSync();
  }

  async forgetVault(defaultVaultId: string, vaultId: string): Promise<void> {
    const settings = this.getSettings();
    const nextKnownVaultIds = settings.knownVaultIds.filter((current) => current !== vaultId);
    this.stateStore.forgetVault(vaultId);
    this.e2eeState.forgetVault(vaultId);

    if (settings.vaultId === vaultId) {
      const fallbackVaultId = nextKnownVaultIds[0] ?? defaultVaultId;
      settings.vaultId = fallbackVaultId;
      this.stateStore.applyVaultScope(settings, fallbackVaultId);
      this.setState(this.stateStore.getStateForVaultId(fallbackVaultId));
      this.coordinator.markDirty();
    }

    settings.knownVaultIds = this.stateStore.getKnownVaultIds(
      nextKnownVaultIds,
      settings.vaultId,
    );
    await this.persistData();
    this.coordinator.restartAutoSync();
  }

  async disconnectVault(defaultVaultId: string, vaultId: string): Promise<void> {
    const settings = this.getSettings();
    const nextKnownVaultIds = settings.knownVaultIds.filter((current) => current !== vaultId);

    if (settings.vaultId === vaultId) {
      const fallbackVaultId = nextKnownVaultIds[0] ?? defaultVaultId;
      settings.vaultId = fallbackVaultId;
      this.stateStore.applyVaultScope(settings, fallbackVaultId);
      this.setState(this.stateStore.getStateForVaultId(fallbackVaultId));
      this.coordinator.markDirty();
    }

    settings.knownVaultIds = this.stateStore.getKnownVaultIds(
      nextKnownVaultIds,
      settings.vaultId,
    );
    await this.persistData();
    this.coordinator.restartAutoSync();
  }

  updateCurrentVaultScope(scope: VaultScopeConfig): void {
    this.stateStore.updateCurrentVaultScope(this.getSettings(), scope);
  }

  async copyCurrentVaultScopeToVault(vaultId: string): Promise<void> {
    const settings = this.getSettings();
    if (!this.stateStore.copyCurrentVaultScopeToVault(settings, vaultId)) {
      return;
    }

    settings.knownVaultIds = this.stateStore.getKnownVaultIds(
      settings.knownVaultIds,
      vaultId.trim(),
    );
    await this.persistData();
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
    const settings = this.getSettings();
    const response = await this.api().getDevices(settings.vaultId);
    return `Connected to ${settings.vaultId}. ${response.devices.length} device(s) registered.`;
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
    const settings = this.getSettings();
    settings.knownVaultIds = this.stateStore.getKnownVaultIds(settings.knownVaultIds, response.vault.vault_id);
    await this.persistData();
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
    return new SyncApi(settings.serverUrl.replace(/\/+$/, ""), settings.authToken);
  }
}
