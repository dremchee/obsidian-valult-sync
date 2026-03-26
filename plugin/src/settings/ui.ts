import { ApiError } from "../api";
import { t } from "../i18n";

export function formatLastSyncAt(value: number | null): string {
  if (value === null) {
    return t("settings.common.never");
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleString();
}

export function buildE2eeStatusText(fingerprint: string | null, passphrase: string): string {
  if (!fingerprint) {
    return passphrase.trim()
      ? t("settings.helpers.e2eeLoadedPendingFingerprint")
      : t("settings.helpers.e2eeOff");
  }

  if (!passphrase.trim()) {
    return t("settings.helpers.e2eeFingerprintMissingPassphrase", {
      fingerprint: fingerprint.slice(0, 12),
    });
  }

  return t("settings.helpers.e2eeFingerprintLoaded", {
    fingerprint: fingerprint.slice(0, 12),
  });
}

export function formatDeviceError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return t("settings.helpers.authFailed");
    }
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
