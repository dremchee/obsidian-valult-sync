export interface SyncSettings {
  serverUrl: string;
  vaultId: string;
  knownVaultIds: string[];
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

export interface SyncState {
  vaultId: string;
  files: Record<string, FileState>;
  lastSeq: number;
}

export interface PluginDataShape {
  settings: SyncSettings;
  statesByVaultId: Record<string, SyncState>;
  vaultScopesById: Record<string, VaultScopeConfig>;
}

export interface LegacyPluginDataShape {
  settings?: Partial<SyncSettings>;
  state?: Partial<SyncState>;
  statesByVaultId?: Record<string, Partial<SyncState>>;
  vaultScopesById?: Record<string, Partial<VaultScopeConfig>>;
}

export interface UploadRequest {
  vault_id: string;
  device_id: string;
  path: string;
  content_b64: string;
  hash: string;
  base_version: number;
}

export interface DeleteRequest {
  vault_id: string;
  device_id: string;
  path: string;
  base_version: number;
}

export interface MutationResponse {
  ok: boolean;
  version?: number;
  conflict?: boolean;
  server_version?: number;
}

export interface FileResponse {
  path: string;
  hash: string;
  version: number;
  deleted: boolean;
  content_b64: string | null;
}

export interface ChangeItem {
  seq: number;
  device_id: string;
  path: string;
  version: number;
  deleted: boolean;
}

export interface ChangesResponse {
  changes: ChangeItem[];
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

export interface LocalFileSnapshot {
  path: string;
  hash: string;
  mtime: number;
  data: Uint8Array;
}
