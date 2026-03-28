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
