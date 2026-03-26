import { describe, expect, it } from "vitest";

import {
  applyDeletedFile,
  applyRemoteFile,
  applyUploadedFile,
  buildConflictPath,
  createDeleteRequest,
  createUploadRequest,
  decideRemoteChange,
  shouldCreateConflictCopy,
  shouldUploadLocalChange,
  shouldUploadLocalDeletion,
} from "../sync/flow";
import type { ChangeItem, FileState, LocalFileSnapshot, SyncSettings, SyncState } from "../types";

const DEFAULT_SETTINGS: SyncSettings = {
  serverUrl: "http://127.0.0.1:3000",
  vaultId: "vault-a",
  includePatterns: [],
  ignorePatterns: [],
  deviceId: "device-local",
  authToken: "token",
  pollIntervalSecs: 2,
  autoSync: true,
};

describe("sync flow helpers", () => {
  it("builds upload and delete requests from state inputs", () => {
    const local = createLocalSnapshot();
    const current: FileState = {
      hash: "old-hash",
      version: 3,
      mtime: 1,
      deleted: false,
    };

    expect(createUploadRequest(
      DEFAULT_SETTINGS,
      local,
      current,
      {
        contentBase64: "Zm9v",
        payloadHash: "payload-hash",
        contentFormat: "plain",
      },
    )).toMatchObject({
      vault_id: "vault-a",
      device_id: "device-local",
      path: "notes/test.md",
      base_version: 3,
      content_format: "plain",
    });

    expect(createDeleteRequest(DEFAULT_SETTINGS, local.path, current)).toMatchObject({
      vault_id: "vault-a",
      device_id: "device-local",
      path: "notes/test.md",
      base_version: 3,
    });
  });

  it("decides upload/delete/conflict prerequisites from pure state", () => {
    const local = createLocalSnapshot();
    const current: FileState = {
      hash: "same-hash",
      version: 3,
      mtime: 1,
      deleted: false,
    };
    const remoteChange: ChangeItem = {
      seq: 10,
      device_id: "device-remote",
      path: local.path,
      version: 4,
      deleted: false,
    };

    expect(shouldUploadLocalChange(current, { hash: "same-hash" })).toBe(false);
    expect(shouldUploadLocalChange(current, local)).toBe(true);
    expect(shouldUploadLocalDeletion(local.path, current, new Map(), () => true)).toBe(true);
    expect(
      decideRemoteChange(remoteChange, "device-local", current, () => true),
    ).toBe("apply-file");
    expect(
      decideRemoteChange(
        { ...remoteChange, device_id: "device-local" },
        "device-local",
        current,
        () => true,
      ),
    ).toBe("skip-own-change");
    expect(shouldCreateConflictCopy(false, current, "different-hash")).toBe(true);
    expect(shouldCreateConflictCopy(true, current, "different-hash")).toBe(false);
  });

  it("applies state transitions and conflict path generation", () => {
    const state: SyncState = {
      vaultId: "vault-a",
      files: {},
      lastSeq: 0,
      lastSyncAt: null,
      lastSyncError: null,
    };
    const local = createLocalSnapshot();

    applyUploadedFile(state, local, 7);
    expect(state.files[local.path]).toMatchObject({
      hash: local.hash,
      version: 7,
      deleted: false,
    });

    applyRemoteFile(state, local.path, "remote-hash", 8, 123);
    expect(state.files[local.path]).toMatchObject({
      hash: "remote-hash",
      version: 8,
      mtime: 123,
      deleted: false,
    });

    applyDeletedFile(state, local.path, 9);
    expect(state.files[local.path]).toMatchObject({
      hash: "",
      version: 9,
      deleted: true,
    });

    expect(buildConflictPath("notes/test.md")).toBe("notes/test (conflict).md");
    expect(buildConflictPath("notes/test")).toBe("notes/test (conflict)");
  });
});

function createLocalSnapshot(): LocalFileSnapshot {
  return {
    path: "notes/test.md",
    hash: "new-hash",
    mtime: 10,
    data: new Uint8Array([1, 2, 3]),
  };
}
