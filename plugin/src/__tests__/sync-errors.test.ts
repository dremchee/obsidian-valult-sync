import { describe, expect, it } from "vitest";

import { ApiError } from "../api";
import { createSyncError, formatSyncErrorState, toSyncErrorState } from "../sync-errors";

describe("sync-errors", () => {
  it("preserves explicit sync error codes", () => {
    const state = toSyncErrorState(createSyncError("missing_passphrase", "Passphrase required"));

    expect(state).toEqual({
      code: "missing_passphrase",
      message: "Passphrase required",
    });
  });

  it("maps API auth errors to stable codes", () => {
    const state = toSyncErrorState(new ApiError("unauthorized", 401, "unauthorized"));

    expect(state).toEqual({
      code: "unauthorized",
      message: "Unauthorized. Check Auth token in plugin settings.",
    });
  });

  it("formats persisted sync error state for UI", () => {
    expect(formatSyncErrorState({
      code: "fingerprint_mismatch",
      message: "Fingerprint mismatch",
    })).toBe("E2EE passphrase does not match this vault.");
    expect(formatSyncErrorState(null)).toBe("No recent errors");
  });
});
