import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../api";
import { SettingsSession, type SettingsSessionHost } from "../settings/session";
import type { SyncSettings, SyncState, VaultItem } from "../types";

const DEFAULT_SETTINGS: SyncSettings = {
  serverUrl: "http://127.0.0.1:3000",
  vaultId: "",
  includePatterns: [],
  ignorePatterns: [],
  deviceId: "device-local",
  authToken: "",
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

describe("SettingsSession", () => {
  it("keeps the view-model locked until an auth token is available", () => {
    const host = createHost();
    const session = new SettingsSession({} as never, host, createControllerStub());

    session.sync();

    expect(session.model.connection.unlocked).toBe(false);
    expect(session.model.connection.authTokenDraft).toBe("");
    expect(session.model.connection.authGateMessage.length).toBeGreaterThan(0);
    expect(session.model.connection.deviceId).toBe("device-local");
  });

  it("loads remote vaults reactively when credentials are present", async () => {
    const host = createHost({
      settings: {
        authToken: "secret-token",
      },
    });
    const vaults: VaultItem[] = [
      {
        vault_id: "vault-a",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        device_count: 1,
        e2ee_fingerprint: null,
      },
    ];
    const controller = createControllerStub({
      getRemoteVaults: vi.fn().mockResolvedValue(vaults),
    });
    const session = new SettingsSession({} as never, host, controller);

    session.sync();
    await flushPromises();

    expect(controller.getRemoteVaults).toHaveBeenCalledTimes(1);
    expect(session.model.vault.remoteVaults).toEqual(vaults);
    expect(session.model.vault.loadingRemoteVaults).toBe(false);
    expect(session.model.vault.vaultStatusText).toContain("1");
    expect(session.model.connection.deviceId).toBe("device-local");
  });

  it("loads server state on open when connected to the server", async () => {
    const host = createHost({
      settings: {
        authToken: "secret-token",
        vaultId: "vault-a",
      },
    });
    const controller = createControllerStub({
      checkConnection: vi.fn().mockResolvedValue("ready"),
      getRemoteVaults: vi.fn().mockResolvedValue([]),
      getRegisteredDevices: vi.fn().mockResolvedValue([
        {
          device_id: "device-a",
          first_seen_at: "2024-01-01T00:00:00Z",
          last_seen_at: "2024-01-01T00:00:00Z",
        },
      ]),
    });
    const session = new SettingsSession({} as never, host, controller);

    session.sync();
    await flushPromises();

    expect(controller.checkConnection).toHaveBeenCalledTimes(1);
    expect(controller.getRemoteVaults).toHaveBeenCalledTimes(1);
    expect(controller.getRegisteredDevices).toHaveBeenCalledWith("vault-a");
    expect(session.model.connection.connectionStatusText).toBe("ready");
    expect(session.model.overview.quickActionsStatusText).toContain("1");
  });

  it("shows device id when sync state contains an error", () => {
    const host = createHost({
      state: {
        lastSyncError: {
          code: "invalid_settings",
          message: "bad device id",
        },
      },
    });
    const session = new SettingsSession({} as never, host, createControllerStub());

    session.sync();

    expect(session.model.connection.deviceId).toBe("device-local");
  });

  it("shows device id when loading remote vaults fails", async () => {
    const host = createHost({
      settings: {
        authToken: "secret-token",
      },
    });
    const controller = createControllerStub({
      getRemoteVaults: vi.fn().mockRejectedValue(new Error("network failed")),
    });
    const session = new SettingsSession({} as never, host, controller);

    session.sync();
    await flushPromises();

    expect(session.model.vault.remoteVaultsError).toContain("network failed");
    expect(session.model.connection.deviceId).toBe("device-local");
  });

  it("signs out through actions and updates the reactive model without remount assumptions", async () => {
    const host = createHost({
      settings: {
        authToken: "secret-token",
      },
    });
    const controller = createControllerStub();
    const session = new SettingsSession({} as never, host, controller);

    session.sync();
    await session.actions.onSignOut();
    await flushPromises();

    expect(host.settings.authToken).toBe("");
    expect(session.model.connection.authTokenDraft).toBe("");
    expect(session.model.connection.connectionStatusText.length).toBeGreaterThan(0);
    expect(host.persistData).toHaveBeenCalledTimes(1);
    expect(controller.restartAutoSync).toHaveBeenCalledTimes(1);
  });

  it("authorizes token by loading protected server vaults", async () => {
    const host = createHost();
    const controller = createControllerStub({
      checkConnection: vi.fn().mockResolvedValue("ready"),
      getRemoteVaults: vi.fn().mockResolvedValue([]),
    });
    const session = new SettingsSession({} as never, host, controller);

    session.sync();
    session.actions.onAuthTokenDraftChange("secret-token");
    await session.actions.onAuthorize();
    await flushPromises();

    expect(host.settings.authToken).toBe("secret-token");
    expect(controller.getRemoteVaults).toHaveBeenCalled();
    expect(session.model.connection.unlocked).toBe(true);
    expect(session.model.connection.editingAuthToken).toBe(false);
  });

  it("keeps the auth editor open when the token is rejected by the server", async () => {
    const host = createHost();
    const controller = createControllerStub({
      checkConnection: vi.fn().mockResolvedValue("ready"),
      getRemoteVaults: vi.fn().mockRejectedValue(new ApiError("unauthorized", 401, "unauthorized")),
    });
    const session = new SettingsSession({} as never, host, controller);

    session.sync();
    session.actions.onAuthTokenDraftChange("bad-token");
    await session.actions.onAuthorize();
    await flushPromises();

    expect(session.model.connection.unlocked).toBe(false);
    expect(session.model.connection.authGateMessage).toContain("token");
  });
});

function createHost(input?: {
  settings?: Partial<SyncSettings>;
  state?: Partial<SyncState>;
}): SettingsSessionHost & { persistData: ReturnType<typeof vi.fn> } {
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      ...input?.settings,
    },
    state: {
      ...DEFAULT_STATE,
      ...input?.state,
    },
    persistData: vi.fn().mockResolvedValue(undefined),
  };
}

function createControllerStub(overrides?: Partial<Record<keyof ControllerStub, unknown>>): ControllerStub {
  return {
    setE2eePassphrase: vi.fn(),
    createVault: vi.fn(),
    bindVault: vi.fn(),
    rememberCurrentE2eePassphrase: vi.fn(),
    validateVaultJoinPassphrase: vi.fn().mockResolvedValue(undefined),
    hasRemoteVaultContent: vi.fn().mockResolvedValue(false),
    getRemoteVaults: vi.fn().mockResolvedValue([]),
    checkConnection: vi.fn().mockResolvedValue("ready"),
    restartAutoSync: vi.fn(),
    runManualSync: vi.fn().mockResolvedValue(undefined),
    getRegisteredDevices: vi.fn().mockResolvedValue([]),
    hasPendingSyncWork: vi.fn().mockReturnValue(false),
    disconnectVault: vi.fn().mockResolvedValue(undefined),
    forgetLocalState: vi.fn().mockResolvedValue(undefined),
    updateCurrentVaultScope: vi.fn(),
    getE2eeFingerprint: vi.fn().mockReturnValue(null),
    getE2eePassphrase: vi.fn().mockReturnValue(""),
    ...overrides,
  } as ControllerStub;
}

type ControllerStub = {
  setE2eePassphrase: ReturnType<typeof vi.fn>;
  createVault: ReturnType<typeof vi.fn>;
  bindVault: ReturnType<typeof vi.fn>;
  rememberCurrentE2eePassphrase: ReturnType<typeof vi.fn>;
  validateVaultJoinPassphrase: ReturnType<typeof vi.fn>;
  hasRemoteVaultContent: ReturnType<typeof vi.fn>;
  getRemoteVaults: ReturnType<typeof vi.fn>;
  checkConnection: ReturnType<typeof vi.fn>;
  restartAutoSync: ReturnType<typeof vi.fn>;
  runManualSync: ReturnType<typeof vi.fn>;
  getRegisteredDevices: ReturnType<typeof vi.fn>;
  hasPendingSyncWork: ReturnType<typeof vi.fn>;
  disconnectVault: ReturnType<typeof vi.fn>;
  forgetLocalState: ReturnType<typeof vi.fn>;
  updateCurrentVaultScope: ReturnType<typeof vi.fn>;
  getE2eeFingerprint: ReturnType<typeof vi.fn>;
  getE2eePassphrase: ReturnType<typeof vi.fn>;
};

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
