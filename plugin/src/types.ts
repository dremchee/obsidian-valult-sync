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

export type ContentFormat = "plain" | "e2ee-envelope-v1";

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
  lastSyncAt: number | null;
  lastSyncError: SyncErrorState | null;
}

export interface PluginDataShape {
  settings: SyncSettings;
  state: SyncState;
  scope: VaultScopeConfig;
  e2eeFingerprint: string | null;
}

export interface LegacyPluginDataShape {
  settings?: Partial<SyncSettings>;
  state?: Partial<SyncState>;
  scope?: Partial<VaultScopeConfig>;
  e2eeFingerprint?: string | null;
  statesByVaultId?: Record<string, Partial<SyncState>>;
  vaultScopesById?: Record<string, Partial<VaultScopeConfig>>;
  e2eeFingerprintsByVaultId?: Record<string, string>;
}

export interface UploadRequest {
  vault_id: string;
  device_id: string;
  path: string;
  content_b64: string;
  hash: string;
  payload_hash: string;
  content_format: ContentFormat;
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

export interface RestoreFileRequest {
  vault_id: string;
  device_id: string;
  path: string;
  target_version: number;
  base_version: number;
}

export interface FileResponse {
  path: string;
  hash: string;
  version: number;
  deleted: boolean;
  content_b64: string | null;
  content_format: ContentFormat;
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

export interface VaultItem {
  vault_id: string;
  created_at: string;
  updated_at: string;
  device_count: number;
}

export interface VaultsResponse {
  vaults: VaultItem[];
}

export interface FileVersionItem {
  version: number;
  hash: string;
  payload_hash: string;
  content_format: ContentFormat;
  deleted: boolean;
  created_at: string;
}

export interface FileHistoryResponse {
  path: string;
  versions: FileVersionItem[];
}

export interface CreateVaultResponse {
  ok: boolean;
  created: boolean;
  vault: VaultItem;
}

export interface LocalFileSnapshot {
  path: string;
  hash: string;
  mtime: number;
  data: Uint8Array;
}

export interface E2eeEnvelope {
  v: 1;
  alg: "AES-GCM-256";
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt_b64: string;
  iv_b64: string;
  ciphertext_b64: string;
}

export type SyncErrorCode =
  | "network_error"
  | "unauthorized"
  | "missing_passphrase"
  | "fingerprint_mismatch"
  | "decrypt_failed"
  | "invalid_e2ee_envelope"
  | "invalid_settings"
  | "unknown_error";

export interface SyncErrorState {
  code: SyncErrorCode;
  message: string;
}
