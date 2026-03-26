import { buildPassphraseFingerprint } from "./crypto";
import { t } from "../i18n";
import { createSyncError } from "../sync/errors";

export class E2eeState {
  private readonly fingerprintsByVaultId: Record<string, string>;
  private readonly sessionPassphrasesByVaultId: Record<string, string> = {};

  constructor(initialFingerprintsByVaultId: Record<string, string> = {}) {
    this.fingerprintsByVaultId = { ...initialFingerprintsByVaultId };
  }

  exportFingerprints(): Record<string, string> {
    return { ...this.fingerprintsByVaultId };
  }

  replaceFingerprints(nextFingerprintsByVaultId: Record<string, string>): void {
    for (const vaultId of Object.keys(this.fingerprintsByVaultId)) {
      delete this.fingerprintsByVaultId[vaultId];
    }

    Object.assign(this.fingerprintsByVaultId, nextFingerprintsByVaultId);
  }

  forgetVault(vaultId: string): void {
    delete this.fingerprintsByVaultId[vaultId];
    delete this.sessionPassphrasesByVaultId[vaultId];
  }

  getPassphrase(vaultId: string): string {
    return this.sessionPassphrasesByVaultId[vaultId] ?? "";
  }

  setPassphrase(vaultId: string, passphrase: string): void {
    const trimmed = passphrase.trim();
    if (!trimmed) {
      delete this.sessionPassphrasesByVaultId[vaultId];
      return;
    }

    this.sessionPassphrasesByVaultId[vaultId] = passphrase;
  }

  getFingerprint(vaultId: string): string | null {
    return this.fingerprintsByVaultId[vaultId] ?? null;
  }

  async validatePassphrase(vaultId: string): Promise<string> {
    const passphrase = this.getPassphrase(vaultId).trim();
    const fingerprint = this.getFingerprint(vaultId);

    if (!fingerprint) {
      return passphrase
        ? t("settings.e2ee.validation.pendingFingerprint")
        : t("settings.e2ee.validation.notConfigured");
    }

    if (!passphrase) {
      throw createSyncError("missing_passphrase", t("settings.e2ee.validation.passphraseRequired"));
    }

    const currentFingerprint = await buildPassphraseFingerprint(vaultId, passphrase);
    if (currentFingerprint !== fingerprint) {
      throw createSyncError("fingerprint_mismatch", t("settings.e2ee.validation.fingerprintMismatch"));
    }

    return t("settings.e2ee.validation.matchesFingerprint", {
      fingerprint: shortFingerprint(fingerprint),
    });
  }

  async rememberPassphrase(vaultId: string): Promise<boolean> {
    const passphrase = this.getPassphrase(vaultId).trim();
    if (!passphrase) {
      return false;
    }

    const currentFingerprint = await buildPassphraseFingerprint(vaultId, passphrase);
    const knownFingerprint = this.getFingerprint(vaultId);
    if (knownFingerprint && knownFingerprint !== currentFingerprint) {
      throw createSyncError("fingerprint_mismatch", t("settings.e2ee.validation.fingerprintMismatch"));
    }

    if (!knownFingerprint) {
      this.fingerprintsByVaultId[vaultId] = currentFingerprint;
      return true;
    }

    return false;
  }

  clearFingerprint(vaultId: string): boolean {
    if (!(vaultId in this.fingerprintsByVaultId)) {
      return false;
    }

    delete this.fingerprintsByVaultId[vaultId];
    return true;
  }
}

function shortFingerprint(value: string): string {
  return value.slice(0, 12);
}
