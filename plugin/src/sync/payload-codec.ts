import { decryptEnvelope, encryptBytes, parseEnvelope, serializeEnvelope } from "../e2ee/crypto";
import { t } from "../i18n";
import { createSyncError } from "./errors";
import type { ContentFormat } from "../types";

export interface EncodedSyncPayload {
  contentBase64: string;
  payloadHash: string;
  contentFormat: ContentFormat;
}

export async function encodeSyncPayload(
  data: Uint8Array,
  localHash: string,
  passphrase: string,
  rememberValidatedPassphrase: () => Promise<void>,
): Promise<EncodedSyncPayload> {
  const normalizedPassphrase = passphrase.trim();
  if (!normalizedPassphrase) {
    return {
      contentBase64: bytesToBase64(data),
      payloadHash: localHash,
      contentFormat: "plain",
    };
  }

  await rememberValidatedPassphrase();
  const envelope = await encryptBytes(data, normalizedPassphrase);
  const serializedEnvelope = serializeEnvelope(envelope);
  return {
    contentBase64: bytesToBase64(serializedEnvelope),
    payloadHash: await sha256Hex(serializedEnvelope),
    contentFormat: "e2ee-envelope-v1",
  };
}

export async function decodeSyncPayload(
  payloadBase64: string,
  contentFormat: ContentFormat,
  passphrase: string,
  rememberValidatedPassphrase: () => Promise<void>,
): Promise<Uint8Array> {
  const payload = base64ToBytes(payloadBase64);
  if (contentFormat === "plain") {
    return payload;
  }

  const normalizedPassphrase = passphrase.trim();
  if (!normalizedPassphrase) {
    throw createSyncError("missing_passphrase", t("sync.errors.decryptRequired"));
  }

  await rememberValidatedPassphrase();
  return decryptEnvelope(parseEnvelope(payload), normalizedPassphrase);
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}

export function bytesToBase64(data: Uint8Array): string {
  let text = "";
  for (const byte of data) {
    text += String.fromCharCode(byte);
  }
  return btoa(text);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    output[i] = binary.charCodeAt(i);
  }
  return output;
}
