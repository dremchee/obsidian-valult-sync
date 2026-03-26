import type {
  ChangeItem,
  ContentFormat,
  DeleteRequest,
  FileState,
  LocalFileSnapshot,
  SyncSettings,
  SyncState,
  UploadRequest,
} from "../types";

export interface UploadContentPayload {
  contentBase64: string;
  payloadHash: string;
  contentFormat: ContentFormat;
}

export type RemoteChangeDecision =
  | "skip-own-change"
  | "skip-out-of-scope"
  | "skip-current-state"
  | "apply-delete"
  | "apply-file";

export function shouldUploadLocalChange(
  current: FileState | undefined,
  local: Pick<LocalFileSnapshot, "hash">,
): boolean {
  return !(current && !current.deleted && current.hash === local.hash);
}

export function createUploadRequest(
  settings: Pick<SyncSettings, "vaultId" | "deviceId">,
  local: LocalFileSnapshot,
  current: FileState | undefined,
  payload: UploadContentPayload,
): UploadRequest {
  return {
    vault_id: settings.vaultId,
    device_id: settings.deviceId,
    path: local.path,
    content_b64: payload.contentBase64,
    hash: local.hash,
    payload_hash: payload.payloadHash,
    content_format: payload.contentFormat,
    base_version: current?.version ?? 0,
  };
}

export function applyUploadedFile(
  state: SyncState,
  local: LocalFileSnapshot,
  version: number,
): void {
  state.files[local.path] = {
    hash: local.hash,
    version,
    mtime: local.mtime,
    deleted: false,
  };
}

export function shouldUploadLocalDeletion(
  path: string,
  fileState: FileState,
  localFiles: Map<string, LocalFileSnapshot>,
  shouldSyncPath: (path: string) => boolean,
): boolean {
  return !fileState.deleted && !localFiles.has(path) && shouldSyncPath(path);
}

export function createDeleteRequest(
  settings: Pick<SyncSettings, "vaultId" | "deviceId">,
  path: string,
  fileState: FileState,
): DeleteRequest {
  return {
    vault_id: settings.vaultId,
    device_id: settings.deviceId,
    path,
    base_version: fileState.version,
  };
}

export function applyDeletedFile(
  state: SyncState,
  path: string,
  version: number,
): void {
  state.files[path] = {
    hash: "",
    version,
    mtime: 0,
    deleted: true,
  };
}

export function decideRemoteChange(
  change: ChangeItem,
  currentDeviceId: string,
  localState: FileState | undefined,
  shouldSyncPath: (path: string) => boolean,
): RemoteChangeDecision {
  if (change.device_id === currentDeviceId) {
    return "skip-own-change";
  }

  if (!shouldSyncPath(change.path)) {
    return "skip-out-of-scope";
  }

  if (localState && localState.version >= change.version) {
    return "skip-current-state";
  }

  return change.deleted ? "apply-delete" : "apply-file";
}

export function shouldCreateConflictCopy(
  conflictCopyAlreadySaved: boolean,
  localState: FileState | undefined,
  currentHash: string,
): boolean {
  return !conflictCopyAlreadySaved
    && !!localState
    && !localState.deleted
    && currentHash !== localState.hash;
}

export function applyRemoteFile(
  state: SyncState,
  path: string,
  hash: string,
  version: number,
  mtime: number,
): void {
  state.files[path] = {
    hash,
    version,
    mtime,
    deleted: false,
  };
}

export function buildConflictPath(path: string): string {
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
