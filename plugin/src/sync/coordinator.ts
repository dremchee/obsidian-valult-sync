import { Notice } from "obsidian";

import { t } from "../i18n";
import { RealtimeSyncClient } from "./realtime";
import { formatSyncErrorState, toSyncErrorState } from "./errors";
import type { SyncSettings, SyncState } from "../types";

type RealtimeSyncFactory = (
  getSettings: () => SyncSettings,
  getState: () => SyncState,
  onRemoteChange: () => Promise<void>,
  onUnauthorized: () => void,
) => RealtimeSyncClient;

export class SyncCoordinator {
  private intervalId: ReturnType<typeof globalThis.setInterval> | null = null;
  private dirty = false;
  private dirtyVersion = 0;
  private syncing = false;
  private stoppedByUnauthorized = false;
  private readonly realtime: RealtimeSyncClient;

  constructor(
    private readonly getSettings: () => SyncSettings,
    private readonly getState: () => SyncState,
    private readonly setState: (state: SyncState) => Promise<void>,
    private readonly syncOnce: () => Promise<void>,
    realtimeFactory: RealtimeSyncFactory = (
      getSettings,
      getState,
      onRemoteChange,
      onUnauthorized,
    ) => new RealtimeSyncClient(getSettings, getState, { onRemoteChange, onUnauthorized }),
  ) {
    this.realtime = realtimeFactory(
      this.getSettings,
      this.getState,
      async () => {
        this.markDirty();
        await this.runBackgroundSync();
      },
      () => {
        this.stopBackgroundSyncUntilRestart();
      },
    );
  }

  markDirty(): void {
    this.dirty = true;
    this.dirtyVersion += 1;
  }

  isSyncing(): boolean {
    return this.syncing;
  }

  hasPendingWork(): boolean {
    return this.dirty;
  }

  restartAutoSync(): void {
    this.stoppedByUnauthorized = false;
    this.stopPolling();

    if (
      !this.getSettings().autoSync
      || !this.getSettings().vaultId.trim()
      || !this.getSettings().authToken.trim()
    ) {
      this.realtime.stop();
      return;
    }

    const intervalMs = Math.max(this.getSettings().pollIntervalSecs, 1) * 1000;
    this.realtime.restart();
    this.intervalId = globalThis.setInterval(async () => {
      if (!this.dirty && this.getState().lastSeq > 0) {
        await this.runBackgroundSync();
        return;
      }

      await this.runBackgroundSync();
    }, intervalMs);
  }

  stop(): void {
    this.stopPolling();
    this.realtime.stop();
  }

  async runManualSync(): Promise<void> {
    if (!this.getSettings().vaultId.trim()) {
      new Notice(t("notices.connectVaultFirst"), 4000);
      return;
    }

    if (this.syncing) {
      new Notice(t("notices.syncAlreadyRunning"), 3000);
      return;
    }

    const startedDirtyVersion = this.dirtyVersion;
    this.syncing = true;
    try {
      await this.syncOnce();
      this.clearDirtyIfUnchanged(startedDirtyVersion);
      await this.setLastSyncError(null);
      new Notice(t("notices.syncCompleted"), 3000);
    } catch (error) {
      const syncError = toSyncErrorState(error);
      if (syncError.code === "unauthorized") {
        this.stopBackgroundSyncUntilRestart();
      }
      await this.setLastSyncError(syncError);
      new Notice(formatSyncErrorState(syncError), 5000);
    } finally {
      this.syncing = false;
    }
  }

  async runBackgroundSync(): Promise<void> {
    if (!this.getSettings().vaultId.trim() || this.stoppedByUnauthorized) {
      return;
    }

    if (this.syncing) {
      this.dirty = true;
      this.dirtyVersion += 1;
      return;
    }

    const startedDirtyVersion = this.dirtyVersion;
    this.syncing = true;
    try {
      await this.syncOnce();
      this.clearDirtyIfUnchanged(startedDirtyVersion);
      await this.setLastSyncError(null);
    } catch (error) {
      const syncError = toSyncErrorState(error);
      if (syncError.code === "unauthorized") {
        this.stopBackgroundSyncUntilRestart();
      }
      await this.setLastSyncError(syncError);
    } finally {
      this.syncing = false;
    }
  }

  private async setLastSyncError(nextError: SyncState["lastSyncError"]): Promise<void> {
    const state = structuredClone(this.getState());
    state.lastSyncError = nextError;
    await this.setState(state);
  }

  private clearDirtyIfUnchanged(startedDirtyVersion: number): void {
    if (this.dirtyVersion === startedDirtyVersion) {
      this.dirty = false;
    }
  }

  private stopBackgroundSyncUntilRestart(): void {
    this.stoppedByUnauthorized = true;
    this.stopPolling();
    this.realtime.stop();
  }

  private stopPolling(): void {
    if (this.intervalId !== null) {
      globalThis.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
