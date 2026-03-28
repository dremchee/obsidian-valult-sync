import type {
  PluginDataShape,
  SyncSettings,
  SyncState,
  VaultScopeConfig,
} from "../types";

const DEFAULT_STATE: SyncState = {
  vaultId: "",
  files: {},
  documents: {},
  lastSeq: 0,
  lastSyncAt: null,
  lastSyncError: null,
};

const DEFAULT_SCOPE: VaultScopeConfig = {
  includePatterns: [],
  ignorePatterns: [],
};

export class PluginStateStore {
  state: SyncState = structuredClone(DEFAULT_STATE);
  scope: VaultScopeConfig = structuredClone(DEFAULT_SCOPE);

  load(raw: PluginDataShape | null, activeVaultId: string): SyncState {
    this.state = this.normalizePersistedState(raw, activeVaultId);
    this.scope = this.normalizePersistedScope(raw, activeVaultId);
    return structuredClone(this.state);
  }

  snapshotState(activeVaultId: string, state: SyncState): void {
    this.state = structuredClone({
      ...state,
      vaultId: activeVaultId,
    });
  }

  getState(): SyncState {
    return structuredClone(this.state);
  }

  resetState(activeVaultId: string): SyncState {
    this.state = {
      ...DEFAULT_STATE,
      vaultId: activeVaultId,
    };
    return this.getState();
  }

  getCurrentScope(settings: SyncSettings): VaultScopeConfig {
    return {
      includePatterns: [...settings.includePatterns],
      ignorePatterns: [...settings.ignorePatterns],
    };
  }

  saveCurrentScope(settings: SyncSettings): void {
    this.scope = this.getCurrentScope(settings);
  }

  applyScope(settings: SyncSettings): void {
    settings.includePatterns = [...this.scope.includePatterns];
    settings.ignorePatterns = [...this.scope.ignorePatterns];
  }

  updateCurrentScope(settings: SyncSettings, scope: VaultScopeConfig): void {
    settings.includePatterns = [...scope.includePatterns];
    settings.ignorePatterns = [...scope.ignorePatterns];
    this.scope = this.getCurrentScope(settings);
  }

  resetScope(settings: SyncSettings): void {
    this.scope = structuredClone(DEFAULT_SCOPE);
    this.applyScope(settings);
  }

  private normalizePersistedState(
    raw: PluginDataShape | null,
    activeVaultId: string,
  ): SyncState {
    const persistedCurrentState = raw?.state;
    if (persistedCurrentState) {
      return {
        ...DEFAULT_STATE,
        ...persistedCurrentState,
        vaultId: activeVaultId,
        files: {
          ...DEFAULT_STATE.files,
          ...persistedCurrentState.files,
        },
        documents: {
          ...DEFAULT_STATE.documents,
          ...persistedCurrentState.documents,
        },
      };
    }

    return {
      ...DEFAULT_STATE,
      vaultId: activeVaultId,
    };
  }

  private normalizePersistedScope(
    raw: PluginDataShape | null,
    _activeVaultId: string,
  ): VaultScopeConfig {
    if (raw?.scope) {
      return {
        includePatterns: [...(raw.scope.includePatterns ?? [])],
        ignorePatterns: [...(raw.scope.ignorePatterns ?? [])],
      };
    }

    return structuredClone(DEFAULT_SCOPE);
  }
}
