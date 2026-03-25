import { ApiError } from "../api";

export function formatLastSyncAt(value: number | null): string {
  if (value === null) {
    return "Never";
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
      ? "E2EE: passphrase loaded. A fingerprint will be saved after the first encrypted sync."
      : "E2EE: off for this vault.";
  }

  if (!passphrase.trim()) {
    return `E2EE: fingerprint ${fingerprint.slice(0, 12)} is saved, but no passphrase is loaded in this session.`;
  }

  return `E2EE: fingerprint ${fingerprint.slice(0, 12)} is saved and the session passphrase is loaded.`;
}

export function formatDeviceError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "auth failed";
    }
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
