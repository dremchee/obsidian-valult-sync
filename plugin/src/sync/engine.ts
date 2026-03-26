import {
  Notice,
  TFile,
  type App,
} from "obsidian";

import { SyncApi } from "../api";
import { t } from "../i18n";
import { createSyncError, toSyncErrorState } from "./errors";
import {
  applyDeletedFile,
  applyRemoteFile,
  applyUploadedFile,
  buildConflictPath,
  createDeleteRequest,
  createUploadRequest,
  decideRemoteChange,
  shouldCreateConflictCopy,
  shouldUploadLocalChange,
  shouldUploadLocalDeletion,
} from "./flow";
import {
  decodeSyncPayload,
  encodeSyncPayload,
  sha256Hex,
} from "./payload-codec";
import { withRetry } from "./retry";
import { shouldSyncPath } from "./scope";
import { ObsidianVaultIO } from "./vault-io";
import type {
  LocalFileSnapshot,
  SyncSettings,
  SyncState,
} from "../types";

export class SyncEngine {
  private running = false;
  private readonly maxNetworkAttempts = 4;
  private readonly retryBaseDelayMs = 500;
  private readonly vaultIO: ObsidianVaultIO;

  constructor(
    app: App,
    private readonly getSettings: () => SyncSettings,
    private readonly getE2eePassphrase: () => string,
    private readonly rememberValidatedE2eePassphrase: () => Promise<void>,
    private readonly getState: () => SyncState,
    private readonly saveState: (state: SyncState) => Promise<void>,
    private readonly apiFactory: (serverUrl: string, authToken: string) => SyncApi = (
      serverUrl,
      authToken,
    ) => new SyncApi(serverUrl, authToken),
    private readonly sleepFn: (ms: number) => Promise<void> = sleep,
  ) {
    this.vaultIO = new ObsidianVaultIO(app);
  }

  async syncOnce(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const settings = this.getSettings();
      this.validateSettings(settings);
      const state = structuredClone(this.getState());
      const api = this.apiFactory(
        settings.serverUrl.replace(/\/+$/, ""),
        settings.authToken,
      );
      state.vaultId = settings.vaultId;

      await this.retry(() => api.health(), "health check");
      await this.runLocalSyncStage(api, state);
      await this.runRemoteSyncStage(api, state);
      state.lastSyncAt = Date.now();

      await this.saveState(state);
    } catch (error) {
      console.error("obsidian-sync: sync failed", error);
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async scanVault(): Promise<Map<string, LocalFileSnapshot>> {
    return this.vaultIO.scanVaultFiles((path) => this.shouldSyncPath(path));
  }

  private validateSettings(settings: SyncSettings): void {
    if (!settings.serverUrl.trim()) {
      throw createSyncError("invalid_settings", t("sync.errors.invalidSettingsServerUrl"));
    }

    if (!settings.authToken.trim()) {
      throw createSyncError("invalid_settings", t("sync.errors.invalidSettingsAuthToken"));
    }

    if (!settings.vaultId.trim()) {
      throw createSyncError("invalid_settings", t("sync.errors.invalidSettingsVaultId"));
    }

    if (!settings.deviceId.trim()) {
      throw createSyncError("invalid_settings", t("sync.errors.invalidSettingsDeviceId"));
    }
  }

  private async runLocalSyncStage(api: SyncApi, state: SyncState): Promise<void> {
    const localFiles = await this.scanVault();
    await this.uploadLocalChanges(api, state, localFiles);
    await this.uploadLocalDeletions(api, state, localFiles);
  }

  private async runRemoteSyncStage(api: SyncApi, state: SyncState): Promise<void> {
    await this.downloadRemoteChanges(api, state);
  }

  private async uploadLocalChanges(
    api: SyncApi,
    state: SyncState,
    localFiles: Map<string, LocalFileSnapshot>,
  ): Promise<void> {
    for (const local of localFiles.values()) {
      const current = state.files[local.path];
      if (!shouldUploadLocalChange(current, local)) {
        continue;
      }

      const response = await this.retry(
        async () => {
          const payload = await this.buildUploadPayload(local);
          return api.upload(createUploadRequest(this.getSettings(), local, current, payload));
        },
        `upload ${local.path}`,
      );

      if (response.ok && response.version) {
        applyUploadedFile(state, local, response.version);
        continue;
      }

      if (response.conflict) {
        await this.resolveConflict(api, state, local);
      }
    }
  }

  private async uploadLocalDeletions(
    api: SyncApi,
    state: SyncState,
    localFiles: Map<string, LocalFileSnapshot>,
  ): Promise<void> {
    for (const [path, fileState] of Object.entries(state.files)) {
      if (!shouldUploadLocalDeletion(path, fileState, localFiles, (candidatePath) => this.shouldSyncPath(candidatePath))) {
        continue;
      }

      const response = await this.retry(
        () => api.delete(createDeleteRequest(this.getSettings(), path, fileState)),
        `delete ${path}`,
      );

      if (response.ok && response.version) {
        applyDeletedFile(state, path, response.version);
        continue;
      }

      if (response.conflict) {
        await this.downloadAndApplyRemote(api, state, path);
      }
    }
  }

  private async downloadRemoteChanges(api: SyncApi, state: SyncState): Promise<void> {
    const response = await this.retry(
      () => api.getChanges(state.vaultId, state.lastSeq),
      "fetch change feed",
    );
    const currentDeviceId = this.getSettings().deviceId;

    for (const change of response.changes) {
      const localState = state.files[change.path];
      const decision = decideRemoteChange(
        change,
        currentDeviceId,
        localState,
        (candidatePath) => this.shouldSyncPath(candidatePath),
      );

      if (
        decision === "skip-own-change"
        || decision === "skip-out-of-scope"
        || decision === "skip-current-state"
      ) {
        state.lastSeq = change.seq;
        continue;
      }

      if (decision === "apply-delete") {
        await this.applyRemoteDelete(state, change.path, change.version, change.device_id);
      } else {
        await this.downloadAndApplyRemote(api, state, change.path, change.device_id);
      }

      state.lastSeq = change.seq;
    }

    state.lastSeq = response.latest_seq;
  }

  private async resolveConflict(
    api: SyncApi,
    state: SyncState,
    local: LocalFileSnapshot,
  ): Promise<void> {
    const existing = this.vaultIO.getAbstractFileByPath(local.path);
    if (existing instanceof TFile) {
      await this.saveConflictCopyIfNeeded(existing, local.data, false);
    }

    await this.downloadAndApplyRemote(api, state, local.path, undefined, true);
  }

  private async downloadAndApplyRemote(
    api: SyncApi,
    state: SyncState,
    path: string,
    sourceDeviceId?: string,
    conflictCopyAlreadySaved = false,
  ): Promise<void> {
    const remote = await this.retry(
      () => api.getFile(this.getSettings().vaultId, path),
        `download ${path}`,
    );

    if (remote.deleted) {
      await this.applyRemoteDelete(
        state,
        remote.path,
        remote.version,
        sourceDeviceId,
        conflictCopyAlreadySaved,
      );
      return;
    }

    const data = await this.decodeRemoteContent(
      remote.content_b64 ?? "",
      remote.content_format,
    );
    const existing = this.vaultIO.getAbstractFileByPath(remote.path);
    const localState = state.files[remote.path];

    if (existing instanceof TFile) {
      const currentData = await this.vaultIO.readBinary(existing);
      const currentHash = await sha256Hex(currentData);
      if (shouldCreateConflictCopy(conflictCopyAlreadySaved, localState, currentHash)) {
        await this.saveConflictCopyIfNeeded(existing, currentData, true, sourceDeviceId);
      }
      await this.vaultIO.writeBinary(existing, data);
    } else {
      await this.vaultIO.ensureParentFolder(remote.path);
      await this.vaultIO.createBinary(remote.path, data);
    }

    applyRemoteFile(
      state,
      remote.path,
      remote.hash,
      remote.version,
      await this.vaultIO.getMtime(remote.path),
    );
  }

  private async applyRemoteDelete(
    state: SyncState,
    path: string,
    version: number,
    sourceDeviceId?: string,
    conflictCopyAlreadySaved = false,
  ): Promise<void> {
    const existing = this.vaultIO.getAbstractFileByPath(path);
    const localState = state.files[path];

    if (existing instanceof TFile) {
      const currentData = await this.vaultIO.readBinary(existing);
      const currentHash = await sha256Hex(currentData);
      if (shouldCreateConflictCopy(conflictCopyAlreadySaved, localState, currentHash)) {
        await this.saveConflictCopyIfNeeded(existing, currentData, true, sourceDeviceId);
      }
      await this.vaultIO.trashFile(existing);
    }

    applyDeletedFile(state, path, version);
  }

  private async writeConflictCopy(file: TFile, data: Uint8Array): Promise<void> {
    const conflictPath = buildConflictPath(file.path);
    await this.vaultIO.ensureParentFolder(conflictPath);
    await this.vaultIO.createBinary(conflictPath, data);
  }

  private async saveConflictCopyIfNeeded(
    file: TFile,
    data: Uint8Array,
    notify: boolean,
    sourceDeviceId?: string,
  ): Promise<void> {
    const conflictPath = buildConflictPath(file.path);
    if (this.vaultIO.getAbstractFileByPath(conflictPath)) {
      return;
    }

    await this.writeConflictCopy(file, data);
    if (notify) {
      this.notifyConflictCopy(file.path, sourceDeviceId);
    }
  }

  private notifyConflictCopy(path: string, sourceDeviceId?: string): void {
    const sourceSuffix = sourceDeviceId ? ` from ${sourceDeviceId}` : "";
    new Notice(t("notices.conflictCopySaved", {
      path,
      sourceSuffix,
    }));
  }

  private async buildUploadPayload(local: LocalFileSnapshot): Promise<{
    contentBase64: string;
    payloadHash: string;
    contentFormat: "plain" | "e2ee-envelope-v1";
  }> {
    return encodeSyncPayload(
      local.data,
      local.hash,
      this.getE2eePassphrase(),
      async () => this.rememberValidatedE2eePassphrase(),
    );
  }

  private async decodeRemoteContent(
    payloadBase64: string,
    contentFormat: "plain" | "e2ee-envelope-v1",
  ): Promise<Uint8Array> {
    return decodeSyncPayload(
      payloadBase64,
      contentFormat,
      this.getE2eePassphrase(),
      async () => this.rememberValidatedE2eePassphrase(),
    );
  }

  private shouldSyncPath(path: string): boolean {
    if (isGeneratedConflictPath(path)) {
      return false;
    }

    const settings = this.getSettings();
    return shouldSyncPath(path, settings.includePatterns, settings.ignorePatterns);
  }

  private async retry<T>(operation: () => Promise<T>, label: string): Promise<T> {
    return withRetry(operation, label, {
      maxAttempts: this.maxNetworkAttempts,
      baseDelayMs: this.retryBaseDelayMs,
      sleep: this.sleepFn,
      onRetry: (retryLabel, delayMs, error) => {
        console.warn(`obsidian-sync: retrying ${retryLabel} in ${delayMs}ms`, error);
      },
    });
  }
}

function formatError(error: unknown): string {
  return toSyncErrorState(error).message;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function isGeneratedConflictPath(path: string): boolean {
  return / \(conflict\)(\.[^/]+)?$/.test(path);
}
