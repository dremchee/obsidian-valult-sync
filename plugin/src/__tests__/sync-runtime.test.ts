import { describe, expect, it, vi } from "vitest";

import type { SyncApi } from "../api";
import { LocalMutationExecutor } from "../sync/local-mutation-executor";
import { RemoteChangeApplier } from "../sync/remote-applier";
import { SyncRuntime } from "../sync/sync-runtime";
import type { LocalFileSnapshot, SyncSettings, SyncState } from "../types";

const SETTINGS: SyncSettings = {
  serverUrl: "http://127.0.0.1:3000",
  vaultId: "vault-a",
  includePatterns: [],
  ignorePatterns: [],
  deviceId: "device-local",
  authToken: "token",
  pollIntervalSecs: 2,
  autoSync: true,
};

describe("SyncRuntime", () => {
  it("runs health, local stages, remote apply, and persistence", async () => {
    const calls: string[] = [];
    const state = createState();
    const localExecutor = createLocalExecutorStub(calls);
    const remoteApplier = createRemoteApplierStub(calls);
    const runtime = new SyncRuntime({
      executeHealthCheck: async () => {
        calls.push("health");
      },
      localExecutor,
      remoteApplier,
      saveState: async () => {
        calls.push("save");
      },
      scanVault: async () => {
        calls.push("scan");
        return new Map<string, LocalFileSnapshot>();
      },
      shouldSyncPath: () => true,
    });

    const result = await runtime.run({
      api: {} as SyncApi,
      settings: SETTINGS,
      state,
      startupDeletionGuardActive: false,
    });

    expect(calls).toEqual([
      "health",
      "scan",
      "rename",
      "upload",
      "delete",
      "remote",
      "save",
    ]);
    expect(result.startupDeletionGuardActive).toBe(false);
    expect(result.state.lastSyncAt).toEqual(expect.any(Number));
  });

  it("skips deletion stage while startup guard is active", async () => {
    const calls: string[] = [];
    const runtime = new SyncRuntime({
      executeHealthCheck: async () => {
        calls.push("health");
      },
      localExecutor: createLocalExecutorStub(calls),
      remoteApplier: createRemoteApplierStub(calls),
      saveState: async () => {
        calls.push("save");
      },
      scanVault: async () => new Map<string, LocalFileSnapshot>(),
      shouldSyncPath: () => true,
    });

    const result = await runtime.run({
      api: {} as SyncApi,
      settings: SETTINGS,
      state: createState(),
      startupDeletionGuardActive: true,
    });

    expect(calls).not.toContain("delete");
    expect(result.startupDeletionGuardActive).toBe(false);
  });
});

function createLocalExecutorStub(calls: string[]): LocalMutationExecutor {
  return {
    executeRenames: vi.fn(async () => {
      calls.push("rename");
    }),
    executeUploads: vi.fn(async () => {
      calls.push("upload");
    }),
    executeDeletions: vi.fn(async () => {
      calls.push("delete");
    }),
  } as unknown as LocalMutationExecutor;
}

function createRemoteApplierStub(calls: string[]): RemoteChangeApplier {
  return {
    applyChangeFeed: vi.fn(async () => {
      calls.push("remote");
    }),
  } as unknown as RemoteChangeApplier;
}

function createState(): SyncState {
  return {
    vaultId: SETTINGS.vaultId,
    files: {},
    lastSeq: 0,
    lastSyncAt: null,
    lastSyncError: null,
  };
}
