import type { SyncApi } from "../api";
import type { LocalFileSnapshot, SyncSettings, SyncState } from "../types";
import type { LocalMutationExecutor } from "./local-mutation-executor";
import { buildLocalSyncPlan } from "./planner";
import type { RemoteChangeApplier } from "./remote-applier";

interface SyncRuntimeDeps {
  executeHealthCheck: (api: SyncApi) => Promise<void>;
  localExecutor: LocalMutationExecutor;
  remoteApplier: RemoteChangeApplier;
  saveState: (state: SyncState) => Promise<void>;
  scanVault: () => Promise<Map<string, LocalFileSnapshot>>;
  shouldSyncPath: (path: string) => boolean;
}

export interface SyncRunContext {
  api: SyncApi;
  settings: SyncSettings;
  state: SyncState;
  startupDeletionGuardActive: boolean;
}

export interface SyncRunResult {
  state: SyncState;
  startupDeletionGuardActive: boolean;
}

export class SyncRuntime {
  constructor(private readonly deps: SyncRuntimeDeps) {}

  async run(context: SyncRunContext): Promise<SyncRunResult> {
    const { api, settings, state } = context;

    await this.deps.executeHealthCheck(api);

    const localFiles = await this.deps.scanVault();
    const plan = buildLocalSyncPlan(
      state,
      localFiles,
      this.deps.shouldSyncPath,
    );

    await this.deps.localExecutor.executeRenames(api, settings, state, plan);
    await this.deps.localExecutor.executeUploads(api, settings, state, plan);
    if (!context.startupDeletionGuardActive) {
      await this.deps.localExecutor.executeDeletions(api, settings, state, plan);
    }

    await this.deps.remoteApplier.applyChangeFeed(api, state, {
      vaultId: settings.vaultId,
      currentDeviceId: settings.deviceId,
      shouldSyncPath: this.deps.shouldSyncPath,
    });
    state.lastSyncAt = Date.now();

    await this.deps.saveState(state);

    return {
      state,
      startupDeletionGuardActive: false,
    };
  }
}
