import type {
  LegacyPluginDataShape,
  SyncSettings,
  SyncState,
  VaultScopeConfig,
} from "../types";

const DEFAULT_STATE: SyncState = {
  vaultId: "default",
  files: {},
  lastSeq: 0,
  lastSyncAt: null,
  lastSyncError: null,
};

export class PluginStateStore {
  statesByVaultId: Record<string, SyncState> = {};
  vaultScopesById: Record<string, VaultScopeConfig> = {};

  load(raw: LegacyPluginDataShape | null, activeVaultId: string): SyncState {
    this.statesByVaultId = this.normalizePersistedStates(raw, activeVaultId);
    this.vaultScopesById = this.normalizePersistedVaultScopes(raw, activeVaultId);
    return this.getStateForVaultId(activeVaultId);
  }

  snapshotState(activeVaultId: string, state: SyncState): void {
    state.vaultId = activeVaultId;
    this.statesByVaultId[activeVaultId] = structuredClone(state);
  }

  getKnownVaultIds(knownVaultIds: string[] | undefined, activeVaultId: string): string[] {
    const uniqueVaultIds = new Set<string>();

    for (const vaultId of knownVaultIds ?? []) {
      const trimmed = vaultId.trim();
      if (trimmed) {
        uniqueVaultIds.add(trimmed);
      }
    }

    uniqueVaultIds.add(activeVaultId);
    return Array.from(uniqueVaultIds);
  }

  getStateForVaultId(vaultId: string): SyncState {
    const existing = this.statesByVaultId[vaultId];
    if (existing) {
      return {
        ...DEFAULT_STATE,
        ...existing,
        vaultId,
        files: {
          ...DEFAULT_STATE.files,
          ...existing.files,
        },
      };
    }

    const freshState: SyncState = {
      ...DEFAULT_STATE,
      vaultId,
    };
    this.statesByVaultId[vaultId] = structuredClone(freshState);
    return freshState;
  }

  getCurrentVaultScope(settings: SyncSettings): VaultScopeConfig {
    return {
      includePatterns: [...settings.includePatterns],
      ignorePatterns: [...settings.ignorePatterns],
    };
  }

  saveCurrentVaultScope(settings: SyncSettings): void {
    this.vaultScopesById[settings.vaultId] = this.getCurrentVaultScope(settings);
  }

  applyVaultScope(settings: SyncSettings, vaultId: string): void {
    const scope = this.vaultScopesById[vaultId] ?? {
      includePatterns: [],
      ignorePatterns: [],
    };
    settings.includePatterns = [...scope.includePatterns];
    settings.ignorePatterns = [...scope.ignorePatterns];
    this.vaultScopesById[vaultId] = {
      includePatterns: [...scope.includePatterns],
      ignorePatterns: [...scope.ignorePatterns],
    };
  }

  updateCurrentVaultScope(settings: SyncSettings, scope: VaultScopeConfig): void {
    settings.includePatterns = [...scope.includePatterns];
    settings.ignorePatterns = [...scope.ignorePatterns];
    this.vaultScopesById[settings.vaultId] = this.getCurrentVaultScope(settings);
  }

  copyCurrentVaultScopeToVault(settings: SyncSettings, vaultId: string): boolean {
    const nextVaultId = vaultId.trim();
    if (!nextVaultId) {
      return false;
    }

    this.vaultScopesById[nextVaultId] = this.getCurrentVaultScope(settings);
    return true;
  }

  forgetVault(vaultId: string): void {
    delete this.statesByVaultId[vaultId];
    delete this.vaultScopesById[vaultId];
  }

  private normalizePersistedStates(
    raw: LegacyPluginDataShape | null,
    activeVaultId: string,
  ): Record<string, SyncState> {
    const statesByVaultId: Record<string, SyncState> = {};

    for (const [vaultId, state] of Object.entries(raw?.statesByVaultId ?? {})) {
      statesByVaultId[vaultId] = {
        ...DEFAULT_STATE,
        ...state,
        vaultId,
        files: {
          ...DEFAULT_STATE.files,
          ...state.files,
        },
      };
    }

    const legacyVaultId = raw?.state?.vaultId || activeVaultId;
    if (raw?.state && !statesByVaultId[legacyVaultId]) {
      statesByVaultId[legacyVaultId] = {
        ...DEFAULT_STATE,
        ...raw.state,
        vaultId: legacyVaultId,
        files: {
          ...DEFAULT_STATE.files,
          ...raw.state.files,
        },
      };
    }

    return statesByVaultId;
  }

  private normalizePersistedVaultScopes(
    raw: LegacyPluginDataShape | null,
    activeVaultId: string,
  ): Record<string, VaultScopeConfig> {
    const vaultScopesById: Record<string, VaultScopeConfig> = {};

    for (const [vaultId, scope] of Object.entries(raw?.vaultScopesById ?? {})) {
      vaultScopesById[vaultId] = {
        includePatterns: [...(scope.includePatterns ?? [])],
        ignorePatterns: [...(scope.ignorePatterns ?? [])],
      };
    }

    const legacyVaultId = raw?.settings?.vaultId || activeVaultId;
    if (!vaultScopesById[legacyVaultId]) {
      vaultScopesById[legacyVaultId] = {
        includePatterns: [...(raw?.settings?.includePatterns ?? [])],
        ignorePatterns: [...(raw?.settings?.ignorePatterns ?? [])],
      };
    }

    return vaultScopesById;
  }
}
