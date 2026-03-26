import { ApiError } from "../api";
import { t } from "../i18n";
import type { SyncErrorCode, SyncErrorState } from "../types";

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
      return {
        code: "unauthorized",
        message: t("sync.errors.unauthorizedDetailed"),
      };
    }

    if (error.code === "invalid_vault_id") {
      return {
        code: "invalid_settings",
        message: t("sync.errors.invalidVaultId"),
      };
    }

    if (error.code === "invalid_device_id") {
      return {
        code: "invalid_settings",
        message: t("sync.errors.invalidDeviceId"),
      };
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
    return t("sync.errors.noRecentErrors");
  }

  switch (state.code) {
    case "network_error":
      return t("sync.errors.network", {
        message: state.message,
      });
    case "unauthorized":
      return t("sync.errors.unauthorized");
    case "missing_passphrase":
      return t("sync.errors.missingPassphrase");
    case "fingerprint_mismatch":
      return t("sync.errors.fingerprintMismatch");
    case "decrypt_failed":
      return t("sync.errors.decryptFailed");
    case "invalid_e2ee_envelope":
      return t("sync.errors.invalidEnvelope");
    case "invalid_settings":
      return state.message;
    case "unknown_error":
      return state.message;
    default:
      return state.message;
  }
}
