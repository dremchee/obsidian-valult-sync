import {
  Notice,
  TFile,
  normalizePath,
  type App,
} from "obsidian";

import { ApiError, SyncApi } from "./api";
import { decryptEnvelope, encryptBytes, parseEnvelope, serializeEnvelope } from "./e2ee";
import { shouldSyncPath } from "./sync-scope";
import type {
  FileState,
  LocalFileSnapshot,
  SyncSettings,
  SyncState,
} from "./types";

export class SyncEngine {
  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();
  private running = false;
  private readonly maxNetworkAttempts = 4;
  private readonly retryBaseDelayMs = 500;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SyncSettings,
    private readonly getState: () => SyncState,
    private readonly saveState: (state: SyncState) => Promise<void>,
    private readonly apiFactory: (serverUrl: string, authToken: string) => SyncApi = (
      serverUrl,
      authToken,
    ) => new SyncApi(serverUrl, authToken),
    private readonly sleepFn: (ms: number) => Promise<void> = sleep,
  ) {}

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

      await this.withRetry(() => api.health(), "health check");

      const localFiles = await this.scanVault();
      await this.uploadLocalChanges(api, state, localFiles);
      await this.uploadLocalDeletions(api, state, localFiles);
      await this.downloadRemoteChanges(api, state);
      state.lastSyncAt = Date.now();

      await this.saveState(state);
    } catch (error) {
      console.error("obsidian-sync: sync failed", error);
      new Notice(`Sync failed: ${formatError(error)}`, 6000);
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async scanVault(): Promise<Map<string, LocalFileSnapshot>> {
    const files = new Map<string, LocalFileSnapshot>();

    for (const file of this.app.vault.getFiles()) {
      if (!this.shouldSyncPath(file.path)) {
        continue;
      }

      const data = await this.readBinary(file);
      const stat = await this.app.vault.adapter.stat(file.path);
      const mtime = stat?.mtime ?? Date.now();

      files.set(file.path, {
        path: file.path,
        hash: await sha256Hex(data),
        mtime,
        data,
      });
    }

    return files;
  }

  private validateSettings(settings: SyncSettings): void {
    if (!settings.serverUrl.trim()) {
      throw new Error("Server URL is not configured");
    }

    if (!settings.vaultId.trim()) {
      throw new Error("Vault ID is not configured");
    }

    if (!settings.deviceId.trim()) {
      throw new Error("Device ID is not configured");
    }
  }

  private async uploadLocalChanges(
    api: SyncApi,
    state: SyncState,
    localFiles: Map<string, LocalFileSnapshot>,
  ): Promise<void> {
    for (const local of localFiles.values()) {
      const current = state.files[local.path];
      if (current && !current.deleted && current.hash === local.hash) {
        continue;
      }

      const response = await this.withRetry(
        async () => {
          const payload = await this.buildUploadPayload(local);
          return api.upload({
            vault_id: this.getSettings().vaultId,
            device_id: this.getSettings().deviceId,
            path: local.path,
            content_b64: payload.contentBase64,
            hash: local.hash,
            payload_hash: payload.payloadHash,
            content_format: payload.contentFormat,
            base_version: current?.version ?? 0,
          });
        },
        `upload ${local.path}`,
      );

      if (response.ok && response.version) {
        state.files[local.path] = {
          hash: local.hash,
          version: response.version,
          mtime: local.mtime,
          deleted: false,
        };
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
      if (fileState.deleted || localFiles.has(path) || !this.shouldSyncPath(path)) {
        continue;
      }

      const response = await this.withRetry(
        () => api.delete({
          vault_id: this.getSettings().vaultId,
          device_id: this.getSettings().deviceId,
          path,
          base_version: fileState.version,
        }),
        `delete ${path}`,
      );

      if (response.ok && response.version) {
        state.files[path] = {
          hash: "",
          version: response.version,
          mtime: 0,
          deleted: true,
        };
        continue;
      }

      if (response.conflict) {
        await this.downloadAndApplyRemote(api, state, path);
      }
    }
  }

  private async downloadRemoteChanges(api: SyncApi, state: SyncState): Promise<void> {
    const response = await this.withRetry(
      () => api.getChanges(state.vaultId, state.lastSeq),
      "fetch change feed",
    );
    const currentDeviceId = this.getSettings().deviceId;

    for (const change of response.changes) {
      if (change.device_id === currentDeviceId) {
        state.lastSeq = change.seq;
        continue;
      }

      if (!this.shouldSyncPath(change.path)) {
        state.lastSeq = change.seq;
        continue;
      }

      const localState = state.files[change.path];
      if (localState && localState.version >= change.version) {
        continue;
      }

      if (change.deleted) {
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
    const existing = this.app.vault.getAbstractFileByPath(local.path);
    if (existing instanceof TFile) {
      await this.writeConflictCopy(existing, local.data);
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
    const remote = await this.withRetry(
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
      base64ToBytes(remote.content_b64 ?? ""),
      remote.content_format ?? "plain",
    );
    const existing = this.app.vault.getAbstractFileByPath(remote.path);
    const localState = state.files[remote.path];

    if (existing instanceof TFile) {
      const currentData = await this.readBinary(existing);
      const currentHash = await sha256Hex(currentData);
      if (!conflictCopyAlreadySaved && localState && !localState.deleted && currentHash !== localState.hash) {
        await this.writeConflictCopy(existing, currentData);
        this.notifyConflictCopy(remote.path, sourceDeviceId);
      }
      await this.writeBinary(existing, data);
    } else {
      await this.ensureParentFolder(remote.path);
      await this.createBinary(remote.path, data);
    }

    const stat = await this.app.vault.adapter.stat(remote.path);
    state.files[remote.path] = {
      hash: remote.hash,
      version: remote.version,
      mtime: stat?.mtime ?? Date.now(),
      deleted: false,
    };
  }

  private async applyRemoteDelete(
    state: SyncState,
    path: string,
    version: number,
    sourceDeviceId?: string,
    conflictCopyAlreadySaved = false,
  ): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    const localState = state.files[path];

    if (existing instanceof TFile) {
      const currentData = await this.readBinary(existing);
      const currentHash = await sha256Hex(currentData);
      if (!conflictCopyAlreadySaved && localState && !localState.deleted && currentHash !== localState.hash) {
        await this.writeConflictCopy(existing, currentData);
        this.notifyConflictCopy(path, sourceDeviceId);
      }
      await this.app.fileManager.trashFile(existing);
    }

    state.files[path] = {
      hash: "",
      version,
      mtime: 0,
      deleted: true,
    };
  }

  private async writeConflictCopy(file: TFile, data: Uint8Array): Promise<void> {
    const conflictPath = buildConflictPath(file.path);
    await this.ensureParentFolder(conflictPath);
    await this.createBinary(conflictPath, data);
  }

  private notifyConflictCopy(path: string, sourceDeviceId?: string): void {
    const sourceSuffix = sourceDeviceId ? ` from ${sourceDeviceId}` : "";
    new Notice(`Saved conflict copy for ${path}${sourceSuffix}`);
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const parts = normalized.split("/");
    parts.pop();

    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!current || this.app.vault.getAbstractFileByPath(current)) {
        continue;
      }
      await this.app.vault.createFolder(current);
    }
  }

  private async readBinary(file: TFile): Promise<Uint8Array> {
    const arrayBuffer = await this.app.vault.readBinary(file);
    return new Uint8Array(arrayBuffer);
  }

  private async writeBinary(file: TFile, data: Uint8Array): Promise<void> {
    await this.app.vault.modifyBinary(file, toArrayBuffer(data));
  }

  private async createBinary(path: string, data: Uint8Array): Promise<void> {
    await this.app.vault.createBinary(path, toArrayBuffer(data));
  }

  private async buildUploadPayload(local: LocalFileSnapshot): Promise<{
    contentBase64: string;
    payloadHash?: string;
    contentFormat: "plain" | "e2ee-envelope-v1";
  }> {
    const passphrase = this.getSettings().e2eePassphrase.trim();
    if (!passphrase) {
      return {
        contentBase64: bytesToBase64(local.data),
        contentFormat: "plain",
      };
    }

    const envelope = await encryptBytes(local.data, passphrase);
    const serializedEnvelope = serializeEnvelope(envelope);
    return {
      contentBase64: bytesToBase64(serializedEnvelope),
      payloadHash: await sha256Hex(serializedEnvelope),
      contentFormat: "e2ee-envelope-v1",
    };
  }

  private async decodeRemoteContent(
    payload: Uint8Array,
    contentFormat: "plain" | "e2ee-envelope-v1",
  ): Promise<Uint8Array> {
    if (contentFormat === "plain") {
      return payload;
    }

    const passphrase = this.getSettings().e2eePassphrase.trim();
    if (!passphrase) {
      throw new Error("E2EE passphrase is required to decrypt synced content");
    }

    return decryptEnvelope(parseEnvelope(payload), passphrase);
  }

  private shouldSyncPath(path: string): boolean {
    const settings = this.getSettings();
    return shouldSyncPath(path, settings.includePatterns, settings.ignorePatterns);
  }

  private async withRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
    let attempt = 0;

    while (true) {
      attempt += 1;
      try {
        return await operation();
      } catch (error) {
        if (!isRetryableError(error) || attempt >= this.maxNetworkAttempts) {
          throw error;
        }

        const delayMs = this.retryBaseDelayMs * 2 ** (attempt - 1);
        console.warn(`obsidian-sync: retrying ${label} in ${delayMs}ms`, error);
        await this.sleepFn(delayMs);
      }
    }
  }
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}

function bytesToBase64(data: Uint8Array): string {
  let text = "";
  for (const byte of data) {
    text += String.fromCharCode(byte);
  }
  return btoa(text);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    output[i] = binary.charCodeAt(i);
  }
  return output;
}

function buildConflictPath(path: string): string {
  const slashIndex = path.lastIndexOf("/");
  const directory = slashIndex >= 0 ? path.slice(0, slashIndex + 1) : "";
  const fileName = slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex <= 0) {
    return `${directory}${fileName} (conflict)`;
  }

  const stem = fileName.slice(0, dotIndex);
  const ext = fileName.slice(dotIndex);
  return `${directory}${stem} (conflict)${ext}`;
}

function formatError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "Unauthorized. Check Auth token in plugin settings.";
    }

    if (error.code === "invalid_vault_id") {
      return "Vault ID is invalid. Use only letters, digits, '-' or '_'.";
    }

    if (error.code === "invalid_device_id") {
      return "Device ID is invalid. Use only letters, digits, '-' or '_'.";
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 408
      || error.status === 429
      || error.status >= 500;
  }

  return error instanceof Error;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
