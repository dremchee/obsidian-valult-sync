import { beforeEach, describe, expect, it, vi } from "vitest";

import { TFile, notices } from "../../test/mocks/obsidian";

import { ApiError, type SyncApi } from "../api";
import { encryptBytes, serializeEnvelope } from "../e2ee/crypto";
import { SyncEngine } from "../sync/engine";
import type { SyncSettings, SyncState } from "../types";

const DEFAULT_SETTINGS: SyncSettings = {
  serverUrl: "http://127.0.0.1:3000",
  vaultId: "vault-a",
  includePatterns: [],
  ignorePatterns: [],
  deviceId: "device-local",
  authToken: "test-token",
  pollIntervalSecs: 2,
  autoSync: true,
};

describe("SyncEngine", () => {
  beforeEach(() => {
    notices.length = 0;
  });

  it("retries transient upload failures and persists updated state", async () => {
    const app = createMemoryApp({
      "notes/test.md": "hello",
    });
    let persistedState: SyncState | null = null;
    const retryDelays: number[] = [];
    const api = createApiStub({
      health: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn()
        .mockRejectedValueOnce(new ApiError("temporary failure", 500))
        .mockResolvedValue({ ok: true, version: 1 }),
      delete: vi.fn().mockResolvedValue({ ok: true, version: 1 }),
      getFile: vi.fn(),
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          {
            seq: 1,
            device_id: "device-local",
            path: "notes/test.md",
            version: 1,
            deleted: false,
          },
        ],
        latest_seq: 1,
      }),
    });

    const engine = new SyncEngine(
      app as never,
      () => DEFAULT_SETTINGS,
      () => "",
      async () => {},
      () => createState(),
      async (state) => {
        persistedState = state;
      },
      () => api,
      async (delayMs) => {
        retryDelays.push(delayMs);
      },
    );

    await engine.syncOnce();

    expect(api.upload).toHaveBeenCalledTimes(2);
    expect(api.getChanges).toHaveBeenCalledWith(DEFAULT_SETTINGS.vaultId, 0);
    expect(retryDelays).toEqual([500]);
    expect(persistedState).toMatchObject({
      lastSeq: 1,
      files: {
        "notes/test.md": {
          version: 1,
          deleted: false,
        },
      },
    });
  });

  it("creates a single conflict copy and applies the server version", async () => {
    const app = createMemoryApp({
      "notes/test.md": "local edit",
    });
    let persistedState: SyncState | null = null;
    const remoteContent = "server version";
    const remoteHash = await sha256Hex(toBytes(remoteContent));
    const api = createApiStub({
      health: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockResolvedValue({
        ok: false,
        conflict: true,
        server_version: 2,
      }),
      delete: vi.fn(),
      getFile: vi.fn().mockResolvedValue({
        path: "notes/test.md",
        hash: remoteHash,
        version: 2,
        deleted: false,
        content_b64: bytesToBase64(toBytes(remoteContent)),
        content_format: "plain",
      }),
      getChanges: vi.fn().mockResolvedValue({
        changes: [],
        latest_seq: 2,
      }),
    });

    const engine = new SyncEngine(
      app as never,
      () => DEFAULT_SETTINGS,
      () => "",
      async () => {},
      () => createState({
        files: {
          "notes/test.md": {
            hash: "stale-hash",
            version: 1,
            mtime: 1,
            deleted: false,
          },
        },
        lastSeq: 1,
      }),
      async (state) => {
        persistedState = state;
      },
      () => api,
      async () => {},
    );

    await engine.syncOnce();

    expect(app.readText("notes/test.md")).toBe(remoteContent);
    expect(app.readText("notes/test (conflict).md")).toBe("local edit");
    expect(app.listPaths().filter((path) => path.includes("(conflict)"))).toEqual([
      "notes/test (conflict).md",
    ]);
    expect(persistedState).toMatchObject({
      lastSeq: 2,
      files: {
        "notes/test.md": {
          hash: remoteHash,
          version: 2,
          deleted: false,
        },
      },
    });
  });

  it("does not re-create or re-notify an existing conflict copy after a failed sync", async () => {
    const app = createMemoryApp({
      "notes/test.md": "local edit",
    });
    const remoteContent = "server version";
    const remoteHash = await sha256Hex(toBytes(remoteContent));
    const api = createApiStub({
      health: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockResolvedValue({
        ok: false,
        conflict: true,
        server_version: 2,
      }),
      delete: vi.fn(),
      getFile: vi.fn().mockResolvedValue({
        path: "notes/test.md",
        hash: remoteHash,
        version: 2,
        deleted: false,
        content_b64: bytesToBase64(toBytes(remoteContent)),
        content_format: "plain",
      }),
      getChanges: vi.fn().mockResolvedValue({
        changes: [],
        latest_seq: 2,
      }),
    });

    const staleState = createState({
      files: {
        "notes/test.md": {
          hash: "stale-hash",
          version: 1,
          mtime: 1,
          deleted: false,
        },
      },
      lastSeq: 1,
    });

    const engine = new SyncEngine(
      app as never,
      () => DEFAULT_SETTINGS,
      () => "",
      async () => {},
      () => staleState,
      async () => {
        throw new Error("persist failed");
      },
      () => api,
      async () => {},
    );

    await expect(engine.syncOnce()).rejects.toThrow("persist failed");
    expect(app.listPaths().filter((path) => path.includes("(conflict)"))).toEqual([
      "notes/test (conflict).md",
    ]);
    expect(notices.filter((message) => message.includes("conflict"))).toHaveLength(0);

    await expect(engine.syncOnce()).rejects.toThrow("persist failed");
    expect(app.listPaths().filter((path) => path.includes("(conflict)"))).toEqual([
      "notes/test (conflict).md",
    ]);
    expect(notices.filter((message) => message.includes("conflict"))).toHaveLength(0);
  });

  it("resumes from persisted lastSeq after restart", async () => {
    const app = createMemoryApp({
      "notes/test.md": "hello",
    });
    let persistedState: SyncState = createState();

    const firstApi = createApiStub({
      health: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockResolvedValue({ ok: true, version: 1 }),
      delete: vi.fn(),
      getFile: vi.fn(),
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          {
            seq: 1,
            device_id: "device-local",
            path: "notes/test.md",
            version: 1,
            deleted: false,
          },
        ],
        latest_seq: 1,
      }),
    });

    const firstEngine = new SyncEngine(
      app as never,
      () => DEFAULT_SETTINGS,
      () => "",
      async () => {},
      () => persistedState,
      async (state) => {
        persistedState = state;
      },
      () => firstApi,
      async () => {},
    );

    await firstEngine.syncOnce();

    const secondApi = createApiStub({
      health: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn(),
      delete: vi.fn(),
      getFile: vi.fn(),
      getChanges: vi.fn().mockResolvedValue({
        changes: [],
        latest_seq: 1,
      }),
    });

    const secondEngine = new SyncEngine(
      app as never,
      () => DEFAULT_SETTINGS,
      () => "",
      async () => {},
      () => persistedState,
      async (state) => {
        persistedState = state;
      },
      () => secondApi,
      async () => {},
    );

    await secondEngine.syncOnce();

    expect(secondApi.upload).not.toHaveBeenCalled();
    expect(secondApi.delete).not.toHaveBeenCalled();
    expect(secondApi.getChanges).toHaveBeenCalledWith(DEFAULT_SETTINGS.vaultId, 1);
    expect(persistedState.lastSeq).toBe(1);
  });

  it("keeps a conflict copy when a remote tombstone deletes a locally modified file", async () => {
    const app = createMemoryApp({
      "notes/test.md": "local unsynced edit",
    });
    let persistedState: SyncState | null = null;
    const api = createApiStub({
      health: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockResolvedValue({
        ok: false,
        conflict: true,
        server_version: 2,
      }),
      delete: vi.fn(),
      getFile: vi.fn().mockResolvedValue({
        path: "notes/test.md",
        hash: "",
        version: 2,
        deleted: true,
        content_b64: null,
        content_format: "plain",
      }),
      getChanges: vi.fn().mockResolvedValue({
        changes: [],
        latest_seq: 2,
      }),
    });

    const engine = new SyncEngine(
      app as never,
      () => DEFAULT_SETTINGS,
      () => "",
      async () => {},
      () => createState({
        files: {
          "notes/test.md": {
            hash: "server-hash",
            version: 1,
            mtime: 1,
            deleted: false,
          },
        },
        lastSeq: 1,
      }),
      async (state) => {
        persistedState = state;
      },
      () => api,
      async () => {},
    );

    await engine.syncOnce();

    expect(app.listPaths()).toEqual(["notes/test (conflict).md"]);
    expect(app.readText("notes/test (conflict).md")).toBe("local unsynced edit");
    expect(notices).toEqual([]);
    expect(persistedState).toMatchObject({
      lastSeq: 2,
      files: {
        "notes/test.md": {
          hash: "",
          version: 2,
          deleted: true,
        },
      },
    });
  });

  it("skips ignored local files during upload and deletion detection", async () => {
    const app = createMemoryApp({
      "Templates/Meeting.md": "template",
      "notes/test.md": "sync me",
    });
    let persistedState: SyncState | null = null;
    const api = createApiStub({
      health: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockResolvedValue({ ok: true, version: 1 }),
      delete: vi.fn(),
      getFile: vi.fn(),
      getChanges: vi.fn().mockResolvedValue({
        changes: [],
        latest_seq: 0,
      }),
    });

    const engine = new SyncEngine(
      app as never,
      () => ({
        ...DEFAULT_SETTINGS,
        ignorePatterns: ["Templates/"],
      }),
      () => "",
      async () => {},
      () => createState({
        files: {
          "Templates/Old.md": {
            hash: "old-hash",
            version: 2,
            mtime: 1,
            deleted: false,
          },
        },
        lastSeq: 0,
      }),
      async (state) => {
        persistedState = state;
      },
      () => api,
      async () => {},
    );

    await engine.syncOnce();

    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(api.upload).toHaveBeenCalledWith(expect.objectContaining({
      path: "notes/test.md",
    }));
    expect(api.delete).not.toHaveBeenCalled();
    expect(persistedState).toMatchObject({
      files: {
        "Templates/Old.md": {
          version: 2,
          deleted: false,
        },
        "notes/test.md": {
          version: 1,
          deleted: false,
        },
      },
    });
  });

  it("skips ignored remote changes", async () => {
    const app = createMemoryApp({});
    let persistedState: SyncState = createState({
      lastSeq: 1,
    });
    const api = createApiStub({
      health: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn(),
      delete: vi.fn(),
      getFile: vi.fn(),
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          {
            seq: 2,
            device_id: "device-remote",
            path: "Templates/Meeting.md",
            version: 3,
            deleted: false,
          },
        ],
        latest_seq: 2,
      }),
    });

    const engine = new SyncEngine(
      app as never,
      () => ({
        ...DEFAULT_SETTINGS,
        ignorePatterns: ["Templates/"],
      }),
      () => "",
      async () => {},
      () => createState({
        lastSeq: 1,
      }),
      async (state) => {
        persistedState = state;
      },
      () => api,
      async () => {},
    );

    await engine.syncOnce();

    expect(api.getFile).not.toHaveBeenCalled();
    expect(app.listPaths()).toEqual([]);
    expect(persistedState.lastSeq).toBe(2);
  });

  it("uploads only paths allowed by include patterns", async () => {
    const app = createMemoryApp({
      "Notes/keep.md": "keep",
      "Templates/skip.md": "skip",
    });
    const api = createApiStub({
      health: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockResolvedValue({ ok: true, version: 1 }),
      delete: vi.fn(),
      getFile: vi.fn(),
      getChanges: vi.fn().mockResolvedValue({
        changes: [],
        latest_seq: 0,
      }),
    });

    const engine = new SyncEngine(
      app as never,
      () => ({
        ...DEFAULT_SETTINGS,
        includePatterns: ["Notes/"],
      }),
      () => "",
      async () => {},
      () => createState(),
      async () => {},
      () => api,
      async () => {},
    );

    await engine.syncOnce();

    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(api.upload).toHaveBeenCalledWith(expect.objectContaining({
      path: "Notes/keep.md",
    }));
  });

  it("encrypts uploads when E2EE passphrase is configured", async () => {
    const app = createMemoryApp({
      "Notes/secret.md": "secret body",
    });
    const api = createApiStub({
      health: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockResolvedValue({ ok: true, version: 1 }),
      delete: vi.fn(),
      getFile: vi.fn(),
      getChanges: vi.fn().mockResolvedValue({
        changes: [],
        latest_seq: 0,
      }),
    });

    const engine = new SyncEngine(
      app as never,
      () => DEFAULT_SETTINGS,
      () => "correct horse battery staple",
      async () => {},
      () => createState(),
      async () => {},
      () => api,
      async () => {},
    );

    await engine.syncOnce();

    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(api.upload).toHaveBeenCalledWith(expect.objectContaining({
      path: "Notes/secret.md",
      content_format: "e2ee-envelope-v1",
      payload_hash: expect.any(String),
    }));
    expect(api.upload).not.toHaveBeenCalledWith(expect.objectContaining({
      content_b64: bytesToBase64(toBytes("secret body")),
    }));
  });

  it("skips remote changes outside include patterns", async () => {
    const app = createMemoryApp({});
    let persistedState: SyncState = createState({
      lastSeq: 3,
    });
    const api = createApiStub({
      health: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn(),
      delete: vi.fn(),
      getFile: vi.fn(),
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          {
            seq: 4,
            device_id: "device-remote",
            path: "Templates/skip.md",
            version: 1,
            deleted: false,
          },
        ],
        latest_seq: 4,
      }),
    });

    const engine = new SyncEngine(
      app as never,
      () => ({
        ...DEFAULT_SETTINGS,
        includePatterns: ["Notes/"],
      }),
      () => "",
      async () => {},
      () => persistedState,
      async (state) => {
        persistedState = state;
      },
      () => api,
      async () => {},
    );

    await engine.syncOnce();

    expect(api.getFile).not.toHaveBeenCalled();
    expect(app.listPaths()).toEqual([]);
    expect(persistedState.lastSeq).toBe(4);
  });

  it("decrypts encrypted remote content before applying it locally", async () => {
    const plaintext = toBytes("decrypted secret");
    const envelope = await encryptBytes(plaintext, "correct horse battery staple");
    const app = createMemoryApp({});
    let persistedState: SyncState | null = null;
    const api = createApiStub({
      health: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn(),
      delete: vi.fn(),
      getFile: vi.fn().mockResolvedValue({
        path: "Notes/secret.md",
        hash: await sha256Hex(plaintext),
        version: 2,
        deleted: false,
        content_b64: bytesToBase64(serializeEnvelope(envelope)),
        content_format: "e2ee-envelope-v1",
      }),
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          {
            seq: 2,
            device_id: "device-remote",
            path: "Notes/secret.md",
            version: 2,
            deleted: false,
          },
        ],
        latest_seq: 2,
      }),
    });

    const engine = new SyncEngine(
      app as never,
      () => DEFAULT_SETTINGS,
      () => "correct horse battery staple",
      async () => {},
      () => createState({
        lastSeq: 1,
      }),
      async (state) => {
        persistedState = state;
      },
      () => api,
      async () => {},
    );

    await engine.syncOnce();

    expect(app.readText("Notes/secret.md")).toBe("decrypted secret");
    expect(persistedState).toMatchObject({
      lastSeq: 2,
      files: {
        "Notes/secret.md": {
          hash: await sha256Hex(plaintext),
          version: 2,
          deleted: false,
        },
      },
    });
  });

  it("fails clearly when encrypted remote content arrives without a session passphrase", async () => {
    const plaintext = toBytes("decrypted secret");
    const envelope = await encryptBytes(plaintext, "correct horse battery staple");
    const app = createMemoryApp({});
    const api = createApiStub({
      health: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn(),
      delete: vi.fn(),
      getFile: vi.fn().mockResolvedValue({
        path: "Notes/secret.md",
        hash: await sha256Hex(plaintext),
        version: 2,
        deleted: false,
        content_b64: bytesToBase64(serializeEnvelope(envelope)),
        content_format: "e2ee-envelope-v1",
      }),
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          {
            seq: 2,
            device_id: "device-remote",
            path: "Notes/secret.md",
            version: 2,
            deleted: false,
          },
        ],
        latest_seq: 2,
      }),
    });

    const engine = new SyncEngine(
      app as never,
      () => DEFAULT_SETTINGS,
      () => "",
      async () => {},
      () => createState({
        lastSeq: 1,
      }),
      async () => {},
      () => api,
      async () => {},
    );

    await expect(engine.syncOnce()).rejects.toThrow(
      "E2EE passphrase is required to decrypt synced content",
    );
  });
});

function createApiStub(overrides: Partial<SyncApi>): SyncApi {
  return {
    health: vi.fn(),
    upload: vi.fn(),
    delete: vi.fn(),
    getFile: vi.fn(),
    getChanges: vi.fn(),
    ...overrides,
  } as unknown as SyncApi;
}

function createState(overrides: Partial<SyncState> = {}): SyncState {
  return {
    vaultId: DEFAULT_SETTINGS.vaultId,
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
