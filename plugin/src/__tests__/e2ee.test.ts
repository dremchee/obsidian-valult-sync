import { describe, expect, it } from "vitest";

import {
  buildPassphraseFingerprint,
  decryptEnvelope,
  encryptBytes,
  isE2eeEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from "../e2ee/crypto";
import { E2eeState } from "../e2ee/state";

describe("E2EE helpers", () => {
  it("round-trips encrypted content", async () => {
    const plaintext = new TextEncoder().encode("# Secret note\nhello");
    const envelope = await encryptBytes(plaintext, "correct horse battery staple");

    const decrypted = await decryptEnvelope(envelope, "correct horse battery staple");

    expect(new TextDecoder().decode(decrypted)).toBe("# Secret note\nhello");
  });

  it("fails to decrypt with a wrong passphrase", async () => {
    const envelope = await encryptBytes(
      new TextEncoder().encode("top secret"),
      "correct horse battery staple",
    );

    await expect(decryptEnvelope(envelope, "wrong passphrase")).rejects.toThrow(
      "Failed to decrypt E2EE payload",
    );
  });

  it("serializes and parses an envelope", async () => {
    const envelope = await encryptBytes(
      new TextEncoder().encode("serialized payload"),
      "correct horse battery staple",
    );

    const encoded = serializeEnvelope(envelope);
    const parsed = parseEnvelope(encoded);

    expect(parsed).toEqual(envelope);
    expect(isE2eeEnvelope(encoded)).toBe(true);
  });

  it("rejects non-envelope payloads", () => {
    const data = new TextEncoder().encode("plain markdown");

    expect(isE2eeEnvelope(data)).toBe(false);
    expect(() => parseEnvelope(data)).toThrow("Invalid E2EE envelope");
  });

  it("builds stable vault-scoped passphrase fingerprints", async () => {
    const first = await buildPassphraseFingerprint("vault-a", "correct horse battery staple");
    const second = await buildPassphraseFingerprint("vault-a", "correct horse battery staple");
    const third = await buildPassphraseFingerprint("vault-b", "correct horse battery staple");

    expect(first).toBe(second);
    expect(first).not.toBe(third);
  });

  it("locks the session passphrase per vault until the vault is forgotten", () => {
    const state = new E2eeState();

    state.setPassphrase("vault-a", "correct horse battery staple");
    expect(state.getPassphrase("vault-a")).toBe("correct horse battery staple");

    expect(() => {
      state.setPassphrase("vault-a", "different passphrase");
    }).toThrow("E2EE passphrase is already set for this vault");

    state.setPassphrase("vault-a", "");
    state.setPassphrase("vault-a", "different passphrase");
    expect(state.getPassphrase("vault-a")).toBe("different passphrase");
  });
});
