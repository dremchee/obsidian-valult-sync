import { TFile } from "obsidian";

import type { SyncApi } from "../api";
import type {
  ChangeItem,
  ContentFormat,
  SyncState,
} from "../types";
import {
  applyDeletedFile,
  applyRemoteFile,
  buildConflictPath,
  decideRemoteChange,
  shouldCreateConflictCopy,
} from "./flow";
import { sha256Hex } from "./payload-codec";
import type { ObsidianVaultIO } from "./vault-io";

export interface RemoteChangeApplierOptions {
  vaultId: string;
  currentDeviceId: string;
  shouldSyncPath: (path: string) => boolean;
}

interface RemoteChangeApplierDeps {
  decodeRemoteContent: (payloadBase64: string, contentFormat: ContentFormat) => Promise<Uint8Array>;
  notifyConflictCopy: (path: string, sourceDeviceId?: string) => void;
  retry: <T>(operation: () => Promise<T>, label: string) => Promise<T>;
  vaultIO: ObsidianVaultIO;
}

export class RemoteChangeApplier {
  constructor(private readonly deps: RemoteChangeApplierDeps) {}

  async applyChangeFeed(
    api: SyncApi,
    state: SyncState,
    options: RemoteChangeApplierOptions,
  ): Promise<void> {
    const response = await this.deps.retry(
      () => api.getChanges(state.vaultId, state.lastSeq),
      "fetch change feed",
    );
    const groupedChanges = groupChangesByMutation(response.changes);

    for (const changes of groupedChanges) {
      if (await this.tryApplyRemoteRenameBatch(api, state, changes, options)) {
        state.lastSeq = changes[changes.length - 1].seq;
        continue;
      }

      for (const change of changes) {
        const localState = state.files[change.path];
        const decision = decideRemoteChange(
          change,
          options.currentDeviceId,
          localState,
          options.shouldSyncPath,
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
          await this.downloadAndApplyRemote(api, state, options.vaultId, change.path, change.device_id);
        }

        state.lastSeq = change.seq;
      }
    }

    state.lastSeq = response.latest_seq;
  }

  async resolveConflict(
    api: SyncApi,
    state: SyncState,
    vaultId: string,
    local: { path: string; data: Uint8Array },
  ): Promise<void> {
    const existing = this.deps.vaultIO.getAbstractFileByPath(local.path);
    if (existing instanceof TFile) {
      await this.saveConflictCopyIfNeeded(existing, local.data, false);
    }

    await this.downloadAndApplyRemote(api, state, vaultId, local.path, undefined, true);
  }

  async syncRemotePath(
    api: SyncApi,
    state: SyncState,
    vaultId: string,
    path: string,
    sourceDeviceId?: string,
  ): Promise<void> {
    await this.downloadAndApplyRemote(api, state, vaultId, path, sourceDeviceId);
  }

  private async tryApplyRemoteRenameBatch(
    api: SyncApi,
    state: SyncState,
    changes: ChangeItem[],
    options: RemoteChangeApplierOptions,
  ): Promise<boolean> {
    if (changes.length !== 2 || changes[0].device_id === options.currentDeviceId) {
      return false;
    }

    const deletedChange = changes.find((change) => change.deleted);
    const createdChange = changes.find((change) => !change.deleted);
    if (!deletedChange || !createdChange) {
      return false;
    }

    const deletedDecision = decideRemoteChange(
      deletedChange,
      options.currentDeviceId,
      state.files[deletedChange.path],
      options.shouldSyncPath,
    );
    const createdDecision = decideRemoteChange(
      createdChange,
      options.currentDeviceId,
      state.files[createdChange.path],
      options.shouldSyncPath,
    );
    if (
      deletedDecision === "skip-out-of-scope"
      || createdDecision === "skip-out-of-scope"
      || deletedDecision === "skip-own-change"
      || createdDecision === "skip-own-change"
      || createdDecision === "skip-current-state"
    ) {
      return false;
    }

    await this.applyRemoteDelete(state, deletedChange.path, deletedChange.version, deletedChange.device_id);
    await this.downloadAndApplyRemote(api, state, options.vaultId, createdChange.path, createdChange.device_id);

    return true;
  }

  private async downloadAndApplyRemote(
    api: SyncApi,
    state: SyncState,
    vaultId: string,
    path: string,
    sourceDeviceId?: string,
    conflictCopyAlreadySaved = false,
  ): Promise<void> {
    const remote = await this.deps.retry(
      () => api.getFile(vaultId, path),
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

    const data = await this.deps.decodeRemoteContent(
      remote.content_b64 ?? "",
      remote.content_format,
    );
    const existing = this.deps.vaultIO.getAbstractFileByPath(remote.path);
    const localState = state.files[remote.path];

    if (existing instanceof TFile) {
      const currentData = await this.deps.vaultIO.readBinary(existing);
      const currentHash = await sha256Hex(currentData);
      if (shouldCreateConflictCopy(conflictCopyAlreadySaved, localState, currentHash)) {
        await this.saveConflictCopyIfNeeded(existing, currentData, true, sourceDeviceId);
      }
      await this.deps.vaultIO.writeBinary(existing, data);
    } else {
      await this.deps.vaultIO.ensureParentFolder(remote.path);
      await this.deps.vaultIO.createBinary(remote.path, data);
    }

    applyRemoteFile(
      state,
      remote.path,
      remote.hash,
      remote.version,
      await this.deps.vaultIO.getMtime(remote.path),
    );
  }

  private async applyRemoteDelete(
    state: SyncState,
    path: string,
    version: number,
    sourceDeviceId?: string,
    conflictCopyAlreadySaved = false,
  ): Promise<void> {
    const existing = this.deps.vaultIO.getAbstractFileByPath(path);
    const localState = state.files[path];

    if (existing instanceof TFile) {
      const currentData = await this.deps.vaultIO.readBinary(existing);
      const currentHash = await sha256Hex(currentData);
      if (shouldCreateConflictCopy(conflictCopyAlreadySaved, localState, currentHash)) {
        await this.saveConflictCopyIfNeeded(existing, currentData, true, sourceDeviceId);
      }
      await this.deps.vaultIO.trashFile(existing);
    }

    applyDeletedFile(state, path, version);
  }

  private async writeConflictCopy(file: TFile, data: Uint8Array): Promise<void> {
    const conflictPath = buildConflictPath(file.path);
    await this.deps.vaultIO.ensureParentFolder(conflictPath);
    await this.deps.vaultIO.createBinary(conflictPath, data);
  }

  private async saveConflictCopyIfNeeded(
    file: TFile,
    data: Uint8Array,
    notify: boolean,
    sourceDeviceId?: string,
  ): Promise<void> {
    const conflictPath = buildConflictPath(file.path);
    if (this.deps.vaultIO.getAbstractFileByPath(conflictPath)) {
      return;
    }

    await this.writeConflictCopy(file, data);
    if (notify) {
      this.deps.notifyConflictCopy(file.path, sourceDeviceId);
    }
  }
}

export function groupChangesByMutation(
  changes: ChangeItem[],
): ChangeItem[][] {
  const groups: ChangeItem[][] = [];
  let currentGroup: ChangeItem[] = [];

  for (const change of changes) {
    if (
      currentGroup.length > 0
      && (
        currentGroup[0].device_id !== change.device_id
        || currentGroup[0].version !== change.version
      )
    ) {
      groups.push(currentGroup);
      currentGroup = [];
    }

    currentGroup.push(change);
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}
