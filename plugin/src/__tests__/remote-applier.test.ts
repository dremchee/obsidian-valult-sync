import { describe, expect, it, vi } from "vitest";

import { TFile, notices } from "../../test/mocks/obsidian";

import type { SyncApi } from "../api";
import { groupChangesByMutation, RemoteChangeApplier } from "../sync/remote-applier";
import { ObsidianVaultIO } from "../sync/vault-io";
import type { SyncState } from "../types";

describe("RemoteChangeApplier", () => {
  it("groups change feed entries by device and version", () => {
    expect(groupChangesByMutation([
      { seq: 1, device_id: "a", path: "one", version: 1, deleted: false },
      { seq: 2, device_id: "a", path: "two", version: 1, deleted: true },
      { seq: 3, device_id: "a", path: "three", version: 2, deleted: false },
      { seq: 4, device_id: "b", path: "four", version: 2, deleted: false },
    ])).toEqual([
      [
        { seq: 1, device_id: "a", path: "one", version: 1, deleted: false },
        { seq: 2, device_id: "a", path: "two", version: 1, deleted: true },
      ],
      [
        { seq: 3, device_id: "a", path: "three", version: 2, deleted: false },
      ],
      [
        { seq: 4, device_id: "b", path: "four", version: 2, deleted: false },
      ],
    ]);
  });

  it("applies remote rename batches without leaving duplicate paths", async () => {
    notices.length = 0;
    const app = createMemoryApp({
      "notes/test.md": "hello",
    });
    const fileHash = await sha256Hex(toBytes("hello"));
    const state = createState({
      files: {
        "notes/test.md": {
          hash: fileHash,
          version: 1,
          mtime: 1,
          deleted: false,
        },
      },
      lastSeq: 1,
    });
    const api = createApiStub({
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          {
            seq: 2,
            device_id: "device-remote",
            path: "notes/test.md",
            version: 2,
            deleted: true,
          },
          {
            seq: 3,
            device_id: "device-remote",
            path: "notes/renamed.md",
            version: 2,
            deleted: false,
          },
        ],
        latest_seq: 3,
      }),
      getFile: vi.fn().mockResolvedValue({
        path: "notes/renamed.md",
        hash: fileHash,
        version: 2,
        deleted: false,
        content_b64: bytesToBase64(toBytes("hello")),
        content_format: "plain",
      }),
    });

    const applier = new RemoteChangeApplier({
      vaultIO: new ObsidianVaultIO(app as never),
      decodeRemoteContent: async (payload) => Buffer.from(payload, "base64"),
      notifyConflictCopy: vi.fn(),
      retry: async (operation) => operation(),
    });

    await applier.applyChangeFeed(api, state, {
      vaultId: "vault-a",
      currentDeviceId: "device-local",
      shouldSyncPath: () => true,
    });

    expect(app.listPaths()).toEqual(["notes/renamed.md"]);
    expect(app.readText("notes/renamed.md")).toBe("hello");
    expect(state).toMatchObject({
      lastSeq: 3,
      files: {
        "notes/test.md": {
          version: 2,
          deleted: true,
        },
        "notes/renamed.md": {
          version: 2,
          deleted: false,
        },
      },
    });
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

function createState(overrides: Partial<SyncState> = {}): SyncState {
  return {
    vaultId: "vault-a",
    files: {},
    lastSeq: 0,
    lastSyncAt: null,
    lastSyncError: null,
    ...overrides,
  };
}

function createMemoryApp(initialFiles: Record<string, string>) {
  const files = new Map<string, Uint8Array>();
  const mtimes = new Map<string, number>();
  const folders = new Set<string>();
  let tick = 0;

  for (const [path, content] of Object.entries(initialFiles)) {
    write(path, toBytes(content));
    collectFolders(path);
  }

  const vault = {
    getFiles(): TFile[] {
      return Array.from(files.keys()).map((path) => new TFile(path));
    },
    getAbstractFileByPath(path: string): TFile | { path: string } | null {
      if (files.has(path)) {
        return new TFile(path);
      }
      if (folders.has(path)) {
        return { path };
      }
      return null;
    },
    async readBinary(file: TFile): Promise<ArrayBuffer> {
      return toArrayBuffer(read(file.path));
    },
    async modifyBinary(file: TFile, data: ArrayBuffer): Promise<void> {
      write(file.path, new Uint8Array(data));
    },
    async createBinary(path: string, data: ArrayBuffer): Promise<void> {
      if (files.has(path)) {
        throw new Error(`file already exists: ${path}`);
      }
      collectFolders(path);
      write(path, new Uint8Array(data));
    },
    async createFolder(path: string): Promise<void> {
      folders.add(path);
    },
    adapter: {
      async stat(path: string): Promise<{ mtime: number } | null> {
        if (!files.has(path)) {
          return null;
        }
        return { mtime: mtimes.get(path) ?? 0 };
      },
    },
  };

  const fileManager = {
    async trashFile(file: TFile): Promise<void> {
      files.delete(file.path);
      mtimes.delete(file.path);
    },
  };

  return {
    vault,
    fileManager,
    readText(path: string): string {
      return new TextDecoder().decode(read(path));
    },
    listPaths(): string[] {
      return Array.from(files.keys()).sort();
    },
  };

  function collectFolders(path: string): void {
    const segments = path.split("/");
    segments.pop();
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      folders.add(current);
    }
  }

  function read(path: string): Uint8Array {
    const value = files.get(path);
    if (!value) {
      throw new Error(`missing file: ${path}`);
    }
    return value;
  }

  function write(path: string, data: Uint8Array): void {
    tick += 1;
    files.set(path, new Uint8Array(data));
    mtimes.set(path, tick);
  }
}

function toBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}
