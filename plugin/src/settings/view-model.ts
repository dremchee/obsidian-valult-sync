import type { VaultItem } from "../types";

export interface SettingsConnectionViewModel {
  unlocked: boolean;
  authGateMessage: string;
  serverUrl: string;
  authTokenDraft: string;
  editingAuthToken: boolean;
  connectionStatusText: string;
  deviceId: string;
  pollIntervalSecs: number;
  autoSync: boolean;
}

export interface SettingsOverviewViewModel {
  currentVaultId: string;
  trackedFilesCount: number;
  deletedFilesCount: number;
  lastSyncAt: number | null;
  lastSyncErrorText: string;
  quickActionsStatusText: string;
  serverUrl: string;
}

export interface SettingsVaultViewModel {
  currentVaultId: string;
  remoteVaults: VaultItem[] | null;
  loadingRemoteVaults: boolean;
  remoteVaultsError: string | null;
  vaultStatusText: string;
  confirmDisconnect: boolean;
  confirmForget: boolean;
  pendingJoinDecision: boolean;
  pendingJoinVaultId: string | null;
  pendingJoinLocalFileCount: number;
}

export interface SettingsScopeViewModel {
  includePatterns: string[];
  ignorePatterns: string[];
}

export interface SettingsViewModel {
  connection: SettingsConnectionViewModel;
  overview: SettingsOverviewViewModel;
  vault: SettingsVaultViewModel;
  scope: SettingsScopeViewModel;
}

export interface SettingsConnectionActions {
  onServerUrlChange: (value: string) => Promise<void> | void;
  onCheckConnection: () => Promise<void> | void;
  onAuthTokenDraftChange: (value: string) => void;
  onAuthorize: () => Promise<void> | void;
  onCancelAuthEdit: () => void;
  onStartAuthEdit: () => void;
  onSignOut: () => Promise<void> | void;
  onPollIntervalChange: (value: string) => Promise<void> | void;
  onAutoSyncChange: (value: boolean) => Promise<void> | void;
}

export interface SettingsOverviewActions {
  onSyncNow: () => Promise<void> | void;
  onCheckConnection: () => Promise<void> | void;
  onRefreshDevices: () => Promise<void> | void;
}

export interface SettingsVaultActions {
  onDisconnectVault: () => Promise<void> | void;
  onForgetLocalState: () => Promise<void> | void;
  onLoadVaults: () => Promise<void> | void;
  onCreateCurrentVault: () => Promise<void> | void;
  onCreateVault: () => Promise<void> | void;
  onJoinVault: (vaultId: string) => Promise<void> | void;
  onAdoptServerVault: () => Promise<void> | void;
  onSyncJoinedVault: () => Promise<void> | void;
}

export interface SettingsScopeActions {
  onIncludePatternsChange: (value: string) => Promise<void> | void;
  onIgnorePatternsChange: (value: string) => Promise<void> | void;
}

export interface SettingsActions extends
  SettingsConnectionActions,
  SettingsOverviewActions,
  SettingsVaultActions,
  SettingsScopeActions {}
