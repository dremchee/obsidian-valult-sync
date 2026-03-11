import { afterEach, describe, expect, it, vi } from "vitest";

import { RealtimeSyncClient, parseRealtimeSseBuffer } from "../sync/realtime";
import type { SyncSettings, SyncState } from "../types";

describe("sync realtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses SSE payloads and keeps trailing remainder", () => {
    const parsed = parseRealtimeSseBuffer(
      [
        "event: change",
        "data: {\"latest_seq\":2}",
        "",
        ": keepalive",
        "",
        "event: change",
        "data: {\"latest_seq\":3}",
      ].join("\n"),
    );

    expect(parsed.events).toEqual([{ latest_seq: 2 }]);
    expect(parsed.remainder).toContain("\"latest_seq\":3");
  });

  it("does not connect without an auth token", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const client = new RealtimeSyncClient(
      () => ({
        serverUrl: "http://127.0.0.1:3000",
        vaultId: "default",
        includePatterns: [],
        ignorePatterns: [],
        deviceId: "device-local",
        authToken: "",
        pollIntervalSecs: 2,
        autoSync: true,
      } satisfies SyncSettings),
      () => ({
        vaultId: "default",
        files: {},
        lastSeq: 0,
        lastSyncAt: null,
        lastSyncError: null,
      } satisfies SyncState),
      async () => {},
    );

    client.restart();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
