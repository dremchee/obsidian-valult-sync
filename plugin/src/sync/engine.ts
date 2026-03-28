import { Notice, TFile, type App } from "obsidian";

import { SyncApi } from "../api";
import { t } from "../i18n";
import { createSyncError } from "./errors";
import { decodeSyncPayload, encodeSyncPayload, sha256Hex, base64ToBytes, bytesToBase64 } from "./payload-codec";
import { shouldSyncPath } from "./scope";
import { ObsidianVaultIO } from "./vault-io";
import {
  createDocFromMarkdown,
  exportSnapshotB64,
  importSnapshotB64,
  readMarkdownFromDoc,
} from "./loro-markdown";
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

      const localFiles = await this.vaultIO.scanVaultFiles((path) => this.shouldSyncPath(path));
      await this.pushLocalDocuments(api, state, settings, localFiles);
      await this.pullRemoteDocuments(api, state, settings);

      state.lastSyncAt = Date.now();
      await this.saveState(state);
    } catch (error) {
      console.error("obsidian-sync: sync failed", error);
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async pushLocalDocuments(
    api: SyncApi,
    state: SyncState,
    settings: SyncSettings,
    localFiles: Map<string, LocalFileSnapshot>,
  ): Promise<void> {
    const localPaths = new Set(localFiles.keys());

    for (const localFile of localFiles.values()) {
      const remoteState = state.documents[localFile.path];
      const markdown = new TextDecoder().decode(localFile.data);
      const doc = createDocFromMarkdown(markdown, remoteState?.snapshotB64);
      const snapshotB64 = exportSnapshotB64(doc);
      const snapshotBytes = base64ToBytes(snapshotB64);
      const contentHash = await sha256Hex(snapshotBytes);

      if (remoteState?.snapshotB64 === snapshotB64 && !remoteState.deleted) {
        continue;
      }

      const payload = await encodeSyncPayload(
        snapshotBytes,
        contentHash,
        "",
        async () => {},
      );

      const response = await this.retry(
        () => api.pushDocument({
          vault_id: settings.vaultId,
          device_id: settings.deviceId,
          path: localFile.path,
          content_b64: payload.contentBase64,
          hash: payload.hash,
          deleted: false,
        }),
        `push document ${localFile.path}`,
      );

      if (response.ok && typeof response.version === "number") {
        state.documents[localFile.path] = {
          snapshotB64,
          contentHash,
          version: response.version,
          mtime: localFile.mtime,
          deleted: false,
        };
      }
    }

    for (const [path, documentState] of Object.entries(state.documents)) {
      if (localPaths.has(path) || documentState.deleted) {
        continue;
      }

      const tombstoneDoc = createDocFromMarkdown("", documentState.snapshotB64);
      const snapshotB64 = exportSnapshotB64(tombstoneDoc);
      const snapshotBytes = base64ToBytes(snapshotB64);
      const contentHash = await sha256Hex(snapshotBytes);

      const payload = await encodeSyncPayload(
        snapshotBytes,
        contentHash,
        "",
        async () => {},
      );

      const response = await this.retry(
        () => api.pushDocument({
          vault_id: settings.vaultId,
          device_id: settings.deviceId,
          path,
          content_b64: payload.contentBase64,
          hash: payload.hash,
          deleted: true,
        }),
        `delete document ${path}`,
      );

      if (response.ok && typeof response.version === "number") {
        state.documents[path] = {
          snapshotB64,
          contentHash,
          version: response.version,
          mtime: Date.now(),
          deleted: true,
        };
      }
    }
  }

  private async pullRemoteDocuments(
    api: SyncApi,
    state: SyncState,
    settings: SyncSettings,
  ): Promise<void> {
    const changes = await this.retry(
      () => api.getDocumentChanges(settings.vaultId, state.lastSeq),
      "fetch document changes",
    );

    for (const change of changes.changes) {
      if (change.device_id === settings.deviceId) {
        continue;
      }

      const remote = await this.retry(
        () => api.getDocumentSnapshot(settings.vaultId, change.path),
        `download document ${change.path}`,
      );

      if (remote.deleted) {
        await this.applyRemoteDelete(change.path, remote.version, state);
        continue;
      }

      const payloadBytes = await this.decodeRemotePayload(
        remote.content_b64,
        "plain",
      );
      const snapshotB64 = bytesToBase64(payloadBytes);
      const doc = importSnapshotB64(snapshotB64);
      const markdown = readMarkdownFromDoc(doc);
      const existing = this.readExistingFile(change.path);

      await this.writeMarkdown(change.path, markdown, existing);

      state.documents[change.path] = {
        snapshotB64,
        contentHash: remote.hash,
        version: remote.version,
        mtime: Date.now(),
        deleted: false,
      };
    }

    state.lastSeq = changes.latest_seq;
  }

  private async decodeRemotePayload(
    contentB64: string,
    contentFormat: string,
  ): Promise<Uint8Array> {
    return decodeSyncPayload(
      contentB64,
      contentFormat,
      "",
      async () => {},
    );
  }

  private async applyRemoteDelete(
    path: string,
    version: number,
    state: SyncState,
  ): Promise<void> {
    const existing = this.readExistingFile(path);
    if (existing) {
      await this.vaultIO.trashFile(existing);
    }

    state.documents[path] = {
      snapshotB64: "",
      contentHash: "",
      version,
      mtime: Date.now(),
      deleted: true,
    };
  }

  private async writeMarkdown(
    path: string,
    markdown: string,
    existing: TFile | null,
  ): Promise<void> {
    const bytes = new TextEncoder().encode(markdown);
    if (existing) {
      await this.vaultIO.writeBinary(existing, bytes);
      return;
    }

    await this.vaultIO.ensureParentFolder(path);
    await this.vaultIO.createBinary(path, bytes);
  }

  private readExistingFile(path: string) {
    const file = this.vaultIO.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  private shouldSyncPath(path: string): boolean {
    const settings = this.getSettings();
    return shouldSyncPath(path, settings.includePatterns, settings.ignorePatterns);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function withRetry<T>(
  operation: () => Promise<T>,
  label: string,
  options: {
    maxAttempts: number;
    baseDelayMs: number;
    sleep: (ms: number) => Promise<void>;
    onRetry?: (label: string, delayMs: number, error: unknown) => void;
  },
): Promise<T> {
  const attempt = async (index: number): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (index >= options.maxAttempts - 1) {
        throw error;
      }

      const delayMs = options.baseDelayMs * 2 ** index;
      options.onRetry?.(label, delayMs, error);
      await options.sleep(delayMs);
      return attempt(index + 1);
    }
  };

  return attempt(0);
}
