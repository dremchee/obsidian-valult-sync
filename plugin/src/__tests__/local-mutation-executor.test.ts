import { describe, expect, it, vi } from "vitest";

import type { SyncApi } from "../api";
import { LocalMutationExecutor } from "../sync/local-mutation-executor";
import type { LocalSyncPlan } from "../sync/planner";
import type { LocalFileSnapshot, SyncSettings, SyncState } from "../types";

const DEFAULT_SETTINGS: Pick<SyncSettings, "vaultId" | "deviceId"> = {
  vaultId: "vault-a",
  deviceId: "device-local",
};

describe("LocalMutationExecutor", () => {
  it("executes rename, upload, and delete operations against the api", async () => {
    const localFile = createLocalSnapshot("notes/test.md", "new-hash");
    const state = createState({
      "notes/old.md": {
        hash: "new-hash",
        version: 1,
        mtime: 1,
        deleted: false,
      },
      "notes/delete.md": {
        hash: "delete-hash",
        version: 2,
        mtime: 1,
        deleted: false,
      },
    });
    const api = createApiStub({
      rename: vi.fn().mockResolvedValue({ ok: true, version: 3 }),
      upload: vi.fn().mockResolvedValue({ ok: true, version: 4 }),
      delete: vi.fn().mockResolvedValue({ ok: true, version: 5 }),
    });
    const executor = new LocalMutationExecutor({
      buildUploadPayload: vi.fn().mockResolvedValue({
        contentBase64: "Zm9v",
        payloadHash: "payload-hash",
        contentFormat: "plain",
      }),
      onDeleteConflict: vi.fn(),
      onUploadConflict: vi.fn(),
      retry: async (operation) => operation(),
    });
    const plan: LocalSyncPlan = {
      operations: [
        {
          kind: "rename",
          candidate: {
            fromPath: "notes/old.md",
            fromState: state.files["notes/old.md"],
            toFile: createLocalSnapshot("notes/renamed.md", "new-hash"),
          },
        },
        {
          kind: "upload",
          localFile,
          current: undefined,
        },
        {
          kind: "delete",
          path: "notes/delete.md",
          fileState: state.files["notes/delete.md"],
        },
      ],
    };

    await executor.executeRenames(api, DEFAULT_SETTINGS, state, plan);
    await executor.executeUploads(api, DEFAULT_SETTINGS, state, plan);
    await executor.executeDeletions(api, DEFAULT_SETTINGS, state, plan);

    expect(api.rename).toHaveBeenCalledWith(expect.objectContaining({
      from_path: "notes/old.md",
      to_path: "notes/renamed.md",
      base_version: 1,
    }));
    expect(api.upload).toHaveBeenCalledWith(expect.objectContaining({
      path: "notes/test.md",
      base_version: 0,
    }));
    expect(api.delete).toHaveBeenCalledWith(expect.objectContaining({
      path: "notes/delete.md",
      base_version: 2,
    }));
    expect(state.files["notes/old.md"]).toMatchObject({ version: 3, deleted: true });
    expect(state.files["notes/renamed.md"]).toMatchObject({ version: 3, deleted: false });
    expect(state.files["notes/test.md"]).toMatchObject({ version: 4, deleted: false });
    expect(state.files["notes/delete.md"]).toMatchObject({ version: 5, deleted: true });
  });

  it("delegates upload and delete conflicts to callbacks", async () => {
    const uploadConflict = vi.fn().mockResolvedValue(undefined);
    const deleteConflict = vi.fn().mockResolvedValue(undefined);
    const api = createApiStub({
      upload: vi.fn().mockResolvedValue({ ok: false, conflict: true }),
      delete: vi.fn().mockResolvedValue({ ok: false, conflict: true }),
    });
    const executor = new LocalMutationExecutor({
      buildUploadPayload: vi.fn().mockResolvedValue({
        contentBase64: "Zm9v",
        payloadHash: "payload-hash",
        contentFormat: "plain",
      }),
      onDeleteConflict: deleteConflict,
      onUploadConflict: uploadConflict,
      retry: async (operation) => operation(),
    });
    const state = createState({
      "notes/delete.md": {
        hash: "delete-hash",
        version: 2,
        mtime: 1,
        deleted: false,
      },
    });
    const uploadFile = createLocalSnapshot("notes/upload.md", "upload-hash");
    const plan: LocalSyncPlan = {
      operations: [
        {
          kind: "upload",
          localFile: uploadFile,
          current: undefined,
        },
        {
          kind: "delete",
          path: "notes/delete.md",
          fileState: state.files["notes/delete.md"],
        },
      ],
    };

    await executor.executeUploads(api, DEFAULT_SETTINGS, state, plan);
    await executor.executeDeletions(api, DEFAULT_SETTINGS, state, plan);

    expect(uploadConflict).toHaveBeenCalledWith(api, state, uploadFile);
    expect(deleteConflict).toHaveBeenCalledWith(api, state, "notes/delete.md");
  });
});

function createApiStub(overrides: Partial<SyncApi>): SyncApi {
  return {
    health: vi.fn(),
    upload: vi.fn(),
    delete: vi.fn(),
    rename: vi.fn(),
    getFile: vi.fn(),
    getChanges: vi.fn(),
    ...overrides,
  } as unknown as SyncApi;
}

function createState(files: SyncState["files"]): SyncState {
  return {
    vaultId: "vault-a",
    files,
    lastSeq: 0,
    lastSyncAt: null,
    lastSyncError: null,
  };
}

function createLocalSnapshot(path: string, hash: string): LocalFileSnapshot {
  return {
    path,
    hash,
    mtime: 10,
    data: new Uint8Array([1, 2, 3]),
  };
}
