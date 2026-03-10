import { createSyncError } from "./sync-errors";
import type { E2eeEnvelope } from "./types";

const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH_BITS = 256;
const IV_LENGTH_BYTES = 12;
const SALT_LENGTH_BYTES = 16;

export async function deriveContentKey(
  passphrase: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const passphraseBytes = new TextEncoder().encode(passphrase);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(passphraseBytes),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations,
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: KEY_LENGTH_BITS,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function buildPassphraseFingerprint(
  vaultId: string,
  passphrase: string,
): Promise<string> {
  const input = new TextEncoder().encode(`obsidian-sync:e2ee-fingerprint:v1:${vaultId}\n${passphrase}`);
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(input));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function encryptBytes(
  plaintext: Uint8Array,
  passphrase: string,
): Promise<E2eeEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const key = await deriveContentKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
    },
    key,
    toArrayBuffer(plaintext),
  );

  return {
    v: 1,
    alg: "AES-GCM-256",
    kdf: "PBKDF2-SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt_b64: bytesToBase64(salt),
    iv_b64: bytesToBase64(iv),
    ciphertext_b64: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptEnvelope(
  envelope: E2eeEnvelope,
  passphrase: string,
): Promise<Uint8Array> {
  if (envelope.v !== 1) {
    throw createSyncError("invalid_e2ee_envelope", `Unsupported envelope version: ${String(envelope.v)}`);
  }

  if (envelope.alg !== "AES-GCM-256") {
    throw createSyncError("invalid_e2ee_envelope", `Unsupported envelope algorithm: ${envelope.alg}`);
  }

  if (envelope.kdf !== "PBKDF2-SHA-256") {
    throw createSyncError("invalid_e2ee_envelope", `Unsupported envelope KDF: ${envelope.kdf}`);
  }

  const salt = base64ToBytes(envelope.salt_b64);
  const iv = base64ToBytes(envelope.iv_b64);
  const ciphertext = base64ToBytes(envelope.ciphertext_b64);
  const key = await deriveContentKey(passphrase, salt, envelope.iterations);

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
      },
      key,
      toArrayBuffer(ciphertext),
    );
    return new Uint8Array(plaintext);
  } catch {
    throw createSyncError("decrypt_failed", "Failed to decrypt E2EE payload");
  }
}

export function serializeEnvelope(envelope: E2eeEnvelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(envelope));
}

export function parseEnvelope(data: Uint8Array): E2eeEnvelope {
  let parsed: Partial<E2eeEnvelope>;

  try {
    parsed = JSON.parse(new TextDecoder().decode(data)) as Partial<E2eeEnvelope>;
  } catch {
    throw createSyncError("invalid_e2ee_envelope", "Invalid E2EE envelope");
  }

  if (
    parsed.v !== 1 ||
    parsed.alg !== "AES-GCM-256" ||
    parsed.kdf !== "PBKDF2-SHA-256" ||
    typeof parsed.iterations !== "number" ||
    typeof parsed.salt_b64 !== "string" ||
    typeof parsed.iv_b64 !== "string" ||
    typeof parsed.ciphertext_b64 !== "string"
  ) {
    throw createSyncError("invalid_e2ee_envelope", "Invalid E2EE envelope");
  }

  return {
    v: 1,
    alg: "AES-GCM-256",
    kdf: "PBKDF2-SHA-256",
    iterations: parsed.iterations,
    salt_b64: parsed.salt_b64,
    iv_b64: parsed.iv_b64,
    ciphertext_b64: parsed.ciphertext_b64,
  };
}

export function isE2eeEnvelope(data: Uint8Array): boolean {
  try {
    parseEnvelope(data);
    return true;
  } catch {
    return false;
  }
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function bytesToBase64(data: Uint8Array): string {
  let text = "";
  for (const byte of data) {
    text += String.fromCharCode(byte);
  }
  return btoa(text);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    output[i] = binary.charCodeAt(i);
  }
  return output;
}
