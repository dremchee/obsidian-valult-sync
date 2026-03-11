import { Notice } from "obsidian";

import { toSyncErrorState } from "./errors";
import type { SyncSettings, SyncState } from "../types";

export class SyncCoordinator {
  private intervalId: number | null = null;
  private dirty = false;
  private syncing = false;

  constructor(
    private readonly getSettings: () => SyncSettings,
    private readonly getState: () => SyncState,
    private readonly setState: (state: SyncState) => Promise<void>,
    private readonly syncOnce: () => Promise<void>,
  ) {}

  markDirty(): void {
    this.dirty = true;
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

    if (!this.getSettings().autoSync) {
      return;
    }

    const intervalMs = Math.max(this.getSettings().pollIntervalSecs, 1) * 1000;
    this.intervalId = window.setInterval(async () => {
      if (!this.dirty && this.getState().lastSeq > 0) {
        await this.runBackgroundSync();
        return;
      }

      this.dirty = false;
      await this.runBackgroundSync();
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async runManualSync(): Promise<void> {
    this.syncing = true;
    try {
      await this.syncOnce();
      this.dirty = false;
      await this.setLastSyncError(null);
      new Notice("Sync completed", 3000);
    } catch (error) {
      await this.setLastSyncError(toSyncErrorState(error));
    } finally {
      this.syncing = false;
    }
  }

  async runBackgroundSync(): Promise<void> {
    this.syncing = true;
    try {
      await this.syncOnce();
      this.dirty = false;
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
}
