import { SyncApi } from "../api";
import { buildPassphraseFingerprint } from "../e2ee/crypto";
import { E2eeState } from "../e2ee/state";
import { t } from "../i18n";
import { PluginStateStore } from "../state/store";
import { decodeSyncPayload } from "../sync/payload-codec";
import { SyncCoordinator } from "../sync/coordinator";
import { createSyncError } from "../sync/errors";
import type {
  CreateVaultResponse,
  DeviceItem,
  FileHistoryResponse,
  FileResponse,
  LocalFileSnapshot,
  MutationResponse,
  RestoreFileRequest,
  SyncSettings,
  SyncState,
  VaultItem,
  VaultSnapshotResponse,
  VaultScopeConfig,
} from "../types";

type SettingsApi = Pick<
  SyncApi,
  | "health"
  | "upload"
  | "delete"
  | "getFile"
  | "getChanges"
  | "getHistory"
  | "getDevices"
  | "getVaults"
  | "getSnapshot"
  | "createVault"
  | "restoreFile"
>;

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
      this.e2eeState.forgetVault(previousVaultId);
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
    return t("settings.connection.serverUrl.statusReady");
  }

  async getRemoteVaults(): Promise<VaultItem[]> {
    const response = await this.api().getVaults();
    return response.vaults;
  }

  getVaultSnapshot(vaultId: string): Promise<VaultSnapshotResponse> {
    return this.api().getSnapshot(vaultId);
  }

  async bootstrapJoinedVaultState(
    vaultId: string,
    localFiles: Array<Pick<LocalFileSnapshot, "path" | "hash" | "mtime">>,
  ): Promise<void> {
    const normalizedVaultId = vaultId.trim();
    if (!normalizedVaultId) {
      return;
    }

    const snapshot = await this.getVaultSnapshot(normalizedVaultId);
    const nextState = this.stateStore.resetState(normalizedVaultId);
    const remoteFilesByPath = new Map(snapshot.files.map((file) => [file.path, file]));

    for (const localFile of localFiles) {
      const remoteFile = remoteFilesByPath.get(localFile.path);
      if (!remoteFile || remoteFile.deleted || remoteFile.hash !== localFile.hash) {
        continue;
      }

      nextState.files[localFile.path] = {
        hash: localFile.hash,
        version: remoteFile.version,
        mtime: localFile.mtime,
        deleted: false,
      };
    }

    this.setState(nextState);
    await this.persistData();
  }

  getFileHistory(path: string, vaultId = this.getSettings().vaultId): Promise<FileHistoryResponse> {
    return this.api().getHistory(vaultId, path);
  }

  restoreFile(payload: RestoreFileRequest): Promise<MutationResponse> {
    return this.api().restoreFile(payload);
  }

  async createVault(vaultId: string, passphrase: string): Promise<CreateVaultResponse> {
    const normalizedVaultId = vaultId.trim();
    const normalizedPassphrase = passphrase.trim();
    const e2eeFingerprint = normalizedPassphrase
      ? await buildPassphraseFingerprint(normalizedVaultId, normalizedPassphrase)
      : null;
    const response = await this.api().createVault(normalizedVaultId, e2eeFingerprint);
    return response;
  }

  async hasRemoteVaultContent(vaultId: string): Promise<boolean> {
    const sampleFile = await this.getLatestLiveRemoteFile(vaultId.trim());
    return sampleFile !== null;
  }

  async validateVaultJoinPassphrase(vaultId: string, passphrase: string): Promise<void> {
    const normalizedVaultId = vaultId.trim();
    const normalizedPassphrase = passphrase.trim();
    if (!normalizedVaultId) {
      return;
    }

    const sampleFile = await this.getLatestEncryptedRemoteFile(normalizedVaultId);
    if (!sampleFile) {
      return;
    }

    if (!normalizedPassphrase) {
      throw createSyncError("missing_passphrase", t("settings.e2ee.validation.passphraseRequired"));
    }

    await decodeSyncPayload(
      sampleFile.content_b64 ?? "",
      sampleFile.content_format,
      normalizedPassphrase,
      async () => {},
    );
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

  private async getLatestLiveRemoteFile(vaultId: string): Promise<FileResponse | null> {
    const changes = await this.api().getChanges(vaultId, 0);
    const deletedPaths = new Set<string>();

    for (const change of [...changes.changes].reverse()) {
      if (change.deleted) {
        deletedPaths.add(change.path);
        continue;
      }

      if (deletedPaths.has(change.path)) {
        continue;
      }

      const file = await this.api().getFile(vaultId, change.path);
      if (!file.deleted && file.content_b64) {
        return file;
      }
    }

    return null;
  }

  private async getLatestEncryptedRemoteFile(vaultId: string): Promise<FileResponse | null> {
    const changes = await this.api().getChanges(vaultId, 0);
    const deletedPaths = new Set<string>();

    for (const change of [...changes.changes].reverse()) {
      if (change.deleted) {
        deletedPaths.add(change.path);
        continue;
      }

      if (deletedPaths.has(change.path)) {
        continue;
      }

      const file = await this.api().getFile(vaultId, change.path);
      if (!file.deleted && file.content_b64 && file.content_format === "e2ee-envelope-v1") {
        return file;
      }
    }

    return null;
  }
}
