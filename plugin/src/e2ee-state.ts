import { buildPassphraseFingerprint } from "./e2ee";
import { createSyncError } from "./sync-errors";

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
        ? "No fingerprint stored yet. It will be recorded after the first encrypted sync."
        : "E2EE is not configured for this vault yet.";
    }

    if (!passphrase) {
      throw createSyncError("missing_passphrase", "E2EE passphrase is required for this vault");
    }

    const currentFingerprint = await buildPassphraseFingerprint(vaultId, passphrase);
    if (currentFingerprint !== fingerprint) {
      throw createSyncError("fingerprint_mismatch", "E2EE passphrase does not match the stored fingerprint for this vault");
    }

    return `Passphrase matches fingerprint ${shortFingerprint(fingerprint)}.`;
  }

  async rememberPassphrase(vaultId: string): Promise<boolean> {
    const passphrase = this.getPassphrase(vaultId).trim();
    if (!passphrase) {
      return false;
    }

    const currentFingerprint = await buildPassphraseFingerprint(vaultId, passphrase);
    const knownFingerprint = this.getFingerprint(vaultId);
    if (knownFingerprint && knownFingerprint !== currentFingerprint) {
      throw createSyncError("fingerprint_mismatch", "E2EE passphrase does not match the stored fingerprint for this vault");
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
