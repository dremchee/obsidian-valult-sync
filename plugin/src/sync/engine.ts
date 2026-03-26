import {
  Notice,
  type App,
} from "obsidian";

import { SyncApi } from "../api";
import { t } from "../i18n";
import { createSyncError, toSyncErrorState } from "./errors";
import { LocalMutationExecutor } from "./local-mutation-executor";
import {
  decodeSyncPayload,
  encodeSyncPayload,
} from "./payload-codec";
import { RemoteChangeApplier } from "./remote-applier";
import { withRetry } from "./retry";
import { shouldSyncPath } from "./scope";
import { SyncRuntime } from "./sync-runtime";
import { ObsidianVaultIO } from "./vault-io";
import type {
  LocalFileSnapshot,
  SyncSettings,
  SyncState,
} from "../types";

export class SyncEngine {
  private running = false;
  private startupDeletionGuardActive = true;
  private readonly maxNetworkAttempts = 4;
  private readonly retryBaseDelayMs = 500;
  private readonly vaultIO: ObsidianVaultIO;
  private readonly localExecutor: LocalMutationExecutor;
  private readonly remoteApplier: RemoteChangeApplier;
  private readonly runtime: SyncRuntime;

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
    this.localExecutor = new LocalMutationExecutor({
      buildUploadPayload: (local) => this.buildUploadPayload(local),
      onDeleteConflict: (api, state, path) => this.remoteApplier.syncRemotePath(
        api,
        state,
        this.getSettings().vaultId,
        path,
      ),
      onUploadConflict: (api, state, localFile) => this.remoteApplier.resolveConflict(
        api,
        state,
        this.getSettings().vaultId,
        localFile,
      ),
      retry: <T>(operation: () => Promise<T>, label: string) => this.retry(operation, label),
    });
    this.remoteApplier = new RemoteChangeApplier({
      vaultIO: this.vaultIO,
      decodeRemoteContent: (payloadBase64, contentFormat) => this.decodeRemoteContent(payloadBase64, contentFormat),
      notifyConflictCopy: (path, sourceDeviceId) => this.notifyConflictCopy(path, sourceDeviceId),
      retry: <T>(operation: () => Promise<T>, label: string) => this.retry(operation, label),
    });
    this.runtime = new SyncRuntime({
      executeHealthCheck: (api) => this.retry(() => api.health(), "health check"),
      localExecutor: this.localExecutor,
      remoteApplier: this.remoteApplier,
      saveState: this.saveState,
      scanVault: () => this.scanVault(),
      shouldSyncPath: (path) => this.shouldSyncPath(path),
    });
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

      const result = await this.runtime.run({
        api,
        settings,
        state,
        startupDeletionGuardActive: this.startupDeletionGuardActive,
      });
      this.startupDeletionGuardActive = result.startupDeletionGuardActive;
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
