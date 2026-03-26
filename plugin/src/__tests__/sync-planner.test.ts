import { describe, expect, it } from "vitest";

import { buildLocalSyncPlan } from "../sync/planner";
import type { LocalFileSnapshot, SyncState } from "../types";

describe("local sync planner", () => {
  it("emits explicit rename, upload, delete, and skip operations", () => {
    const renamedFile = createLocalSnapshot("notes/renamed.md", "same-hash");
    const newFile = createLocalSnapshot("notes/new.md", "new-hash");
    const unchangedFile = createLocalSnapshot("notes/unchanged.md", "kept-hash");
    const localFiles = new Map([
      [renamedFile.path, renamedFile],
      [newFile.path, newFile],
      [unchangedFile.path, unchangedFile],
    ]);

    const plan = buildLocalSyncPlan({
      vaultId: "vault-a",
      files: {
        "notes/old.md": {
          hash: "same-hash",
          version: 1,
          mtime: 1,
          deleted: false,
        },
        "notes/removed.md": {
          hash: "removed-hash",
          version: 2,
          mtime: 1,
          deleted: false,
        },
        "notes/unchanged.md": {
          hash: "kept-hash",
          version: 3,
          mtime: 1,
          deleted: false,
        },
      },
      lastSeq: 0,
      lastSyncAt: null,
      lastSyncError: null,
    }, localFiles, () => true);

    expect(plan.operations).toEqual([
      {
        kind: "rename",
        candidate: {
          fromPath: "notes/old.md",
          fromState: {
            hash: "same-hash",
            version: 1,
            mtime: 1,
            deleted: false,
          },
          toFile: renamedFile,
        },
      },
      {
        kind: "skip",
        path: "notes/renamed.md",
        reason: "covered-by-rename",
      },
      {
        kind: "upload",
        localFile: newFile,
        current: undefined,
      },
      {
        kind: "skip",
        path: "notes/unchanged.md",
        reason: "unchanged",
      },
      {
        kind: "skip",
        path: "notes/old.md",
        reason: "covered-by-rename",
      },
      {
        kind: "delete",
        path: "notes/removed.md",
        fileState: {
          hash: "removed-hash",
          version: 2,
          mtime: 1,
          deleted: false,
        },
      },
    ]);
  });

  it("does not infer rename when hash matches are ambiguous", () => {
    const localFiles = new Map([
      ["notes/a-renamed.md", createLocalSnapshot("notes/a-renamed.md", "same-hash")],
      ["notes/b-renamed.md", createLocalSnapshot("notes/b-renamed.md", "same-hash")],
    ]);

    const plan = buildLocalSyncPlan(createState({
      "notes/a.md": {
        hash: "same-hash",
        version: 1,
        mtime: 1,
        deleted: false,
      },
      "notes/b.md": {
        hash: "same-hash",
        version: 2,
        mtime: 1,
        deleted: false,
      },
    }), localFiles, () => true);

    expect(plan.operations.filter((operation) => operation.kind === "rename")).toEqual([]);
    expect(plan.operations.filter((operation) => operation.kind === "upload")).toHaveLength(2);
    expect(plan.operations.filter((operation) => operation.kind === "delete")).toHaveLength(2);
  });
});

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
