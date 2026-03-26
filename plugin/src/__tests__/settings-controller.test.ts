import { describe, expect, it, vi } from "vitest";

import { E2eeState } from "../e2ee/state";
import { encryptBytes, serializeEnvelope } from "../e2ee/crypto";
import { SettingsController } from "../settings/controller";
import { PluginStateStore } from "../state/store";
import { bytesToBase64 } from "../sync/payload-codec";
import type { FileResponse, SyncSettings, SyncState, VaultSnapshotResponse } from "../types";

const DEFAULT_SETTINGS: SyncSettings = {
  serverUrl: "http://127.0.0.1:3000",
  vaultId: "",
  includePatterns: [],
  ignorePatterns: [],
  deviceId: "device-local",
  authToken: "secret-token",
  pollIntervalSecs: 2,
  autoSync: true,
};

const DEFAULT_STATE: SyncState = {
  vaultId: "",
  files: {},
  lastSeq: 0,
  lastSyncAt: null,
  lastSyncError: null,
};

describe("SettingsController", () => {
  it("creates a plain vault when passphrase is empty", async () => {
    const createVault = vi.fn().mockResolvedValue({
      ok: true,
      created: true,
      vault: {
        vault_id: "vault-a",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        device_count: 1,
        e2ee_fingerprint: null,
      },
    });
    const controller = createController(() => ({
      health: vi.fn(),
      upload: vi.fn(),
      delete: vi.fn(),
      getHistory: vi.fn(),
      getDevices: vi.fn(),
      getVaults: vi.fn(),
      createVault,
      restoreFile: vi.fn(),
      getChanges: vi.fn(),
      getFile: vi.fn(),
    }));

    await controller.createVault("vault-a", "");

    expect(createVault).toHaveBeenCalledWith("vault-a", null);
  });

  it("rejects join when encrypted vault content cannot be decrypted with the supplied passphrase", async () => {
    const encryptedFile = await createEncryptedFileResponse("vault-a", "notes/test.md", "correct horse");
    const controller = createController(() => ({
      health: vi.fn(),
      upload: vi.fn(),
      delete: vi.fn(),
      getHistory: vi.fn(),
      getDevices: vi.fn(),
      getVaults: vi.fn(),
      createVault: vi.fn(),
      restoreFile: vi.fn(),
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          {
            seq: 1,
            device_id: "device-remote",
            path: encryptedFile.path,
            version: encryptedFile.version,
            deleted: false,
          },
        ],
        latest_seq: 1,
      }),
      getFile: vi.fn().mockResolvedValue(encryptedFile),
    }));

    await expect(
      controller.validateVaultJoinPassphrase("vault-a", "wrong passphrase"),
    ).rejects.toMatchObject({
      code: "decrypt_failed",
    });
  });

  it("allows join when encrypted vault content matches the supplied passphrase", async () => {
    const encryptedFile = await createEncryptedFileResponse("vault-a", "notes/test.md", "correct horse");
    const controller = createController(() => ({
      health: vi.fn(),
      upload: vi.fn(),
      delete: vi.fn(),
      getHistory: vi.fn(),
      getDevices: vi.fn(),
      getVaults: vi.fn(),
      createVault: vi.fn(),
      restoreFile: vi.fn(),
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          {
            seq: 1,
            device_id: "device-remote",
            path: encryptedFile.path,
            version: encryptedFile.version,
            deleted: false,
          },
        ],
        latest_seq: 1,
      }),
      getFile: vi.fn().mockResolvedValue(encryptedFile),
    }));

    await expect(
      controller.validateVaultJoinPassphrase("vault-a", "correct horse"),
    ).resolves.toBeUndefined();
  });

  it("rejects join when the latest live file is plain but an older encrypted file exists", async () => {
    const encryptedFile = await createEncryptedFileResponse("vault-a", "notes/encrypted.md", "correct horse");
    const controller = createController(() => ({
      health: vi.fn(),
      upload: vi.fn(),
      delete: vi.fn(),
      getHistory: vi.fn(),
      getDevices: vi.fn(),
      getVaults: vi.fn(),
      createVault: vi.fn(),
      restoreFile: vi.fn(),
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          {
            seq: 1,
            device_id: "device-remote",
            path: encryptedFile.path,
            version: encryptedFile.version,
            deleted: false,
          },
          {
            seq: 2,
            device_id: "device-remote",
            path: "notes/plain.md",
            version: 2,
            deleted: false,
          },
        ],
        latest_seq: 2,
      }),
      getFile: vi.fn().mockImplementation((vaultId: string, path: string) => {
        if (path === "notes/plain.md") {
          return Promise.resolve({
            path,
            hash: `${vaultId}-plain-hash`,
            version: 2,
            deleted: false,
            content_b64: bytesToBase64(new TextEncoder().encode("plain content")),
            content_format: "plain",
          });
        }

        return Promise.resolve(encryptedFile);
      }),
    }));

    await expect(
      controller.validateVaultJoinPassphrase("vault-a", "wrong passphrase"),
    ).rejects.toMatchObject({
      code: "decrypt_failed",
    });
  });

  it("allows join when the vault has no encrypted content to validate against", async () => {
    const controller = createController(() => ({
      health: vi.fn(),
      upload: vi.fn(),
      delete: vi.fn(),
      getHistory: vi.fn(),
      getDevices: vi.fn(),
      getVaults: vi.fn(),
      createVault: vi.fn(),
      restoreFile: vi.fn(),
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          {
            seq: 1,
            device_id: "device-remote",
            path: "notes/plain.md",
            version: 1,
            deleted: false,
          },
        ],
        latest_seq: 1,
      }),
      getFile: vi.fn().mockResolvedValue({
        path: "notes/plain.md",
        hash: "vault-a-plain-hash",
        version: 1,
        deleted: false,
        content_b64: bytesToBase64(new TextEncoder().encode("plain content")),
        content_format: "plain",
      }),
    }));

    await expect(
      controller.validateVaultJoinPassphrase("vault-a", ""),
    ).resolves.toBeUndefined();
  });

  it("requires passphrase only when encrypted remote content exists", async () => {
    const encryptedFile = await createEncryptedFileResponse("vault-a", "notes/test.md", "correct horse");
    const controller = createController(() => ({
      health: vi.fn(),
      upload: vi.fn(),
      delete: vi.fn(),
      getHistory: vi.fn(),
      getDevices: vi.fn(),
      getVaults: vi.fn(),
      createVault: vi.fn(),
      restoreFile: vi.fn(),
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          {
            seq: 1,
            device_id: "device-remote",
            path: encryptedFile.path,
            version: encryptedFile.version,
            deleted: false,
          },
        ],
        latest_seq: 1,
      }),
      getFile: vi.fn().mockResolvedValue(encryptedFile),
    }));

    await expect(
      controller.validateVaultJoinPassphrase("vault-a", ""),
    ).rejects.toMatchObject({
      code: "missing_passphrase",
    });
  });

  it("bootstraps joined vault state with hash-matched local files", async () => {
    let settings = { ...DEFAULT_SETTINGS, vaultId: "vault-a" };
    let state = { ...DEFAULT_STATE, vaultId: "vault-a" };
    const persistData = vi.fn().mockResolvedValue(undefined);
    const getSnapshot = vi.fn().mockResolvedValue({
      latest_seq: 5,
      files: [
        {
          path: "notes/matched.md",
          hash: "hash-a",
          version: 3,
          deleted: false,
          content_format: "plain",
        },
        {
          path: "notes/changed.md",
          hash: "remote-hash",
          version: 4,
          deleted: false,
          content_format: "plain",
        },
        {
          path: "notes/deleted.md",
          hash: "",
          version: 2,
          deleted: true,
          content_format: "plain",
        },
      ],
    } satisfies VaultSnapshotResponse);

    const controller = new SettingsController(
      () => settings,
      (nextSettings) => {
        settings = nextSettings;
      },
      () => state,
      (nextState) => {
        state = nextState;
      },
      persistData,
      new PluginStateStore(),
      new E2eeState(),
      {
        markDirty: vi.fn(),
        restartAutoSync: vi.fn(),
        pauseAutoSync: vi.fn(),
        runManualSync: vi.fn(),
        hasPendingWork: vi.fn().mockReturnValue(false),
      } as never,
      () => ({
        health: vi.fn(),
        upload: vi.fn(),
        delete: vi.fn(),
        getFile: vi.fn(),
        getChanges: vi.fn(),
        getHistory: vi.fn(),
        getDevices: vi.fn(),
        getVaults: vi.fn(),
        getSnapshot,
        createVault: vi.fn(),
        restoreFile: vi.fn(),
      }),
    );

    await controller.bootstrapJoinedVaultState("vault-a", [
      {
        path: "notes/matched.md",
        hash: "hash-a",
        mtime: 100,
      },
      {
        path: "notes/changed.md",
        hash: "local-hash",
        mtime: 200,
      },
      {
        path: "notes/local-only.md",
        hash: "local-only-hash",
        mtime: 300,
      },
    ]);

    expect(getSnapshot).toHaveBeenCalledWith("vault-a");
    expect(state).toEqual({
      vaultId: "vault-a",
      files: {
        "notes/matched.md": {
          hash: "hash-a",
          version: 3,
          mtime: 100,
          deleted: false,
        },
      },
      lastSeq: 0,
      lastSyncAt: null,
      lastSyncError: null,
    });
    expect(persistData).toHaveBeenCalledTimes(1);
  });
});

function createController(
  apiFactory: (serverUrl: string, authToken: string) => {
    health: () => Promise<void>;
    upload: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    getFile: ReturnType<typeof vi.fn>;
    getChanges: ReturnType<typeof vi.fn>;
    getHistory: ReturnType<typeof vi.fn>;
    getDevices: ReturnType<typeof vi.fn>;
    getVaults: ReturnType<typeof vi.fn>;
    getSnapshot?: ReturnType<typeof vi.fn>;
    createVault: ReturnType<typeof vi.fn>;
    restoreFile: ReturnType<typeof vi.fn>;
  },
): SettingsController {
  let settings = { ...DEFAULT_SETTINGS };
  let state = { ...DEFAULT_STATE };

  return new SettingsController(
    () => settings,
    (nextSettings) => {
      settings = nextSettings;
    },
    () => state,
    (nextState) => {
      state = nextState;
    },
    vi.fn().mockResolvedValue(undefined),
    new PluginStateStore(),
    new E2eeState(),
    {
      markDirty: vi.fn(),
      restartAutoSync: vi.fn(),
      pauseAutoSync: vi.fn(),
      runManualSync: vi.fn(),
      hasPendingWork: vi.fn().mockReturnValue(false),
    } as never,
    (serverUrl, authToken) => ({
      getSnapshot: vi.fn(),
      ...apiFactory(serverUrl, authToken),
    }),
  );
}

async function createEncryptedFileResponse(
  vaultId: string,
  path: string,
  passphrase: string,
): Promise<FileResponse> {
  const envelope = await encryptBytes(new TextEncoder().encode("hello from vault"), passphrase);
  const payload = serializeEnvelope(envelope);

  return {
    path,
    hash: `${vaultId}-hash`,
    version: 1,
    deleted: false,
    content_b64: bytesToBase64(payload),
    content_format: "e2ee-envelope-v1",
  };
}
