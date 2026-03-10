import { ApiError } from "./api";
import type { SyncErrorCode, SyncErrorState } from "./types";

export class SyncError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

export function createSyncError(code: SyncErrorCode, message: string): SyncError {
  return new SyncError(code, message);
}

export function toSyncErrorState(error: unknown): SyncErrorState {
  if (error instanceof SyncError) {
    return { code: error.code, message: error.message };
  }

  if (error instanceof ApiError) {
    if (error.status === 401) {
      return { code: "unauthorized", message: "Unauthorized. Check Auth token in plugin settings." };
    }

    if (error.code === "invalid_vault_id") {
      return { code: "invalid_settings", message: "Vault ID is invalid. Use only letters, digits, '-' or '_'." };
    }

    if (error.code === "invalid_device_id") {
      return { code: "invalid_settings", message: "Device ID is invalid. Use only letters, digits, '-' or '_'." };
    }

    return { code: "network_error", message: error.message };
  }

  if (error instanceof Error) {
    return { code: "unknown_error", message: error.message };
  }

  return { code: "unknown_error", message: String(error) };
}

export function formatSyncErrorState(state: SyncErrorState | null): string {
  if (!state) {
    return "None";
  }

  return `${state.code}: ${state.message}`;
}
