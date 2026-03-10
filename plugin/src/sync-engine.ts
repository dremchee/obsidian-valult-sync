import {
  Notice,
  TFile,
  normalizePath,
  type App,
} from "obsidian";

import { SyncApi } from "./api";
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

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SyncSettings,
    private readonly getState: () => SyncState,
    private readonly saveState: (state: SyncState) => Promise<void>,
  ) {}

  async syncOnce(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const settings = this.getSettings();
      const state = structuredClone(this.getState());
      const api = new SyncApi(
        settings.serverUrl.replace(/\/+$/, ""),
        settings.authToken,
      );
      state.vaultId = settings.vaultId;

      await api.health();

      const localFiles = await this.scanVault();
      await this.uploadLocalChanges(api, state, localFiles);
      await this.uploadLocalDeletions(api, state, localFiles);
      await this.downloadRemoteChanges(api, state);

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

      const response = await api.upload({
        vault_id: this.getSettings().vaultId,
        path: local.path,
        content_b64: bytesToBase64(local.data),
        hash: local.hash,
        base_version: current?.version ?? 0,
      });

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
      if (fileState.deleted || localFiles.has(path)) {
        continue;
      }

      const response = await api.delete({
        vault_id: this.getSettings().vaultId,
        path,
        base_version: fileState.version,
      });

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
    const response = await api.getChanges(state.vaultId, state.lastSeq);

    for (const change of response.changes) {
      const localState = state.files[change.path];
      if (localState && localState.version >= change.version) {
        continue;
      }

      if (change.deleted) {
        await this.applyRemoteDelete(state, change.path, change.version);
      } else {
        await this.downloadAndApplyRemote(api, state, change.path);
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

    await this.downloadAndApplyRemote(api, state, local.path);
  }

  private async downloadAndApplyRemote(
    api: SyncApi,
    state: SyncState,
    path: string,
  ): Promise<void> {
    const remote = await api.getFile(this.getSettings().vaultId, path);

    if (remote.deleted) {
      await this.applyRemoteDelete(state, remote.path, remote.version);
      return;
    }

    const data = base64ToBytes(remote.content_b64 ?? "");
    const existing = this.app.vault.getAbstractFileByPath(remote.path);
    const localState = state.files[remote.path];

    if (existing instanceof TFile) {
      const currentData = await this.readBinary(existing);
      const currentHash = await sha256Hex(currentData);
      if (localState && !localState.deleted && currentHash !== localState.hash) {
        await this.writeConflictCopy(existing, currentData);
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
  ): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    const localState = state.files[path];

    if (existing instanceof TFile) {
      const currentData = await this.readBinary(existing);
      const currentHash = await sha256Hex(currentData);
      if (localState && !localState.deleted && currentHash !== localState.hash) {
        await this.writeConflictCopy(existing, currentData);
      }
      await this.app.fileManager.trashFile(existing, false);
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
    await this.app.vault.modifyBinary(file, data.buffer.slice(0));
  }

  private async createBinary(path: string, data: Uint8Array): Promise<void> {
    await this.app.vault.createBinary(path, data.buffer.slice(0));
  }
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
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
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
