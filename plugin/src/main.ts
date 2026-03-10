import { Notice, Plugin } from "obsidian";

import { SyncApi } from "./api";
import { buildPassphraseFingerprint } from "./e2ee";
import { SyncSettingTab } from "./settings";
import { SyncEngine } from "./sync-engine";
import type {
  DeviceItem,
  LegacyPluginDataShape,
  PluginDataShape,
  SyncSettings,
  SyncState,
  VaultScopeConfig,
} from "./types";

const DEFAULT_SETTINGS: SyncSettings = {
  serverUrl: "http://127.0.0.1:3000",
  vaultId: "default",
  knownVaultIds: ["default"],
  includePatterns: [],
  ignorePatterns: [],
  deviceId: "",
  authToken: "",
  pollIntervalSecs: 2,
  autoSync: true,
};

const DEFAULT_STATE: SyncState = {
  vaultId: "default",
  files: {},
  lastSeq: 0,
  lastSyncAt: null,
};

export default class ObsidianSyncPlugin extends Plugin {
  settings: SyncSettings = structuredClone(DEFAULT_SETTINGS);
  state: SyncState = structuredClone(DEFAULT_STATE);
  statesByVaultId: Record<string, SyncState> = {};
  vaultScopesById: Record<string, VaultScopeConfig> = {};
  e2eeFingerprintsByVaultId: Record<string, string> = {};

  private engine!: SyncEngine;
  private intervalId: number | null = null;
  private dirty = false;
  private sessionE2eePassphrasesByVaultId: Record<string, string> = {};

  async onload(): Promise<void> {
    await this.loadPluginData();
    this.dirty = true;

    this.engine = new SyncEngine(
      this.app,
      () => this.settings,
      () => this.getE2eePassphrase(),
      async () => this.rememberCurrentE2eePassphrase(),
      () => this.state,
      async (state) => {
        this.state = state;
        await this.persistData();
      },
    );

    this.addSettingTab(new SyncSettingTab(this.app, this));

    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: async () => {
        await this.runManualSync();
      },
    });

    this.registerEvent(
      this.app.vault.on("create", () => {
        this.dirty = true;
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", () => {
        this.dirty = true;
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", () => {
        this.dirty = true;
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", () => {
        this.dirty = true;
      }),
    );

    this.restartAutoSync();
    void this.safeSync();
  }

  onunload(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async persistData(): Promise<void> {
    this.state.vaultId = this.settings.vaultId;
    this.statesByVaultId[this.settings.vaultId] = structuredClone(this.state);
    this.vaultScopesById[this.settings.vaultId] = this.getCurrentVaultScope();
    this.settings.knownVaultIds = this.normalizeKnownVaultIds(
      this.settings.knownVaultIds,
      this.settings.vaultId,
    );
    const data: PluginDataShape = {
      settings: this.settings,
      statesByVaultId: this.statesByVaultId,
      vaultScopesById: this.vaultScopesById,
      e2eeFingerprintsByVaultId: this.e2eeFingerprintsByVaultId,
    };
    await this.saveData(data);
  }

  async activateVault(vaultId: string): Promise<void> {
    this.vaultScopesById[this.settings.vaultId] = this.getCurrentVaultScope();
    this.settings.vaultId = vaultId;
    this.settings.knownVaultIds = this.normalizeKnownVaultIds(
      this.settings.knownVaultIds,
      vaultId,
    );
    this.applyVaultScope(vaultId);
    this.state = this.getStateForVaultId(vaultId);
    this.dirty = true;
    await this.persistData();
  }

  async forgetVault(vaultId: string): Promise<void> {
    const nextKnownVaultIds = this.settings.knownVaultIds.filter((current) => current !== vaultId);
    delete this.statesByVaultId[vaultId];
    delete this.vaultScopesById[vaultId];
    delete this.e2eeFingerprintsByVaultId[vaultId];
    delete this.sessionE2eePassphrasesByVaultId[vaultId];

    if (this.settings.vaultId === vaultId) {
      const fallbackVaultId = nextKnownVaultIds[0] ?? DEFAULT_SETTINGS.vaultId;
      this.settings.vaultId = fallbackVaultId;
      this.applyVaultScope(fallbackVaultId);
      this.state = this.getStateForVaultId(fallbackVaultId);
      this.dirty = true;
    }

    this.settings.knownVaultIds = this.normalizeKnownVaultIds(
      nextKnownVaultIds,
      this.settings.vaultId,
    );
    await this.persistData();
  }

  getKnownVaultIds(): string[] {
    return [...this.settings.knownVaultIds];
  }

  getE2eePassphrase(vaultId = this.settings.vaultId): string {
    return this.sessionE2eePassphrasesByVaultId[vaultId] ?? "";
  }

  setE2eePassphrase(passphrase: string, vaultId = this.settings.vaultId): void {
    const trimmed = passphrase.trim();
    if (!trimmed) {
      delete this.sessionE2eePassphrasesByVaultId[vaultId];
      return;
    }

    this.sessionE2eePassphrasesByVaultId[vaultId] = passphrase;
  }

  getE2eeFingerprint(vaultId = this.settings.vaultId): string | null {
    return this.e2eeFingerprintsByVaultId[vaultId] ?? null;
  }

  async validateCurrentE2eePassphrase(): Promise<string> {
    const vaultId = this.settings.vaultId;
    const passphrase = this.getE2eePassphrase(vaultId).trim();
    const fingerprint = this.getE2eeFingerprint(vaultId);

    if (!fingerprint) {
      return passphrase
        ? "No fingerprint stored yet. It will be recorded after the first encrypted sync."
        : "E2EE is not configured for this vault yet.";
    }

    if (!passphrase) {
      throw new Error("E2EE passphrase is required for this vault");
    }

    const currentFingerprint = await buildPassphraseFingerprint(vaultId, passphrase);
    if (currentFingerprint !== fingerprint) {
      throw new Error("E2EE passphrase does not match the stored fingerprint for this vault");
    }

    return `Passphrase matches fingerprint ${shortFingerprint(fingerprint)}.`;
  }

  async clearCurrentE2eeFingerprint(): Promise<void> {
    delete this.e2eeFingerprintsByVaultId[this.settings.vaultId];
    await this.persistData();
  }

  async rememberCurrentE2eePassphrase(): Promise<void> {
    const vaultId = this.settings.vaultId;
    const passphrase = this.getE2eePassphrase(vaultId).trim();
    if (!passphrase) {
      return;
    }

    const currentFingerprint = await buildPassphraseFingerprint(vaultId, passphrase);
    const knownFingerprint = this.getE2eeFingerprint(vaultId);
    if (knownFingerprint && knownFingerprint !== currentFingerprint) {
      throw new Error("E2EE passphrase does not match the stored fingerprint for this vault");
    }

    if (!knownFingerprint) {
      this.e2eeFingerprintsByVaultId[vaultId] = currentFingerprint;
      await this.persistData();
    }
  }

  updateCurrentVaultScope(scope: VaultScopeConfig): void {
    this.settings.includePatterns = [...scope.includePatterns];
    this.settings.ignorePatterns = [...scope.ignorePatterns];
    this.vaultScopesById[this.settings.vaultId] = this.getCurrentVaultScope();
  }

  async copyCurrentVaultScopeToVault(vaultId: string): Promise<void> {
    const nextVaultId = vaultId.trim();
    if (!nextVaultId) {
      return;
    }

    this.vaultScopesById[nextVaultId] = this.getCurrentVaultScope();
    this.settings.knownVaultIds = this.normalizeKnownVaultIds(
      this.settings.knownVaultIds,
      nextVaultId,
    );
    await this.persistData();
  }

  async getRegisteredDevices(vaultId = this.settings.vaultId): Promise<DeviceItem[]> {
    const api = new SyncApi(
      this.settings.serverUrl.replace(/\/+$/, ""),
      this.settings.authToken,
    );
    const response = await api.getDevices(vaultId);
    return response.devices;
  }

  async checkConnection(): Promise<string> {
    const api = new SyncApi(
      this.settings.serverUrl.replace(/\/+$/, ""),
      this.settings.authToken,
    );
    const response = await api.getDevices(this.settings.vaultId);
    return `Connected to ${this.settings.vaultId}. ${response.devices.length} device(s) registered.`;
  }

  restartAutoSync(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (!this.settings.autoSync) {
      return;
    }

    const intervalMs = Math.max(this.settings.pollIntervalSecs, 1) * 1000;
    this.intervalId = window.setInterval(async () => {
      if (!this.dirty && this.state.lastSeq > 0) {
        await this.safeSync();
        return;
      }

      this.dirty = false;
      await this.safeSync();
    }, intervalMs);
  }

  private async runManualSync(): Promise<void> {
    try {
      await this.engine.syncOnce();
      new Notice("Sync completed", 3000);
    } catch {
      // Notice is shown inside SyncEngine
    }
  }

  private async safeSync(): Promise<void> {
    try {
      await this.engine.syncOnce();
    } catch {
      // Notice is shown inside SyncEngine
    }
  }

  private async loadPluginData(): Promise<void> {
    const raw = (await this.loadData()) as LegacyPluginDataShape | null;
    const rawSettings = raw?.settings ? stripLegacySecrets(raw.settings) : undefined;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...rawSettings,
      knownVaultIds: this.normalizeKnownVaultIds(
        rawSettings?.knownVaultIds,
        rawSettings?.vaultId || DEFAULT_SETTINGS.vaultId,
      ),
    };
    if (!this.settings.deviceId) {
      this.settings.deviceId = this.generateDeviceId();
    }
    this.statesByVaultId = this.normalizePersistedStates(raw);
    this.vaultScopesById = this.normalizePersistedVaultScopes(raw);
    this.e2eeFingerprintsByVaultId = { ...(raw?.e2eeFingerprintsByVaultId ?? {}) };
    this.applyVaultScope(this.settings.vaultId);
    this.state = this.getStateForVaultId(this.settings.vaultId);
  }

  private generateDeviceId(): string {
    return `device_${crypto.randomUUID().replace(/-/g, "_")}`;
  }

  private getStateForVaultId(vaultId: string): SyncState {
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
      vaultId,
      files: {},
      lastSeq: 0,
      lastSyncAt: null,
    };
    this.statesByVaultId[vaultId] = structuredClone(freshState);
    return freshState;
  }

  private normalizePersistedStates(raw: LegacyPluginDataShape | null): Record<string, SyncState> {
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

    const legacyVaultId = raw?.state?.vaultId || this.settings.vaultId;
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

  private normalizeKnownVaultIds(
    knownVaultIds: string[] | undefined,
    activeVaultId: string,
  ): string[] {
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

  private getCurrentVaultScope(): VaultScopeConfig {
    return {
      includePatterns: [...this.settings.includePatterns],
      ignorePatterns: [...this.settings.ignorePatterns],
    };
  }

  private applyVaultScope(vaultId: string): void {
    const scope = this.vaultScopesById[vaultId] ?? {
      includePatterns: [],
      ignorePatterns: [],
    };
    this.settings.includePatterns = [...scope.includePatterns];
    this.settings.ignorePatterns = [...scope.ignorePatterns];
    this.vaultScopesById[vaultId] = {
      includePatterns: [...scope.includePatterns],
      ignorePatterns: [...scope.ignorePatterns],
    };
  }

  private normalizePersistedVaultScopes(raw: LegacyPluginDataShape | null): Record<string, VaultScopeConfig> {
    const vaultScopesById: Record<string, VaultScopeConfig> = {};

    for (const [vaultId, scope] of Object.entries(raw?.vaultScopesById ?? {})) {
      vaultScopesById[vaultId] = {
        includePatterns: [...(scope.includePatterns ?? [])],
        ignorePatterns: [...(scope.ignorePatterns ?? [])],
      };
    }

    const legacyVaultId = raw?.settings?.vaultId || DEFAULT_SETTINGS.vaultId;
    if (!vaultScopesById[legacyVaultId]) {
      vaultScopesById[legacyVaultId] = {
        includePatterns: [...(raw?.settings?.includePatterns ?? [])],
        ignorePatterns: [...(raw?.settings?.ignorePatterns ?? [])],
      };
    }

    return vaultScopesById;
  }
}

function stripLegacySecrets(settings: Partial<SyncSettings> & { e2eePassphrase?: string }): Partial<SyncSettings> {
  const { e2eePassphrase: _ignored, ...safeSettings } = settings;
  return safeSettings;
}

function shortFingerprint(value: string): string {
  return value.slice(0, 12);
}
