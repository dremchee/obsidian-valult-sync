import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api";
import { SyncCoordinator } from "../sync/coordinator";
import { createSyncError } from "../sync/errors";
import type { SyncSettings, SyncState } from "../types";

const DEFAULT_SETTINGS: SyncSettings = {
  serverUrl: "http://127.0.0.1:3000",
  vaultId: "vault-a",
  includePatterns: [],
  ignorePatterns: [],
  deviceId: "device-local",
  authToken: "secret-token",
  pollIntervalSecs: 2,
  autoSync: true,
};

const DEFAULT_STATE: SyncState = {
  vaultId: "vault-a",
  files: {},
  lastSeq: 0,
  lastSyncAt: null,
  lastSyncError: null,
};

describe("SyncCoordinator", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("stops background sync when realtime reports unauthorized", async () => {
    let unauthorizedHandler: () => void = () => {};
    const realtimeStop = vi.fn();
    const realtimeRestart = vi.fn();
    const setState = vi.fn().mockResolvedValue(undefined);
    const syncOnce = vi.fn().mockResolvedValue(undefined);

    const coordinator = new SyncCoordinator(
      () => DEFAULT_SETTINGS,
      () => DEFAULT_STATE,
      setState,
      syncOnce,
      (_getSettings, _getState, _onRemoteChange, onUnauthorized) => {
        unauthorizedHandler = onUnauthorized;
        return {
          restart: realtimeRestart,
          stop: realtimeStop,
        } as never;
      },
    );

    coordinator.restartAutoSync();
    unauthorizedHandler();
    await coordinator.runBackgroundSync();

    expect(realtimeRestart).toHaveBeenCalledTimes(1);
    expect(realtimeStop).toHaveBeenCalledTimes(1);
    expect(syncOnce).not.toHaveBeenCalled();
    expect(setState).not.toHaveBeenCalled();
  });

  it("stops background sync on persistent passphrase errors", async () => {
    const realtimeStop = vi.fn();
    const realtimeRestart = vi.fn();
    const setState = vi.fn().mockResolvedValue(undefined);
    const syncOnce = vi.fn().mockRejectedValue(
      createSyncError("fingerprint_mismatch", "passphrase does not match"),
    );

    const coordinator = new SyncCoordinator(
      () => DEFAULT_SETTINGS,
      () => DEFAULT_STATE,
      setState,
      syncOnce,
      (_getSettings, _getState, _onRemoteChange, _onUnauthorized) => ({
        restart: realtimeRestart,
        stop: realtimeStop,
      } as never),
    );

    coordinator.restartAutoSync();
    await coordinator.runBackgroundSync();
    await coordinator.runBackgroundSync();

    expect(realtimeRestart).toHaveBeenCalledTimes(1);
    expect(realtimeStop).toHaveBeenCalledTimes(1);
    expect(syncOnce).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSyncError: expect.objectContaining({
          code: "fingerprint_mismatch",
        }),
      }),
    );
  });

  it("stops background sync on network failures", async () => {
    const realtimeStop = vi.fn();
    const realtimeRestart = vi.fn();
    const setState = vi.fn().mockResolvedValue(undefined);
    const syncOnce = vi.fn().mockRejectedValue(new ApiError("temporary failure", 500));

    const coordinator = new SyncCoordinator(
      () => DEFAULT_SETTINGS,
      () => DEFAULT_STATE,
      setState,
      syncOnce,
      (_getSettings, _getState, _onRemoteChange, _onUnauthorized) => ({
        restart: realtimeRestart,
        stop: realtimeStop,
      } as never),
    );

    coordinator.restartAutoSync();
    await coordinator.runBackgroundSync();
    await coordinator.runBackgroundSync();

    expect(realtimeRestart).toHaveBeenCalledTimes(1);
    expect(realtimeStop).toHaveBeenCalledTimes(1);
    expect(syncOnce).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSyncError: expect.objectContaining({
          code: "network_error",
        }),
      }),
    );
  });
});
