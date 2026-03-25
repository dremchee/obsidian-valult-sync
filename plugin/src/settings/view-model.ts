import type { VaultItem } from "../types";

export interface SettingsViewModel {
  unlocked: boolean;
  authGateMessage: string;
  serverUrl: string;
  authTokenDraft: string;
  editingAuthToken: boolean;
  connectionStatusText: string;
  deviceId: string;
  pollIntervalSecs: number;
  autoSync: boolean;
  currentVaultId: string;
  trackedFilesCount: number;
  deletedFilesCount: number;
  lastSyncAt: number | null;
  lastSyncErrorText: string;
  e2eeFingerprint: string | null;
  e2eePassphrase: string;
  quickActionsStatusText: string;
  remoteVaults: VaultItem[] | null;
  loadingRemoteVaults: boolean;
  remoteVaultsError: string | null;
  vaultStatusText: string;
  confirmDisconnect: boolean;
  confirmForget: boolean;
  includePatterns: string[];
  ignorePatterns: string[];
}

export interface SettingsActions {
  onServerUrlChange: (value: string) => Promise<void> | void;
  onCheckConnection: () => Promise<void> | void;
  onAuthTokenDraftChange: (value: string) => void;
  onAuthorize: () => Promise<void> | void;
  onCancelAuthEdit: () => void;
  onStartAuthEdit: () => void;
  onSignOut: () => Promise<void> | void;
  onPollIntervalChange: (value: string) => Promise<void> | void;
  onAutoSyncChange: (value: boolean) => Promise<void> | void;
  onSyncNow: () => Promise<void> | void;
  onRefreshDevices: () => Promise<void> | void;
  onDisconnectVault: () => Promise<void> | void;
  onForgetLocalState: () => Promise<void> | void;
  onLoadVaults: () => Promise<void> | void;
  onCreateCurrentVault: () => Promise<void> | void;
  onCreateVault: () => Promise<void> | void;
  onJoinVault: (vaultId: string) => Promise<void> | void;
  onIncludePatternsChange: (value: string) => Promise<void> | void;
  onIgnorePatternsChange: (value: string) => Promise<void> | void;
}
