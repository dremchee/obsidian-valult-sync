export interface SyncSettings {
  serverUrl: string;
  vaultId: string;
  includePatterns: string[];
  ignorePatterns: string[];
  deviceId: string;
  authToken: string;
  pollIntervalSecs: number;
  autoSync: boolean;
}

export interface VaultScopeConfig {
  includePatterns: string[];
  ignorePatterns: string[];
}

export interface FileState {
  hash: string;
  version: number;
  mtime: number;
  deleted: boolean;
}

export interface DocumentState {
  snapshotB64: string;
  contentHash: string;
  version: number;
  mtime: number;
  deleted: boolean;
}

export interface SyncState {
  vaultId: string;
  files: Record<string, FileState>;
  documents: Record<string, DocumentState>;
  lastSeq: number;
  lastSyncAt: number | null;
  lastSyncError: SyncErrorState | null;
}

export interface PluginDataShape {
  settings: SyncSettings;
  state: SyncState;
  scope: VaultScopeConfig;
}

export interface MutationResponse {
  ok: boolean;
  version?: number;
  conflict?: boolean;
  server_version?: number;
}

export interface DocumentChangeItem {
  seq: number;
  device_id: string;
  path: string;
  version: number;
  deleted: boolean;
}

export interface DocumentChangesResponse {
  changes: DocumentChangeItem[];
  latest_seq: number;
}

export interface DeviceItem {
  device_id: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface DevicesResponse {
  devices: DeviceItem[];
}

export interface VaultItem {
  vault_id: string;
  created_at: string;
  updated_at: string;
  device_count: number;
}

export interface VaultsResponse {
  vaults: VaultItem[];
}

export interface DocumentVersionItem {
  version: number;
  hash: string;
  snapshot_b64: string;
  deleted: boolean;
  created_at: string;
}

export interface DocumentHistoryResponse {
  path: string;
  versions: DocumentVersionItem[];
}

export interface CreateVaultResponse {
  ok: boolean;
  created: boolean;
  vault: VaultItem;
}

export interface DocumentSnapshotResponse {
  path: string;
  version: number;
  snapshot_b64: string;
  hash: string;
  deleted: boolean;
  content_b64: string;
}

export interface PushDocumentRequest {
  vault_id: string;
  device_id: string;
  path: string;
  content_b64: string;
  hash: string;
  deleted: boolean;
}

export interface RestoreDocumentRequest {
  vault_id: string;
  device_id: string;
  path: string;
  target_version: number;
}

export interface LocalFileSnapshot {
  path: string;
  hash: string;
  mtime: number;
  data: Uint8Array;
}

export interface RenameCandidate {
  fromPath: string;
  fromState: FileState;
  toFile: LocalFileSnapshot;
}

export type SyncErrorCode =
  | "network_error"
  | "unauthorized"
  | "invalid_settings"
  | "unknown_error";

export interface SyncErrorState {
  code: SyncErrorCode;
  message: string;
}
