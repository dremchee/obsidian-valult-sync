import { Notice } from "obsidian";

import { RealtimeSyncClient } from "./realtime";
import { toSyncErrorState } from "./errors";
import type { SyncSettings, SyncState } from "../types";

export class SyncCoordinator {
  private intervalId: number | null = null;
  private dirty = false;
  private dirtyVersion = 0;
  private syncing = false;
  private readonly realtime: RealtimeSyncClient;

  constructor(
    private readonly getSettings: () => SyncSettings,
    private readonly getState: () => SyncState,
    private readonly setState: (state: SyncState) => Promise<void>,
    private readonly syncOnce: () => Promise<void>,
  ) {
    this.realtime = new RealtimeSyncClient(
      this.getSettings,
      this.getState,
      async () => {
        this.markDirty();
        await this.runBackgroundSync();
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
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (!this.getSettings().autoSync || !this.getSettings().vaultId.trim()) {
      this.realtime.stop();
      return;
    }

    const intervalMs = Math.max(this.getSettings().pollIntervalSecs, 1) * 1000;
    this.realtime.restart();
    this.intervalId = window.setInterval(async () => {
      if (!this.dirty && this.getState().lastSeq > 0) {
        await this.runBackgroundSync();
        return;
      }

      await this.runBackgroundSync();
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.realtime.stop();
  }

  async runManualSync(): Promise<void> {
    if (!this.getSettings().vaultId.trim()) {
      new Notice("Connect this folder to a vault first", 4000);
      return;
    }

    if (this.syncing) {
      new Notice("Sync already running", 3000);
      return;
    }

    const startedDirtyVersion = this.dirtyVersion;
    this.syncing = true;
    try {
      await this.syncOnce();
      this.clearDirtyIfUnchanged(startedDirtyVersion);
      await this.setLastSyncError(null);
      new Notice("Sync completed", 3000);
    } catch (error) {
      await this.setLastSyncError(toSyncErrorState(error));
    } finally {
      this.syncing = false;
    }
  }

  async runBackgroundSync(): Promise<void> {
    if (!this.getSettings().vaultId.trim()) {
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
      await this.setLastSyncError(toSyncErrorState(error));
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
}
